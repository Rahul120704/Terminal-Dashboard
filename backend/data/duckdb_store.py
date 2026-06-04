"""
BTI DuckDB Historical Data Store
==================================
Lightning-fast OHLCV + tick data store for NSE equities.
DuckDB reads Parquet 10-50x faster than SQLite for analytical queries.

Architecture:
  D:/BB/data/
    ohlcv/          — Daily OHLCV Parquet, partitioned by symbol
    ticks/          — Intraday tick data, partitioned by date/symbol
    options/        — Options chain snapshots

Usage:
  from data.duckdb_store import store
  candles = store.get_ohlcv("RELIANCE", "2024-01-01", "2025-01-01")
  store.upsert_ohlcv("RELIANCE", candles_list)

Data sources:
  - Fyers historical API (primary, requires auth)
  - NSE Bhavcopy CSV (daily EOD, free, no auth)
  - yfinance (fallback, rate-limited)
"""

import asyncio
import logging
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional, Union
import threading

logger = logging.getLogger(__name__)

# ── Data directory ─────────────────────────────────────────────────────────────
DATA_DIR = Path(__file__).parent.parent / "data_store" / "market_data"
OHLCV_DIR = DATA_DIR / "ohlcv"
TICKS_DIR = DATA_DIR / "ticks"
OPTIONS_DIR = DATA_DIR / "options"

for d in [DATA_DIR, OHLCV_DIR, TICKS_DIR, OPTIONS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ── DuckDB connection (thread-safe singleton) ─────────────────────────────────
_db_lock = threading.Lock()
_db_conn = None

def get_db():
    """Get or create DuckDB connection. Thread-safe."""
    global _db_conn
    with _db_lock:
        if _db_conn is None:
            try:
                import duckdb
                db_path = str(DATA_DIR / "bti_market.duckdb")
                _db_conn = duckdb.connect(db_path)
                _init_schema(_db_conn)
                logger.info("DuckDB market data store initialized: %s", db_path)
            except ImportError:
                logger.warning("DuckDB not installed — pip install duckdb. Using in-memory fallback.")
                _db_conn = _InMemoryStore()
        return _db_conn


def _init_schema(db):
    """Create DuckDB tables if they don't exist."""
    db.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv (
            symbol      VARCHAR NOT NULL,
            date        DATE NOT NULL,
            open        DOUBLE,
            high        DOUBLE,
            low         DOUBLE,
            close       DOUBLE,
            volume      BIGINT,
            adj_close   DOUBLE,
            source      VARCHAR DEFAULT 'fyers',
            updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (symbol, date)
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS intraday_candles (
            symbol      VARCHAR NOT NULL,
            ts          TIMESTAMP NOT NULL,
            resolution  VARCHAR NOT NULL,   -- '1m', '5m', '15m', '30m', '1h'
            open        DOUBLE,
            high        DOUBLE,
            low         DOUBLE,
            close       DOUBLE,
            volume      BIGINT,
            source      VARCHAR DEFAULT 'fyers',
            PRIMARY KEY (symbol, ts, resolution)
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS tick_log (
            symbol      VARCHAR NOT NULL,
            ts          TIMESTAMP NOT NULL,
            price       DOUBLE NOT NULL,
            volume      INTEGER,
            side        VARCHAR,        -- 'BUY', 'SELL', 'UNKNOWN'
            PRIMARY KEY (symbol, ts)
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS corporate_actions (
            symbol      VARCHAR NOT NULL,
            ex_date     DATE NOT NULL,
            action_type VARCHAR NOT NULL,  -- 'dividend', 'bonus', 'split', 'rights'
            ratio       DOUBLE,
            amount      DOUBLE,
            record_date DATE,
            PRIMARY KEY (symbol, ex_date, action_type)
        )
    """)
    # ── In-memory live_quotes table — updated on every Fyers tick ────────────
    # DuckDB in-memory table = sub-millisecond OLAP over 4500+ symbols.
    # Used by /api/market-breadth, /api/gainers-losers, /api/screener instead
    # of slow Python dict iteration over _quote_cache.
    db.execute("""
        CREATE TABLE IF NOT EXISTS live_quotes (
            symbol       VARCHAR PRIMARY KEY,
            price        DOUBLE,
            change_pct   DOUBLE,
            change_abs   DOUBLE,
            volume       BIGINT,
            high         DOUBLE,
            low          DOUBLE,
            open         DOUBLE,
            prev_close   DOUBLE,
            market_cap   DOUBLE,
            updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Create indexes for fast symbol + date range queries
    try:
        db.execute("CREATE INDEX IF NOT EXISTS idx_ohlcv_sym_date ON ohlcv(symbol, date)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_intraday_sym_ts ON intraday_candles(symbol, ts, resolution)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_tick_sym_ts ON tick_log(symbol, ts)")
    except Exception:
        pass  # Indexes may already exist
    logger.debug("DuckDB schema initialized")


class _InMemoryStore:
    """Fallback when DuckDB is not installed."""
    def __init__(self):
        self._data: Dict[str, List] = {}

    def execute(self, sql, params=None):
        return self

    def fetchall(self):
        return []

    def fetchone(self):
        return None


class MarketDataStore:
    """
    High-performance OHLCV + tick store backed by DuckDB.
    Thread-safe, async-compatible via run_in_executor.
    """

    def __init__(self):
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    # ── Live Quotes (in-memory DuckDB — updated on every Fyers tick) ─────────

    # Batch buffer for tick upserts — flush every N ticks to reduce lock contention
    _tick_batch: List[Dict] = []
    _tick_batch_lock = threading.Lock()
    _tick_flush_size = 50   # flush after accumulating 50 ticks

    def upsert_live_quote(self, sym: str, q: Dict) -> None:
        """
        Write one tick into the live_quotes DuckDB table.
        Batches writes — flushes when batch reaches _tick_flush_size.
        Called from the Fyers WS thread (sync, thread-safe).
        """
        with self._tick_batch_lock:
            self._tick_batch.append(q)
            if len(self._tick_batch) < self._tick_flush_size:
                return
            batch = self._tick_batch[:]
            self._tick_batch.clear()
        self._flush_tick_batch(batch)

    def flush_tick_buffer(self) -> None:
        """Flush any remaining buffered ticks — call on a timer or before queries."""
        with self._tick_batch_lock:
            if not self._tick_batch:
                return
            batch = self._tick_batch[:]
            self._tick_batch.clear()
        self._flush_tick_batch(batch)

    def _flush_tick_batch(self, batch: List[Dict]) -> None:
        """Bulk-upsert a batch of quotes into live_quotes. Sub-millisecond."""
        if not batch:
            return
        try:
            db = get_db()
            with _db_lock:
                db.executemany(
                    """INSERT OR REPLACE INTO live_quotes
                       (symbol, price, change_pct, change_abs, volume,
                        high, low, open, prev_close, market_cap, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)""",
                    [
                        (
                            q.get("symbol", ""),
                            float(q.get("price")      or 0),
                            float(q.get("change_pct") or 0),
                            float(q.get("change")     or 0),
                            int(q.get("volume")       or 0),
                            float(q.get("high")       or 0),
                            float(q.get("low")        or 0),
                            float(q.get("open")       or 0),
                            float(q.get("prev_close") or 0),
                            float(q.get("market_cap") or 0),
                        )
                        for q in batch
                        if q.get("symbol") and float(q.get("price") or 0) > 0
                    ]
                )
        except Exception as e:
            logger.debug("live_quotes flush: %s", e)

    def get_market_breadth_fast(self) -> Optional[Dict]:
        """
        Sub-millisecond market breadth via DuckDB OLAP.
        Returns advances, declines, unchanged, top gainers/losers — all in one pass.
        Falls back to None if live_quotes is empty.
        """
        try:
            db = get_db()
            with _db_lock:
                row = db.execute("""
                    SELECT
                        COUNT_IF(price > 0 AND change_pct > 0)    AS advances,
                        COUNT_IF(price > 0 AND change_pct < 0)    AS declines,
                        COUNT_IF(price > 0 AND change_pct = 0)    AS unchanged,
                        COUNT_IF(price > 0)                       AS total_quoted,
                        ROUND(SUM(CASE WHEN price > 0 THEN price * volume ELSE 0 END) / 1e10, 2) AS total_turnover_cr
                    FROM live_quotes
                    WHERE price > 0
                """).fetchone()
            if not row or row[3] == 0:
                return None
            return {
                "advances":       int(row[0]),
                "declines":       int(row[1]),
                "unchanged":      int(row[2]),
                "symbols_scanned": int(row[3]),
                "ad_ratio":       round(row[0] / max(row[1], 1), 2),
                "bull_pct":       round(row[0] / max(row[3], 1) * 100, 1),
                "turnover_cr":    float(row[4]),
                "source":         "duckdb_live",
            }
        except Exception as e:
            logger.debug("get_market_breadth_fast: %s", e)
            return None

    def get_top_movers_fast(self, top_n: int = 20) -> Dict:
        """
        Top N gainers and losers in one DuckDB scan.
        Bloomberg MMAP equivalent — instant refresh on every tick flush.
        """
        gainers, losers = [], []
        try:
            db = get_db()
            with _db_lock:
                rows = db.execute(f"""
                    SELECT symbol, price, change_pct, change_abs, volume, market_cap
                    FROM live_quotes
                    WHERE price > 0
                    ORDER BY change_pct DESC
                    LIMIT {top_n * 2}
                """).fetchall()
            for r in rows[:top_n]:
                gainers.append(dict(zip(
                    ["symbol","price","change_pct","change_abs","volume","market_cap"], r)))
            # Losers: query again with ASC
            with _db_lock:
                rows_l = db.execute(f"""
                    SELECT symbol, price, change_pct, change_abs, volume, market_cap
                    FROM live_quotes
                    WHERE price > 0
                    ORDER BY change_pct ASC
                    LIMIT {top_n}
                """).fetchall()
            for r in rows_l:
                losers.append(dict(zip(
                    ["symbol","price","change_pct","change_abs","volume","market_cap"], r)))
        except Exception as e:
            logger.debug("get_top_movers_fast: %s", e)
        return {"gainers": gainers, "losers": losers}

    def get_sector_breadth_fast(self, sector_stocks: Dict[str, List[str]]) -> List[Dict]:
        """
        Sector-level advance/decline using DuckDB IN clause.
        Bloomberg BMAP sector heat equivalent.
        """
        results = []
        try:
            db = get_db()
            for sector, syms in sector_stocks.items():
                if not syms:
                    continue
                placeholders = ", ".join(f"'{s}'" for s in syms)
                with _db_lock:
                    row = db.execute(f"""
                        SELECT
                            COUNT_IF(change_pct > 0) AS advances,
                            COUNT_IF(change_pct < 0) AS declines,
                            AVG(change_pct)          AS avg_change,
                            SUM(volume * price) / 1e10 AS turnover_cr
                        FROM live_quotes
                        WHERE symbol IN ({placeholders}) AND price > 0
                    """).fetchone()
                if row:
                    results.append({
                        "sector":   sector,
                        "advances": int(row[0] or 0),
                        "declines": int(row[1] or 0),
                        "avg_change_pct": round(float(row[2] or 0), 2),
                        "turnover_cr":    round(float(row[3] or 0), 2),
                    })
        except Exception as e:
            logger.debug("get_sector_breadth_fast: %s", e)
        return results

    # ── OHLCV ──────────────────────────────────────────────────────────────────

    def get_ohlcv_sync(self, symbol: str,
                       start_date: str = None, end_date: str = None,
                       limit: int = 365) -> List[Dict]:
        """
        Synchronous OHLCV fetch — call via run_in_executor from async code.
        Returns list of candle dicts: {date, open, high, low, close, volume}.
        """
        db = get_db()
        try:
            if isinstance(db, _InMemoryStore):
                return []

            conditions = ["symbol = ?"]
            params = [symbol.upper()]
            if start_date:
                conditions.append("date >= ?")
                params.append(start_date)
            if end_date:
                conditions.append("date <= ?")
                params.append(end_date)

            where = " AND ".join(conditions)
            result = db.execute(
                f"""SELECT date, open, high, low, close, volume, adj_close
                    FROM ohlcv
                    WHERE {where}
                    ORDER BY date DESC
                    LIMIT ?""",
                params + [limit]
            ).fetchall()

            candles = [
                {"date": str(r[0]), "open": r[1], "high": r[2], "low": r[3],
                 "close": r[4], "volume": r[5], "adj_close": r[6]}
                for r in result
            ]
            candles.reverse()  # Return chronological order
            return candles

        except Exception as e:
            logger.error("get_ohlcv_sync(%s): %s", symbol, e)
            return []

    async def get_ohlcv(self, symbol: str,
                        start_date: str = None, end_date: str = None,
                        limit: int = 365) -> List[Dict]:
        """Async wrapper for get_ohlcv_sync."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, self.get_ohlcv_sync, symbol, start_date, end_date, limit
        )

    def upsert_ohlcv_sync(self, symbol: str, candles: List[Dict]) -> int:
        """
        Upsert daily candles. Returns count inserted/updated.
        Candles: list of {date, open, high, low, close, volume} dicts.
        """
        if not candles:
            return 0
        db = get_db()
        try:
            if isinstance(db, _InMemoryStore):
                return 0

            sym = symbol.upper()
            rows = [(sym, c["date"], c.get("open"), c.get("high"), c.get("low"),
                     c.get("close"), c.get("volume"), c.get("adj_close") or c.get("close"))
                    for c in candles if c.get("date") and c.get("close")]

            if not rows:
                return 0

            db.executemany(
                """INSERT OR REPLACE INTO ohlcv
                   (symbol, date, open, high, low, close, volume, adj_close)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                rows
            )
            logger.debug("upsert_ohlcv(%s): %d candles", sym, len(rows))
            return len(rows)
        except Exception as e:
            logger.error("upsert_ohlcv(%s): %s", symbol, e)
            return 0

    async def upsert_ohlcv(self, symbol: str, candles: List[Dict]) -> int:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.upsert_ohlcv_sync, symbol, candles)

    # ── Intraday candles ───────────────────────────────────────────────────────

    def upsert_intraday_sync(self, symbol: str, resolution: str, candles: List[Dict]) -> int:
        db = get_db()
        try:
            if isinstance(db, _InMemoryStore):
                return 0
            sym = symbol.upper()
            rows = [(sym, c["timestamp"], resolution,
                     c.get("open"), c.get("high"), c.get("low"),
                     c.get("close"), c.get("volume"))
                    for c in candles if c.get("timestamp") and c.get("close")]
            if not rows:
                return 0
            db.executemany(
                """INSERT OR REPLACE INTO intraday_candles
                   (symbol, ts, resolution, open, high, low, close, volume)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                rows
            )
            return len(rows)
        except Exception as e:
            logger.error("upsert_intraday(%s): %s", symbol, e)
            return 0

    async def upsert_intraday(self, symbol: str, resolution: str, candles: List[Dict]) -> int:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.upsert_intraday_sync, symbol, resolution, candles)

    def get_intraday_sync(self, symbol: str, resolution: str = "1m",
                          date: str = None, limit: int = 390) -> List[Dict]:
        db = get_db()
        try:
            if isinstance(db, _InMemoryStore):
                return []
            today = date or datetime.now().strftime("%Y-%m-%d")
            result = db.execute(
                """SELECT ts, open, high, low, close, volume
                   FROM intraday_candles
                   WHERE symbol = ? AND resolution = ? AND CAST(ts AS DATE) = ?
                   ORDER BY ts ASC LIMIT ?""",
                [symbol.upper(), resolution, today, limit]
            ).fetchall()
            return [{"timestamp": str(r[0]), "open": r[1], "high": r[2],
                     "low": r[3], "close": r[4], "volume": r[5]} for r in result]
        except Exception as e:
            logger.error("get_intraday(%s): %s", symbol, e)
            return []

    # ── Tick log ───────────────────────────────────────────────────────────────

    def log_tick_sync(self, symbol: str, price: float, volume: int,
                      side: str = "UNKNOWN", ts: datetime = None):
        db = get_db()
        try:
            if isinstance(db, _InMemoryStore):
                return
            ts_str = (ts or datetime.now()).isoformat()
            db.execute(
                "INSERT OR REPLACE INTO tick_log (symbol, ts, price, volume, side) VALUES (?, ?, ?, ?, ?)",
                [symbol.upper(), ts_str, price, volume, side]
            )
        except Exception as e:
            logger.debug("log_tick: %s", e)

    def log_tick_batch_sync(self, ticks: List[Dict]):
        """
        Batch-insert ticks from the Fyers WS drain buffer.  Called every 33ms.
        One executemany round-trip instead of N individual inserts — ~100x faster.
        ticks: list of {symbol, price, volume, side?, ts?} dicts.
        """
        if not ticks:
            return
        db = get_db()
        try:
            if isinstance(db, _InMemoryStore):
                return
            rows = []
            for t in ticks:
                sym   = t.get("symbol", "").upper()
                price = t.get("price")
                if not sym or not price:
                    continue
                ts_val = t.get("ts")
                ts_str = (
                    ts_val.isoformat()
                    if isinstance(ts_val, datetime)
                    else (ts_val or datetime.now().isoformat())
                )
                rows.append((
                    sym,
                    ts_str,
                    float(price),
                    int(t.get("volume", 0)),
                    t.get("side", "UNKNOWN"),
                ))
            if rows:
                db.executemany(
                    "INSERT OR REPLACE INTO tick_log (symbol, ts, price, volume, side)"
                    " VALUES (?, ?, ?, ?, ?)",
                    rows,
                )
        except Exception as e:
            logger.debug("log_tick_batch(%d): %s", len(ticks), e)

    def get_ticks_sync(self, symbol: str, date: str = None, limit: int = 500) -> List[Dict]:
        db = get_db()
        try:
            if isinstance(db, _InMemoryStore):
                return []
            today = date or datetime.now().strftime("%Y-%m-%d")
            result = db.execute(
                """SELECT ts, price, volume, side
                   FROM tick_log
                   WHERE symbol = ? AND CAST(ts AS DATE) = ?
                   ORDER BY ts DESC LIMIT ?""",
                [symbol.upper(), today, limit]
            ).fetchall()
            return [{"timestamp": str(r[0]), "price": r[1], "volume": r[2], "side": r[3]}
                    for r in reversed(result)]
        except Exception as e:
            logger.error("get_ticks(%s): %s", symbol, e)
            return []

    # ── Analytics ──────────────────────────────────────────────────────────────

    def compute_vwap_sync(self, symbol: str, date: str = None) -> Optional[float]:
        """VWAP for a given date from tick log."""
        db = get_db()
        try:
            if isinstance(db, _InMemoryStore):
                return None
            today = date or datetime.now().strftime("%Y-%m-%d")
            result = db.execute(
                """SELECT SUM(price * volume) / NULLIF(SUM(volume), 0)
                   FROM tick_log
                   WHERE symbol = ? AND CAST(ts AS DATE) = ?""",
                [symbol.upper(), today]
            ).fetchone()
            return round(float(result[0]), 2) if result and result[0] else None
        except Exception:
            return None

    def get_all_symbols_sync(self) -> List[str]:
        """All symbols in the OHLCV table."""
        db = get_db()
        try:
            if isinstance(db, _InMemoryStore):
                return []
            result = db.execute("SELECT DISTINCT symbol FROM ohlcv ORDER BY symbol").fetchall()
            return [r[0] for r in result]
        except Exception:
            return []

    def get_data_coverage_sync(self, symbol: str) -> Dict:
        """How much data we have for a symbol."""
        db = get_db()
        try:
            if isinstance(db, _InMemoryStore):
                return {}
            result = db.execute(
                """SELECT MIN(date), MAX(date), COUNT(*) FROM ohlcv WHERE symbol = ?""",
                [symbol.upper()]
            ).fetchone()
            if result and result[2]:
                return {
                    "symbol": symbol,
                    "earliest": str(result[0]),
                    "latest": str(result[1]),
                    "trading_days": result[2],
                    "years_coverage": round(result[2] / 250, 1),
                }
            return {"symbol": symbol, "trading_days": 0}
        except Exception:
            return {}


# ── Module-level singleton ─────────────────────────────────────────────────────
store = MarketDataStore()


# ── NSE Bhavcopy downloader (free daily EOD data, no auth needed) ──────────────

async def download_nse_bhavcopy(date: datetime = None) -> int:
    """
    Download NSE Bhavcopy (EOD CSV) and store in DuckDB.
    NSE publishes this daily at ~18:00 IST. Free, no authentication required.
    Returns count of records stored.
    """
    import aiohttp

    dt = date or (datetime.now() - timedelta(days=1 if datetime.now().hour < 18 else 0))
    # Skip weekends
    while dt.weekday() >= 5:
        dt -= timedelta(days=1)

    date_str = dt.strftime("%d%m%Y")
    url = f"https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{date_str}_F_0000.csv.zip"

    try:
        async with aiohttp.ClientSession(
            headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.nseindia.com/"}
        ) as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200:
                    logger.warning("Bhavcopy %s: HTTP %d", date_str, resp.status)
                    return 0
                data = await resp.read()

        # Parse ZIP → CSV
        import zipfile
        import io
        import csv

        # Parse ZIP → CSV, grouping candles by symbol for bulk upsert
        by_symbol: Dict[str, List[Dict]] = {}
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            csv_name = zf.namelist()[0]
            with zf.open(csv_name) as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig'))
                date_val = dt.strftime("%Y-%m-%d")
                for row in reader:
                    try:
                        # Bhavcopy format varies; try both old and new column names
                        sym  = (row.get("TckrSymb") or row.get("SYMBOL", "")).strip()
                        if not sym:
                            continue
                        candle = {
                            "date":   date_val,
                            "open":   float(row.get("OpnPric")     or row.get("OPEN",      0) or 0),
                            "high":   float(row.get("HghPric")     or row.get("HIGH",      0) or 0),
                            "low":    float(row.get("LwPric")      or row.get("LOW",       0) or 0),
                            "close":  float(row.get("ClsPric")     or row.get("CLOSE",     0) or 0),
                            "volume": int(float(row.get("TtlTradgVol") or row.get("TOTTRDQTY", 0) or 0)),
                        }
                        if candle["close"] > 0:
                            by_symbol.setdefault(sym, []).append(candle)
                    except (ValueError, TypeError):
                        continue

        # Bulk upsert per symbol — one DuckDB executemany per 100 symbols
        total = 0
        sym_list = list(by_symbol.items())
        for i in range(0, len(sym_list), 100):
            for sym_key, sym_candles in sym_list[i:i+100]:
                total += store.upsert_ohlcv_sync(sym_key, sym_candles)

        logger.info("Bhavcopy %s: %d symbols / %d candles stored", date_str, len(by_symbol), total)
        return total

    except Exception as e:
        logger.error("download_nse_bhavcopy(%s): %s", date_str, e)
        return 0


async def backfill_symbol_history(symbol: str, years: int = 5) -> int:
    """
    Backfill historical OHLCV for a symbol using Fyers or yfinance.
    Called on-demand when TradeReplay or Backtest needs history.
    Returns count of candles stored.
    """
    from data import fyers_data

    total = 0
    if fyers_data.is_authenticated():
        hist = await fyers_data.get_history(symbol, resolution="D", days=years * 365)
        if hist:
            candles = []
            if isinstance(hist, dict) and "candles" in hist:
                for c in hist["candles"]:
                    if len(c) >= 6:
                        ts = datetime.fromtimestamp(c[0])
                        candles.append({
                            "date":   ts.strftime("%Y-%m-%d"),
                            "open":   c[1], "high": c[2], "low": c[3],
                            "close":  c[4], "volume": c[5],
                        })
            elif isinstance(hist, list):
                candles = hist
            total = store.upsert_ohlcv_sync(symbol, candles)
            logger.info("backfill(%s): %d candles from Fyers", symbol, total)
            return total

    # Fallback: yfinance (only if not blocked)
    from data.nse_data import _yf_blocked, nse_symbol, _mark_yf_failed
    if _yf_blocked(symbol):
        logger.debug("backfill(%s): yfinance blocked — skipping", symbol)
        return 0
    yf_sym = nse_symbol(symbol)  # applies rename map (MCDOWELL-N → MCDOWELLN.NS etc.)
    loop = asyncio.get_running_loop()
    def _fetch():
        try:
            import yfinance as yf
            df = yf.Ticker(yf_sym).history(period=f"{years}y", auto_adjust=True)
            if df.empty: return []
            return [{"date": str(idx.date()), "open": float(row.Open), "high": float(row.High),
                     "low": float(row.Low), "close": float(row.Close), "volume": int(row.Volume)}
                    for idx, row in df.iterrows()]
        except Exception:
            return []

    candles = await loop.run_in_executor(None, _fetch)
    if candles:
        total = store.upsert_ohlcv_sync(symbol, candles)
        logger.info("backfill(%s): %d candles from yfinance", symbol, total)
    return total
