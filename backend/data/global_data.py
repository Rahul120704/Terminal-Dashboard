"""
Global market data: Crypto top-100, FX pairs, Global indices, Commodities.
Sources: CoinGecko (free), yfinance for FX+indices.
"""

import asyncio
import aiohttp
import yfinance as yf
import logging
import time
import math
from typing import Dict, List, Any, Optional
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

# ── Cache ──────────────────────────────────────────────────────────────────────
_crypto_cache: List[Dict] = []
_crypto_ts: float = 0
_forex_cache: Dict[str, Any] = {}
_forex_ts: float = 0
_global_cache: List[Dict] = []
_global_ts: float = 0

CRYPTO_TTL  = 15       # seconds — refresh every 15s for live crypto broadcaster
FOREX_TTL   = 30
GLOBAL_TTL  = 60

# Dedicated thread pool to avoid blocking event loop
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="global_data")

# ── Global Indices definition ──────────────────────────────────────────────────
GLOBAL_INDICES = [
    # USA
    {"symbol": "^GSPC",    "name": "S&P 500",           "region": "USA"},
    {"symbol": "^DJI",     "name": "Dow Jones",          "region": "USA"},
    {"symbol": "^IXIC",    "name": "NASDAQ",             "region": "USA"},
    {"symbol": "^RUT",     "name": "Russell 2000",       "region": "USA"},
    {"symbol": "^VIX",     "name": "CBOE VIX",           "region": "USA"},
    # UK / Europe
    {"symbol": "^FTSE",    "name": "FTSE 100",           "region": "UK"},
    {"symbol": "^GDAXI",   "name": "DAX",                "region": "Germany"},
    {"symbol": "^FCHI",    "name": "CAC 40",             "region": "France"},
    # Asia
    {"symbol": "^N225",    "name": "Nikkei 225",         "region": "Japan"},
    {"symbol": "^HSI",     "name": "Hang Seng",          "region": "HongKong"},
    {"symbol": "000001.SS","name": "Shanghai Composite", "region": "China"},
    {"symbol": "^AXJO",    "name": "ASX 200",            "region": "Australia"},
    # India
    {"symbol": "^BSESN",   "name": "BSE Sensex",         "region": "India"},
    {"symbol": "^NSEI",    "name": "Nifty 50",           "region": "India"},
    {"symbol": "^NSEBANK", "name": "Nifty Bank",         "region": "India"},
    {"symbol": "^CNXIT",   "name": "Nifty IT",           "region": "India"},
    {"symbol": "^INDIAVIX","name": "India VIX",          "region": "India"},
    # Commodities
    {"symbol": "GC=F",     "name": "Gold Futures",       "region": "Commodities"},
    {"symbol": "SI=F",     "name": "Silver Futures",     "region": "Commodities"},
    {"symbol": "CL=F",     "name": "Crude Oil (WTI)",    "region": "Commodities"},
    {"symbol": "BZ=F",     "name": "Brent Crude",        "region": "Commodities"},
    {"symbol": "NG=F",     "name": "Natural Gas",        "region": "Commodities"},
    {"symbol": "HG=F",     "name": "Copper",             "region": "Commodities"},
    # Bonds
    {"symbol": "^TNX",     "name": "US 10Y Treasury",    "region": "Bonds"},
    {"symbol": "^TYX",     "name": "US 30Y Treasury",    "region": "Bonds"},
    {"symbol": "^IRX",     "name": "US 3M T-Bill",       "region": "Bonds"},
]

FOREX_PAIRS = [
    "USDINR=X","EURUSD=X","GBPUSD=X","USDJPY=X","AUDUSD=X","USDCAD=X",
    "USDCHF=X","NZDUSD=X","USDCNY=X","USDSGD=X","USDHKD=X","USDKRW=X",
    "DX-Y.NYB","EURINR=X","GBPINR=X","JPYINR=X",
]


def _safe_float(v) -> Optional[float]:
    """Convert to float, return None if NaN/inf/None."""
    try:
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except Exception:
        return None


def _fetch_ticker_info(symbol: str) -> Optional[Dict]:
    """Fetch a single ticker using yfinance fast_info (no crumb issues)."""
    try:
        t = yf.Ticker(symbol)
        fi = t.fast_info
        price = _safe_float(fi.get("lastPrice") or fi.get("last_price"))
        prev  = _safe_float(fi.get("previousClose") or fi.get("previous_close"))
        hi    = _safe_float(fi.get("dayHigh") or fi.get("day_high"))
        lo    = _safe_float(fi.get("dayLow")  or fi.get("day_low"))
        if price is None:
            # fallback: 2-day history
            h = t.history(period="2d", interval="1d", timeout=8)
            if h.empty:
                return None
            price = _safe_float(h["Close"].iloc[-1])
            prev  = _safe_float(h["Close"].iloc[-2]) if len(h) >= 2 else price
            hi    = _safe_float(h["High"].iloc[-1])
            lo    = _safe_float(h["Low"].iloc[-1])

        chg = ((price - prev) / prev * 100) if (price is not None and prev and prev != 0) else 0.0
        return {
            "price":      round(price, 4) if price is not None else None,
            "change_pct": round(chg, 3),
            "high":       round(hi, 4) if hi is not None else price,
            "low":        round(lo, 4) if lo is not None else price,
        }
    except Exception as e:
        logger.debug("_fetch_ticker_info %s: %s", symbol, e)
        return None


def _batch_fetch(symbols: List[str]) -> Dict[str, Optional[Dict]]:
    """Fetch multiple tickers in parallel threads — runs in executor."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    results = {}
    with ThreadPoolExecutor(max_workers=min(8, len(symbols))) as pool:
        futures = {pool.submit(_fetch_ticker_info, sym): sym for sym in symbols}
        for f in as_completed(futures, timeout=20):
            sym = futures[f]
            try:
                results[sym] = f.result()
            except Exception:
                results[sym] = None
    return results


# ── Crypto ─────────────────────────────────────────────────────────────────────
async def fetch_crypto_markets(limit: int = 100) -> List[Dict]:
    """Fetch top-N cryptos from CoinGecko (free, no key needed)."""
    global _crypto_cache, _crypto_ts
    now = time.time()
    if _crypto_cache and (now - _crypto_ts) < CRYPTO_TTL:
        return _crypto_cache

    url = (
        f"https://api.coingecko.com/api/v3/coins/markets"
        f"?vs_currency=usd&order=market_cap_desc&per_page={limit}&page=1"
        f"&sparkline=false&price_change_percentage=1h,24h,7d"
    )
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as r:
                if r.status == 200:
                    data = await r.json()
                    result = []
                    for c in data:
                        result.append({
                            "symbol":         c.get("symbol", "").upper(),
                            "name":           c.get("name", ""),
                            "price":          _safe_float(c.get("current_price")),
                            "market_cap":     _safe_float(c.get("market_cap")),
                            "volume_24h":     _safe_float(c.get("total_volume")),
                            "change_1h":      _safe_float(c.get("price_change_percentage_1h_in_currency")),
                            "change_24h":     _safe_float(c.get("price_change_percentage_24h")),
                            "change_7d":      _safe_float(c.get("price_change_percentage_7d_in_currency")),
                            "high_24h":       _safe_float(c.get("high_24h")),
                            "low_24h":        _safe_float(c.get("low_24h")),
                            "rank":           c.get("market_cap_rank"),
                            "image":          c.get("image", ""),
                            "ath":            _safe_float(c.get("ath")),
                            "ath_change_pct": _safe_float(c.get("ath_change_percentage")),
                        })
                    _crypto_cache = result
                    _crypto_ts = now
                    logger.info("CoinGecko: %d coins fetched", len(result))
                    return result
                else:
                    logger.warning("CoinGecko HTTP %s", r.status)
    except asyncio.TimeoutError:
        logger.warning("CoinGecko timeout")
    except Exception as e:
        logger.warning("CoinGecko fetch failed: %s", e)
    return _crypto_cache or []


# ── Forex ──────────────────────────────────────────────────────────────────────
async def fetch_forex_rates() -> Dict[str, Any]:
    """Fetch FX rates using per-ticker fast_info (avoids 401 issues)."""
    global _forex_cache, _forex_ts
    now = time.time()
    if _forex_cache and (now - _forex_ts) < FOREX_TTL:
        return _forex_cache

    loop = asyncio.get_event_loop()
    name_map = {x["symbol"]: x["name"] for x in GLOBAL_INDICES}
    try:
        raw = await asyncio.wait_for(
            loop.run_in_executor(_executor, lambda: _batch_fetch(FOREX_PAIRS)),
            timeout=25,
        )
        result = {}
        for pair in FOREX_PAIRS:
            info = raw.get(pair)
            if info:
                result[pair] = {
                    "symbol":     pair,
                    "name":       name_map.get(pair, pair),
                    "price":      info["price"],
                    "change_pct": info["change_pct"],
                    "region":     "FX",
                }
        if result:
            _forex_cache = result
            _forex_ts = now
            logger.info("Forex: %d pairs fetched", len(result))
        return result
    except asyncio.TimeoutError:
        logger.warning("Forex batch timeout")
    except Exception as e:
        logger.warning("Forex fetch failed: %s", e)
    return _forex_cache or {}


# ── Global Indices ─────────────────────────────────────────────────────────────
async def fetch_global_markets() -> List[Dict]:
    """Fetch global indices + commodities + bonds via parallel per-symbol fast_info."""
    global _global_cache, _global_ts
    now = time.time()
    if _global_cache and (now - _global_ts) < GLOBAL_TTL:
        return _global_cache

    symbols_to_fetch = [x["symbol"] for x in GLOBAL_INDICES]
    loop = asyncio.get_event_loop()
    try:
        raw = await asyncio.wait_for(
            loop.run_in_executor(_executor, lambda: _batch_fetch(symbols_to_fetch)),
            timeout=30,
        )
        result = []
        for idx in GLOBAL_INDICES:
            sym  = idx["symbol"]
            info = raw.get(sym)
            if info:
                result.append({
                    "symbol":     sym,
                    "name":       idx["name"],
                    "region":     idx["region"],
                    "price":      info["price"],
                    "change_pct": info["change_pct"],
                    "high":       info["high"],
                    "low":        info["low"],
                })
        if result:
            _global_cache = result
            _global_ts = now
            logger.info("Global markets: %d symbols fetched", len(result))
        return result
    except asyncio.TimeoutError:
        logger.warning("Global markets batch timeout — returning cached")
    except Exception as e:
        logger.warning("Global markets fetch failed: %s", e)
    return _global_cache or []


async def fetch_all_global() -> Dict:
    """One-call aggregation of all global data."""
    try:
        crypto, forex, indices = await asyncio.gather(
            fetch_crypto_markets(100),
            fetch_forex_rates(),
            fetch_global_markets(),
            return_exceptions=True,
        )
        return {
            "crypto":     crypto  if isinstance(crypto,  list) else [],
            "forex":      forex   if isinstance(forex,   dict) else {},
            "indices":    indices if isinstance(indices, list) else [],
            "updated_at": datetime.now().isoformat(),
        }
    except Exception as e:
        logger.error("fetch_all_global: %s", e)
        return {"crypto": [], "forex": {}, "indices": [], "updated_at": datetime.now().isoformat()}
