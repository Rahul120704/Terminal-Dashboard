"""
Insider trading / SAST disclosure scraper.
Sources: NSE SAST (Reg 7/13/29), BSE insider trading disclosures.
"""

import aiohttp
import asyncio
import logging
from typing import List, Dict, Optional
from datetime import datetime, timedelta
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://www.nseindia.com/",
}
BSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://www.bseindia.com/",
}


async def fetch_nse_insider_trades(symbol: Optional[str] = None, days: int = 30) -> List[Dict]:
    """
    Fetch insider trading disclosures from NSE.
    NSE provides SAST data via their public API.
    """
    results = []
    try:
        from_date = (datetime.now() - timedelta(days=days)).strftime("%d-%m-%Y")
        to_date = datetime.now().strftime("%d-%m-%Y")

        if symbol:
            url = f"https://www.nseindia.com/api/corporates-pit?symbol={symbol}&from={from_date}&to={to_date}&corpType=insider"
        else:
            url = f"https://www.nseindia.com/api/corporates-pit?from={from_date}&to={to_date}&corpType=insider"

        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(
            headers=NSE_HEADERS,
            timeout=timeout,
            connector=aiohttp.TCPConnector(ssl=False)
        ) as session:
            async with session.get("https://www.nseindia.com") as r:
                await r.read()

            async with session.get(url) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    for item in (data.get("data", []) or [])[:100]:
                        results.append({
                            "symbol": item.get("symbol", ""),
                            "person_name": item.get("acqName", ""),
                            "person_type": item.get("personCategory", "Insider"),
                            "transaction_type": item.get("tdpTransactionType", ""),
                            "shares": _safe_int(item.get("secAcq", 0)),
                            "price": _safe_float(item.get("secVal", 0)),
                            "value": _safe_float(item.get("totAcqShare", 0)),
                            "holding_pct_before": _safe_float(item.get("befAcqSharesNo", 0)),
                            "holding_pct_after": _safe_float(item.get("afterAcqSharesNo", 0)),
                            "date": item.get("date", ""),
                            "exchange": "NSE",
                        })
    except Exception as e:
        logger.error("nse_insider_trades: %s", e)

    return results


async def fetch_nse_block_deals(days: int = 7) -> List[Dict]:
    """Fetch block/bulk deals from NSE."""
    results = []
    try:
        from_date = (datetime.now() - timedelta(days=days)).strftime("%d-%m-%Y")
        to_date = datetime.now().strftime("%d-%m-%Y")

        url = f"https://www.nseindia.com/api/block-deal?from={from_date}&to={to_date}"

        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(
            headers=NSE_HEADERS,
            timeout=timeout,
            connector=aiohttp.TCPConnector(ssl=False)
        ) as session:
            async with session.get("https://www.nseindia.com") as r:
                await r.read()
            async with session.get(url) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    for item in (data.get("data", []) or [])[:50]:
                        results.append({
                            "symbol": item.get("symbol", ""),
                            "client": item.get("clientName", ""),
                            "transaction_type": item.get("buySell", ""),
                            "shares": _safe_int(item.get("quantity", 0)),
                            "price": _safe_float(item.get("tradePrice", 0)),
                            "value": _safe_float(item.get("quantity", 0)) * _safe_float(item.get("tradePrice", 0)),
                            "date": item.get("blockDealDate", ""),
                            "deal_type": "BLOCK",
                            "exchange": "NSE",
                        })
    except Exception as e:
        logger.error("nse_block_deals: %s", e)

    return results


async def fetch_nse_bulk_deals(days: int = 7) -> List[Dict]:
    """Fetch bulk deals from NSE."""
    results = []
    try:
        from_date = (datetime.now() - timedelta(days=days)).strftime("%d-%m-%Y")
        to_date = datetime.now().strftime("%d-%m-%Y")
        url = f"https://www.nseindia.com/api/bulk-deal?from={from_date}&to={to_date}"

        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(
            headers=NSE_HEADERS,
            timeout=timeout,
            connector=aiohttp.TCPConnector(ssl=False)
        ) as session:
            async with session.get("https://www.nseindia.com") as r:
                await r.read()
            async with session.get(url) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    for item in (data.get("data", []) or [])[:50]:
                        results.append({
                            "symbol": item.get("symbol", ""),
                            "client": item.get("clientName", ""),
                            "transaction_type": item.get("buySell", ""),
                            "shares": _safe_int(item.get("quantity", 0)),
                            "price": _safe_float(item.get("tradePrice", 0)),
                            "value": _safe_float(item.get("quantity", 0)) * _safe_float(item.get("tradePrice", 0)),
                            "date": item.get("blockDealDate", item.get("date", "")),
                            "deal_type": "BULK",
                            "exchange": "NSE",
                        })
    except Exception as e:
        logger.error("nse_bulk_deals: %s", e)

    return results


def _safe_float(v) -> float:
    try:
        return float(str(v).replace(",", "")) if v else 0.0
    except (ValueError, TypeError):
        return 0.0


def _safe_int(v) -> int:
    try:
        return int(str(v).replace(",", "")) if v else 0
    except (ValueError, TypeError):
        return 0
