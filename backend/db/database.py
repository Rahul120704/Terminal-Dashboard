"""
Database layer: DuckDB (OHLCV/historical), SQLite (news/filings/metadata), Redis (live cache).
Thread-safety: DuckDB connections per-thread. SQLite uses aiosqlite. Redis is async-safe.
"""

import os
import asyncio
import duckdb
import aiosqlite
import redis.asyncio as aioredis
from pathlib import Path
from typing import Optional
import logging

logger = logging.getLogger(__name__)

DB_DIR = Path(__file__).parent.parent / "data_store"
DB_DIR.mkdir(exist_ok=True)

DUCKDB_PATH = str(DB_DIR / "ohlcv.duckdb")
SQLITE_PATH = str(DB_DIR / "meta.db")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

_sqlite_conn: Optional[aiosqlite.Connection] = None
_redis_client: Optional[aioredis.Redis] = None
_redis_available = False


def get_duckdb() -> duckdb.DuckDBPyConnection:
    """Get a per-call DuckDB connection (thread-safe: each call gets own connection)."""
    conn = duckdb.connect(DUCKDB_PATH)
    return conn


async def get_sqlite() -> aiosqlite.Connection:
    global _sqlite_conn
    if _sqlite_conn is None:
        _sqlite_conn = await aiosqlite.connect(SQLITE_PATH)
        await _sqlite_conn.execute("PRAGMA journal_mode=WAL")
        await _sqlite_conn.execute("PRAGMA synchronous=NORMAL")
        await _sqlite_conn.execute("PRAGMA cache_size=10000")
        await _sqlite_conn.commit()
    return _sqlite_conn


async def get_redis() -> Optional[aioredis.Redis]:
    global _redis_client, _redis_available
    if _redis_client is None:
        try:
            _redis_client = aioredis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=2)
            await _redis_client.ping()
            _redis_available = True
            logger.info("Redis connected at %s", REDIS_URL)
        except Exception as e:
            logger.warning("Redis unavailable (%s). Running without cache.", e)
            _redis_available = False
            _redis_client = None
    return _redis_client if _redis_available else None


async def init_duckdb():
    conn = get_duckdb()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv (
            symbol VARCHAR NOT NULL,
            ts TIMESTAMP NOT NULL,
            open DOUBLE,
            high DOUBLE,
            low DOUBLE,
            close DOUBLE,
            volume BIGINT,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ohlcv_symbol ON ohlcv(symbol)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS technicals (
            symbol VARCHAR NOT NULL,
            ts TIMESTAMP NOT NULL,
            ema20 DOUBLE, ema50 DOUBLE, ema200 DOUBLE,
            sma20 DOUBLE, sma50 DOUBLE, sma200 DOUBLE,
            rsi14 DOUBLE, macd DOUBLE, macd_signal DOUBLE, macd_hist DOUBLE,
            bb_upper DOUBLE, bb_mid DOUBLE, bb_lower DOUBLE,
            vwap DOUBLE, atr14 DOUBLE, adx14 DOUBLE,
            stoch_k DOUBLE, stoch_d DOUBLE,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.close()
    logger.info("DuckDB initialized at %s", DUCKDB_PATH)


async def init_sqlite():
    db = await get_sqlite()

    await db.executescript("""
        CREATE TABLE IF NOT EXISTS stocks (
            symbol TEXT PRIMARY KEY,
            name TEXT,
            sector TEXT,
            industry TEXT,
            exchange TEXT,
            isin TEXT,
            market_cap REAL,
            face_value REAL,
            lot_size INTEGER,
            is_fno INTEGER DEFAULT 0,
            is_index INTEGER DEFAULT 0,
            updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS news (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT,
            headline TEXT NOT NULL,
            summary TEXT,
            source TEXT,
            url TEXT,
            published_at TEXT,
            sentiment REAL DEFAULT 0,
            category TEXT,
            is_read INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_news_ticker ON news(ticker);
        CREATE INDEX IF NOT EXISTS idx_news_published ON news(published_at DESC);
        CREATE INDEX IF NOT EXISTS idx_news_created ON news(created_at DESC);

        CREATE TABLE IF NOT EXISTS filings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT,
            exchange TEXT,
            filing_type TEXT,
            subject TEXT,
            description TEXT,
            url TEXT,
            filed_at TEXT,
            impact TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_filings_symbol ON filings(symbol);
        CREATE INDEX IF NOT EXISTS idx_filings_filed ON filings(filed_at DESC);

        CREATE TABLE IF NOT EXISTS earnings_calendar (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            company_name TEXT,
            result_date TEXT,
            result_type TEXT,
            quarter TEXT,
            revenue_est REAL,
            eps_est REAL,
            revenue_actual REAL,
            eps_actual REAL,
            revenue_surprise_pct REAL,
            eps_surprise_pct REAL,
            yoy_revenue_growth REAL,
            yoy_pat_growth REAL,
            status TEXT DEFAULT 'upcoming',
            concall_date TEXT,
            concall_time TEXT,
            concall_link TEXT,
            updated_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_earnings_symbol ON earnings_calendar(symbol);
        CREATE INDEX IF NOT EXISTS idx_earnings_date ON earnings_calendar(result_date);

        CREATE TABLE IF NOT EXISTS insider_trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            person_name TEXT,
            person_type TEXT,
            transaction_type TEXT,
            shares BIGINT,
            price REAL,
            value REAL,
            holding_pct_before REAL,
            holding_pct_after REAL,
            date TEXT,
            exchange TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_insider_symbol ON insider_trades(symbol);

        CREATE TABLE IF NOT EXISTS fii_dii_flows (
            date TEXT NOT NULL PRIMARY KEY,
            fii_buy REAL, fii_sell REAL, fii_net REAL,
            dii_buy REAL, dii_sell REAL, dii_net REAL
        );

        CREATE TABLE IF NOT EXISTS macro_indicators (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            indicator TEXT NOT NULL,
            value REAL,
            unit TEXT,
            period TEXT,
            source TEXT,
            updated_at TEXT,
            UNIQUE(indicator, period)
        );

        CREATE TABLE IF NOT EXISTS fundamentals (
            symbol TEXT PRIMARY KEY,
            pe_ratio REAL, pb_ratio REAL, ps_ratio REAL,
            ev_ebitda REAL, div_yield REAL, div_payout REAL,
            revenue REAL, revenue_growth REAL,
            ebitda REAL, ebitda_margin REAL,
            pat REAL, pat_margin REAL, pat_growth REAL,
            eps REAL, book_value REAL,
            roe REAL, roce REAL, roa REAL,
            current_ratio REAL, quick_ratio REAL,
            debt_equity REAL, interest_coverage REAL,
            asset_turnover REAL, inventory_turnover REAL,
            promoter_holding REAL, fii_holding REAL, dii_holding REAL, public_holding REAL,
            promoter_pledge_pct REAL,
            total_assets REAL, total_liabilities REAL, net_worth REAL,
            operating_cf REAL, investing_cf REAL, financing_cf REAL, free_cf REAL,
            week52_high REAL, week52_low REAL,
            market_cap REAL, enterprise_value REAL,
            updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS volume_shockers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            date TEXT NOT NULL,
            volume BIGINT,
            avg_volume_20d BIGINT,
            volume_ratio REAL,
            price REAL,
            change_pct REAL,
            reason TEXT,
            UNIQUE(symbol, date)
        );

        CREATE TABLE IF NOT EXISTS system_health (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service TEXT NOT NULL,
            status TEXT,
            last_heartbeat TEXT,
            error_count INTEGER DEFAULT 0,
            last_error TEXT,
            restart_count INTEGER DEFAULT 0
        );
    """)
    await db.commit()

    # ── Migrations ────────────────────────────────────────────────────────────
    # Deduplicate earnings_calendar and add UNIQUE index (idempotent)
    try:
        await db.execute("""
            DELETE FROM earnings_calendar
            WHERE id NOT IN (
                SELECT MAX(id) FROM earnings_calendar
                WHERE result_date IS NOT NULL
                GROUP BY symbol, result_date
            ) AND result_date IS NOT NULL
        """)
        await db.commit()
        await db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_earnings_uniq ON earnings_calendar(symbol, result_date)"
        )
        await db.commit()
    except Exception as _e:
        logger.debug("earnings migration: %s", _e)

    # Add UNIQUE index on news (headline, source) to prevent duplicates across restarts
    try:
        await db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_news_uniq ON news(headline, source)"
        )
        await db.commit()
    except Exception as _e:
        logger.debug("news unique migration: %s", _e)

    logger.info("SQLite initialized at %s", SQLITE_PATH)


async def init_all():
    await init_duckdb()
    await init_sqlite()
    await get_redis()
    logger.info("All databases initialized")


async def close_all():
    global _sqlite_conn, _redis_client
    if _sqlite_conn:
        await _sqlite_conn.close()
        _sqlite_conn = None
    if _redis_client:
        await _redis_client.close()
        _redis_client = None
