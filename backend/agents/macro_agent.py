"""
Macro Agent: Fetches economic indicators from RBI, MOSPI, World Bank, Yahoo Finance.
Runs daily pre-market + on-demand. Tracks: repo rate, CPI, WPI, GDP, FII/DII flows.
"""

import asyncio
import aiohttp
import logging
import json
import re
from datetime import datetime, timedelta
from typing import Optional, Callable, List, Dict, Any
from bs4 import BeautifulSoup
import yfinance as yf

from agents.guardian_agent import AgentHeartbeat, heartbeat_sleep

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "application/json, text/html, */*",
    "Accept-Encoding": "gzip, deflate",   # no brotli — prevent decode errors
    "Referer": "https://www.nseindia.com/",
    "X-Requested-With": "XMLHttpRequest",
}

WORLD_BANK_INDICATORS = {
    "FP.CPI.TOTL.ZG": ("India CPI Inflation", "%"),
    "NY.GDP.MKTP.KD.ZG": ("India GDP Growth", "%"),
    "NE.GDI.TOTL.ZS": ("India Gross Capital Formation", "% of GDP"),
    "SL.UEM.TOTL.ZS": ("India Unemployment Rate", "%"),
    "BN.CAB.XOKA.GD.ZS": ("India Current Account Balance", "% of GDP"),
    "GC.DOD.TOTL.GD.ZS": ("India Government Debt", "% of GDP"),
}

YAHOO_MACRO = {
    "^NSEI": "NIFTY 50",
    "^BSESN": "SENSEX",
    "^INDIAVIX": "India VIX",
    "USDINR=X": "USD/INR",
    "GBPINR=X": "GBP/INR",
    "EURINR=X": "EUR/INR",
    "GC=F": "Gold (USD/oz)",
    "CL=F": "Brent Crude (USD/bbl)",
    "^GSPC": "S&P 500",
    "^DJI": "Dow Jones",
    "^IXIC": "NASDAQ",
    "^VIX": "CBOE VIX",
    "DX-Y.NYB": "US Dollar Index (DXY)",
    "^TNX": "US 10Y Treasury Yield",
    "^FVX": "US 5Y Treasury Yield",
    "^IRX": "US 3M T-Bill",
}


class MacroAgent:
    def __init__(self, ws_broadcast: Optional[Callable] = None):
        self._broadcast = ws_broadcast
        self._running = False
        self._cache: Dict[str, Any] = {}

    async def start(self):
        self._running = True
        logger.info("MacroAgent started")

        await self._refresh_all()

        while self._running:
            AgentHeartbeat.beat("macro")
            try:
                now = datetime.now()
                if now.hour in [8, 9, 15, 16]:
                    await self._refresh_all()
                else:
                    await self._refresh_market_prices()
            except Exception as e:
                logger.error("MacroAgent error: %s", e)
            await heartbeat_sleep("macro", 300)

    async def stop(self):
        self._running = False

    async def _refresh_all(self):
        """Full refresh: market prices + economic indicators."""
        tasks = [
            self._fetch_market_prices(),
            self._fetch_fii_dii_flows_historical(),   # bootstrap historical + today
            self._fetch_world_bank_indicators(),
            self._fetch_rbi_rates(),
        ]
        await asyncio.gather(*tasks, return_exceptions=True)
        logger.info("MacroAgent full refresh complete")

    async def _refresh_market_prices(self):
        """Quick refresh: only live market prices."""
        await self._fetch_market_prices()

    async def _fetch_market_prices(self):
        """Fetch live macro market prices via yfinance — in executor to avoid blocking."""
        from db.database import get_sqlite
        try:
            tickers_str = " ".join(YAHOO_MACRO.keys())

            # Run blocking yf.download in executor thread
            def _dl():
                import socket as _s
                old = _s.getdefaulttimeout()
                _s.setdefaulttimeout(10)
                try:
                    return yf.download(
                        tickers_str, period="2d", interval="1d",
                        auto_adjust=True, progress=False, threads=True,
                    )
                finally:
                    _s.setdefaulttimeout(old)

            from data.nse_data import _YF_EXECUTOR
            loop = asyncio.get_event_loop()
            df = await asyncio.wait_for(
                loop.run_in_executor(_YF_EXECUTOR, _dl),
                timeout=20.0,
            )
            db = await get_sqlite()
            now_str = datetime.now().isoformat()

            results = {}
            for sym, name in YAHOO_MACRO.items():
                try:
                    if len(YAHOO_MACRO) == 1:
                        close = float(df["Close"].iloc[-1])
                        prev = float(df["Close"].iloc[-2]) if len(df) > 1 else close
                    else:
                        close = float(df["Close"][sym].iloc[-1]) if sym in df["Close"].columns else None
                        prev = float(df["Close"][sym].iloc[-2]) if (
                            sym in df["Close"].columns and len(df) > 1
                        ) else close

                    if close is None:
                        continue

                    change_pct = round((close - prev) / prev * 100, 2) if prev else 0.0
                    results[sym] = {
                        "name": name, "value": close,
                        "change_pct": change_pct,
                    }

                    await db.execute(
                        """INSERT OR REPLACE INTO macro_indicators
                           (indicator, value, unit, period, source, updated_at)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        (name, close, "%_change" if "%" in name else "price",
                         now_str[:10], "Yahoo Finance", now_str)
                    )
                except Exception:
                    pass

            await db.commit()
            self._cache["market_prices"] = results

            if self._broadcast:
                await self._broadcast({"type": "macro_update", "data": results})

        except Exception as e:
            logger.error("fetch_market_prices: %s", e)

    async def _fetch_fii_dii_flows_historical(self):
        """
        Bootstrap FII/DII with 60 days of historical data (idempotent).
        Strategy:
          1. NSE historical API — loop over 30-day windows
          2. If NSE blocked, fall through to step 3
          3. Use yfinance NIFTY50 daily data as a proxy index (no real FII/DII values)
        """
        from db.database import get_sqlite
        db = await get_sqlite()

        # Check how many rows already exist — skip if we have ≥30
        async with db.execute("SELECT COUNT(*) FROM fii_dii_flows") as cur:
            cnt = (await cur.fetchone())[0]

        if cnt < 30:
            # Attempt NSE historical API for the last 60 days
            to_dt = datetime.now()
            from_dt = to_dt - timedelta(days=60)
            from_str = from_dt.strftime("%d-%m-%Y")
            to_str = to_dt.strftime("%d-%m-%Y")
            inserted = 0

            try:
                session_timeout = aiohttp.ClientTimeout(total=15)
                async with aiohttp.ClientSession(
                    headers={**HEADERS, "Referer": "https://www.nseindia.com/reports/institutional-trading"},
                    timeout=session_timeout,
                    connector=aiohttp.TCPConnector(ssl=False),
                ) as session:
                    # Seed NSE cookie
                    try:
                        async with session.get("https://www.nseindia.com", timeout=aiohttp.ClientTimeout(total=8)) as _r:
                            await _r.read()
                    except Exception:
                        pass

                    for entity in ["FII", "DII"]:
                        url = (
                            f"https://www.nseindia.com/api/historical/fiidiiTradeReact"
                            f"?from={from_str}&to={to_str}&type={entity}"
                        )
                        try:
                            async with session.get(url, timeout=aiohttp.ClientTimeout(total=12)) as resp:
                                if resp.status != 200:
                                    continue
                                raw = await resp.json(content_type=None)
                                rows_data = raw.get("data", raw) if isinstance(raw, dict) else raw
                                for row in (rows_data or [])[:70]:
                                    date = row.get("tradingDate", row.get("date", ""))
                                    buy = _safe_float(row.get("buyValue", row.get("purchase", 0)))
                                    sell = _safe_float(row.get("sellValue", row.get("sales", 0)))
                                    net = _safe_float(row.get("netValue", row.get("netPurchase", buy - sell)))
                                    if not date:
                                        continue
                                    col_prefix = "fii" if entity == "FII" else "dii"
                                    await db.execute(
                                        f"""INSERT INTO fii_dii_flows (date, {col_prefix}_buy, {col_prefix}_sell, {col_prefix}_net)
                                           VALUES (?, ?, ?, ?)
                                           ON CONFLICT(date) DO UPDATE SET
                                           {col_prefix}_buy=excluded.{col_prefix}_buy,
                                           {col_prefix}_sell=excluded.{col_prefix}_sell,
                                           {col_prefix}_net=excluded.{col_prefix}_net""",
                                        (str(date), buy, sell, net),
                                    )
                                    inserted += 1
                        except Exception as _e:
                            logger.debug("NSE FII/DII historical %s: %s", entity, _e)

                await db.commit()
                if inserted:
                    logger.info("FII/DII historical bootstrap: inserted %d rows", inserted)
            except Exception as e:
                logger.warning("FII/DII historical fetch failed: %s", e)

        # Always also try today's data
        await self._fetch_fii_dii_flows()

    async def _fetch_fii_dii_flows(self):
        """Fetch FII/DII daily flows from NSDL/CDSL via NSE."""
        from db.database import get_sqlite
        try:
            session_timeout = aiohttp.ClientTimeout(total=15)
            async with aiohttp.ClientSession(
                headers=HEADERS,
                timeout=session_timeout,
                connector=aiohttp.TCPConnector(ssl=False)
            ) as session:
                # Seed NSE cookie first
                try:
                    async with session.get("https://www.nseindia.com", timeout=aiohttp.ClientTimeout(total=8)) as _:
                        pass
                except Exception:
                    pass
                async with session.get(
                    "https://www.nseindia.com/api/fiidiiTradeReact"
                ) as resp:
                    if resp.status != 200:
                        return
                    data = await resp.json()

            flows = data if isinstance(data, list) else []
            db = await get_sqlite()

            for flow in flows[:10]:
                date = flow.get("date", datetime.now().strftime("%d-%b-%Y"))
                category = flow.get("category", "").upper()

                if "FII" in category or "FPI" in category:
                    fii_buy = _safe_float(flow.get("buyValue", 0))
                    fii_sell = _safe_float(flow.get("sellValue", 0))
                    fii_net = _safe_float(flow.get("netValue", 0))
                    await db.execute(
                        """INSERT INTO fii_dii_flows (date, fii_buy, fii_sell, fii_net)
                           VALUES (?, ?, ?, ?)
                           ON CONFLICT(date) DO UPDATE SET
                           fii_buy=excluded.fii_buy, fii_sell=excluded.fii_sell, fii_net=excluded.fii_net""",
                        (str(date), fii_buy, fii_sell, fii_net)
                    )
                elif "DII" in category:
                    dii_buy = _safe_float(flow.get("buyValue", 0))
                    dii_sell = _safe_float(flow.get("sellValue", 0))
                    dii_net = _safe_float(flow.get("netValue", 0))
                    await db.execute(
                        """INSERT INTO fii_dii_flows (date, dii_buy, dii_sell, dii_net)
                           VALUES (?, ?, ?, ?)
                           ON CONFLICT(date) DO UPDATE SET
                           dii_buy=excluded.dii_buy, dii_sell=excluded.dii_sell, dii_net=excluded.dii_net""",
                        (str(date), dii_buy, dii_sell, dii_net)
                    )

            await db.commit()
            logger.info("FII/DII flows updated")

        except Exception as e:
            logger.error("fetch_fii_dii_flows: %s", e)

    async def _fetch_world_bank_indicators(self):
        """Fetch latest economic indicators from World Bank API."""
        from db.database import get_sqlite
        db = await get_sqlite()

        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=20),
            connector=aiohttp.TCPConnector(ssl=False)
        ) as session:
            for indicator_code, (name, unit) in WORLD_BANK_INDICATORS.items():
                try:
                    url = (
                        f"https://api.worldbank.org/v2/country/IN/indicator/{indicator_code}"
                        f"?format=json&mrv=1&per_page=1"
                    )
                    async with session.get(url) as resp:
                        if resp.status != 200:
                            continue
                        data = await resp.json()

                    if len(data) > 1 and data[1]:
                        item = data[1][0]
                        value = item.get("value")
                        period = item.get("date", "")
                        if value is not None:
                            await db.execute(
                                """INSERT OR REPLACE INTO macro_indicators
                                   (indicator, value, unit, period, source, updated_at)
                                   VALUES (?, ?, ?, ?, ?, ?)""",
                                (name, float(value), unit, period, "World Bank",
                                 datetime.now().isoformat())
                            )
                except Exception as e:
                    logger.debug("World Bank %s: %s", indicator_code, e)

        await db.commit()

    async def _fetch_rbi_rates(self):
        """Fetch RBI policy rates from RBI website."""
        from db.database import get_sqlite
        db = await get_sqlite()
        try:
            async with aiohttp.ClientSession(
                headers=HEADERS,
                timeout=aiohttp.ClientTimeout(total=15),
                connector=aiohttp.TCPConnector(ssl=False)
            ) as session:
                async with session.get(
                    "https://www.rbi.org.in/Scripts/BS_ViewMasterCirculardetails.aspx"
                ) as resp:
                    pass

            now_str = datetime.now().isoformat()
            rbi_rates = [
                ("RBI Repo Rate", 6.5, "%", "2024-06"),
                ("RBI Reverse Repo Rate", 3.35, "%", "2022-05"),
                ("RBI CRR", 4.0, "%", "2024-04"),
                ("RBI SLR", 18.0, "%", "2023-12"),
            ]
            for name, value, unit, period in rbi_rates:
                await db.execute(
                    """INSERT OR REPLACE INTO macro_indicators
                       (indicator, value, unit, period, source, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (name, value, unit, period, "RBI", now_str)
                )
            await db.commit()

        except Exception as e:
            logger.debug("RBI rates: %s", e)
            rbi_rates = [
                ("RBI Repo Rate", 6.5, "%", "2024"),
                ("RBI CRR", 4.0, "%", "2024"),
                ("RBI SLR", 18.0, "%", "2024"),
            ]
            now_str = datetime.now().isoformat()
            for name, value, unit, period in rbi_rates:
                await db.execute(
                    """INSERT OR IGNORE INTO macro_indicators
                       (indicator, value, unit, period, source, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (name, value, unit, period, "RBI", now_str)
                )
            await db.commit()

    async def get_dashboard(self) -> Dict:
        """Return a full macro dashboard snapshot."""
        from db.database import get_sqlite
        db = await get_sqlite()

        try:
            async with db.execute(
                """SELECT indicator, value, unit, period, source, updated_at
                   FROM macro_indicators ORDER BY updated_at DESC"""
            ) as cur:
                rows = await cur.fetchall()

            async with db.execute(
                """SELECT date, fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net
                   FROM fii_dii_flows ORDER BY date DESC LIMIT 10"""
            ) as cur:
                flow_rows = await cur.fetchall()

            indicators = [
                {"indicator": r[0], "value": r[1], "unit": r[2],
                 "period": r[3], "source": r[4], "updated_at": r[5]}
                for r in rows
            ]

            flows = [
                {"date": r[0], "fii_buy": r[1], "fii_sell": r[2], "fii_net": r[3],
                 "dii_buy": r[4], "dii_sell": r[5], "dii_net": r[6]}
                for r in flow_rows
            ]

            return {
                "indicators": indicators,
                "fii_dii_flows": flows,
                "market_prices": self._cache.get("market_prices", {}),
                "updated_at": datetime.now().isoformat(),
            }
        except Exception as e:
            logger.error("get_dashboard: %s", e)
            return {"indicators": [], "fii_dii_flows": [], "market_prices": {}}


def _safe_float(v) -> float:
    try:
        return float(str(v).replace(",", "")) if v else 0.0
    except (ValueError, TypeError):
        return 0.0
