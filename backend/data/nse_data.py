"""
NSE/BSE live data fetcher.
Uses yfinance as primary + NSE unofficial API as secondary.
All NSE requests use session with cookies (required since NSE rate-limits bots).
"""

import asyncio
import aiohttp
import yfinance as yf
import pandas as pd
import numpy as np
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from tenacity import retry, stop_after_attempt, wait_exponential
import pytz

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")

# ── Dedicated yfinance thread pool ────────────────────────────────────────────
# Limits concurrent yfinance HTTP calls to prevent event-loop thread starvation.
# All blocking yfinance calls in this module use this executor.
_YF_EXECUTOR = ThreadPoolExecutor(max_workers=6, thread_name_prefix="yf-")

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",   # no 'br' — avoids brotli decode issues
    "Referer": "https://www.nseindia.com/",
    "Connection": "keep-alive",
    "X-Requested-With": "XMLHttpRequest",
}

NSE_BASE = "https://www.nseindia.com/api"
BSE_BASE = "https://api.bseindia.com/BseIndiaAPI/api"

# Top NSE stocks list (Nifty 500 universe)
NIFTY_50 = [
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
    "HINDUNILVR", "ITC", "SBIN", "BHARTIARTL", "KOTAKBANK",
    "LT", "AXISBANK", "ASIANPAINT", "MARUTI", "NTPC",
    "SUNPHARMA", "WIPRO", "ULTRACEMCO", "BAJFINANCE", "TECHM",
    "HCLTECH", "TITAN", "POWERGRID", "ONGC", "NESTLEIND",
    "TMCV", "JSWSTEEL", "TATASTEEL", "ADANIENT", "M&M",
    "BAJAJFINSV", "COALINDIA", "ADANIPORTS", "DIVISLAB", "CIPLA",
    "BPCL", "DRREDDY", "HINDALCO", "GRASIM", "BRITANNIA",
    "HDFCLIFE", "SBILIFE", "EICHERMOT", "APOLLOHOSP", "INDUSINDBK",
    "BAJAJ-AUTO", "UPL", "HEROMOTOCO", "TATACONSUM", "LTM",
]

NIFTY_NEXT_50 = [
    "PIDILITIND", "SIEMENS", "ABB", "GODREJCP", "MARICO",
    "DABUR", "COLPAL", "BERGEPAINT", "UNITDSPR", "HAVELLS",
    "INDUSTOWER", "VEDL", "GAIL", "IOC", "NMDC",
    "OFSS", "MPHASIS", "PERSISTENT", "LTTS", "COFORGE",
    "BIOCON", "TORNTPHARM", "ALKEM", "IPCALAB", "AUROPHARMA",
    "TATAPOWER", "NHPC", "RECLTD", "PFC", "IRCTC",
    "INDIGO", "JUBLFOOD", "NYKAA", "POLICYBZR", "ZOMATO",
    "PAYTM", "PNB", "BANDHANBNK", "FEDERALBNK", "IDFCFIRSTB",
    "CHOLAFIN", "MUTHOOTFIN", "SHRIRAMFIN", "MANAPPURAM", "LICHSGFIN",
    "DLF", "GODREJPROP", "PRESTIGE", "OBEROIRLTY", "PHOENIXLTD",
]

ALL_TRACKED = NIFTY_50 + NIFTY_NEXT_50

# ── Index constituent lists (for index-specific gainers/losers) ───────────────
NIFTY_BANK = [
    "HDFCBANK", "ICICIBANK", "KOTAKBANK", "AXISBANK", "SBIN",
    "INDUSINDBK", "AUBANK", "BANDHANBNK", "FEDERALBNK", "IDFCFIRSTB",
    "PNB", "BANKBARODA",
]

NIFTY_IT = [
    "TCS", "INFY", "HCLTECH", "WIPRO", "TECHM",
    "LTM", "MPHASIS", "COFORGE", "PERSISTENT", "OFSS",
]

NIFTY_PHARMA = [
    "SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB", "APOLLOHOSP",
    "TORNTPHARM", "BIOCON", "ALKEM", "IPCALAB", "AUROPHARMA",
]

NIFTY_FMCG = [
    "HINDUNILVR", "ITC", "NESTLEIND", "BRITANNIA", "DABUR",
    "MARICO", "COLPAL", "GODREJCP", "TATACONSUM", "UNITDSPR",
]

NIFTY_AUTO = [
    "MARUTI", "TMCV", "M&M", "BAJAJ-AUTO", "HEROMOTOCO",
    "EICHERMOT", "TVSMOTOR", "ASHOKLEY", "BALKRISIND", "MOTHERSON",
]

NIFTY_METAL = [
    "TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "NMDC",
    "SAIL", "HINDCOPPER", "RATNAMANI", "NATIONALUM", "COALINDIA",
]

NIFTY_ENERGY = [
    "RELIANCE", "ONGC", "BPCL", "GAIL", "IOC",
    "TATAPOWER", "NTPC", "POWERGRID", "NHPC", "ADANIGREEN",
]

NIFTY_REALTY = [
    "DLF", "GODREJPROP", "PRESTIGE", "OBEROIRLTY", "PHOENIXLTD",
    "SOBHA", "BRIGADE", "NYKAA", "MACROTECH", "SUNTECK",
]

# Map of index names → constituent lists (for API parameter matching)
INDEX_MAP: dict = {
    "NIFTY50":      NIFTY_50,
    "BANKNIFTY":    NIFTY_BANK,
    "NIFTYIT":      NIFTY_IT,
    "NIFTYPHARMA":  NIFTY_PHARMA,
    "NIFTYFMCG":    NIFTY_FMCG,
    "NIFTYAUTO":    NIFTY_AUTO,
    "NIFTYMETAL":   NIFTY_METAL,
    "NIFTYENERGY":  NIFTY_ENERGY,
    "NIFTYREALTY":  NIFTY_REALTY,
    "ALL":          ALL_TRACKED,
}


# ── Yahoo Finance symbol remapping ────────────────────────────────────────────
# Some NSE symbols have different Yahoo Finance tickers (post-merger, demerger, rename).
# Without this map, yfinance returns 404 and floods the log with errors.
_YF_SYMBOL_MAP: dict = {
    # Post-merger / post-demerger Fyers tickers → Yahoo Finance equivalents
    "LTM":        "LTIM.NS",       # LTIMindtree — Fyers uses LTM, Yahoo uses LTIM
    "TMCV":       "TATAMOTORS.NS", # Tata Motors CV (demerged from TATAMOTORS)
    "TMPV":       "TATAMOTORS.NS", # Tata Motors PV (demerged from TATAMOTORS)
    "UNITDSPR":   "UNITDSPR.NS",   # United Spirits (was MCDOWELL-N)
    # Keep old keys so any cached references still resolve
    "LTIM":       "LTIM.NS",
    "TATAMOTORS": "TATAMOTORS.NS",
    "MCDOWELL-N": "UNITDSPR.NS",
    "ZOMATO":     "ZOMATO.NS",
    "NYKAA":      "NYKAA.NS",
    "PAYTM":      "PAYTM.NS",
    "POLICYBZR":  "POLICYBZR.NS",
}

# Runtime set of symbols that have returned 401/404 this session.
# yfinance calls for these symbols are skipped — prevents log flooding.
_yf_blocklist: set = set()

def _mark_yf_failed(symbol: str) -> None:
    """Mark a symbol as failing for yfinance this session — skip future calls."""
    _yf_blocklist.add(symbol.upper().replace(".NS", ""))

def _yf_blocked(symbol: str) -> bool:
    return symbol.upper().replace(".NS", "") in _yf_blocklist


def nse_symbol(symbol: str) -> str:
    """Convert raw NSE symbol to Yahoo Finance format with known remapping."""
    sym = symbol.upper().replace(" ", "")
    if sym in _YF_SYMBOL_MAP:
        return _YF_SYMBOL_MAP[sym]
    if not sym.endswith(".NS"):
        return f"{sym}.NS"
    return sym


def strip_suffix(symbol: str) -> str:
    return symbol.replace(".NS", "").replace(".BO", "")


class NSESession:
    """Maintains a session with NSE cookies to bypass bot detection."""

    def __init__(self):
        self._session: Optional[aiohttp.ClientSession] = None
        self._cookie_refreshed = False

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=15)
            self._session = aiohttp.ClientSession(
                headers=NSE_HEADERS,
                timeout=timeout,
                connector=aiohttp.TCPConnector(ssl=False, limit=20)
            )
        return self._session

    async def _refresh_cookies(self):
        """Hit NSE homepage to get fresh cookies."""
        try:
            session = await self._get_session()
            async with session.get("https://www.nseindia.com") as resp:
                await resp.read()
            self._cookie_refreshed = True
        except Exception as e:
            logger.warning("NSE cookie refresh failed: %s", e)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=5))
    async def get(self, endpoint: str) -> Optional[Dict]:
        if not self._cookie_refreshed:
            await self._refresh_cookies()
        session = await self._get_session()
        url = f"{NSE_BASE}/{endpoint}"
        try:
            async with session.get(url) as resp:
                if resp.status == 401:
                    self._cookie_refreshed = False
                    await self._refresh_cookies()
                    async with session.get(url) as resp2:
                        return await resp2.json()
                if resp.status == 200:
                    return await resp.json()
                # 404 on option-chain-indices is expected (NSE API rotation) — debug only
                level = logger.debug if resp.status == 404 else logger.warning
                level("NSE API %s returned %d", endpoint, resp.status)
                return None
        except Exception as e:
            logger.error("NSE GET %s error: %s", endpoint, e)
            raise

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()


_nse_session = NSESession()


def _fetch_quote_sync(symbol: str) -> Optional[Dict]:
    """
    Synchronous single-symbol quote via yfinance.
    Uses fast_info.last_price for LIVE price during market hours.
    MUST only be called via run_in_executor.
    """
    import socket as _socket
    old_timeout = _socket.getdefaulttimeout()
    _socket.setdefaulttimeout(8)
    try:
        yf_sym = nse_symbol(symbol)
        ticker = yf.Ticker(yf_sym)
        info = ticker.fast_info

        # ── Live price: fast_info gives the current market price ─────────────
        # last_price is updated in real-time during market hours (not daily close)
        price      = 0.0
        prev_close = 0.0
        open_p = high_p = low_p = 0.0
        volume = 0
        try:
            price      = float(getattr(info, "last_price",              0) or 0)
            prev_close = float(getattr(info, "previous_close",          0) or 0)
            open_p     = float(getattr(info, "open",                    0) or 0)
            high_p     = float(getattr(info, "day_high",                0) or 0)
            low_p      = float(getattr(info, "day_low",                 0) or 0)
            volume     = int(  getattr(info, "three_month_average_volume", 0) or 0)
        except Exception:
            pass

        # ── Fallback: intraday 5-minute bars (today's actual traded price) ───
        if price == 0 or np.isnan(price):
            try:
                intra = ticker.history(period="1d", interval="5m")
                if intra is not None and not intra.empty:
                    price  = float(intra["Close"].iloc[-1])
                    open_p = float(intra["Open"].iloc[0])
                    high_p = float(intra["High"].max())
                    low_p  = float(intra["Low"].min())
                    volume = int(intra["Volume"].sum())
            except Exception:
                pass

        # ── Fallback to daily if still zero ──────────────────────────────────
        if price == 0 or np.isnan(price):
            hist = ticker.history(period="2d", interval="1d")
            if hist is None or hist.empty:
                return None
            price      = float(hist["Close"].iloc[-1])
            prev_close = float(hist["Close"].iloc[-2]) if len(hist) > 1 else price
            open_p     = float(hist["Open"].iloc[-1])
            high_p     = float(hist["High"].iloc[-1])
            low_p      = float(hist["Low"].iloc[-1])
            volume     = int(hist["Volume"].iloc[-1])

        if price == 0 or np.isnan(price):
            return None

        if prev_close == 0:
            prev_close = price
        change     = round(price - prev_close, 2)
        change_pct = round((change / prev_close * 100) if prev_close else 0.0, 2)

        return {
            "symbol":     strip_suffix(yf_sym),
            "price":      round(price, 2),
            "change":     change,
            "change_pct": change_pct,
            "open":       round(open_p, 2),
            "high":       round(high_p, 2),
            "low":        round(low_p, 2),
            "prev_close": round(prev_close, 2),
            "volume":     volume,
            "avg_volume": int(getattr(info, "three_month_average_volume", 0) or 0),
            "market_cap": getattr(info, "market_cap", None),
            "week_52_high": getattr(info, "year_high", None),
            "week_52_low":  getattr(info, "year_low",  None),
            "timestamp":  datetime.now(IST).isoformat(),
            "source":     "yfinance_live",
        }
    except Exception as e:
        logger.error("fetch_quote %s: %s", symbol, e)
        return None
    finally:
        _socket.setdefaulttimeout(old_timeout)


async def _fetch_quote_nse_rest(symbol: str) -> Optional[Dict]:
    """
    PRIMARY live-price path: NSE REST API.
    Response latency ~200-500 ms — far better than yfinance (3-15s).
    Uses the shared NSESession (cookie-managed, auto-refreshing).
    """
    try:
        data = await asyncio.wait_for(
            _nse_session.get(f"quote-equity?symbol={symbol.upper()}"),
            timeout=6.0,
        )
        if not data:
            return None

        pi   = data.get("priceInfo")   or {}
        info = data.get("info")        or {}
        meta = data.get("metadata")    or {}

        price      = float(pi.get("lastPrice")     or pi.get("close")         or 0)
        prev_close = float(pi.get("previousClose") or pi.get("basePrice")     or 0)
        change     = float(pi.get("change")        or (price - prev_close))
        change_pct = float(pi.get("pChange")       or 0)
        open_p     = float(pi.get("open")          or 0)
        intra      = pi.get("intraDayHighLow")     or {}
        high_p     = float(intra.get("max")        or pi.get("dayHigh")       or 0)
        low_p      = float(intra.get("min")        or pi.get("dayLow")        or 0)
        vwap       = float(pi.get("vwap")          or 0)
        wk         = pi.get("weekHighLow")         or {}
        volume     = int(float(meta.get("quantityTraded") or meta.get("tradeVolume") or 0))
        mkt_cap    = float(meta.get("marketCap")   or 0)

        if price == 0:
            return None

        return {
            "symbol":       symbol.upper(),
            "name":         info.get("companyName") or symbol,
            "price":        round(price,      2),
            "change":       round(change,     2),
            "change_pct":   round(change_pct, 2),
            "open":         round(open_p,     2),
            "high":         round(high_p,     2),
            "low":          round(low_p,      2),
            "prev_close":   round(prev_close, 2),
            "vwap":         round(vwap,       2),
            "volume":       volume,
            "market_cap":   mkt_cap,
            "week_52_high": float(wk.get("max") or 0),
            "week_52_low":  float(wk.get("min") or 0),
            "timestamp":    datetime.now(IST).isoformat(),
            "source":       "nse_rest",
        }
    except asyncio.TimeoutError:
        logger.warning("NSE REST quote timeout: %s", symbol)
        return None
    except Exception as e:
        logger.debug("NSE REST quote %s: %s", symbol, e)
        return None


async def fetch_quote(symbol: str) -> Optional[Dict]:
    """
    Live single-symbol quote.
    Priority: NSE REST (200-500 ms) → yfinance executor (last resort, fundamentals fallback).
    """
    # 1. Try NSE REST — fast and live
    q = await _fetch_quote_nse_rest(symbol)
    if q:
        return q

    # 2. yfinance — only when NSE REST fails (e.g. pre/post market, NSE maintenance)
    logger.debug("NSE REST failed for %s — falling back to yfinance", symbol)
    loop = asyncio.get_event_loop()
    try:
        return await asyncio.wait_for(
            loop.run_in_executor(_YF_EXECUTOR, lambda: _fetch_quote_sync(symbol)),
            timeout=12.0,
        )
    except asyncio.TimeoutError:
        logger.warning("fetch_quote yfinance timeout: %s", symbol)
        return None
    except Exception as e:
        logger.error("fetch_quote yfinance %s: %s", symbol, e)
        return None


def _fetch_quotes_batch_sync(symbols: List[str]) -> Dict[str, Dict]:
    """
    Synchronous batch quote fetch via yfinance.
    Uses fast_info.last_price per-ticker so prices are LIVE during market hours.
    MUST only be called via run_in_executor — never directly from asyncio.
    """
    import socket as _socket
    old_timeout = _socket.getdefaulttimeout()
    _socket.setdefaulttimeout(10)
    results = {}
    try:
        for sym in symbols:
            try:
                yf_sym = nse_symbol(sym)
                ticker = yf.Ticker(yf_sym)
                info   = ticker.fast_info

                price      = float(getattr(info, "last_price",     0) or 0)
                prev_close = float(getattr(info, "previous_close", 0) or 0)
                open_p     = float(getattr(info, "open",           0) or 0)
                high_p     = float(getattr(info, "day_high",       0) or 0)
                low_p      = float(getattr(info, "day_low",        0) or 0)
                volume     = int(  getattr(info, "last_volume",    0) or 0)

                # fall back to daily close if fast_info empty
                if price == 0 or np.isnan(price):
                    hist = ticker.history(period="2d", interval="1d")
                    if hist is None or hist.empty:
                        continue
                    price      = float(hist["Close"].iloc[-1])
                    prev_close = float(hist["Close"].iloc[-2]) if len(hist) > 1 else price
                    open_p     = float(hist["Open"].iloc[-1])
                    high_p     = float(hist["High"].iloc[-1])
                    low_p      = float(hist["Low"].iloc[-1])
                    volume     = int(hist["Volume"].iloc[-1])

                if price == 0 or np.isnan(price):
                    continue
                if prev_close == 0:
                    prev_close = price
                change     = round(price - prev_close, 2)
                change_pct = round((change / prev_close * 100) if prev_close else 0, 2)

                results[sym] = {
                    "symbol":     sym,
                    "price":      round(price, 2),
                    "change":     change,
                    "change_pct": change_pct,
                    "open":       round(open_p, 2),
                    "high":       round(high_p, 2),
                    "low":        round(low_p, 2),
                    "prev_close": round(prev_close, 2),
                    "volume":     volume,
                    "timestamp":  datetime.now(IST).isoformat(),
                    "source":     "yfinance_live",
                }
            except Exception as e:
                logger.debug("batch quote %s: %s", sym, e)
        return results
    except Exception as e:
        logger.error("fetch_quotes_batch_sync: %s", e)
        return {}
    finally:
        _socket.setdefaulttimeout(old_timeout)


async def fetch_quotes_batch(symbols: List[str]) -> Dict[str, Dict]:
    """
    Live batch quote: NSE index endpoints (primary) + yfinance for gaps.

    NSE index endpoints return all NIFTY 50 + NEXT 50 in 2 parallel calls (~400 ms total).
    Symbols not in those indices fall back to yfinance (rare for top-100 stocks).
    """
    results: Dict[str, Dict] = {}
    target  = {s.upper() for s in symbols}

    # ── 1. NSE index batch (fast — 2 parallel calls, covers top-100) ─────────
    try:
        now_ist = datetime.now(IST).isoformat()
        tasks = [
            asyncio.wait_for(
                _nse_session.get("equity-stockIndices?index=NIFTY%2050"),
                timeout=8.0,
            ),
            asyncio.wait_for(
                _nse_session.get("equity-stockIndices?index=NIFTY%20NEXT%2050"),
                timeout=8.0,
            ),
        ]
        responses = await asyncio.gather(*tasks, return_exceptions=True)

        for resp in responses:
            if isinstance(resp, Exception) or not resp:
                continue
            for s in (resp.get("data") or []):
                sym = (s.get("symbol") or "").upper()
                if sym not in target:
                    continue
                price = float(s.get("lastPrice") or s.get("ltp") or 0)
                prev  = float(s.get("previousClose") or s.get("pclose") or 0)
                chng  = float(s.get("change") or (price - prev))
                pchng = float(s.get("pChange") or 0)
                if price == 0:
                    continue
                results[sym] = {
                    "symbol":     sym,
                    "price":      round(price, 2),
                    "change":     round(chng,  2),
                    "change_pct": round(pchng, 2),
                    "open":       round(float(s.get("open")     or 0), 2),
                    "high":       round(float(s.get("dayHigh")  or 0), 2),
                    "low":        round(float(s.get("dayLow")   or 0), 2),
                    "prev_close": round(prev,  2),
                    "volume":     int(float(s.get("totalTradedVolume") or s.get("tradedQuantity") or 0)),
                    "timestamp":  now_ist,
                    "source":     "nse_index",
                }
        logger.debug("NSE index batch: %d/%d symbols fetched", len(results), len(target))
    except Exception as e:
        logger.warning("NSE index batch error: %s", e)

    # ── 2. yfinance fallback only for symbols NOT found via NSE index ─────────
    missing = [s for s in symbols if s.upper() not in results]
    if missing:
        logger.debug("NSE index missing %d symbols — yfinance fallback", len(missing))
        loop = asyncio.get_event_loop()
        try:
            yf_results = await asyncio.wait_for(
                loop.run_in_executor(
                    _YF_EXECUTOR,
                    lambda: _fetch_quotes_batch_sync(missing),
                ),
                timeout=20.0,
            )
            results.update(yf_results)
        except asyncio.TimeoutError:
            logger.warning("fetch_quotes_batch yfinance fallback timeout")
        except Exception as e:
            logger.error("fetch_quotes_batch yfinance fallback: %s", e)

    return results


def _yf_download_sync(yf_sym: str, period: str, interval: str) -> "pd.DataFrame":
    """Synchronous yfinance download — runs in executor to avoid blocking asyncio."""
    return yf.download(yf_sym, period=period, interval=interval,
                       auto_adjust=True, progress=False, multi_level_index=False)


async def fetch_ohlcv(symbol: str, period: str = "1y", interval: str = "1d") -> "pd.DataFrame":
    """
    Fetch OHLCV history — DuckDB first (fast), yfinance fallback (executor).
    Never blocks the event loop.
    """
    import duckdb
    from pathlib import Path

    sym_clean = symbol.upper().replace(".NS", "").replace(".BO", "")
    sym_ns    = sym_clean + ".NS"

    # ── 1. DuckDB cache (instant if available) ────────────────────────────
    db_path = Path(__file__).parent.parent / "data_store" / "ohlcv.duckdb"
    if db_path.exists():
        try:
            # Map period → days
            _period_days = {"5d": 5, "1mo": 30, "3mo": 90, "6mo": 180,
                            "1y": 365, "2y": 730, "5y": 1825}
            days = _period_days.get(period, 365)
            loop = asyncio.get_event_loop()

            def _duckdb_query():
                con = duckdb.connect(str(db_path), read_only=True)
                try:
                    rows = con.execute(
                        "SELECT ts, open, high, low, close, volume FROM ohlcv "
                        "WHERE (symbol = ? OR symbol = ?) AND ts >= now() - INTERVAL ? DAY "
                        "ORDER BY ts ASC",
                        [sym_ns, sym_clean, days],
                    ).fetchall()
                    return rows
                finally:
                    con.close()

            rows = await asyncio.wait_for(loop.run_in_executor(None, _duckdb_query), timeout=8)
            if rows:
                data = [{"ts": r[0], "open": r[1], "high": r[2],
                         "low": r[3], "close": r[4], "volume": r[5]} for r in rows]
                df = pd.DataFrame(data)
                df["symbol"] = symbol
                logger.debug("fetch_ohlcv %s: %d bars from DuckDB", symbol, len(df))
                return df
        except Exception as e:
            logger.debug("DuckDB fetch_ohlcv %s: %s", symbol, e)

    # ── 2. yfinance (run in thread pool — non-blocking) ───────────────────
    # Skip if blocked (persistently failing 401/404 this session)
    if _yf_blocked(symbol):
        logger.debug("fetch_ohlcv %s: skipped (yfinance blocklist)", symbol)
        return pd.DataFrame()
    try:
        yf_sym = nse_symbol(symbol)
        loop = asyncio.get_event_loop()
        df = await asyncio.wait_for(
            loop.run_in_executor(_YF_EXECUTOR, lambda: _yf_download_sync(yf_sym, period, interval)),
            timeout=20,
        )
        if df is None or df.empty:
            logger.debug("fetch_ohlcv %s: empty from yfinance (adding to blocklist)", symbol)
            _mark_yf_failed(symbol)
            return pd.DataFrame()
        df.index = pd.to_datetime(df.index)
        df.columns = [c.lower() if isinstance(c, str) else str(c).lower() for c in df.columns]
        df["symbol"] = symbol
        result = df.reset_index().rename(columns={"date": "ts", "datetime": "ts"})
        logger.debug("fetch_ohlcv %s: %d bars from yfinance", symbol, len(result))
        return result
    except asyncio.TimeoutError:
        logger.warning("fetch_ohlcv %s: yfinance timeout — adding to blocklist", symbol)
        _mark_yf_failed(symbol)
        return pd.DataFrame()
    except Exception as e:
        # 401/404 = block permanently this session; other errors = log normally
        err_str = str(e).lower()
        if "401" in err_str or "404" in err_str or "not found" in err_str or "delisted" in err_str:
            logger.debug("fetch_ohlcv %s: yfinance 401/404 — adding to blocklist", symbol)
            _mark_yf_failed(symbol)
        else:
            logger.warning("fetch_ohlcv %s: %s", symbol, e)
        return pd.DataFrame()


async def fetch_nse_option_chain(symbol: str) -> Optional[Dict]:
    """Fetch NSE option chain for a symbol (index or stock).
    NSE frequently changes their API endpoints. We try multiple variants.
    """
    try:
        # NSE endpoint variants — try in order
        if symbol in ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"]:
            endpoints = [
                f"option-chain-indices?symbol={symbol}",
                f"option-chain?symbol={symbol}&type=index",   # new NSE API variant
            ]
        else:
            endpoints = [
                f"option-chain-equities?symbol={symbol}",
                f"option-chain?symbol={symbol}&type=equity",
            ]

        data = None
        for ep in endpoints:
            data = await _nse_session.get(ep)
            if data:
                break
        if not data:
            logger.debug("NSE option chain %s: all endpoints returned no data", symbol)
            return None

        records = data.get("records", {})
        filtered = data.get("filtered", {})
        all_data = records.get("data", [])

        strikes = []
        expiry_dates = records.get("expiryDates", [])

        for item in all_data:
            ce = item.get("CE", {})
            pe = item.get("PE", {})
            strikes.append({
                "strike": item.get("strikePrice"),
                "expiry": item.get("expiryDate"),
                "call_oi": ce.get("openInterest"),
                "call_oi_change": ce.get("changeinOpenInterest"),
                "call_volume": ce.get("totalTradedVolume"),
                "call_iv": ce.get("impliedVolatility"),
                "call_ltp": ce.get("lastPrice"),
                "call_bid": ce.get("bidprice"),
                "call_ask": ce.get("askPrice"),
                "put_oi": pe.get("openInterest"),
                "put_oi_change": pe.get("changeinOpenInterest"),
                "put_volume": pe.get("totalTradedVolume"),
                "put_iv": pe.get("impliedVolatility"),
                "put_ltp": pe.get("lastPrice"),
                "put_bid": pe.get("bidprice"),
                "put_ask": pe.get("askPrice"),
            })

        total_ce_oi = filtered.get("CE", {}).get("totOI", 0)
        total_pe_oi = filtered.get("PE", {}).get("totOI", 0)
        pcr = round(total_pe_oi / total_ce_oi, 3) if total_ce_oi else None

        return {
            "symbol": symbol,
            "expiry_dates": expiry_dates,
            "strikes": strikes,
            "total_ce_oi": total_ce_oi,
            "total_pe_oi": total_pe_oi,
            "pcr": pcr,
            "underlying_value": records.get("underlyingValue"),
        }
    except Exception as e:
        logger.error("fetch_option_chain %s: %s", symbol, e)
        return None


async def fetch_nse_gainers_losers() -> Dict:
    """Fetch top gainers and losers from NSE."""
    try:
        gainers_data = await _nse_session.get("live-analysis-variations?index=gainers&limit=15")
        losers_data = await _nse_session.get("live-analysis-variations?index=loosers&limit=15")

        def parse(data, key):
            if not data:
                return []
            items = data.get(key, data.get("data", []))
            return [
                {
                    "symbol": d.get("symbol", ""),
                    "name": d.get("meta", {}).get("companyName", d.get("symbol", "")),
                    "ltp": d.get("lastPrice", d.get("ltp", 0)),
                    "change_pct": d.get("pChange", 0),
                    "volume": d.get("totalTradedVolume", 0),
                }
                for d in (items if isinstance(items, list) else [])
            ]

        return {
            "gainers": parse(gainers_data, "Advances"),
            "losers": parse(losers_data, "Declines"),
        }
    except Exception as e:
        logger.error("fetch_gainers_losers: %s", e)
        return {"gainers": [], "losers": []}


async def fetch_nse_most_active() -> List[Dict]:
    """Fetch most active stocks by value."""
    try:
        data = await _nse_session.get("live-analysis-variations?index=mostactive")
        if not data:
            return []
        items = data.get("data", [])
        return [
            {
                "symbol": d.get("symbol", ""),
                "name": d.get("meta", {}).get("companyName", ""),
                "ltp": d.get("lastPrice", 0),
                "change_pct": d.get("pChange", 0),
                "volume": d.get("totalTradedVolume", 0),
                "turnover": d.get("totalTradedValue", 0),
            }
            for d in items[:20]
        ]
    except Exception as e:
        logger.error("fetch_most_active: %s", e)
        return []


async def fetch_nse_52w_extremes() -> Dict:
    """Fetch 52-week high/low hitters."""
    try:
        highs = await _nse_session.get("live-analysis-variations?index=52Wh")
        lows = await _nse_session.get("live-analysis-variations?index=52Wl")

        def parse(d):
            if not d:
                return []
            return [{"symbol": x.get("symbol", ""), "price": x.get("lastPrice", 0),
                     "change_pct": x.get("pChange", 0)} for x in d.get("data", [])[:15]]

        return {"highs": parse(highs), "lows": parse(lows)}
    except Exception as e:
        logger.error("fetch_52w_extremes: %s", e)
        return {"highs": [], "lows": []}


async def fetch_india_vix() -> Optional[float]:
    """Fetch India VIX from NSE."""
    try:
        data = await _nse_session.get("allIndices")
        if data:
            for idx in data.get("data", []):
                if idx.get("index") == "INDIA VIX":
                    return float(idx.get("last", 0))
    except Exception as e:
        logger.debug("India VIX fetch: %s", e)
    try:
        df = yf.download("^INDIAVIX", period="1d", progress=False)
        if not df.empty:
            return float(df["Close"].iloc[-1])
    except Exception:
        pass
    return None


async def fetch_nifty_indices() -> List[Dict]:
    """Fetch all NSE index values."""
    try:
        data = await _nse_session.get("allIndices")
        if not data:
            return []
        indices = []
        for idx in data.get("data", []):
            indices.append({
                "name": idx.get("index", ""),
                "value": idx.get("last", 0),
                "change": idx.get("variation", 0),
                "change_pct": idx.get("percentChange", 0),
                "open": idx.get("open", 0),
                "high": idx.get("high", 0),
                "low": idx.get("low", 0),
                "prev_close": idx.get("previousClose", 0),
                "year_high": idx.get("yearHigh", 0),
                "year_low": idx.get("yearLow", 0),
            })
        return indices
    except Exception as e:
        logger.error("fetch_nifty_indices: %s", e)
        return []


async def fetch_fno_ban_list() -> List[str]:
    """Fetch F&O ban list from NSE."""
    try:
        data = await _nse_session.get("live-analysis-variations?index=fnoban")
        if data:
            return [d.get("symbol", "") for d in data.get("data", [])]
    except Exception as e:
        logger.debug("F&O ban list: %s", e)
    return []


async def fetch_block_bulk_deals() -> List[Dict]:
    """Fetch block/bulk deals from NSE."""
    try:
        data = await _nse_session.get("block-deal")
        if data:
            return data.get("data", [])[:50]
    except Exception as e:
        logger.debug("Block deals: %s", e)
    return []


async def fetch_gift_nifty() -> Optional[float]:
    """Fetch GIFT Nifty futures (SGX Nifty proxy)."""
    try:
        df = yf.download("NQ=F", period="1d", interval="5m", progress=False)
        if not df.empty:
            return float(df["Close"].iloc[-1])
    except Exception as e:
        logger.debug("GIFT Nifty: %s", e)
    return None


async def close():
    await _nse_session.close()
