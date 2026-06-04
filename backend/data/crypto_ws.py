"""
CryptoCompare WebSocket + REST client.
- Streams millisecond price ticks for top-20 cryptos via CCCAGG feed
- Provides REST helpers for history, news, market cap table
- API key read from environment — NEVER hardcoded
"""

import asyncio
import json
import logging
import os
import time
import aiohttp
from typing import Dict, List, Optional, Callable, Any

logger = logging.getLogger(__name__)

# ── Config from env ────────────────────────────────────────────────────────────
_API_KEY = os.environ.get("CRYPTOCOMPARE_API_KEY", "")
_WS_URL  = f"wss://streamer.cryptocompare.com/v2?api_key={_API_KEY}"
_REST    = "https://min-api.cryptocompare.com"

# Top-20 crypto symbols to stream (CCCAGG vs USD)
TOP_20 = [
    "BTC", "ETH", "BNB", "SOL", "XRP",
    "ADA", "DOGE", "AVAX", "DOT", "LINK",
    "MATIC", "UNI", "ATOM", "LTC", "NEAR",
    "FTM", "ALGO", "VET", "MANA", "SAND",
]

# Channel type 5 = CCCAGG aggregate ticks
SUBS = [f"5~CCCAGG~{sym}~USD" for sym in TOP_20]

# ── In-process price cache ─────────────────────────────────────────────────────
_price_cache: Dict[str, Dict] = {}   # symbol → {price, open24h, high24h, low24h, volume24h, change24h, ts}
_cache_lock = asyncio.Lock()

# ── CCCAGG field mapping (TYPE=5) ─────────────────────────────────────────────
# See: https://min-api.cryptocompare.com/documentation/websockets?key=Streamer
FIELD_MAP = {
    "PRICE":          "price",
    "OPEN24HOUR":     "open24h",
    "HIGH24HOUR":     "high24h",
    "LOW24HOUR":      "low24h",
    "VOLUMEHOUR":     "volumeHour",
    "VOLUME24HOUR":   "volume24h",
    "CHANGE24HOUR":   "change24h",
    "CHANGEPCT24HOUR":"changePct24h",
    "MKTCAP":         "marketCap",
    "LASTUPDATE":     "ts",
    "FLAGS":          "flags",
}


def _parse_tick(raw: Dict) -> Optional[Dict]:
    """Parse a TYPE=5 CCCAGG tick into a normalised dict."""
    if raw.get("TYPE") != "5":
        return None
    sym = raw.get("FROMSYMBOL", "")
    if not sym:
        return None
    out = {"symbol": sym}
    for cc_key, out_key in FIELD_MAP.items():
        if cc_key in raw:
            out[out_key] = raw[cc_key]
    return out


class CryptoWSAgent:
    """
    Background agent that maintains a long-lived CryptoCompare WebSocket
    connection, parses CCCAGG ticks, and broadcasts to the BTI WebSocket hub.
    """

    def __init__(self, broadcast: Optional[Callable] = None):
        self._broadcast = broadcast
        self._running = False
        self._ws = None
        self._reconnect_delay = 5  # seconds, backs off up to 60s

    async def start(self):
        if not _API_KEY:
            logger.warning("CRYPTOCOMPARE_API_KEY not set — crypto WebSocket disabled")
            return
        self._running = True
        logger.info("CryptoWSAgent starting…")
        await self._run_loop()

    async def stop(self):
        self._running = False
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass

    async def _run_loop(self):
        # The server (CryptoCompare free tier) sometimes closes the socket
        # immediately after connect. The old code only backed off in the
        # `except` branch, so a *clean* immediate close reset the delay and
        # reconnected with ZERO sleep → dozens of reconnects/sec, flooding the
        # event loop with crypto_tick broadcasts and starving the Indian price
        # heartbeat. Fix: ALWAYS sleep before reconnecting, and treat a
        # short-lived session as a failure that triggers exponential backoff.
        delay = self._reconnect_delay
        MIN_HEALTHY_UPTIME = 20.0   # a session must last this long to count as "good"
        MAX_DELAY          = 120.0  # cap — persistent rejection must not busy-loop
        while self._running:
            started = time.monotonic()
            clean   = False
            try:
                await self._connect()
                clean = True                       # returned without raising
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("CryptoWS error: %s", e)
            finally:
                self._ws = None

            if not self._running:
                break

            uptime = time.monotonic() - started
            if uptime >= MIN_HEALTHY_UPTIME:
                delay = self._reconnect_delay        # healthy session → reset backoff
            else:
                # Immediate close / handshake reject / error — back off so we
                # never spin into a reconnect storm.
                delay = min(max(delay, self._reconnect_delay) * 2, MAX_DELAY)
                logger.warning(
                    "CryptoWS %s after %.1fs — backing off %ds",
                    "closed early" if clean else "failed", uptime, int(delay),
                )

            await asyncio.sleep(delay)   # ALWAYS sleep before reconnect

    async def _connect(self):
        """Open WebSocket, subscribe, and process messages until disconnected."""
        timeout = aiohttp.ClientTimeout(total=None, connect=15)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.ws_connect(
                _WS_URL,
                heartbeat=30,
                max_msg_size=0,
            ) as ws:
                self._ws = ws
                logger.info("CryptoWS connected ✓")

                # Subscribe to top-20 CCCAGG ticks
                await ws.send_str(json.dumps({"action": "SubAdd", "subs": SUBS}))

                async for msg in ws:
                    if not self._running:
                        break
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        await self._handle(msg.data)
                    elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                        logger.warning("CryptoWS closed/error — reconnecting")
                        break

    async def _handle(self, raw_text: str):
        try:
            raw = json.loads(raw_text)
        except json.JSONDecodeError:
            return

        tick = _parse_tick(raw)
        if not tick:
            return

        sym = tick["symbol"]
        async with _cache_lock:
            existing = _price_cache.get(sym, {})
            existing.update(tick)
            existing["symbol"] = sym
            existing["updated_at"] = time.time()
            _price_cache[sym] = existing

        # Broadcast to all BTI WebSocket clients
        if self._broadcast and tick.get("price"):
            await self._broadcast({
                "type": "crypto_tick",
                "data": tick,
            })


# ── Singleton instance ─────────────────────────────────────────────────────────
_agent: Optional[CryptoWSAgent] = None


def get_agent(broadcast: Optional[Callable] = None) -> CryptoWSAgent:
    global _agent
    if _agent is None:
        _agent = CryptoWSAgent(broadcast=broadcast)
    return _agent


def get_cached_prices() -> Dict[str, Dict]:
    """Synchronous snapshot of the in-memory price cache (thread-safe for asyncio)."""
    return dict(_price_cache)


def get_cached_price(symbol: str) -> Optional[Dict]:
    return _price_cache.get(symbol.upper())


# ── REST helpers ───────────────────────────────────────────────────────────────

async def fetch_top_by_market_cap(limit: int = 20) -> List[Dict]:
    """Fetch top-N coins by market cap from CryptoCompare REST API."""
    if not _API_KEY:
        return []
    url = f"{_REST}/data/top/mktcapfull?limit={limit}&tsym=USD&api_key={_API_KEY}"
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(url, timeout=aiohttp.ClientTimeout(total=10)) as r:
                if r.status != 200:
                    return []
                data = await r.json()
                coins = data.get("Data", [])
                result = []
                for c in coins:
                    info  = c.get("CoinInfo", {})
                    raw   = c.get("RAW", {}).get("USD", {})
                    disp  = c.get("DISPLAY", {}).get("USD", {})
                    result.append({
                        "symbol":       info.get("Name", ""),
                        "name":         info.get("FullName", ""),
                        "price":        raw.get("PRICE"),
                        "market_cap":   raw.get("MKTCAP"),
                        "volume_24h":   raw.get("VOLUME24HOUR"),
                        "change_pct_24h": raw.get("CHANGEPCT24HOUR"),
                        "high_24h":     raw.get("HIGH24HOUR"),
                        "low_24h":      raw.get("LOW24HOUR"),
                        "supply":       raw.get("SUPPLY"),
                        "image":        f"https://www.cryptocompare.com{info.get('ImageUrl', '')}",
                        "rank":         info.get("Rating", {}).get("Weiss", {}).get("Rating", ""),
                        "algorithm":    info.get("Algorithm", ""),
                        "proof_type":   info.get("ProofType", ""),
                    })
                return result
    except Exception as e:
        logger.error("fetch_top_by_market_cap: %s", e)
        return []


async def fetch_history(symbol: str, vs: str = "USD",
                         limit: int = 365, aggregate: int = 1,
                         resolution: str = "day") -> List[Dict]:
    """
    Fetch OHLCV history.
    resolution: 'day' | 'hour' | 'minute'
    """
    if not _API_KEY:
        return []
    ep_map = {"day": "histoday", "hour": "histohour", "minute": "histominute"}
    ep = ep_map.get(resolution, "histoday")
    url = (
        f"{_REST}/data/v2/{ep}?fsym={symbol.upper()}&tsym={vs}"
        f"&limit={limit}&aggregate={aggregate}&api_key={_API_KEY}"
    )
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(url, timeout=aiohttp.ClientTimeout(total=15)) as r:
                if r.status != 200:
                    return []
                data = await r.json()
                candles = data.get("Data", {}).get("Data", [])
                return [
                    {
                        "time": c["time"],
                        "open":   c.get("open"),
                        "high":   c.get("high"),
                        "low":    c.get("low"),
                        "close":  c.get("close"),
                        "volume": c.get("volumeto"),
                    }
                    for c in candles
                    if c.get("close")
                ]
    except Exception as e:
        logger.error("fetch_history %s: %s", symbol, e)
        return []


async def fetch_crypto_news(categories: str = "", limit: int = 20) -> List[Dict]:
    """Fetch latest crypto news from CryptoCompare."""
    if not _API_KEY:
        return []
    url = (
        f"{_REST}/data/v2/news/?lang=EN&sortOrder=popular"
        f"{'&categories=' + categories if categories else ''}"
        f"&api_key={_API_KEY}"
    )
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(url, timeout=aiohttp.ClientTimeout(total=10)) as r:
                if r.status != 200:
                    return []
                data = await r.json()
                items = data.get("Data", [])[:limit]
                return [
                    {
                        "id":         str(item.get("id", "")),
                        "headline":   item.get("title", ""),
                        "body":       item.get("body", "")[:400],
                        "url":        item.get("url", ""),
                        "source":     item.get("source", ""),
                        "published_at": item.get("published_on"),
                        "image":      item.get("imageurl", ""),
                        "tags":       item.get("tags", ""),
                        "categories": item.get("categories", ""),
                    }
                    for item in items
                ]
    except Exception as e:
        logger.error("fetch_crypto_news: %s", e)
        return []


async def fetch_price_multi(symbols: List[str], vs_currencies: List[str] = None) -> Dict:
    """Fetch current prices for multiple symbols from CryptoCompare REST."""
    if not _API_KEY or not symbols:
        return {}
    vs = ",".join(vs_currencies or ["USD", "INR", "BTC", "ETH"])
    fsyms = ",".join(s.upper() for s in symbols[:30])
    url = f"{_REST}/data/pricemultifull?fsyms={fsyms}&tsyms={vs}&api_key={_API_KEY}"
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(url, timeout=aiohttp.ClientTimeout(total=10)) as r:
                if r.status != 200:
                    return {}
                data = await r.json()
                raw = data.get("RAW", {})
                result = {}
                for sym, vs_map in raw.items():
                    usd = vs_map.get("USD", {})
                    inr = vs_map.get("INR", {})
                    result[sym] = {
                        "price_usd":     usd.get("PRICE"),
                        "price_inr":     inr.get("PRICE"),
                        "change_pct_24h":usd.get("CHANGEPCT24HOUR"),
                        "market_cap":    usd.get("MKTCAP"),
                        "volume_24h":    usd.get("VOLUME24HOUR"),
                        "high_24h":      usd.get("HIGH24HOUR"),
                        "low_24h":       usd.get("LOW24HOUR"),
                        "supply":        usd.get("SUPPLY"),
                    }
                return result
    except Exception as e:
        logger.error("fetch_price_multi: %s", e)
        return {}
