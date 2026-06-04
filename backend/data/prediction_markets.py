"""
Prediction Markets: Polymarket + Manifold Markets
Polymarket: gamma-api (free, no auth)
Manifold:   manifold.markets API (free, no auth) — replaces Kalshi (now paywalled)
"""

import asyncio
import aiohttp
import logging
import json
import time
from typing import List, Dict, Any
from datetime import datetime

logger = logging.getLogger(__name__)

_poly_cache: List[Dict] = []
_poly_ts: float = 0
_manifold_cache: List[Dict] = []
_manifold_ts: float = 0
CACHE_TTL = 120  # 2 minutes

# Headers that prevent brotli encoding issues
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; BTI/1.0)",
    "Accept": "application/json",
    "Accept-Encoding": "gzip, deflate",   # explicitly no 'br'
}


async def fetch_polymarket(limit: int = 50) -> List[Dict]:
    """Fetch active Polymarket markets (highest liquidity first)."""
    global _poly_cache, _poly_ts
    now = time.time()
    if _poly_cache and (now - _poly_ts) < CACHE_TTL:
        return _poly_cache

    url = (
        "https://gamma-api.polymarket.com/markets"
        f"?active=true&closed=false&limit={limit}"
        "&order=liquidity&ascending=false"
    )
    try:
        async with aiohttp.ClientSession(headers=_HEADERS) as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as r:
                if r.status == 200:
                    data = await r.json(content_type=None)
                    result = []
                    for m in data:
                        outcomes = m.get("outcomes", [])
                        probs = []
                        try:
                            out_prices = m.get("outcomePrices", "[]")
                            if isinstance(out_prices, str):
                                out_prices = json.loads(out_prices)
                            probs = [round(float(p) * 100, 1) for p in out_prices]
                        except Exception:
                            pass

                        result.append({
                            "id":            m.get("id", ""),
                            "question":      m.get("question", ""),
                            "category":      m.get("category", ""),
                            "end_date":      m.get("endDate", ""),
                            "volume":        float(m.get("volume", 0) or 0),
                            "liquidity":     float(m.get("liquidity", 0) or 0),
                            "outcomes":      outcomes,
                            "probabilities": probs,
                            "url":           f"https://polymarket.com/event/{m.get('slug', '')}",
                            "source":        "Polymarket",
                        })
                    _poly_cache = result
                    _poly_ts = now
                    logger.info("Polymarket: %d markets loaded", len(result))
                    return result
                else:
                    body = await r.text()
                    logger.warning("Polymarket HTTP %s: %s", r.status, body[:200])
    except Exception as e:
        logger.warning("Polymarket fetch failed: %s", e)
    return _poly_cache or []


async def fetch_manifold(limit: int = 50) -> List[Dict]:
    """
    Fetch prediction markets from Manifold Markets (free, open API).
    Returns markets sorted by 24h volume — covers finance, crypto, global events.
    """
    global _manifold_cache, _manifold_ts
    now = time.time()
    if _manifold_cache and (now - _manifold_ts) < CACHE_TTL:
        return _manifold_cache

    url = f"https://api.manifold.markets/v0/markets?limit={limit}&sort=last-bet-time"
    try:
        async with aiohttp.ClientSession(headers=_HEADERS) as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as r:
                if r.status == 200:
                    data = await r.json(content_type=None)
                    result = []
                    for m in data:
                        # Only binary markets have clear yes/no probabilities
                        mtype = m.get("outcomeType", "")
                        prob = m.get("probability", 0.5)
                        result.append({
                            "id":           m.get("id", ""),
                            "question":     m.get("question", ""),
                            "category":     m.get("groupSlugs", ["general"])[0] if m.get("groupSlugs") else "general",
                            "end_date":     m.get("closeTime", ""),
                            "volume":       float(m.get("totalLiquidity", 0) or 0),
                            "yes_price":    round(prob * 100, 1) if mtype == "BINARY" else None,
                            "no_price":     round((1 - prob) * 100, 1) if mtype == "BINARY" else None,
                            "outcome_type": mtype,
                            "url":          m.get("url", ""),
                            "source":       "Manifold",
                            "creator":      m.get("creatorName", ""),
                            "unique_bettors": m.get("uniqueBettorCount", 0),
                        })
                    _manifold_cache = result
                    _manifold_ts = now
                    logger.info("Manifold: %d markets loaded", len(result))
                    return result
                else:
                    body = await r.text()
                    logger.warning("Manifold HTTP %s: %s", r.status, body[:200])
    except Exception as e:
        logger.warning("Manifold fetch failed: %s", e)
    return _manifold_cache or []


async def fetch_all_prediction_markets() -> Dict:
    poly, manifold = await asyncio.gather(
        fetch_polymarket(50),
        fetch_manifold(50),
        return_exceptions=True,
    )
    return {
        "polymarket": poly     if isinstance(poly,     list) else [],
        "kalshi":     manifold if isinstance(manifold, list) else [],   # keep key name for frontend compat
        "updated_at": datetime.now().isoformat(),
    }
