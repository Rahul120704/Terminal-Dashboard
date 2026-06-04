"""
Delta Exchange WebSocket + REST client — real-time crypto prices.

CONFIRMED (live test 2025-05-25):
  - India endpoint: wss://socket.india.delta.exchange
  - Channel: v2/ticker  (PUBLIC — no auth required)
  - Message format: FLAT outer object  (no nested 'data' key)
    {"type":"v2/ticker","symbol":"BTCUSD","close":75949.5,"mark_price":"75956.06",...}
  - API keys are INVALID — never send auth frame
    (invalid auth = immediate WS close → reconnect loop → prices freeze)

Latency architecture:
  WS tick arrives
    → _on_message: parse + put_nowait into _tick_queue   ← non-blocking, ~0µs
    → _tick_pump: drains queue + awaits broadcast         ← dedicated coroutine
    → manager.broadcast: asyncio.gather to all clients   ← parallel send

  This decouples WS receiving from broadcasting so neither blocks the other.
  The queue is unbounded — ticks are never dropped.

REST always-poll (3s interval):
  Guarantees updates even during WS silence / reconnects.
"""

import asyncio
import aiohttp
import json
import logging
import os
import time
from datetime import datetime
from typing import Callable, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

# ── Endpoints ──────────────────────────────────────────────────────────────────
_REGION = os.getenv("DELTA_REGION", "india").lower()

if _REGION == "india":
    DELTA_REST_URL = "https://api.india.delta.exchange/v2"
    DELTA_WS_URL   = "wss://socket.india.delta.exchange"
else:
    DELTA_REST_URL = "https://api.delta.exchange/v2"
    DELTA_WS_URL   = "wss://socket.delta.exchange"

# ── Timing ─────────────────────────────────────────────────────────────────────
RECONNECT_BASE = 5
RECONNECT_MAX  = 60
REST_POLL_SECS = 3    # always-on REST poll — 3 s guarantees at least 3s refresh

# ── Keys — only in .env, never hardcoded ──────────────────────────────────────
_API_KEY    = os.getenv("DELTA_API_KEY",    "")
_API_SECRET = os.getenv("DELTA_API_SECRET", "")

# ── Confirmed perpetual symbols on India endpoint ─────────────────────────────
DELTA_SEED_SYMBOLS: List[str] = [
    "BTCUSD",  "ETHUSD",  "BNBUSD",  "SOLUSD",  "XRPUSD",
    "ADAUSD",  "AVAXUSD", "DOTUSD",  "LINKUSD", "MATICUSD",
    "DOGEUSD", "LTCUSD",  "UNIUSD",  "ATOMUSD", "NEARUSD",
    "ETCUSD",  "XLMUSD",  "SUIUSD",  "APTUSD",  "ARBUSD",
    "OPUSD",   "INJUSD",  "TIAUSD",  "SEIUSD",  "FTMUSD",
    "HBARUSD", "TONUSD",  "TRXUSD",  "FILUSD",  "RUNEUSD",
]


# ── Helpers ────────────────────────────────────────────────────────────────────

def _safe_float(val) -> float:
    try:
        f = float(val)
        return 0.0 if f != f else f
    except Exception:
        return 0.0


def _delta_to_std(sym: str) -> str:
    return sym.replace("USDT", "").replace("USD", "")


# ── Client ─────────────────────────────────────────────────────────────────────

class DeltaExchangeClient:
    """
    Delta Exchange live feed.  No auth — v2/ticker is a public channel.
    Cache keys = standard symbols (BTC, ETH…).
    """

    def __init__(self, broadcast_fn: Optional[Callable] = None):
        self._broadcast              = broadcast_fn
        self._running                = False
        self._cache: Dict[str, Dict] = {}
        self._active: List[str]      = []
        self._session: Optional[aiohttp.ClientSession] = None
        self._reconnect_delay        = RECONNECT_BASE
        self._last_tick_ts: float    = 0.0
        self._seen_types: Set[str]   = set()

        # Internal queue — WS puts ticks here; _tick_pump drains + broadcasts
        # This decouples receiving from broadcasting with zero scheduling overhead
        self._tick_queue: asyncio.Queue = asyncio.Queue()

        logger.info("Delta Exchange: region=%s  WS=%s", _REGION, DELTA_WS_URL)

    # ── Public API ─────────────────────────────────────────────────────────────

    async def start(self):
        self._running = True
        logger.info("DeltaExchangeClient starting (region=%s)…", _REGION)
        await self._discover_symbols()
        n = await self._poll_rest_once()
        logger.info("Delta REST snapshot: %d symbols primed", n)
        await asyncio.gather(
            self._ws_supervisor(),
            self._rest_always_poll(),
            self._tick_pump(),      # dedicated broadcast pump
        )

    async def stop(self):
        self._running = False
        if self._session and not self._session.closed:
            await self._session.close()

    def get_all(self) -> Dict[str, Dict]:
        return dict(self._cache)

    def get(self, symbol: str) -> Optional[Dict]:
        return self._cache.get(symbol.upper())

    def is_live(self, max_age_s: float = 60.0) -> bool:
        """True if a price update arrived within max_age_s (from WS or REST)."""
        return self._last_tick_ts > 0 and (time.time() - self._last_tick_ts) < max_age_s

    def status(self) -> Dict:
        age = round(time.time() - self._last_tick_ts, 1) if self._last_tick_ts else None
        return {
            "region":            _REGION,
            "rest_url":          DELTA_REST_URL,
            "ws_url":            DELTA_WS_URL,
            "active_symbols":    len(self._active),
            "cached_symbols":    len(self._cache),
            "cached_list":       sorted(self._cache.keys())[:20],
            "last_update_ago_s": age,
            "is_live_60s":       self.is_live(60),
            "queue_size":        self._tick_queue.qsize(),
            "seen_ws_types":     sorted(self._seen_types),
        }

    # ── Session factory ────────────────────────────────────────────────────────

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=10),
                headers={"Accept": "application/json", "User-Agent": "BTI-Terminal/2.0"},
                connector=aiohttp.TCPConnector(ssl=True, limit=10),
            )
        return self._session

    async def _get(self, path: str, params: dict = None) -> Optional[dict]:
        """Public GET — no auth needed for market data."""
        sess = await self._get_session()
        try:
            async with sess.get(DELTA_REST_URL + path, params=params) as resp:
                if resp.status != 200:
                    logger.warning("Delta REST %s → HTTP %d", path, resp.status)
                    return None
                return await resp.json(content_type=None)
        except Exception as e:
            logger.warning("Delta REST %s: %s", path, e)
            return None

    # ── Symbol discovery ───────────────────────────────────────────────────────

    async def _discover_symbols(self):
        try:
            data = await self._get(
                "/products",
                {"contract_types": "perpetual_futures", "states": "live", "page_size": 500},
            )
            results   = (data or {}).get("result") or []
            available = {r.get("symbol", "") for r in results}
            matched   = [s for s in DELTA_SEED_SYMBOLS if s in available]
            if matched:
                self._active = matched
                logger.info("Delta: %d symbols on %s", len(matched), _REGION)
            else:
                self._active = list(DELTA_SEED_SYMBOLS)
                logger.warning("Delta: no seed symbols matched (%d products) — using seed list", len(results))
        except Exception as e:
            self._active = list(DELTA_SEED_SYMBOLS)
            logger.warning("Delta discovery failed (%s)", e)

    # ── REST poll ──────────────────────────────────────────────────────────────

    async def _poll_rest_once(self) -> int:
        """Fetch /v2/tickers (public), update cache, enqueue for broadcast."""
        try:
            data    = await self._get("/tickers")
            tickers = (data or {}).get("result") or []
            if not tickers and isinstance(data, list):
                tickers = data

            active_set = set(self._active)
            count      = 0
            for t in tickers:
                sym = t.get("symbol", "")
                if active_set and sym not in active_set:
                    continue
                q   = self._parse(t)
                std = q["symbol"]
                if not std:
                    continue
                self._cache[std] = q
                count += 1
                # Put into queue for broadcasting (non-blocking)
                self._tick_queue.put_nowait({"type": "crypto_tick", "data": q})

            if count > 0:
                self._last_tick_ts = time.time()
            return count
        except Exception as e:
            logger.warning("Delta REST poll: %s", e)
            return 0

    async def _rest_always_poll(self):
        """Always-on REST poll every REST_POLL_SECS — independent of WS state."""
        await asyncio.sleep(12)  # give WS time to produce first ticks
        while self._running:
            n = await self._poll_rest_once()
            logger.debug("Delta REST poll: %d updated", n)
            await asyncio.sleep(REST_POLL_SECS)

    # ── Tick pump — dedicated broadcast coroutine ──────────────────────────────

    async def _tick_pump(self):
        """
        Drains _tick_queue and calls _broadcast for each message.
        Running as a dedicated coroutine means WS receiving and broadcasting
        never block each other.  Zero scheduling overhead vs ensure_future.
        """
        while self._running:
            try:
                # Wait up to 0.1s for a message so we can check _running
                msg = await asyncio.wait_for(self._tick_queue.get(), timeout=0.1)
                if self._broadcast:
                    await self._broadcast(msg)
                self._tick_queue.task_done()
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug("tick_pump: %s", e)

    # ── WebSocket supervisor ───────────────────────────────────────────────────

    async def _ws_supervisor(self):
        while self._running:
            try:
                await self._ws_run()
                self._reconnect_delay = RECONNECT_BASE
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("Delta WS error (%s) — retry in %ds", e, self._reconnect_delay)
                if self._running:
                    await asyncio.sleep(self._reconnect_delay)
                    self._reconnect_delay = min(self._reconnect_delay * 2, RECONNECT_MAX)

    async def _ws_run(self):
        sess = await self._get_session()
        async with sess.ws_connect(
            DELTA_WS_URL,
            heartbeat=20,
            receive_timeout=60,
            ssl=True,
        ) as ws:
            logger.info("Delta WS connected (%d symbols, no auth)", len(self._active))
            self._reconnect_delay = RECONNECT_BASE

            # Subscribe to v2/ticker — PUBLIC channel, NO auth needed.
            # Do NOT send auth frame: invalid keys cause immediate close → reconnect loop.
            for i in range(0, len(self._active), 50):
                chunk = self._active[i : i + 50]
                await ws.send_json({
                    "type": "subscribe",
                    "payload": {"channels": [{"name": "v2/ticker", "symbols": chunk}]},
                })

            async for msg in ws:
                if not self._running:
                    break
                if msg.type == aiohttp.WSMsgType.TEXT:
                    try:
                        await self._on_message(json.loads(msg.data))
                    except Exception as exc:
                        logger.debug("Delta WS parse: %s", exc)
                elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                    logger.warning("Delta WS closed: %s", msg.data)
                    break

    # ── Message handler ────────────────────────────────────────────────────────

    async def _on_message(self, data: Dict):
        """
        Minimal work: parse the tick, update cache, put in queue.
        ~microseconds per call — never blocks the WS receive loop.
        """
        msg_type = data.get("type", "")

        if msg_type in ("subscriptions", "subscribe", "subscription"):
            return

        if msg_type in ("ticker", "v2/ticker"):
            sym = data.get("symbol", "")
            if not sym:
                return

            # India WS sends flat format — all fields in outer object, no 'data' key.
            # Handle nested format too (older API versions).
            inner = data.get("data")
            payload = {**inner, "symbol": sym} if isinstance(inner, dict) else data

            self._last_tick_ts = time.time()
            q   = self._parse(payload)
            std = q["symbol"]
            if not std:
                return

            self._cache[std] = q
            # Non-blocking enqueue — _tick_pump handles broadcasting
            self._tick_queue.put_nowait({"type": "crypto_tick", "data": q})
            return

        if msg_type not in self._seen_types:
            self._seen_types.add(msg_type)
            logger.info("Delta WS new type '%s': %s", msg_type, str(data)[:150])

    # ── Normaliser ─────────────────────────────────────────────────────────────

    def _parse(self, d: Dict) -> Dict:
        delta_sym = d.get("symbol", "")
        std_sym   = _delta_to_std(delta_sym).upper()

        close  = _safe_float(d.get("close") or d.get("mark_price") or d.get("last_price") or 0)
        open_p = _safe_float(d.get("open")   or 0)
        high   = _safe_float(d.get("high")   or 0)
        low    = _safe_float(d.get("low")    or 0)
        vol    = _safe_float(d.get("volume") or d.get("turnover_usd") or 0)
        mark   = _safe_float(d.get("mark_price") or close)
        spot   = _safe_float(d.get("spot_price") or close)
        fr     = _safe_float(d.get("funding_rate") or 0)
        oi     = _safe_float(d.get("oi") or d.get("open_interest") or 0)

        change     = close - open_p if open_p else 0.0
        change_pct = (change / open_p * 100) if open_p else 0.0

        return {
            "symbol":         std_sym,
            "name":           d.get("description") or std_sym,
            "price":          close,
            "open24h":        open_p,
            "high24h":        high,
            "low24h":         low,
            "volume24h":      vol,
            "change":         round(change, 4),
            "changePct24h":   round(change_pct, 4),
            "change_pct_24h": round(change_pct, 4),
            "change_24h":     round(change_pct, 4),
            "mark_price":     mark,
            "spot_price":     spot,
            "funding_rate":   fr,
            "open_interest":  oi,
            "delta_symbol":   delta_sym,
            "source":         "delta_exchange",
            "region":         _REGION,
            "timestamp":      datetime.now().isoformat(),
            "_ts":            time.time(),
        }


# ── Convenience helpers ────────────────────────────────────────────────────────

async def fetch_ticker(symbol: str) -> Optional[Dict]:
    client = get_client()
    if not client:
        return None
    data = await client._get(f"/tickers/{symbol}")
    if data and data.get("result"):
        return client._parse(data["result"])
    return None


# ── Singleton ──────────────────────────────────────────────────────────────────

_client: Optional[DeltaExchangeClient] = None


def get_client(broadcast_fn: Optional[Callable] = None) -> Optional[DeltaExchangeClient]:
    global _client
    if _client is None:
        _client = DeltaExchangeClient(broadcast_fn)
    elif broadcast_fn is not None and _client._broadcast is None:
        _client._broadcast = broadcast_fn
    return _client
