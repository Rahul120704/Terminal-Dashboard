"""
Fyers API v3 — PRIMARY data source for ALL NSE/BSE pricing.
App ID : G64FR8CRS7-200
Auth   : OAuth 2.0 — daily login required (access token valid for 1 trading day)

Data coverage:
  Symbol master  : 4500+ NSE equities from https://public.fyers.in/sym_details/NSE_CM.csv
  Live quotes    : Fyers REST batch (50/call, parallel chunks via asyncio.Semaphore)
  Real-time ticks: Fyers WebSocket (subscribed to top 500 stocks by volume)
  Fallback       : In-memory _quote_cache (populated by WS ticks + REST batch)

NSE API is never used for prices — only for data Fyers doesn't provide
(corporate actions, filings, news, insider trades, economic indicators).
"""

import asyncio
import csv
import io
import logging
import json
import math
import queue
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional, Dict, List, Any
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

# ── DuckDB tick store buffer ───────────────────────────────────────────────────
# Thread-safe queue: Fyers WS thread pushes ticks; _tick_batch_broadcaster
# drains it every 33ms and bulk-inserts into DuckDB — zero latency on hot path.
_tick_store_queue: queue.Queue = queue.Queue(maxsize=20_000)


def drain_tick_store_buffer() -> List[Dict]:
    """
    Atomically drain all pending ticks.  Non-blocking — never sleeps.
    Called by _tick_batch_broadcaster in the asyncio event loop every 33ms.
    Returns list of {symbol, price, volume, side, ts} dicts ready for log_tick_batch_sync.
    """
    items: List[Dict] = []
    while True:
        try:
            items.append(_tick_store_queue.get_nowait())
        except queue.Empty:
            break
    return items

# ── Credentials ────────────────────────────────────────────────────────────────
FYERS_APP_ID      = "G64FR8CRS7-200"
FYERS_SECRET      = "0RlSiPF7dJaCfbKT"
FYERS_REDIRECT    = "http://127.0.0.1:8000/api/fyers/callback"
TOKEN_FILE        = Path(__file__).parent.parent / "data_store" / "fyers_token.json"

# ── State ──────────────────────────────────────────────────────────────────────
_fyers_client     = None
_access_token: Optional[str] = None
_token_date: Optional[str]   = None
_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="fyers")

# ── Quote cache (1-second TTL for hot symbols) ─────────────────────────────────
_quote_cache: Dict[str, Dict] = {}
_quote_ts: Dict[str, float]   = {}
QUOTE_TTL = 1.5   # seconds

# ── NSE Symbol Master ───────────────────────────────────────────────────────────
# 4500+ NSE equity symbols downloaded from Fyers public CSV.
# {RAW_SYM: {"fyers_sym": "NSE:RELIANCE-EQ", "name": "...", "isin": "..."}}
_symbol_master: Dict[str, Dict] = {}
_symbol_master_ts: float        = 0.0
_MASTER_CACHE_FILE = Path(__file__).parent.parent / "data_store" / "fyers_symbols.json"
_MASTER_TTL        = 86400   # re-download once per day
_NSE_CM_URL        = "https://public.fyers.in/sym_details/NSE_CM.csv"


async def load_symbol_master() -> int:
    """
    Load all NSE equity symbols from the Fyers public symbol master CSV.
    Priority: in-memory → disk cache (24h) → download from Fyers.
    Returns the number of symbols loaded (typically 4500-5000).
    Does NOT require Fyers authentication — it's a public file.
    """
    global _symbol_master, _symbol_master_ts
    now = time.time()

    # 1. Already in memory and fresh
    if _symbol_master and (now - _symbol_master_ts) < _MASTER_TTL:
        return len(_symbol_master)

    # 2. Load from disk cache
    try:
        if _MASTER_CACHE_FILE.exists():
            cache = json.loads(_MASTER_CACHE_FILE.read_text(encoding="utf-8"))
            if now - cache.get("ts", 0) < _MASTER_TTL and len(cache.get("symbols", {})) > 100:
                _symbol_master    = cache["symbols"]
                _symbol_master_ts = now
                logger.info("Fyers symbol master: %d equities loaded from disk cache", len(_symbol_master))
                return len(_symbol_master)
    except Exception as e:
        logger.warning("Symbol master disk cache: %s", e)

    # 3. Download fresh copy from Fyers public URL
    try:
        import aiohttp
        connector = aiohttp.TCPConnector(ssl=True)
        timeout   = aiohttp.ClientTimeout(total=30)
        async with aiohttp.ClientSession(connector=connector, timeout=timeout) as sess:
            async with sess.get(_NSE_CM_URL) as resp:
                if resp.status != 200:
                    logger.warning("Fyers symbol master HTTP %d", resp.status)
                    return len(_symbol_master)
                text = await resp.text(encoding="utf-8", errors="replace")

        result: Dict[str, Dict] = {}
        # Fyers NSE_CM.csv has NO header row — raw data only.
        # Column layout (0-indexed):
        #   0: fytoken, 1: company name, 5: ISIN, 9: fyers symbol (NSE:XXX-EQ)
        reader = csv.reader(io.StringIO(text))
        for row in reader:
            if len(row) < 10:
                continue
            ticker = row[9].strip()
            # Keep only NSE equity symbols: NSE:RELIANCE-EQ pattern
            if not (ticker.startswith("NSE:") and ticker.endswith("-EQ")):
                continue
            raw = ticker[4:-3]   # strip "NSE:" and "-EQ"
            if not raw or len(raw) > 20:
                continue
            name = row[1].strip() or raw
            isin = row[5].strip() if len(row) > 5 else ""
            result[raw] = {
                "fyers_sym": ticker,
                "name":      name,
                "isin":      isin,
            }

        if len(result) < 100:
            logger.warning("Fyers symbol master: only %d symbols parsed — CSV format may differ", len(result))
            # Keep stale data if the new download looks broken
            return len(_symbol_master)

        _symbol_master    = result
        _symbol_master_ts = now
        # Persist to disk
        try:
            _MASTER_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
            _MASTER_CACHE_FILE.write_text(
                json.dumps({"ts": now, "symbols": result}, ensure_ascii=False),
                encoding="utf-8",
            )
        except Exception as e:
            logger.warning("Symbol master disk save: %s", e)
        logger.info("Fyers symbol master: %d NSE equities downloaded ✓", len(result))
        return len(result)

    except Exception as e:
        logger.error("Fyers symbol master download failed: %s — using stale data (%d)", e, len(_symbol_master))
        return len(_symbol_master)


def get_all_nse_symbols() -> List[str]:
    """All raw NSE equity symbols from Fyers master (4500+)."""
    return list(_symbol_master.keys())


def get_symbol_name(raw_sym: str) -> str:
    """Lookup company name from Fyers symbol master. Returns raw_sym if not found."""
    info = _symbol_master.get(raw_sym.upper())
    return info["name"] if info else raw_sym


# ── Index Quote Cache ─────────────────────────────────────────────────────────
# Maps Fyers-WS raw symbol (after from_fyers_symbol) → human-readable index name
# Used by the indices_broadcaster in main.py and by the frontend tick_update handler.
INDEX_RAW_TO_NAME: Dict[str, str] = {
    "NIFTY50":        "NIFTY 50",
    "NIFTYBANK":      "NIFTY BANK",
    "INDIAVIX":       "INDIA VIX",
    # Correct Fyers WS index identifiers — use NIFTY* prefix, not CNX* prefix.
    # Fyers WS rejects NSE:CNXIT-INDEX etc. with error -300 (invalid symbol).
    "NIFTYIT":        "NIFTY IT",
    "NIFTYPHARMA":    "NIFTY PHARMA",
    "NIFTYAUTO":      "NIFTY AUTO",
    "NIFTYMETAL":     "NIFTY METAL",
    "NIFTYFMCG":      "NIFTY FMCG",
    "NIFTYENERGY":    "NIFTY ENERGY",
    "NIFTYMIDCAP100": "NIFTY MIDCAP 100",
    "NIFTYREALTY":    "NIFTY REALTY",
    "SENSEX":         "SENSEX",
    # Legacy CNX* keys kept so any ticks still arriving on old names are decoded
    "CNXIT":          "NIFTY IT",
    "CNXPHARMA":      "NIFTY PHARMA",
    "CNXAUTO":        "NIFTY AUTO",
    "CNXMETAL":       "NIFTY METAL",
    "CNXFMCG":        "NIFTY FMCG",
    "CNXENERGY":      "NIFTY ENERGY",
}


def get_index_quotes() -> List[Dict]:
    """
    Return latest index quotes from the Fyers WS tick cache.
    Called every 5s by _indices_broadcaster in main.py — sub-ms latency.
    Returns IndexData-compatible dicts: {name, value, change, change_pct}.
    """
    result = []
    for raw_sym, display_name in INDEX_RAW_TO_NAME.items():
        q = _quote_cache.get(raw_sym)
        if q and q.get("price", 0) > 0:
            result.append({
                "name":       display_name,
                "value":      round(q.get("price", 0), 2),
                "change":     round(q.get("change", 0), 2),
                "change_pct": round(q.get("change_pct", 0), 2),
                "open":       round(q.get("open", 0), 2),
                "high":       round(q.get("high", 0), 2),
                "low":        round(q.get("low", 0), 2),
                "source":     "fyers_ws",
            })
    return result


# ── Auth ───────────────────────────────────────────────────────────────────────

def get_auth_url() -> str:
    """Return Fyers OAuth login URL. User visits this once per day."""
    from fyers_apiv3 import fyersModel
    session = fyersModel.SessionModel(
        client_id=FYERS_APP_ID,
        secret_key=FYERS_SECRET,
        redirect_uri=FYERS_REDIRECT,
        response_type="code",
        grant_type="authorization_code",
        state="BTI_AUTH",   # must be non-None for Fyers v3
    )
    url = session.generate_authcode()
    logger.info("Fyers auth URL: %s", url)
    return url


def _exchange_token_sync(auth_code: str) -> dict:
    from fyers_apiv3 import fyersModel
    session = fyersModel.SessionModel(
        client_id=FYERS_APP_ID,
        secret_key=FYERS_SECRET,
        redirect_uri=FYERS_REDIRECT,
        response_type="code",
        grant_type="authorization_code",
        state="BTI_AUTH",
    )
    session.set_token(auth_code)
    result = session.generate_token()
    logger.info("Fyers token raw response keys: %s", list(result.keys()) if isinstance(result, dict) else type(result))
    return result


async def exchange_token(auth_code: str) -> bool:
    """Exchange auth code → access token. Called from /api/fyers/callback."""
    global _fyers_client, _access_token, _token_date
    try:
        loop = asyncio.get_event_loop()
        response = await asyncio.wait_for(
            loop.run_in_executor(_executor, lambda: _exchange_token_sync(auth_code)),
            timeout=15,
        )
        logger.info("Fyers token exchange response: %s", {k: v for k, v in response.items() if k != "access_token"})
        token = response.get("access_token", "")
        if not token:
            logger.error("Fyers: no access_token in response: %s", response)
            return False

        _access_token = token
        _token_date   = str(date.today())
        _init_client(token)

        TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_FILE.write_text(json.dumps({"token": token, "date": _token_date}))
        logger.info("Fyers: authenticated successfully for %s", _token_date)

        # Start WebSocket live feed after auth
        _start_live_feed()
        return True
    except Exception as e:
        logger.error("Fyers exchange_token: %s", e)
        return False


def _init_client(token: str):
    global _fyers_client
    from fyers_apiv3 import fyersModel
    _fyers_client = fyersModel.FyersModel(
        client_id=FYERS_APP_ID,
        token=token,
        log_path="",
        is_async=False,
    )
    logger.info("Fyers client initialized")


def load_saved_token() -> bool:
    """On startup: load today's token from disk (avoids re-login during restarts)."""
    global _access_token, _token_date
    try:
        if TOKEN_FILE.exists():
            data = json.loads(TOKEN_FILE.read_text())
            if data.get("date") == str(date.today()) and data.get("token"):
                _access_token = data["token"]
                _token_date   = data["date"]
                _init_client(_access_token)
                logger.info("Fyers: loaded today's saved token ✓")
                _start_live_feed()
                return True
    except Exception as e:
        logger.warning("Fyers load_saved_token: %s", e)
    return False


def is_authenticated() -> bool:
    return bool(_fyers_client and _access_token and _token_date == str(date.today()))


def get_status() -> Dict:
    return {
        "authenticated": is_authenticated(),
        "token_date":    _token_date,
        "app_id":        FYERS_APP_ID,
        "auth_url":      get_auth_url() if not is_authenticated() else None,
    }


# ── Symbol mapping ─────────────────────────────────────────────────────────────

_INDEX_MAP = {
    "NIFTY":           "NSE:NIFTY50-INDEX",
    "NIFTY50":         "NSE:NIFTY50-INDEX",
    "BANKNIFTY":       "NSE:NIFTYBANK-INDEX",
    "NIFTYBANK":       "NSE:NIFTYBANK-INDEX",
    "SENSEX":          "BSE:SENSEX-INDEX",
    "FINNIFTY":        "NSE:FINNIFTY-INDEX",
    "MIDCPNIFTY":      "NSE:MIDCPNIFTY-INDEX",
    "INDIAVIX":        "NSE:INDIAVIX-INDEX",
    "NIFTYMIDCAP100":  "NSE:NIFTYMIDCAP100-INDEX",
    "NIFTYREALTY":     "NSE:NIFTYREALTY-INDEX",
    # Sector indices — Fyers WS requires NIFTY* prefix, NOT CNX* prefix
    "NIFTYIT":         "NSE:NIFTYIT-INDEX",
    "NIFTYPHARMA":     "NSE:NIFTYPHARMA-INDEX",
    "NIFTYAUTO":       "NSE:NIFTYAUTO-INDEX",
    "NIFTYMETAL":      "NSE:NIFTYMETAL-INDEX",
    "NIFTYFMCG":       "NSE:NIFTYFMCG-INDEX",
    "NIFTYENERGY":     "NSE:NIFTYENERGY-INDEX",
    # Legacy CNX* aliases → correct NIFTY* targets
    "CNXIT":           "NSE:NIFTYIT-INDEX",
    "CNXPHARMA":       "NSE:NIFTYPHARMA-INDEX",
    "CNXAUTO":         "NSE:NIFTYAUTO-INDEX",
    "CNXMETAL":        "NSE:NIFTYMETAL-INDEX",
    "CNXFMCG":         "NSE:NIFTYFMCG-INDEX",
    "CNXENERGY":       "NSE:NIFTYENERGY-INDEX",
}


def to_fyers_symbol(symbol: str) -> str:
    """Convert raw symbol (RELIANCE / RELIANCE.NS / NIFTY) → NSE:RELIANCE-EQ"""
    s = symbol.upper().strip().replace(".NS", "").replace(".BO", "")
    if symbol.upper().endswith(".BO"):
        return f"BSE:{s}-A"
    if s in _INDEX_MAP:
        return _INDEX_MAP[s]
    return f"NSE:{s}-EQ"


def from_fyers_symbol(fyers_sym: str) -> str:
    """NSE:RELIANCE-EQ → RELIANCE"""
    return fyers_sym.split(":")[1].split("-")[0] if ":" in fyers_sym else fyers_sym


# ── Quotes ─────────────────────────────────────────────────────────────────────

def _safe_float(v) -> float:
    try:
        f = float(v)
        return 0.0 if (math.isnan(f) or math.isinf(f)) else f
    except Exception:
        return 0.0


def _parse_quote(item: Dict, raw_symbol: str) -> Dict:
    d = item.get("v", {})
    price      = _safe_float(d.get("lp"))
    prev_close = _safe_float(d.get("prev_close_price"))
    change     = _safe_float(d.get("ch")) or (price - prev_close)
    change_pct = _safe_float(d.get("chp")) or ((change / prev_close * 100) if prev_close else 0)
    return {
        "symbol":     raw_symbol,
        "price":      price,
        "open":       _safe_float(d.get("open_price")),
        "high":       _safe_float(d.get("high_price")),
        "low":        _safe_float(d.get("low_price")),
        "prev_close": prev_close,
        "volume":     int(d.get("volume") or 0),
        "change":     round(change, 2),
        "change_pct": round(change_pct, 2),
        "bid":        _safe_float(d.get("bid")),
        "ask":        _safe_float(d.get("ask")),
        "52w_high":   _safe_float(d.get("52w_high")),
        "52w_low":    _safe_float(d.get("52w_low")),
        "timestamp":  datetime.now().isoformat(),
        "source":     "fyers",
    }


async def get_quote(symbol: str) -> Optional[Dict]:
    """Single symbol quote with 1.5s cache."""
    if not is_authenticated():
        return None
    now = time.time()
    if symbol in _quote_cache and (now - _quote_ts.get(symbol, 0)) < QUOTE_TTL:
        return _quote_cache[symbol]
    try:
        fyers_sym = to_fyers_symbol(symbol)
        loop = asyncio.get_event_loop()
        resp = await asyncio.wait_for(
            loop.run_in_executor(_executor, lambda: _fyers_client.quotes({"symbols": fyers_sym})),
            timeout=6,
        )
        if resp.get("code") == 200 and resp.get("d"):
            q = _parse_quote(resp["d"][0], symbol)
            _quote_cache[symbol] = q
            _quote_ts[symbol] = now
            return q
        logger.warning("Fyers quote %s: %s", symbol, resp.get("message", "no data"))
    except asyncio.TimeoutError:
        logger.warning("Fyers quote timeout: %s", symbol)
    except Exception as e:
        logger.warning("Fyers get_quote %s: %s", symbol, e)
    return _quote_cache.get(symbol)   # return stale if available


async def _fetch_one_chunk(chunk: List[str]) -> List[Dict]:
    """
    Fetch one 50-symbol chunk from Fyers REST quotes API.
    Uses response 'n' field for symbol identification (order-independent).
    Updates _quote_cache in-place; returns list of quote dicts.
    """
    try:
        fyers_syms = ",".join(to_fyers_symbol(s) for s in chunk)
        loop = asyncio.get_event_loop()
        resp = await asyncio.wait_for(
            loop.run_in_executor(_executor, lambda fs=fyers_syms: _fyers_client.quotes({"symbols": fs})),
            timeout=6,
        )
        results = []
        if resp.get("code") == 200 and resp.get("d"):
            now = time.time()
            for item in resp["d"]:
                # Use 'n' field (Fyers symbol) — robust, not dependent on response order
                fyers_n = item.get("n", "")
                raw_sym = from_fyers_symbol(fyers_n) if fyers_n else ""
                if not raw_sym:
                    continue
                q = _parse_quote(item, raw_sym)
                # Enrich with company name from symbol master if not already set
                if not q.get("name"):
                    q["name"] = get_symbol_name(raw_sym)
                _quote_cache[raw_sym] = q
                _quote_ts[raw_sym]    = now
                results.append(q)
        else:
            logger.debug("Fyers chunk %s code=%s msg=%s",
                         chunk[0] if chunk else "", resp.get("code"), resp.get("message", ""))
        return results
    except asyncio.TimeoutError:
        logger.warning("Fyers chunk timeout: first=%s", chunk[0] if chunk else "?")
        return []
    except Exception as e:
        logger.warning("Fyers chunk error: %s", e)
        return []


async def get_quotes_batch(symbols: List[str]) -> List[Dict]:
    """
    Batch quotes for up to ~200 symbols (4 parallel Fyers calls of 50 each).
    For larger universes use get_bulk_quotes().
    """
    if not is_authenticated() or not symbols:
        return []
    chunks = [symbols[i:i+50] for i in range(0, len(symbols), 50)]
    # Fire all chunks in parallel (small batches — no rate-limit concern)
    chunk_lists = await asyncio.gather(*[_fetch_one_chunk(c) for c in chunks], return_exceptions=False)
    results: List[Dict] = []
    for lst in chunk_lists:
        if isinstance(lst, list):
            results.extend(lst)
    return results


async def get_bulk_quotes(
    symbols: List[str],
    concurrency: int = 5,
) -> List[Dict]:
    """
    Fetch quotes for a large symbol universe (4500+ stocks) from Fyers REST.

    Uses asyncio.Semaphore to cap concurrent Fyers calls and stay within
    rate limits (~200 req/min). At concurrency=5:
      90 chunks (4500 stocks / 50) / 5 parallel = 18 rounds × ~300ms ≈ 5-6s

    Updates _quote_cache for all fetched symbols.
    Returns combined list of all quote dicts.
    """
    if not is_authenticated() or not symbols:
        return []

    chunks = [symbols[i:i+50] for i in range(0, len(symbols), 50)]
    sem    = asyncio.Semaphore(concurrency)
    results: List[Dict] = []
    failed = 0

    async def _sem_fetch(chunk: List[str]) -> List[Dict]:
        nonlocal failed
        async with sem:
            r = await _fetch_one_chunk(chunk)
            if not r:
                failed += 1
            return r

    chunk_lists = await asyncio.gather(*[_sem_fetch(c) for c in chunks], return_exceptions=True)
    for lst in chunk_lists:
        if isinstance(lst, list):
            results.extend(lst)

    logger.info("Fyers bulk quotes: %d/%d symbols fetched (%d chunks failed)",
                len(results), len(symbols), failed)
    return results


def _to_gl_row(q: Dict) -> Dict:
    """Convert a Fyers quote dict to the gainers/losers display format."""
    return {
        "symbol":     q.get("symbol", ""),
        "name":       q.get("name")  or q.get("symbol", ""),
        "ltp":        round(float(q.get("price")      or 0), 2),
        "change_pct": round(float(q.get("change_pct") or 0), 2),
        "volume":     int(  q.get("volume")            or 0),
    }


async def get_gainers_losers(symbols: List[str], top_n: int = 15) -> Dict:
    """
    Fyers-first gainers/losers for a given symbol universe.

    For small universes (≤200 symbols): parallel batch REST (~300ms)
    For large universes (>200):         get_bulk_quotes with rate limiting (~5-8s)
    Fallback:                           in-memory WS cache (0ms, may be stale)
    """
    all_quotes: List[Dict] = []

    if is_authenticated():
        try:
            if len(symbols) <= 200:
                all_quotes = await get_quotes_batch(symbols)
            else:
                all_quotes = await get_bulk_quotes(symbols)
        except Exception as e:
            logger.warning("get_gainers_losers REST: %s", e)

    # Fallback: WS cache
    if not all_quotes:
        all_quotes = [_quote_cache[s] for s in symbols
                      if s in _quote_cache and _quote_cache[s].get("price")]
        source = "fyers_ws_cache"
    else:
        source = "fyers_live"

    if not all_quotes:
        return {"gainers": [], "losers": [], "source": "fyers_unavailable", "count": 0}

    gainers = sorted(
        [q for q in all_quotes if (q.get("change_pct") or 0) > 0],
        key=lambda x: x.get("change_pct", 0), reverse=True,
    )[:top_n]

    losers = sorted(
        [q for q in all_quotes if (q.get("change_pct") or 0) < 0],
        key=lambda x: x.get("change_pct", 0),
    )[:top_n]

    return {
        "gainers": [_to_gl_row(q) for q in gainers],
        "losers":  [_to_gl_row(q) for q in losers],
        "source":  source,
        "count":   len(all_quotes),
    }


async def get_most_active(symbols: List[str] = None, top_n: int = 20) -> List[Dict]:
    """
    Top stocks by traded volume.
    Fetches from Fyers REST (large universe: rate-limited bulk; small: parallel batch).
    Falls back to WS cache. Returns [] on total failure so caller can use NSE API.
    """
    sym_list = symbols or list(_symbol_master.keys()) or []
    if not sym_list:
        # Fallback to a static list if symbol master not loaded
        from data.nse_data import ALL_TRACKED as _ALL_TRACKED
        sym_list = _ALL_TRACKED

    all_quotes: List[Dict] = []
    if is_authenticated():
        try:
            if len(sym_list) <= 200:
                all_quotes = await get_quotes_batch(sym_list)
            else:
                all_quotes = await get_bulk_quotes(sym_list)
        except Exception as e:
            logger.warning("get_most_active: %s", e)

    if not all_quotes:
        all_quotes = [_quote_cache[s] for s in sym_list
                      if s in _quote_cache and _quote_cache[s].get("price")]

    if not all_quotes:
        return []

    sorted_q = sorted(all_quotes, key=lambda x: x.get("volume", 0), reverse=True)
    return [
        {
            "symbol":     q.get("symbol", ""),
            "name":       q.get("name") or get_symbol_name(q.get("symbol", "")),
            "ltp":        round(float(q.get("price")      or 0), 2),
            "change_pct": round(float(q.get("change_pct") or 0), 2),
            "volume":     int(  q.get("volume")            or 0),
            "turnover":   round(float(q.get("price") or 0) * int(q.get("volume") or 0), 0),
        }
        for q in sorted_q[:top_n]
        if q.get("volume", 0) > 0
    ]


# ── History ────────────────────────────────────────────────────────────────────

_RESOLUTION_MAP = {
    "1m": "1", "2m": "2", "3m": "3", "5m": "5", "10m": "10",
    "15m": "15", "20m": "20", "30m": "30", "1h": "60",
    "2h": "120", "4h": "240", "1d": "D", "D": "D", "W": "W", "M": "M",
}


async def get_history(
    symbol: str,
    resolution: str = "D",
    days: int = 365,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> List[Dict]:
    """OHLCV history. Returns list of {time, open, high, low, close, volume}."""
    if not is_authenticated():
        return []
    try:
        fyers_sym = to_fyers_symbol(symbol)
        res       = _RESOLUTION_MAP.get(resolution, resolution)
        end_date  = date_to   or str(date.today())
        start_date= date_from or str(date.today() - timedelta(days=days))

        data = {
            "symbol":     fyers_sym,
            "resolution": res,
            "date_format": "1",           # epoch timestamps
            "range_from": start_date,
            "range_to":   end_date,
            "cont_flag":  "1",
        }
        loop = asyncio.get_event_loop()
        resp = await asyncio.wait_for(
            loop.run_in_executor(_executor, lambda: _fyers_client.history(data=data)),
            timeout=20,
        )
        if resp.get("code") == 200 and resp.get("candles"):
            return [
                {"time": int(c[0]), "open": c[1], "high": c[2],
                 "low": c[3], "close": c[4], "volume": int(c[5])}
                for c in resp["candles"]
            ]
        logger.warning("Fyers history %s: %s", symbol, resp.get("message", "no data"))
    except asyncio.TimeoutError:
        logger.warning("Fyers history timeout: %s", symbol)
    except Exception as e:
        logger.warning("Fyers get_history %s: %s", symbol, e)
    return []


# ── Options Chain ──────────────────────────────────────────────────────────────

_OPTIONS_INDEX = {
    "NIFTY":     "NSE:NIFTY50-INDEX",
    "BANKNIFTY": "NSE:NIFTYBANK-INDEX",
    "FINNIFTY":  "NSE:FINNIFTY-INDEX",
    "SENSEX":    "BSE:SENSEX-INDEX",
}

_options_cache: Dict[str, Any] = {}
_options_ts: Dict[str, float]  = {}
OPTIONS_TTL = 30  # seconds


async def get_options_chain(symbol: str = "NIFTY", strike_count: int = 20) -> Optional[Dict]:
    """Live options chain from Fyers. Returns structured chain data."""
    if not is_authenticated():
        return None
    now = time.time()
    if symbol in _options_cache and (now - _options_ts.get(symbol, 0)) < OPTIONS_TTL:
        return _options_cache[symbol]
    fyers_sym = _OPTIONS_INDEX.get(symbol.upper(), to_fyers_symbol(symbol))
    data = {"symbol": fyers_sym, "strikecount": strike_count, "timestamp": ""}
    loop = asyncio.get_event_loop()
    # Fyers occasionally returns a transient "Bad request" under rapid calls
    # (rate-limit). One short-backoff retry recovers it; the 60s cache means
    # this fetch path runs at most ~once/symbol/minute in steady state.
    for attempt in range(2):
        try:
            resp = await asyncio.wait_for(
                loop.run_in_executor(_executor, lambda: _fyers_client.optionchain(data=data)),
                timeout=15,
            )
            if resp.get("code") == 200 and resp.get("data"):
                chain = _parse_options_chain(symbol, resp["data"])
                _options_cache[symbol] = chain
                _options_ts[symbol] = now
                return chain
            logger.warning("Fyers options %s (try %d): %s", symbol, attempt + 1, resp.get("message", ""))
        except asyncio.TimeoutError:
            logger.warning("Fyers options timeout: %s (try %d)", symbol, attempt + 1)
        except Exception as e:
            logger.warning("Fyers get_options_chain %s (try %d): %s", symbol, attempt + 1, e)
        if attempt == 0:
            await asyncio.sleep(0.4)
    return _options_cache.get(symbol)


def _parse_options_chain(symbol: str, raw: Dict) -> Dict:
    """
    Parse a Fyers API v3 ``optionchain`` response into BTI OptionsChain format.

    Fyers v3 wire shape (verified live):
      data.optionsChain : FLAT array of rows, each one of:
        • underlying spot  → option_type == ""  and strike_price == -1
        • a call           → option_type == "CE"
        • a put            → option_type == "PE"
      Per-row fields are snake_case: strike_price, ltp, oi, oich, volume, bid, ask.
      data.expiryData  : [{date:"DD-MM-YYYY", expiry:"<epoch>", expiry_flag:"W|M"}]
      The chain returned covers the NEAREST expiry only (expiryData[0]).

    Fyers does NOT publish IV / delta / theta — those are solved later in
    enrich_option_chain() via Black-Scholes from each row's LTP.
    """
    rows = raw.get("optionsChain") or []

    # Expiry list (DD-MM-YYYY strings). The chain itself is the nearest expiry.
    expiry_dates   = [e.get("date", "") for e in (raw.get("expiryData") or []) if e.get("date")]
    nearest_expiry = expiry_dates[0] if expiry_dates else ""

    # ── Split flat array: underlying spot + CE/PE rows grouped by strike ──────
    underlying = 0.0
    by_strike: Dict[float, Dict[str, Dict]] = {}
    for r in rows:
        ot = (r.get("option_type") or "").upper()
        sp = _safe_float(r.get("strike_price"))
        if ot not in ("CE", "PE") or sp <= 0:
            # underlying row (option_type "" / strike_price -1) → spot price
            ltp = _safe_float(r.get("ltp"))
            if ltp > 0:
                underlying = ltp
            continue
        by_strike.setdefault(sp, {})[ot] = r

    strikes: List[Dict] = []
    total_ce_oi = 0
    total_pe_oi = 0
    for sp in sorted(by_strike.keys()):
        ce = by_strike[sp].get("CE", {}) or {}
        pe = by_strike[sp].get("PE", {}) or {}

        call_oi = int(_safe_float(ce.get("oi")))
        put_oi  = int(_safe_float(pe.get("oi")))
        total_ce_oi += call_oi
        total_pe_oi += put_oi

        strikes.append({
            "strike":         sp,
            "expiry":         nearest_expiry,
            "call_oi":        call_oi,
            "call_oi_change": int(_safe_float(ce.get("oich"))),
            "call_volume":    int(_safe_float(ce.get("volume"))),
            "call_iv":        0.0,                          # solved in enrich step
            "call_ltp":       _safe_float(ce.get("ltp")),
            "call_delta":     0.0,
            "call_theta":     0.0,
            "put_oi":         put_oi,
            "put_oi_change":  int(_safe_float(pe.get("oich"))),
            "put_volume":     int(_safe_float(pe.get("volume"))),
            "put_iv":         0.0,
            "put_ltp":        _safe_float(pe.get("ltp")),
            "put_delta":      0.0,
            "put_theta":      0.0,
            "pcr":            round(put_oi / call_oi, 3) if call_oi else 0,
        })

    pcr      = round(total_pe_oi / total_ce_oi, 3) if total_ce_oi else 0
    max_pain = _calc_max_pain(strikes)

    return {
        "symbol":           symbol,
        "expiry_dates":     expiry_dates,
        "strikes":          strikes,
        "total_ce_oi":      total_ce_oi,
        "total_pe_oi":      total_pe_oi,
        "pcr":              pcr,
        "underlying_value": underlying,
        "max_pain":         max_pain,
        "updated_at":       datetime.now().isoformat(),
        "source":           "fyers",
    }


def _calc_max_pain(strikes: List[Dict]) -> Optional[float]:
    """Max pain = strike price where total options value decays most."""
    try:
        strike_prices = sorted(set(s["strike"] for s in strikes))
        if not strike_prices:
            return None
        min_pain = float("inf")
        max_pain_strike = strike_prices[0]
        for test_strike in strike_prices:
            pain = 0
            for s in strikes:
                if s["strike"] > test_strike:
                    pain += s["call_oi"] * (s["strike"] - test_strike)
                elif s["strike"] < test_strike:
                    pain += s["put_oi"] * (test_strike - s["strike"])
            if pain < min_pain:
                min_pain = pain
                max_pain_strike = test_strike
        return max_pain_strike
    except Exception:
        return None


# ── Market Depth (Level 2) ─────────────────────────────────────────────────────

async def get_market_depth(symbol: str) -> Optional[Dict]:
    """5-level order book depth for a symbol."""
    if not is_authenticated():
        return None
    try:
        fyers_sym = to_fyers_symbol(symbol)
        loop = asyncio.get_event_loop()
        resp = await asyncio.wait_for(
            loop.run_in_executor(_executor, lambda: _fyers_client.depth({"symbol": fyers_sym, "ohlcv_flag": 1})),
            timeout=6,
        )
        # Fyers v3 depth response uses "s":"ok" — there is no "code" field.
        # Previous check `resp.get("code") == 200` always evaluated to None == 200
        # (False), silently discarding every valid response.
        if resp.get("s") == "ok" and resp.get("d"):
            raw_d = resp["d"]
            # "d" is a dict keyed by fyers symbol; fall back to first value if key missing
            if isinstance(raw_d, dict):
                d = raw_d.get(fyers_sym) or (next(iter(raw_d.values()), {}) if raw_d else {})
            elif isinstance(raw_d, list) and raw_d:
                d = raw_d[0] if isinstance(raw_d[0], dict) else {}
            else:
                d = {}
            # Normalize Fyers bid/ask list format → {price, qty, orders}
            # Fyers returns: [{"price": ..., "volume": ..., "ord": ...}, ...]
            def _norm_levels(raw: list) -> list:
                out = []
                for lvl in (raw or []):
                    out.append({
                        "price":  lvl.get("price", 0),
                        "qty":    lvl.get("volume", lvl.get("qty", 0)),
                        "orders": lvl.get("ord",    lvl.get("orders", 0)),
                    })
                return out

            buy_levels  = _norm_levels(d.get("bids", []))
            sell_levels = _norm_levels(d.get("ask",  d.get("asks", [])))

            total_buy  = d.get("totalbuyqty",  sum(l["qty"] for l in buy_levels))
            total_sell = d.get("totalsellqty", sum(l["qty"] for l in sell_levels))

            # Spread calculation
            best_bid = buy_levels[0]["price"]  if buy_levels  else 0
            best_ask = sell_levels[0]["price"] if sell_levels else 0
            spread   = round(best_ask - best_bid, 2) if best_bid and best_ask else 0
            spread_pct = round(spread / best_bid * 100, 4) if best_bid else 0

            return {
                "symbol":        symbol,
                "buy":           buy_levels,     # normalized — frontend reads .buy[]
                "sell":          sell_levels,    # normalized — frontend reads .sell[]
                # legacy keys kept for backward compat
                "bids":          buy_levels,
                "asks":          sell_levels,
                "total_buy_qty": total_buy,
                "total_sell_qty":total_sell,
                "buy_qty":       total_buy,
                "sell_qty":      total_sell,
                "best_bid":      best_bid,
                "best_ask":      best_ask,
                "spread":        spread,
                "spread_pct":    spread_pct,
                "source":        "fyers",
            }
    except Exception as e:
        logger.warning("Fyers market_depth %s: %s(%s)", symbol, type(e).__name__, e)
    return None


# ── WebSocket Live Feed ────────────────────────────────────────────────────────

_ws_thread = None
_ws_obj    = None
_ws_broadcast_cb = None
_ws_symbols: List[str] = []


def _start_live_feed():
    """Start Fyers WebSocket in background thread after auth."""
    import threading
    global _ws_thread, _ws_obj, _ws_symbols

    if not is_authenticated():
        return

    # Default symbols: full Nifty 50 + Nifty Next 50 (first 30) + key indices
    # Fyers WS handles 100+ symbols comfortably — subscribe broadly so the
    # TickerBar shows live tick-by-tick updates for all major stocks, not just watchlist.
    from data.nse_data import NIFTY_50, NIFTY_NEXT_50
    _ws_symbols = (
        [to_fyers_symbol(s) for s in NIFTY_50]               # all 50 NIFTY stocks
        + [to_fyers_symbol(s) for s in NIFTY_NEXT_50[:30]]   # top 30 from Nifty Next 50
        + [
            # NSE broad indices
            "NSE:NIFTY50-INDEX", "NSE:NIFTYBANK-INDEX", "NSE:INDIAVIX-INDEX",
            "NSE:NIFTYMIDCAP100-INDEX", "NSE:NIFTYREALTY-INDEX",
            # NSE sector indices — must use NIFTY* prefix; CNX* rejected by Fyers WS (-300)
            "NSE:NIFTYIT-INDEX", "NSE:NIFTYPHARMA-INDEX", "NSE:NIFTYAUTO-INDEX",
            "NSE:NIFTYMETAL-INDEX", "NSE:NIFTYFMCG-INDEX", "NSE:NIFTYENERGY-INDEX",
            # BSE index
            "BSE:SENSEX-INDEX",
        ]
    )

    def _run_ws():
        global _ws_obj
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            from fyers_apiv3.FyersWebsocket import data_ws

            def on_message(msg):
                # _handle_tick checks _broadcast_fn / _main_loop internally
                _handle_tick(msg)

            def on_error(msg):
                logger.error("Fyers WS error: %s", msg)
                # -300 = invalid symbol(s) — remove them so reconnect doesn't retry them
                if isinstance(msg, dict) and msg.get("code") == -300:
                    bad = msg.get("invalid_symbols", [])
                    if bad:
                        logger.warning("Fyers WS: dropping invalid symbols %s from subscription", bad)
                        for s in bad:
                            try:
                                _ws_symbols.remove(s)
                            except ValueError:
                                pass

            def on_close(msg):
                logger.info("Fyers WS closed")

            def on_open():
                logger.info("Fyers WS connected, subscribing %d symbols", len(_ws_symbols))
                _ws_obj.subscribe(symbols=_ws_symbols, data_type="SymbolUpdate")
                _ws_obj.keep_running()

            _ws_obj = data_ws.FyersDataSocket(
                access_token=f"{FYERS_APP_ID}:{_access_token}",
                log_path="",
                litemode=False,
                write_to_file=False,
                reconnect=True,
                on_connect=on_open,
                on_close=on_close,
                on_error=on_error,
                on_message=on_message,
            )
            _ws_obj.connect()
        except Exception as e:
            logger.error("Fyers WS thread: %s", e)

    _ws_thread = threading.Thread(target=_run_ws, daemon=True, name="fyers_ws")
    _ws_thread.start()
    logger.info("Fyers WebSocket thread started")


_main_loop = None
_broadcast_fn = None


def set_broadcast(broadcast_fn, main_loop):
    """Called from main.py to wire up the async broadcast callback."""
    global _broadcast_fn, _main_loop
    _broadcast_fn = broadcast_fn
    _main_loop    = main_loop


def _handle_tick(msg):
    """Process incoming tick from Fyers WS and update cache + broadcast."""
    global _quote_cache, _quote_ts
    try:
        if not isinstance(msg, list):
            msg = [msg]
        ticks_out = []
        for tick in msg:
            sym_code = tick.get("symbol", "")
            # Convert back to raw symbol
            raw_sym = from_fyers_symbol(sym_code)
            lp = _safe_float(tick.get("ltp") or tick.get("lp"))
            if not lp:
                continue
            prev_close = _safe_float(tick.get("prev_close_price") or tick.get("prev_close"))
            change     = lp - prev_close
            change_pct = (change / prev_close * 100) if prev_close else 0

            q = {
                "symbol":     raw_sym,
                "price":      lp,
                "open":       _safe_float(tick.get("open_price")),
                "high":       _safe_float(tick.get("high_price")),
                "low":        _safe_float(tick.get("low_price")),
                "prev_close": prev_close,
                "volume":     int(tick.get("vol_traded_today") or tick.get("volume") or 0),
                "change":     round(change, 2),
                "change_pct": round(change_pct, 2),
                "timestamp":  datetime.now().isoformat(),
                "source":     "fyers_ws",
            }
            _quote_cache[raw_sym] = q
            _quote_ts[raw_sym]    = time.time()
            ticks_out.append(q)

            # ── DuckDB live_quotes upsert (Bloomberg-style in-memory OLAP) ───
            # Batched inside MarketDataStore — thread-safe, non-blocking.
            # Enables sub-ms breadth/screener queries over all ticked symbols.
            try:
                from data.duckdb_store import store as _duck
                _duck.upsert_live_quote(raw_sym, q)
            except Exception:
                pass  # never stall WS on DuckDB issues

            # ── Buffer for DuckDB tick log (non-blocking — drop if queue full) ──
            # _tick_batch_broadcaster drains this every 33ms and batch-inserts.
            # put_nowait never sleeps — WS callback stays latency-free.
            try:
                _tick_store_queue.put_nowait({
                    "symbol": raw_sym,
                    "price":  lp,
                    "volume": q["volume"],
                    "side":   "UNKNOWN",   # Fyers WS doesn't give trade side at L1
                    "ts":     datetime.now(),
                })
            except queue.Full:
                pass  # Queue full (>20k buffered) — silently drop; never stall WS

        if ticks_out and _broadcast_fn and _main_loop:
            import asyncio as _asyncio
            _asyncio.run_coroutine_threadsafe(
                _broadcast_fn({"type": "tick_update", "data": ticks_out}),
                _main_loop,
            )
    except Exception as e:
        logger.error("_handle_tick: %s", e)


def ws_subscribe(symbols: List[str]):
    """Dynamically add symbols to the live WebSocket feed."""
    global _ws_symbols, _ws_obj
    new = [to_fyers_symbol(s) for s in symbols if to_fyers_symbol(s) not in _ws_symbols]
    if new and _ws_obj:
        _ws_symbols.extend(new)
        try:
            _ws_obj.subscribe(symbols=new, data_type="SymbolUpdate")
        except Exception as e:
            logger.warning("ws_subscribe: %s", e)


def get_quote_cache() -> Dict[str, Dict]:
    """
    Return a snapshot copy of the Fyers WS tick cache.
    Safe to call from main.py every broadcast cycle to merge live WS prices.
    Includes ALL symbols seen from Fyers WS (indices + equities).
    """
    return dict(_quote_cache)


def get_symbol_info_all() -> Dict[str, Dict]:
    """
    Return {symbol: {name, isin}} for all loaded NSE symbols.
    Used by screener for name enrichment.  O(1) — just returns the master dict.
    """
    return {
        sym: {"name": info.get("name", sym), "isin": info.get("isin", "")}
        for sym, info in _symbol_master.items()
    }


def get_ws_status() -> Dict:
    """Return Fyers WS connection status for diagnostics."""
    return {
        "ws_thread_alive": _ws_thread is not None and _ws_thread.is_alive(),
        "ws_symbols_count": len(_ws_symbols),
        "quote_cache_size": len(_quote_cache),
        "broadcast_fn_set": _broadcast_fn is not None,
        "main_loop_set":    _main_loop is not None,
        "sample_symbols":   list(_quote_cache.keys())[:10],
    }
