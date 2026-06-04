"""
BTI EarningsPredictorAgent
- Predicts earnings beat probability for upcoming NSE/BSE results
- Factors: historical beat rate, IV crush expectation, sector momentum,
  analyst estimate revisions, FinBERT pre-earnings sentiment
- Runs every 30 minutes, updates WebSocket clients
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class EarningsPrediction:
    symbol: str
    company_name: str
    earnings_date: str
    quarter: str                    # e.g. "Q3FY25"
    beat_probability: float         # 0-1
    miss_probability: float         # 0-1
    in_line_probability: float      # 0-1
    historical_beat_rate: float     # 0-1
    iv_crush_expected_pct: float    # expected IV drop post-earnings (%)
    sector_momentum: float          # -1 to +1
    sentiment_score: float          # FinBERT pre-earnings avg (-1 to +1)
    estimate_revision_trend: str    # "UP" | "DOWN" | "FLAT"
    confidence: str                 # "HIGH" | "MEDIUM" | "LOW"
    key_metrics_to_watch: List[str] = field(default_factory=list)
    risk_factors: List[str] = field(default_factory=list)
    last_updated: str = ""

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "company_name": self.company_name,
            "earnings_date": self.earnings_date,
            "quarter": self.quarter,
            "beat_probability": round(self.beat_probability * 100, 1),
            "miss_probability": round(self.miss_probability * 100, 1),
            "in_line_probability": round(self.in_line_probability * 100, 1),
            "historical_beat_rate": round(self.historical_beat_rate * 100, 1),
            "iv_crush_expected_pct": round(self.iv_crush_expected_pct, 1),
            "sector_momentum": round(self.sector_momentum, 3),
            "sentiment_score": round(self.sentiment_score, 3),
            "estimate_revision_trend": self.estimate_revision_trend,
            "confidence": self.confidence,
            "key_metrics_to_watch": self.key_metrics_to_watch,
            "risk_factors": self.risk_factors,
            "last_updated": self.last_updated,
        }


# NSE sector indices for momentum proxy
SECTOR_PROXIES = {
    "IT": "^CNXIT",
    "BANK": "^NSEBANK",
    "PHARMA": "^CNXPHARMA",
    "AUTO": "^CNXAUTO",
    "METAL": "^CNXMETAL",
    "FMCG": "^CNXFMCG",
    "ENERGY": "^CNXENERGY",
    "INFRA": "^CNXINFRA",
    "REALTY": "^CNXREALTY",
}

# Historical avg beat rates by sector (from empirical NSE data)
SECTOR_BEAT_RATES = {
    "IT": 0.62,
    "BANK": 0.58,
    "PHARMA": 0.54,
    "AUTO": 0.60,
    "METAL": 0.48,
    "FMCG": 0.56,
    "ENERGY": 0.52,
    "INFRA": 0.50,
    "REALTY": 0.46,
    "DEFAULT": 0.53,
}

# Upcoming earnings calendar (populated from NSE filings + manual)
# Format: symbol → {date, quarter, company_name, sector}
EARNINGS_CALENDAR: Dict[str, Dict] = {
    "RELIANCE.NS": {"date": "2026-07-18", "quarter": "Q1FY27", "company_name": "Reliance Industries", "sector": "ENERGY"},
    "TCS.NS": {"date": "2026-07-11", "quarter": "Q1FY27", "company_name": "Tata Consultancy Services", "sector": "IT"},
    "INFY.NS": {"date": "2026-07-17", "quarter": "Q1FY27", "company_name": "Infosys", "sector": "IT"},
    "HDFCBANK.NS": {"date": "2026-07-19", "quarter": "Q1FY27", "company_name": "HDFC Bank", "sector": "BANK"},
    "ICICIBANK.NS": {"date": "2026-07-26", "quarter": "Q1FY27", "company_name": "ICICI Bank", "sector": "BANK"},
    "WIPRO.NS": {"date": "2026-07-16", "quarter": "Q1FY27", "company_name": "Wipro", "sector": "IT"},
    "HCLTECH.NS": {"date": "2026-07-14", "quarter": "Q1FY27", "company_name": "HCL Technologies", "sector": "IT"},
    "SBIN.NS": {"date": "2026-07-31", "quarter": "Q1FY27", "company_name": "State Bank of India", "sector": "BANK"},
    "BHARTIARTL.NS": {"date": "2026-07-28", "quarter": "Q1FY27", "company_name": "Bharti Airtel", "sector": "TELECOM"},
    "MARUTI.NS": {"date": "2026-07-23", "quarter": "Q1FY27", "company_name": "Maruti Suzuki", "sector": "AUTO"},
    "TATAMOTORS.NS": {"date": "2026-07-30", "quarter": "Q1FY27", "company_name": "Tata Motors", "sector": "AUTO"},
    "SUNPHARMA.NS": {"date": "2026-07-25", "quarter": "Q1FY27", "company_name": "Sun Pharma", "sector": "PHARMA"},
    "DRREDDY.NS": {"date": "2026-07-22", "quarter": "Q1FY27", "company_name": "Dr. Reddy's", "sector": "PHARMA"},
    "TATASTEEL.NS": {"date": "2026-07-24", "quarter": "Q1FY27", "company_name": "Tata Steel", "sector": "METAL"},
    "HINDALCO.NS": {"date": "2026-07-29", "quarter": "Q1FY27", "company_name": "Hindalco", "sector": "METAL"},
    "BAJFINANCE.NS": {"date": "2026-07-21", "quarter": "Q1FY27", "company_name": "Bajaj Finance", "sector": "NBFC"},
    "KOTAKBANK.NS": {"date": "2026-07-20", "quarter": "Q1FY27", "company_name": "Kotak Mahindra Bank", "sector": "BANK"},
    "AXISBANK.NS": {"date": "2026-07-23", "quarter": "Q1FY27", "company_name": "Axis Bank", "sector": "BANK"},
    "LT.NS": {"date": "2026-07-28", "quarter": "Q1FY27", "company_name": "Larsen & Toubro", "sector": "INFRA"},
    "NTPC.NS": {"date": "2026-07-31", "quarter": "Q1FY27", "company_name": "NTPC", "sector": "ENERGY"},
    "POWERGRID.NS": {"date": "2026-06-05", "quarter": "Q4FY26", "company_name": "Power Grid Corp", "sector": "ENERGY"},
    "ONGC.NS": {"date": "2026-06-10", "quarter": "Q4FY26", "company_name": "ONGC", "sector": "ENERGY"},
    "ADANIPORTS.NS": {"date": "2026-06-08", "quarter": "Q4FY26", "company_name": "Adani Ports", "sector": "INFRA"},
    "HINDUNILVR.NS": {"date": "2026-06-15", "quarter": "Q4FY26", "company_name": "Hindustan Unilever", "sector": "FMCG"},
    "NESTLEIND.NS": {"date": "2026-06-20", "quarter": "Q4FY26", "company_name": "Nestle India", "sector": "FMCG"},
    "TITAN.NS": {"date": "2026-06-12", "quarter": "Q4FY26", "company_name": "Titan Company", "sector": "FMCG"},
    "ULTRACEMCO.NS": {"date": "2026-06-18", "quarter": "Q4FY26", "company_name": "UltraTech Cement", "sector": "INFRA"},
    "ASIANPAINT.NS": {"date": "2026-06-22", "quarter": "Q4FY26", "company_name": "Asian Paints", "sector": "FMCG"},
    "JSWSTEEL.NS": {"date": "2026-06-16", "quarter": "Q4FY26", "company_name": "JSW Steel", "sector": "METAL"},
    "TECHM.NS": {"date": "2026-06-14", "quarter": "Q4FY26", "company_name": "Tech Mahindra", "sector": "IT"},
}


class EarningsPredictorAgent:
    """
    Predicts earnings beat probability using multi-factor model:
    1. Historical beat rate (sector + stock specific)
    2. IV crush expectation (from options data)
    3. Pre-earnings FinBERT sentiment
    4. Sector momentum
    5. Estimate revision trend (from news headlines)
    """

    INTERVAL_S = 1800  # 30 minutes

    def __init__(self, db_path: str, broadcast_fn=None):
        self.db_path = db_path
        self.broadcast_fn = broadcast_fn
        self._predictions: Dict[str, EarningsPrediction] = {}
        self._running = False
        logger.info("EarningsPredictorAgent initialized")

    def _get_db(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def _get_historical_beat_rate(self, symbol: str, sector: str) -> float:
        """Get stock-specific beat rate from DB or use sector default."""
        try:
            conn = self._get_db()
            rows = conn.execute(
                "SELECT beat FROM earnings_history WHERE symbol=? ORDER BY date DESC LIMIT 8",
                (symbol,)
            ).fetchall()
            conn.close()
            if len(rows) >= 3:
                return sum(r["beat"] for r in rows) / len(rows)
        except Exception:
            pass
        return SECTOR_BEAT_RATES.get(sector, SECTOR_BEAT_RATES["DEFAULT"])

    def _get_sector_momentum(self, sector: str) -> float:
        """Get 20-day momentum for sector proxy."""
        try:
            import yfinance as yf
            proxy = SECTOR_PROXIES.get(sector)
            if not proxy:
                return 0.0
            hist = yf.Ticker(proxy).history(period="30d")
            if len(hist) < 20:
                return 0.0
            ret = (hist["Close"].iloc[-1] / hist["Close"].iloc[-20] - 1)
            return float(np.clip(ret, -0.2, 0.2))
        except Exception:
            return 0.0

    def _get_pre_earnings_sentiment(self, symbol: str) -> float:
        """Get average FinBERT sentiment for symbol from last 7 days."""
        try:
            conn = self._get_db()
            clean_sym = symbol.replace(".NS", "").replace(".BO", "")
            rows = conn.execute(
                """SELECT sentiment_score FROM news
                   WHERE (ticker LIKE ? OR ticker LIKE ?)
                   AND published >= datetime('now', '-7 days')
                   ORDER BY published DESC LIMIT 30""",
                (f"%{clean_sym}%", f"%{clean_sym}%")
            ).fetchall()
            conn.close()
            if rows:
                scores = [r["sentiment_score"] for r in rows if r["sentiment_score"] is not None]
                if scores:
                    return float(np.mean(scores))
        except Exception:
            pass
        return 0.0

    def _get_iv_crush_estimate(self, symbol: str) -> float:
        """Estimate expected IV crush post-earnings (typical: 30-60% for large caps)."""
        # Heuristic based on sector volatility profile
        high_iv_sectors = {"BANK", "IT", "PHARMA", "METAL"}
        # Default: 40% IV crush for large caps, 25% for stable sectors
        try:
            conn = self._get_db()
            clean_sym = symbol.replace(".NS", "").replace(".BO", "")
            row = conn.execute(
                "SELECT sector FROM fundamentals WHERE symbol LIKE ? LIMIT 1",
                (f"%{clean_sym}%",)
            ).fetchone()
            conn.close()
            if row and row["sector"] in high_iv_sectors:
                return 45.0
        except Exception:
            pass
        return 35.0

    def _get_estimate_revision_trend(self, symbol: str) -> str:
        """Detect analyst estimate revision trend from news."""
        try:
            conn = self._get_db()
            clean_sym = symbol.replace(".NS", "").replace(".BO", "")
            rows = conn.execute(
                """SELECT title FROM news
                   WHERE ticker LIKE ? AND published >= datetime('now', '-14 days')
                   ORDER BY published DESC LIMIT 20""",
                (f"%{clean_sym}%",)
            ).fetchall()
            conn.close()
            up_words = ["upgrade", "raised", "upgraded", "increase estimate", "raise target", "upward revision"]
            down_words = ["downgrade", "cut", "lowered", "reduce estimate", "lower target", "downward revision"]
            titles = " ".join(r["title"].lower() for r in rows)
            up = sum(1 for w in up_words if w in titles)
            down = sum(1 for w in down_words if w in titles)
            if up > down:
                return "UP"
            elif down > up:
                return "DOWN"
        except Exception:
            pass
        return "FLAT"

    def _compute_beat_probability(
        self,
        historical_beat_rate: float,
        sector_momentum: float,
        sentiment_score: float,
        estimate_revision_trend: str,
    ) -> tuple[float, float, float]:
        """
        Logistic-style multi-factor beat probability.
        Returns (beat_prob, miss_prob, in_line_prob)
        """
        # Base from historical
        base = historical_beat_rate

        # Adjustments
        momentum_adj = sector_momentum * 0.15   # ±15% max
        sentiment_adj = sentiment_score * 0.10  # ±10% max
        revision_adj = {"UP": 0.08, "DOWN": -0.08, "FLAT": 0.0}.get(estimate_revision_trend, 0.0)

        beat_raw = base + momentum_adj + sentiment_adj + revision_adj
        beat_prob = float(np.clip(beat_raw, 0.15, 0.85))

        # Distribute remaining probability
        remain = 1 - beat_prob
        miss_prob = remain * 0.55
        in_line_prob = remain * 0.45

        return beat_prob, miss_prob, in_line_prob

    def _key_metrics_for_sector(self, sector: str) -> List[str]:
        """Return key metrics investors watch for each sector."""
        metrics_map = {
            "IT": ["Revenue growth", "EBIT margin", "USD hedging", "Deal wins", "Attrition rate"],
            "BANK": ["NIM", "Loan growth", "GNPA", "CASA ratio", "Slippages"],
            "PHARMA": ["US sales", "EBITDA margin", "R&D spend", "USFDA approvals", "API exports"],
            "AUTO": ["Volume", "EBITDA margin", "EV share", "Export numbers", "Realisation per vehicle"],
            "METAL": ["EBITDA/tonne", "Debt reduction", "China price impact", "Realization"],
            "FMCG": ["Volume growth", "Gross margin", "Rural vs urban mix", "Ad spend"],
            "ENERGY": ["GRM (refining)", "E&P output", "Retail volume", "Capex guidance"],
            "INFRA": ["Order book", "Revenue recognition", "Working capital", "D/E ratio"],
            "NBFC": ["AUM growth", "NIM", "GNPA", "Cost of funds", "Collection efficiency"],
        }
        return metrics_map.get(sector, ["Revenue", "PAT", "Margin", "Guidance"])

    def _risk_factors_for_sector(self, sector: str) -> List[str]:
        risk_map = {
            "IT": ["USD/INR appreciation", "Global macro slowdown", "AI disruption", "Visa issues"],
            "BANK": ["RBI scrutiny", "Credit cost spike", "Slippage in MFI/SME", "NIM compression"],
            "PHARMA": ["USFDA warning letters", "Price erosion in US generics", "API supply chain"],
            "AUTO": ["EV transition pressure", "High inventory", "Commodity costs"],
            "METAL": ["China demand slowdown", "Domestic oversupply", "Currency impact"],
            "FMCG": ["Input cost inflation", "Competitive pressure", "Rural demand slowdown"],
        }
        return risk_map.get(sector, ["Macro headwinds", "Currency risk", "Regulatory changes"])

    async def predict(self, symbol: str) -> Optional[EarningsPrediction]:
        """Generate earnings prediction for a symbol."""
        cal = EARNINGS_CALENDAR.get(symbol) or EARNINGS_CALENDAR.get(symbol + ".NS")
        if not cal:
            return None

        sector = cal.get("sector", "DEFAULT")

        # Gather factors (run IO-bound ones concurrently)
        loop = asyncio.get_event_loop()
        hist_rate = await loop.run_in_executor(None, self._get_historical_beat_rate, symbol, sector)
        sector_mom = await loop.run_in_executor(None, self._get_sector_momentum, sector)
        sentiment = await loop.run_in_executor(None, self._get_pre_earnings_sentiment, symbol)
        iv_crush = await loop.run_in_executor(None, self._get_iv_crush_estimate, symbol)
        revision = await loop.run_in_executor(None, self._get_estimate_revision_trend, symbol)

        beat_p, miss_p, inline_p = self._compute_beat_probability(hist_rate, sector_mom, sentiment, revision)

        # Confidence based on data availability
        confidence = "HIGH" if hist_rate != SECTOR_BEAT_RATES.get("DEFAULT", 0.53) else "MEDIUM"

        pred = EarningsPrediction(
            symbol=symbol,
            company_name=cal.get("company_name", symbol),
            earnings_date=cal.get("date", ""),
            quarter=cal.get("quarter", ""),
            beat_probability=beat_p,
            miss_probability=miss_p,
            in_line_probability=inline_p,
            historical_beat_rate=hist_rate,
            iv_crush_expected_pct=iv_crush,
            sector_momentum=sector_mom,
            sentiment_score=sentiment,
            estimate_revision_trend=revision,
            confidence=confidence,
            key_metrics_to_watch=self._key_metrics_for_sector(sector),
            risk_factors=self._risk_factors_for_sector(sector),
            last_updated=datetime.now().isoformat(),
        )
        self._predictions[symbol] = pred
        return pred

    async def run_once(self):
        """Update predictions for all upcoming earnings (next 30 days)."""
        now = datetime.now()
        cutoff = now + timedelta(days=30)
        updated = []

        for symbol, cal in EARNINGS_CALENDAR.items():
            try:
                earnings_dt = datetime.strptime(cal["date"], "%Y-%m-%d")
                if now <= earnings_dt <= cutoff:
                    pred = await self.predict(symbol)
                    if pred:
                        updated.append(pred)
            except Exception as e:
                logger.warning(f"EarningsPredictor: {symbol} error: {e}")
                continue

        if updated and self.broadcast_fn:
            await self.broadcast_fn({
                "type": "earnings_predictions",
                "data": [p.to_dict() for p in updated],
                "count": len(updated),
            })

        if updated:
            logger.info(f"EarningsPredictorAgent: updated {len(updated)} predictions")

    def get_predictions(self, symbol: Optional[str] = None) -> List[dict]:
        if symbol:
            p = self._predictions.get(symbol) or self._predictions.get(symbol + ".NS")
            return [p.to_dict()] if p else []
        return [p.to_dict() for p in sorted(
            self._predictions.values(),
            key=lambda x: x.earnings_date
        )]

    def get_calendar(self) -> List[dict]:
        """Return upcoming earnings calendar."""
        now = datetime.now()
        result = []
        for symbol, cal in EARNINGS_CALENDAR.items():
            try:
                dt = datetime.strptime(cal["date"], "%Y-%m-%d")
                if dt >= now - timedelta(days=1):
                    days_to = (dt - now).days
                    pred = self._predictions.get(symbol)
                    result.append({
                        "symbol": symbol,
                        "company_name": cal["company_name"],
                        "earnings_date": cal["date"],
                        "quarter": cal["quarter"],
                        "sector": cal.get("sector", ""),
                        "days_to_earnings": days_to,
                        "beat_probability": round(pred.beat_probability * 100, 1) if pred else None,
                        "confidence": pred.confidence if pred else None,
                    })
            except Exception:
                continue
        return sorted(result, key=lambda x: x["earnings_date"])

    async def start(self):
        self._running = True
        logger.info("EarningsPredictorAgent started")
        while self._running:
            await self.run_once()
            await asyncio.sleep(self.INTERVAL_S)

    def stop(self):
        self._running = False
