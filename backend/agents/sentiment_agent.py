"""
Sentiment Agent: Aggregates bull/bear sentiment from options PCR, news sentiment,
market breadth (A/D ratio), and volume profile.
"""

import asyncio
import logging
import math
from datetime import datetime
from typing import Optional, Callable, Dict, List, Any
import yfinance as yf

from agents.guardian_agent import AgentHeartbeat, heartbeat_sleep

logger = logging.getLogger(__name__)


def compute_market_regime(
    pcr: Optional[float],
    india_vix: Optional[float],
    news_sentiment_avg: float,
    advance_decline_ratio: float,
    nifty_vs_ema20: Optional[float],
) -> Dict:
    """
    Compute market regime: RISK_ON / RISK_OFF / NEUTRAL.
    Uses weighted scoring of 5 independent signals.
    """
    score = 0.0
    signals = []

    # PCR signal: <0.7 = very bullish, >1.3 = very bearish
    if pcr is not None:
        if pcr < 0.7:
            score += 2.0
            signals.append(f"PCR={pcr:.2f} (extreme call buying = BULL)")
        elif pcr < 0.9:
            score += 1.0
            signals.append(f"PCR={pcr:.2f} (mild bullish)")
        elif pcr > 1.3:
            score -= 2.0
            signals.append(f"PCR={pcr:.2f} (extreme put buying = BEAR)")
        elif pcr > 1.1:
            score -= 1.0
            signals.append(f"PCR={pcr:.2f} (mild bearish)")
        else:
            signals.append(f"PCR={pcr:.2f} (neutral)")

    # India VIX: <12 = complacent, 12-20 = normal, >20 = fear
    if india_vix is not None:
        if india_vix < 12:
            score += 1.0
            signals.append(f"VIX={india_vix:.1f} (very low fear)")
        elif india_vix < 17:
            score += 0.5
            signals.append(f"VIX={india_vix:.1f} (low fear)")
        elif india_vix > 25:
            score -= 2.0
            signals.append(f"VIX={india_vix:.1f} (HIGH FEAR)")
        elif india_vix > 20:
            score -= 1.0
            signals.append(f"VIX={india_vix:.1f} (elevated fear)")

    # News sentiment: -1 to +1 average
    score += news_sentiment_avg * 1.5
    sentiment_label = "POSITIVE" if news_sentiment_avg > 0.1 else ("NEGATIVE" if news_sentiment_avg < -0.1 else "NEUTRAL")
    signals.append(f"News sentiment={news_sentiment_avg:.2f} ({sentiment_label})")

    # Advance/Decline: >1.5 = broad advance, <0.7 = broad decline
    if advance_decline_ratio > 1.5:
        score += 1.5
        signals.append(f"A/D={advance_decline_ratio:.2f} (broad advance)")
    elif advance_decline_ratio < 0.7:
        score -= 1.5
        signals.append(f"A/D={advance_decline_ratio:.2f} (broad decline)")
    else:
        signals.append(f"A/D={advance_decline_ratio:.2f} (mixed breadth)")

    # Nifty vs EMA20
    if nifty_vs_ema20 is not None:
        if nifty_vs_ema20 > 2.0:
            score += 1.0
            signals.append(f"Nifty {nifty_vs_ema20:.1f}% above EMA20 (extended)")
        elif nifty_vs_ema20 > 0:
            score += 0.5
            signals.append(f"Nifty {nifty_vs_ema20:.1f}% above EMA20")
        elif nifty_vs_ema20 < -3.0:
            score -= 1.5
            signals.append(f"Nifty {nifty_vs_ema20:.1f}% below EMA20 (breakdown)")
        else:
            score -= 0.5
            signals.append(f"Nifty {nifty_vs_ema20:.1f}% below EMA20")

    # Normalize score to -1 to +1
    max_score = 8.0
    normalized = max(-1.0, min(1.0, score / max_score))

    if normalized > 0.3:
        regime = "RISK_ON"
    elif normalized < -0.3:
        regime = "RISK_OFF"
    else:
        regime = "NEUTRAL"

    return {
        "regime": regime,
        "bull_bear_score": round(normalized, 2),
        "score_raw": round(score, 2),
        "signals": signals[:5],
    }


def compute_volume_sentiment(symbol_volumes: Dict[str, Dict]) -> Dict:
    """
    Analyze volume to detect institutional accumulation/distribution.
    High volume up-days vs high volume down-days.
    """
    up_volume = sum(d["volume"] for d in symbol_volumes.values()
                    if d.get("change_pct", 0) > 0)
    down_volume = sum(d["volume"] for d in symbol_volumes.values()
                      if d.get("change_pct", 0) < 0)
    total = up_volume + down_volume

    if total == 0:
        return {"volume_sentiment": "NEUTRAL", "up_volume_pct": 50.0}

    up_pct = up_volume / total * 100
    if up_pct > 65:
        vol_sentiment = "ACCUMULATION"
    elif up_pct < 35:
        vol_sentiment = "DISTRIBUTION"
    else:
        vol_sentiment = "NEUTRAL"

    return {
        "volume_sentiment": vol_sentiment,
        "up_volume_pct": round(up_pct, 1),
        "down_volume_pct": round(100 - up_pct, 1),
    }


class SentimentAgent:
    def __init__(self, ws_broadcast: Optional[Callable] = None):
        self._broadcast = ws_broadcast
        self._running = False
        self._state: Dict[str, Any] = {}

    async def start(self):
        self._running = True
        logger.info("SentimentAgent started")

        await self._refresh()

        while self._running:
            AgentHeartbeat.beat("sentiment")
            try:
                await self._refresh()
            except Exception as e:
                logger.error("SentimentAgent error: %s", e)
            await heartbeat_sleep("sentiment", 300)

    async def stop(self):
        self._running = False

    async def _refresh(self):
        """Compute and cache market sentiment."""
        from data.nse_data import fetch_india_vix, fetch_nse_option_chain, fetch_nifty_indices
        from db.database import get_sqlite

        india_vix = await fetch_india_vix()

        nifty_chain = await fetch_nse_option_chain("NIFTY")
        pcr = nifty_chain.get("pcr") if nifty_chain else None

        db = await get_sqlite()
        news_sentiment = await self._get_avg_news_sentiment(db)

        indices = await fetch_nifty_indices()
        advance_decline = await self._get_advance_decline()
        nifty_ema_diff = await self._get_nifty_vs_ema(db)

        regime = compute_market_regime(
            pcr=pcr,
            india_vix=india_vix,
            news_sentiment_avg=news_sentiment,
            advance_decline_ratio=advance_decline.get("ratio", 1.0),
            nifty_vs_ema20=nifty_ema_diff,
        )

        self._state = {
            **regime,
            "advance_decline": advance_decline,
            "india_vix": india_vix,
            "pcr_nifty": pcr,
            "updated_at": datetime.now().isoformat(),
        }

        if self._broadcast:
            await self._broadcast({"type": "sentiment_update", "data": self._state})

        logger.debug("Sentiment: %s (score=%.2f)", regime["regime"], regime["bull_bear_score"])

    async def _get_avg_news_sentiment(self, db) -> float:
        """Get average news sentiment from last 100 articles."""
        try:
            async with db.execute(
                "SELECT AVG(sentiment) FROM news WHERE created_at > datetime('now', '-1 day')"
            ) as cur:
                row = await cur.fetchone()
            return float(row[0]) if row and row[0] is not None else 0.0
        except Exception:
            return 0.0

    async def _get_advance_decline(self) -> Dict:
        """Get advance/decline ratio from NSE indices."""
        try:
            import asyncio
            from data.nse_data import ALL_TRACKED, _YF_EXECUTOR
            loop = asyncio.get_event_loop()
            df = await loop.run_in_executor(
                _YF_EXECUTOR, lambda: yf.download(
                    "^NSEI ^NSEMDCP50",
                    period="1d", interval="1d", progress=False
                )
            )
            advances = 0
            declines = 0
            unchanged = 0

            for sym in ALL_TRACKED[:100]:
                try:
                    q = await asyncio.get_event_loop().run_in_executor(
                        _YF_EXECUTOR, lambda s=sym: yf.Ticker(f"{s}.NS").fast_info
                    )
                    chg = getattr(q, "day_change", None) or getattr(q, "previous_close", None)
                    if chg is not None:
                        if chg > 0:
                            advances += 1
                        elif chg < 0:
                            declines += 1
                        else:
                            unchanged += 1
                except Exception:
                    pass

            total = advances + declines + unchanged or 1
            ratio = advances / max(declines, 1)
            return {
                "advances": advances,
                "declines": declines,
                "unchanged": unchanged,
                "ratio": round(ratio, 2),
                "advances_pct": round(advances / total * 100, 1),
            }
        except Exception as e:
            logger.debug("advance_decline: %s", e)
            return {"advances": 0, "declines": 0, "unchanged": 0, "ratio": 1.0}

    async def _get_nifty_vs_ema(self, db) -> Optional[float]:
        """Get Nifty's current deviation from EMA20."""
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            df = await loop.run_in_executor(
                None, lambda: yf.download("^NSEI", period="3mo", interval="1d",
                                           auto_adjust=True, progress=False)
            )
            if df is None or df.empty or len(df) < 20:
                return None

            close = df["Close"].astype(float)
            ema20 = close.ewm(span=20).mean().iloc[-1]
            current = float(close.iloc[-1])
            return round((current - ema20) / ema20 * 100, 2)
        except Exception as e:
            logger.debug("nifty_vs_ema: %s", e)
            return None

    def get_state(self) -> Dict:
        return self._state or {
            "regime": "NEUTRAL",
            "bull_bear_score": 0.0,
            "advance_decline": {"advances": 0, "declines": 0, "unchanged": 0, "ratio": 1.0},
            "india_vix": None,
            "pcr_nifty": None,
            "updated_at": datetime.now().isoformat(),
        }
