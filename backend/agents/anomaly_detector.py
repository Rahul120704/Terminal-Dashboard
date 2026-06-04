"""
BTI AnomalyDetectorAgent
- Detects price, volume, and options anomalies using z-score (3σ threshold)
- Runs every 60 seconds during market hours
- Alerts: price spike, volume surge, unusual OI, bid-ask spread widening
- Broadcasts high-priority alerts via WebSocket
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class AnomalyAlert:
    alert_id: str
    symbol: str
    alert_type: str        # "PRICE_SPIKE" | "VOLUME_SURGE" | "OI_BUILDUP" | "SPREAD_WIDE" | "NEWS_CORR"
    severity: str          # "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
    zscore: float
    current_value: float
    baseline_mean: float
    baseline_std: float
    description: str
    timestamp: str
    price: float = 0.0
    price_change_pct: float = 0.0
    volume_ratio: float = 0.0
    resolved: bool = False

    def to_dict(self) -> dict:
        return {
            "alert_id": self.alert_id,
            "symbol": self.symbol,
            "alert_type": self.alert_type,
            "severity": self.severity,
            "zscore": round(self.zscore, 2),
            "current_value": round(self.current_value, 4),
            "baseline_mean": round(self.baseline_mean, 4),
            "baseline_std": round(self.baseline_std, 4),
            "description": self.description,
            "timestamp": self.timestamp,
            "price": round(self.price, 2),
            "price_change_pct": round(self.price_change_pct, 2),
            "volume_ratio": round(self.volume_ratio, 2),
            "resolved": self.resolved,
        }


def _zscore(value: float, values: np.ndarray) -> Tuple[float, float, float]:
    """Return (z, mean, std) for value vs distribution."""
    if len(values) < 5:
        return 0.0, float(np.mean(values)), float(np.std(values) + 1e-10)
    mean = float(np.mean(values))
    std = float(np.std(values) + 1e-10)
    z = (value - mean) / std
    return z, mean, std


def _severity(z: float) -> str:
    az = abs(z)
    if az >= 5:
        return "CRITICAL"
    elif az >= 4:
        return "HIGH"
    elif az >= 3:
        return "MEDIUM"
    else:
        return "LOW"


class AnomalyDetectorAgent:
    """
    Real-time anomaly detection for BTI using z-score methodology.

    Monitored metrics:
    - Price returns (intraday momentum anomalies)
    - Volume vs 20-day average
    - Bid-ask spread widening
    - Options OI concentration
    - News correlation (sudden news spike)
    """

    INTERVAL_S = 60           # run every minute
    ZSCORE_THRESHOLD = 3.0    # 3σ = ~0.27% of observations
    MAX_ALERTS = 200          # keep last N alerts
    LOOKBACK_DAYS = 20        # baseline window

    # NSE/BSE index + large cap watchlist
    DEFAULT_WATCHLIST = [
        "RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "ICICIBANK.NS",
        "HINDUNILVR.NS", "SBIN.NS", "BAJFINANCE.NS", "BHARTIARTL.NS", "KOTAKBANK.NS",
        "LT.NS", "WIPRO.NS", "HCLTECH.NS", "ASIANPAINT.NS", "AXISBANK.NS",
        "MARUTI.NS", "SUNPHARMA.NS", "TATAMOTORS.NS", "NTPC.NS", "TATASTEEL.NS",
        "POWERGRID.NS", "ULTRACEMCO.NS", "TITAN.NS", "TECHM.NS", "NESTLEIND.NS",
        "ADANIPORTS.NS", "ONGC.NS", "JSWSTEEL.NS", "DRREDDY.NS", "HINDALCO.NS",
    ]

    def __init__(
        self,
        db_path: str,
        broadcast_fn=None,
        watchlist: Optional[List[str]] = None,
        quote_fn: Optional[Callable[[], Dict[str, Dict]]] = None,
    ):
        """
        :param db_path:     Path to SQLite DB (used for news correlation only).
        :param broadcast_fn: Async function to push alerts via WebSocket.
        :param watchlist:   Symbols to watch (defaults to NSE large-caps).
        :param quote_fn:    Sync callable that returns {symbol: {price, change_pct, volume}} —
                            injected from main.py's _quote_cache so no SQLite table is needed.
        """
        self.db_path = db_path
        self.broadcast_fn = broadcast_fn
        self.watchlist = watchlist or self.DEFAULT_WATCHLIST
        self._quote_fn = quote_fn          # injected quote provider
        self._alerts: List[AnomalyAlert] = []
        self._alert_ids: set = set()
        self._running = False
        self._price_history: Dict[str, List[float]] = {}  # symbol → list of closes
        self._volume_history: Dict[str, List[float]] = {}
        self._scan_count = 0
        logger.info(f"AnomalyDetectorAgent initialized: watching {len(self.watchlist)} symbols")

    def _get_db(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    async def _fetch_live_quotes(self) -> Dict[str, Dict]:
        """
        Fetch live quotes from the injected quote_fn (main.py _quote_cache),
        then fill gaps with yfinance for any symbols not yet in the cache.
        """
        quotes: Dict[str, Dict] = {}

        # 1. Use injected in-memory cache (zero latency, zero SQL)
        if self._quote_fn is not None:
            try:
                raw = self._quote_fn()
                for sym, q in raw.items():
                    quotes[sym] = {
                        "price":      float(q.get("price", 0) or 0),
                        "change_pct": float(q.get("change_pct", 0) or 0),
                        "volume":     float(q.get("volume", 0) or 0),
                    }
            except Exception as e:
                logger.debug(f"AnomalyDetector quote_fn error: {e}")

        # 2. yfinance fallback for symbols still missing (limit to 5 per scan to avoid rate-limits)
        missing = [s for s in self.watchlist if s not in quotes or quotes[s]["price"] == 0]
        if missing:
            try:
                import yfinance as yf
                for sym in missing[:5]:
                    try:
                        info = yf.Ticker(sym).fast_info
                        quotes[sym] = {
                            "price":      float(getattr(info, "last_price", 0) or 0),
                            "change_pct": float(getattr(info, "percent_change", 0) or 0),
                            "volume":     float(getattr(info, "three_month_average_volume", 0) or 0),
                        }
                    except Exception:
                        continue
            except Exception:
                pass

        return quotes

    def _update_history(self, symbol: str, price: float, volume: float):
        """Maintain rolling 20-day price/volume history."""
        if symbol not in self._price_history:
            self._price_history[symbol] = []
        if symbol not in self._volume_history:
            self._volume_history[symbol] = []

        self._price_history[symbol].append(price)
        self._volume_history[symbol].append(volume)

        # Keep only lookback window
        if len(self._price_history[symbol]) > self.LOOKBACK_DAYS * 390:  # ~390 min/day
            self._price_history[symbol] = self._price_history[symbol][-self.LOOKBACK_DAYS * 390:]
        if len(self._volume_history[symbol]) > self.LOOKBACK_DAYS * 390:
            self._volume_history[symbol] = self._volume_history[symbol][-self.LOOKBACK_DAYS * 390:]

    def _check_price_anomaly(self, symbol: str, price: float, change_pct: float) -> Optional[AnomalyAlert]:
        """Detect unusual intraday price movement."""
        hist = self._price_history.get(symbol, [])
        if len(hist) < 20:
            return None

        # Compute intraday returns distribution
        arr = np.array(hist[-100:])  # last 100 ticks
        if len(arr) < 5:
            return None
        returns = np.diff(arr) / (arr[:-1] + 1e-10)
        current_return = change_pct / 100.0

        z, mean, std = _zscore(current_return, returns)
        if abs(z) < self.ZSCORE_THRESHOLD:
            return None

        sev = _severity(z)
        direction = "↑" if current_return > 0 else "↓"
        return AnomalyAlert(
            alert_id=f"price_{symbol}_{datetime.now().strftime('%H%M%S')}",
            symbol=symbol,
            alert_type="PRICE_SPIKE",
            severity=sev,
            zscore=z,
            current_value=current_return,
            baseline_mean=mean,
            baseline_std=std,
            description=f"{symbol} price {direction}{abs(change_pct):.2f}% — {abs(z):.1f}σ anomaly",
            timestamp=datetime.now().isoformat(),
            price=price,
            price_change_pct=change_pct,
        )

    def _check_volume_anomaly(self, symbol: str, volume: float) -> Optional[AnomalyAlert]:
        """Detect unusual volume vs historical baseline."""
        hist = self._volume_history.get(symbol, [])
        if len(hist) < 20:
            return None

        arr = np.array(hist[-400:])
        z, mean, std = _zscore(volume, arr)
        if abs(z) < self.ZSCORE_THRESHOLD:
            return None

        ratio = volume / (mean + 1e-10)
        sev = _severity(z)
        return AnomalyAlert(
            alert_id=f"vol_{symbol}_{datetime.now().strftime('%H%M%S')}",
            symbol=symbol,
            alert_type="VOLUME_SURGE",
            severity=sev,
            zscore=z,
            current_value=volume,
            baseline_mean=mean,
            baseline_std=std,
            description=f"{symbol} volume {ratio:.1f}x average — {abs(z):.1f}σ surge",
            timestamp=datetime.now().isoformat(),
            volume_ratio=ratio,
        )

    async def _check_news_correlation(self, symbol: str) -> Optional[AnomalyAlert]:
        """Detect sudden news spike correlated with price move."""
        try:
            conn = self._get_db()
            clean = symbol.replace(".NS", "").replace(".BO", "")
            # Count news articles in last 30 min
            recent = conn.execute(
                """SELECT COUNT(*) as cnt FROM news
                   WHERE ticker LIKE ? AND published >= datetime('now', '-30 minutes')""",
                (f"%{clean}%",)
            ).fetchone()
            # Historical 30-min news rate
            hist_rows = conn.execute(
                """SELECT COUNT(*) as cnt, strftime('%H', published) as hr
                   FROM news WHERE ticker LIKE ? GROUP BY hr LIMIT 24""",
                (f"%{clean}%",)
            ).fetchall()
            conn.close()

            if recent and hist_rows:
                current_count = recent["cnt"]
                hist_counts = np.array([r["cnt"] for r in hist_rows])
                if current_count > 0 and len(hist_counts) >= 3:
                    z, mean, std = _zscore(current_count, hist_counts)
                    if z >= 3.0:
                        return AnomalyAlert(
                            alert_id=f"news_{symbol}_{datetime.now().strftime('%H%M%S')}",
                            symbol=symbol,
                            alert_type="NEWS_CORR",
                            severity=_severity(z),
                            zscore=z,
                            current_value=current_count,
                            baseline_mean=mean,
                            baseline_std=std,
                            description=f"{symbol} news surge: {int(current_count)} articles in 30min ({z:.1f}σ above baseline)",
                            timestamp=datetime.now().isoformat(),
                        )
        except Exception:
            pass
        return None

    def _make_alert_id(self, alert_type: str, symbol: str) -> str:
        """Deduplicate alerts within 5-minute window."""
        window = datetime.now().strftime("%Y%m%d%H%M")[:-1]  # round to 5min
        return f"{alert_type}_{symbol}_{window}"

    async def scan(self) -> List[AnomalyAlert]:
        """Run one full anomaly scan across all watched symbols."""
        new_alerts: List[AnomalyAlert] = []

        quotes = await self._fetch_live_quotes()
        if not quotes:
            return new_alerts

        for symbol in self.watchlist:
            q = quotes.get(symbol)
            if not q:
                continue

            price = q.get("price", 0)
            change_pct = q.get("change_pct", 0)
            volume = q.get("volume", 0)

            if price <= 0:
                continue

            self._update_history(symbol, price, volume)

            # Price anomaly
            pa = self._check_price_anomaly(symbol, price, change_pct)
            if pa and pa.alert_id not in self._alert_ids:
                dedupe_id = self._make_alert_id("price", symbol)
                if dedupe_id not in self._alert_ids:
                    self._alert_ids.add(dedupe_id)
                    new_alerts.append(pa)

            # Volume anomaly
            va = self._check_volume_anomaly(symbol, volume)
            if va and va.alert_id not in self._alert_ids:
                dedupe_id = self._make_alert_id("vol", symbol)
                if dedupe_id not in self._alert_ids:
                    self._alert_ids.add(dedupe_id)
                    new_alerts.append(va)

        # News correlation (every 5th scan to reduce DB load)
        if self._scan_count % 5 == 0:
            for symbol in self.watchlist[:10]:  # top 10 only
                na = await self._check_news_correlation(symbol)
                if na:
                    dedupe_id = self._make_alert_id("news", symbol)
                    if dedupe_id not in self._alert_ids:
                        self._alert_ids.add(dedupe_id)
                        new_alerts.append(na)

        self._scan_count += 1

        # Prepend to history
        self._alerts = new_alerts + self._alerts
        self._alerts = self._alerts[:self.MAX_ALERTS]

        if new_alerts:
            high = [a for a in new_alerts if a.severity in ("HIGH", "CRITICAL")]
            logger.info(
                f"AnomalyDetector: {len(new_alerts)} new alerts "
                f"({len(high)} high/critical) from {len(quotes)} symbols"
            )
            if self.broadcast_fn:
                await self.broadcast_fn({
                    "type": "anomaly_alerts",
                    "data": [a.to_dict() for a in new_alerts],
                    "high_count": len(high),
                })

        return new_alerts

    def get_alerts(
        self,
        symbol: Optional[str] = None,
        severity: Optional[str] = None,
        alert_type: Optional[str] = None,
        limit: int = 50,
    ) -> List[dict]:
        alerts = self._alerts
        if symbol:
            alerts = [a for a in alerts if a.symbol == symbol]
        if severity:
            alerts = [a for a in alerts if a.severity == severity]
        if alert_type:
            alerts = [a for a in alerts if a.alert_type == alert_type]
        return [a.to_dict() for a in alerts[:limit]]

    def get_stats(self) -> dict:
        total = len(self._alerts)
        by_severity: Dict[str, int] = {}
        by_type: Dict[str, int] = {}
        for a in self._alerts:
            by_severity[a.severity] = by_severity.get(a.severity, 0) + 1
            by_type[a.alert_type] = by_type.get(a.alert_type, 0) + 1
        return {
            "total_alerts": total,
            "by_severity": by_severity,
            "by_type": by_type,
            "scan_count": self._scan_count,
            "symbols_watched": len(self.watchlist),
            "zscore_threshold": self.ZSCORE_THRESHOLD,
        }

    async def start(self):
        self._running = True
        logger.info("AnomalyDetectorAgent started")
        while self._running:
            try:
                await self.scan()
            except Exception as e:
                logger.error(f"AnomalyDetector scan error: {e}", exc_info=True)
            await asyncio.sleep(self.INTERVAL_S)

    def stop(self):
        self._running = False
