"""
Filings Agent: Polls NSE/BSE announcements every 2 minutes.
Immediately stores and broadcasts any new filing on arrival.
"""

import asyncio
import aiohttp
import logging
from datetime import datetime, timedelta
from typing import Optional, Callable, List, Dict

from agents.guardian_agent import AgentHeartbeat, heartbeat_sleep

logger = logging.getLogger(__name__)

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://www.nseindia.com/",
    "Accept": "application/json",
}
BSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://www.bseindia.com/",
}

FILING_IMPACT = {
    "board meeting": "MEDIUM",
    "dividend": "MEDIUM",
    "bonus": "HIGH",
    "split": "HIGH",
    "rights issue": "HIGH",
    "merger": "HIGH",
    "acquisition": "HIGH",
    "buyback": "HIGH",
    "results": "HIGH",
    "financial results": "HIGH",
    "quarterly results": "HIGH",
    "annual results": "HIGH",
    "agm": "LOW",
    "egm": "MEDIUM",
    "postal ballot": "LOW",
    "loss": "HIGH",
    "profit": "MEDIUM",
    "trading window": "LOW",
    "press release": "LOW",
    "analyst": "LOW",
    "credit rating": "MEDIUM",
    "delisting": "HIGH",
    "pledge": "HIGH",
    "change in management": "HIGH",
    "resignation": "HIGH",
    "appointment": "MEDIUM",
    "sebi": "HIGH",
    "insider trading": "HIGH",
    "order": "HIGH",
    "penalty": "HIGH",
    "default": "HIGH",
}


def classify_impact(subject: str) -> str:
    subject_lower = subject.lower()
    for keyword, impact in sorted(FILING_IMPACT.items(), key=lambda x: len(x[0]), reverse=True):
        if keyword in subject_lower:
            return impact
    return "LOW"


class FilingsAgent:
    def __init__(self, ws_broadcast: Optional[Callable] = None):
        self._broadcast = ws_broadcast
        self._running = False
        self._seen_nse: set = set()
        self._seen_bse: set = set()
        self._session: Optional[aiohttp.ClientSession] = None

    async def start(self):
        self._running = True
        logger.info("FilingsAgent started")
        await self._load_seen_filings()

        while self._running:
            AgentHeartbeat.beat("filings")
            try:
                await asyncio.gather(
                    self._poll_nse_announcements(),
                    self._poll_bse_announcements(),
                    return_exceptions=True,
                )
            except Exception as e:
                logger.error("FilingsAgent error: %s", e)
            await heartbeat_sleep("filings", 120)

    async def stop(self):
        self._running = False
        if self._session and not self._session.closed:
            await self._session.close()

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=20)
            self._session = aiohttp.ClientSession(
                timeout=timeout,
                connector=aiohttp.TCPConnector(ssl=False, limit=10),
            )
        return self._session

    async def _load_seen_filings(self):
        from db.database import get_sqlite
        try:
            db = await get_sqlite()
            async with db.execute(
                "SELECT url FROM filings ORDER BY filed_at DESC LIMIT 1000"
            ) as cur:
                rows = await cur.fetchall()
            for r in rows:
                if r[0]:
                    self._seen_nse.add(r[0])
                    self._seen_bse.add(r[0])
            logger.info("Loaded %d seen filing URLs", len(self._seen_nse))
        except Exception as e:
            logger.error("load_seen_filings: %s", e)

    async def _poll_nse_announcements(self):
        """Poll NSE corporate announcements."""
        try:
            session = await self._get_session()
            today = datetime.now().strftime("%d-%m-%Y")
            yesterday = (datetime.now() - timedelta(days=1)).strftime("%d-%m-%Y")
            url = (
                f"https://www.nseindia.com/api/corporate-announcements"
                f"?index=equities&from_date={yesterday}&to_date={today}&type=C"
            )

            async with session.get("https://www.nseindia.com",
                                   headers=NSE_HEADERS) as r:
                await r.read()

            async with session.get(url, headers=NSE_HEADERS) as resp:
                if resp.status != 200:
                    return
                data = await resp.json()

            from db.database import get_sqlite
            db = await get_sqlite()
            new_count = 0

            for item in (data or [])[:100]:
                an_id = str(item.get("an_un_id", item.get("id", "")))
                if an_id in self._seen_nse:
                    continue
                self._seen_nse.add(an_id)

                symbol = item.get("symbol", "")
                subject = item.get("subject", item.get("desc", ""))
                filed_at = item.get("bm_timestamp", item.get("sort_date", datetime.now().isoformat()))
                doc_url = item.get("attchmntFile", "")
                if doc_url and not doc_url.startswith("http"):
                    doc_url = f"https://www.nseindia.com{doc_url}"

                impact = classify_impact(subject)

                await db.execute(
                    """INSERT OR IGNORE INTO filings
                       (symbol, exchange, filing_type, subject, description, url, filed_at, impact)
                       VALUES (?, 'NSE', ?, ?, ?, ?, ?, ?)""",
                    (symbol, "ANNOUNCEMENT", subject, subject, doc_url, str(filed_at), impact)
                )
                new_count += 1

                if self._broadcast:
                    await self._broadcast({
                        "type": "filing",
                        "data": {
                            "symbol": symbol,
                            "exchange": "NSE",
                            "subject": subject,
                            "filed_at": str(filed_at),
                            "impact": impact,
                            "url": doc_url,
                        }
                    })

            if new_count:
                await db.commit()
                logger.info("FilingsAgent NSE: %d new filings", new_count)

        except Exception as e:
            logger.error("poll_nse_announcements: %s", e)

    async def _poll_bse_announcements(self):
        """Poll BSE corporate announcements API."""
        try:
            session = await self._get_session()
            today = datetime.now().strftime("%Y%m%d")
            yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y%m%d")

            url = (
                f"https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w?"
                f"strCat=-1&strPrevDate={yesterday}&strScrip=&strSearch=P"
                f"&strToDate={today}&strType=C&subcategory=-1"
            )

            async with session.get(url, headers=BSE_HEADERS) as resp:
                if resp.status != 200:
                    return
                data = await resp.json()

            from db.database import get_sqlite
            db = await get_sqlite()
            new_count = 0

            items = data if isinstance(data, list) else data.get("Table", [])
            for item in items[:100]:
                news_id = str(item.get("NEWSID", item.get("Newsid", "")))
                if news_id in self._seen_bse:
                    continue
                self._seen_bse.add(news_id)

                symbol = item.get("scrip_cd", item.get("SCRIP_CD", ""))
                subject = item.get("NEWSSUB", item.get("headline", ""))
                filed_at = item.get("News_submission_dt", datetime.now().isoformat())
                doc_url = item.get("ATTACHMENTNAME", "")
                if doc_url:
                    doc_url = f"https://www.bseindia.com/xml-data/corpfiling/AttachLive/{doc_url}"

                impact = classify_impact(subject or "")

                await db.execute(
                    """INSERT OR IGNORE INTO filings
                       (symbol, exchange, filing_type, subject, description, url, filed_at, impact)
                       VALUES (?, 'BSE', ?, ?, ?, ?, ?, ?)""",
                    (str(symbol), "ANNOUNCEMENT", subject, subject, doc_url, str(filed_at), impact)
                )
                new_count += 1

                if self._broadcast and subject:
                    await self._broadcast({
                        "type": "filing",
                        "data": {
                            "symbol": str(symbol),
                            "exchange": "BSE",
                            "subject": subject,
                            "filed_at": str(filed_at),
                            "impact": impact,
                            "url": doc_url,
                        }
                    })

            if new_count:
                await db.commit()
                logger.info("FilingsAgent BSE: %d new filings", new_count)

        except Exception as e:
            logger.error("poll_bse_announcements: %s", e)

    async def get_recent_filings(self, symbol: Optional[str] = None,
                                  limit: int = 50) -> List[Dict]:
        from db.database import get_sqlite
        try:
            db = await get_sqlite()
            # Use created_at as fallback when filed_at is NULL or literal 'None'
            order_expr = """CASE
                WHEN filed_at IS NULL OR filed_at = 'None' OR filed_at = 'none'
                THEN created_at ELSE filed_at
            END DESC"""
            if symbol:
                async with db.execute(
                    f"""SELECT id, symbol, exchange, filing_type, subject, url,
                               filed_at, impact, created_at
                        FROM filings WHERE symbol = ?
                        ORDER BY {order_expr} LIMIT ?""",
                    (symbol, limit)
                ) as cur:
                    rows = await cur.fetchall()
            else:
                async with db.execute(
                    f"""SELECT id, symbol, exchange, filing_type, subject, url,
                               filed_at, impact, created_at
                        FROM filings
                        ORDER BY {order_expr} LIMIT ?""",
                    (limit,)
                ) as cur:
                    rows = await cur.fetchall()

            return [
                {"id": r[0], "symbol": r[1], "exchange": r[2], "filing_type": r[3],
                 "subject": r[4], "url": r[5],
                 "filed_at": r[6] if (r[6] and r[6] != 'None') else r[8],
                 "impact": r[7]}
                for r in rows
            ]
        except Exception as e:
            logger.error("get_recent_filings: %s", e)
            return []
