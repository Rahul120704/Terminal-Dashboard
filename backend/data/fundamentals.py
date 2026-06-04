"""
Fundamentals scraper — screener.in (primary) + Trendlyne (secondary).
No yfinance: all data from Indian market sources only.

Priority chain per field:
  1. screener.in  — most comprehensive for NSE/BSE
  2. Trendlyne    — financial metrics + DVM score
  3. NSE/BSE API  — structured corporate data (already in nse_data.py)
"""

import aiohttp
import asyncio
import logging
import re
from typing import Optional, Dict, Any, List
from datetime import datetime
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# ── HTTP headers — Chrome 124 to avoid bot detection ─────────────────────────
SCREENER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Cache-Control": "max-age=0",
    "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Referer": "https://www.screener.in/",
}

TRENDLYNE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://trendlyne.com/",
}

SCREENER_BASE = "https://www.screener.in"
TRENDLYNE_BASE = "https://trendlyne.com"


# ── Helper ────────────────────────────────────────────────────────────────────
def _safe_num(text: str) -> Optional[float]:
    if not text:
        return None
    t = text.strip().replace(",", "").replace("%", "").replace("₹", "").replace("Cr", "").replace("L", "").strip()
    # Handle negative values in brackets: (1,234) → -1234
    if t.startswith("(") and t.endswith(")"):
        t = "-" + t[1:-1]
    try:
        return float(t)
    except (ValueError, TypeError):
        return None


def _make_connector():
    return aiohttp.TCPConnector(ssl=False, limit=10)


# ═══════════════════════════════════════════════════════════════════════════════
#  SCREENER.IN  (primary source)
# ═══════════════════════════════════════════════════════════════════════════════

async def fetch_screener_data(symbol: str) -> Dict:
    """
    Scrape screener.in for comprehensive Indian stock fundamentals.
    Tries consolidated view first, falls back to standalone.
    Returns all sections: ratios, shareholding, quarterly, balance sheet,
    cash flow, peers, description, management, annual P&L.
    """
    result: Dict[str, Any] = {"symbol": symbol}
    try:
        timeout = aiohttp.ClientTimeout(total=25)
        connector = _make_connector()
        async with aiohttp.ClientSession(
            headers=SCREENER_HEADERS,
            timeout=timeout,
            connector=connector,
            cookie_jar=aiohttp.CookieJar(),
        ) as session:
            # Prime cookies with homepage visit (reduces bot detection)
            try:
                async with session.get(SCREENER_BASE, timeout=aiohttp.ClientTimeout(total=5)) as _:
                    pass
            except Exception:
                pass

            # Try consolidated, then standalone
            html = None
            for url in (
                f"{SCREENER_BASE}/company/{symbol}/consolidated/",
                f"{SCREENER_BASE}/company/{symbol}/",
            ):
                try:
                    async with session.get(url) as resp:
                        if resp.status == 200:
                            html = await resp.text()
                            break
                        elif resp.status == 403:
                            logger.warning("screener.in 403 for %s — bot block", symbol)
                            return result
                except Exception as e:
                    logger.debug("screener.in fetch error %s: %s", symbol, e)

            if not html:
                return result

        soup = BeautifulSoup(html, "lxml")
        result.update(_parse_screener_overview(soup, symbol))
        result.update(_parse_screener_ratios(soup))
        result.update(_parse_screener_shareholding(soup))
        result.update(_parse_screener_quarterly(soup))
        result.update(_parse_screener_annual_pl(soup))
        result.update(_parse_screener_balance_sheet(soup))
        result.update(_parse_screener_cashflow(soup))
        result.update(_parse_screener_peers(soup))
        result.update(_parse_screener_management(soup))
        result["updated_at"] = datetime.now().isoformat()
        logger.debug("screener.in %s: fetched %d keys", symbol, len(result))
    except Exception as e:
        logger.error("screener.in %s: %s", symbol, e)
    return result


def _parse_screener_overview(soup: BeautifulSoup, symbol: str) -> Dict:
    data: Dict[str, Any] = {}
    try:
        # Company name
        h1 = soup.find("h1", class_="hide-on-mobile")
        if h1:
            data["name"] = h1.get_text(strip=True)
        # About / description
        about = soup.find("div", class_="company-description") or soup.find("p", class_="about")
        if not about:
            about = soup.find("div", id="company-info")
        if about:
            data["description"] = about.get_text(" ", strip=True)[:1500]
        # Sector / industry
        sub = soup.find("div", class_="company-subtitle") or soup.find("div", {"data-field": "sector"})
        if sub:
            text = sub.get_text(" ", strip=True)
            if " | " in text:
                parts = text.split(" | ")
                data["sector"] = parts[0].strip()
                data["industry"] = parts[1].strip() if len(parts) > 1 else ""
        # BSE code / NSE symbol / ISIN — from meta or top ribbon
        for anchor in soup.find_all("a", href=True):
            href = anchor.get("href", "")
            if "bse" in href.lower() and "scripcode" in href.lower():
                m = re.search(r"scripcode=(\d+)", href)
                if m:
                    data["bse_code"] = m.group(1)
        # ISIN
        for li in soup.find_all("li"):
            text = li.get_text(strip=True)
            if text.startswith("INE") and len(text) == 12:
                data["isin"] = text
        # Website
        website_link = soup.find("a", {"target": "_blank", "rel": lambda r: r and "nofollow" in r})
        if website_link:
            href = website_link.get("href", "")
            if href.startswith("http") and "screener" not in href:
                data["website"] = href
    except Exception as e:
        logger.debug("parse_overview: %s", e)
    return data


def _parse_screener_ratios(soup: BeautifulSoup) -> Dict:
    data: Dict[str, Any] = {}
    try:
        top_section = soup.find("div", id="top-ratios")
        if not top_section:
            return data
        for li in top_section.find_all("li"):
            spans = li.find_all("span")
            if len(spans) < 2:
                continue
            key = spans[0].get_text(strip=True).lower()
            val = spans[-1].get_text(strip=True)
            num = _safe_num(val)
            if "market cap" in key:
                data["market_cap"] = num
            elif "stock p/e" in key or key == "p/e":
                data["pe_ratio"] = num
            elif "book value" in key:
                data["book_value"] = num
            elif "dividend yield" in key:
                data["div_yield"] = num
            elif "roce" in key:
                data["roce"] = num
            elif "roe" in key:
                data["roe"] = num
            elif "face value" in key:
                data["face_value"] = num
            elif "sales" in key and "growth" in key:
                data["revenue_growth"] = num
            elif "profit" in key and "growth" in key:
                data["pat_growth"] = num
            elif "debt" in key and "equity" in key:
                data["debt_equity"] = num
            elif "pat margin" in key or "net margin" in key:
                data["pat_margin"] = num
            elif "eps" in key:
                data["eps"] = num

        # Extended ratios from the detail section
        for li in soup.find_all("li", class_="flex"):
            spans = li.find_all("span")
            if len(spans) < 2:
                continue
            key = spans[0].get_text(strip=True).lower()
            val = spans[-1].get_text(strip=True)
            num = _safe_num(val)
            if "net profit margin" in key:
                data["net_margin"] = num
            elif "price to book" in key or "p/b" in key:
                data["pb_ratio"] = num
            elif "ev/ebitda" in key:
                data["ev_ebitda"] = num
            elif "current ratio" in key:
                data["current_ratio"] = num
            elif "interest coverage" in key:
                data["interest_coverage"] = num
            elif "price to sales" in key or "p/s" in key:
                data["ps_ratio"] = num
    except Exception as e:
        logger.debug("parse_ratios: %s", e)
    return data


def _parse_screener_shareholding(soup: BeautifulSoup) -> Dict:
    data: Dict[str, Any] = {}
    try:
        sh_section = soup.find("section", id="shareholding")
        if not sh_section:
            return data
        tables = sh_section.find_all("table")
        if not tables:
            return data
        table = tables[0]
        headers = [th.get_text(strip=True) for th in table.find_all("th")]
        rows = table.find_all("tr")[1:]
        history_rows: List[Dict] = []

        for row in rows:
            cells = [td.get_text(strip=True) for td in row.find_all("td")]
            if not cells:
                continue
            category = cells[0].lower()
            # Latest value is column 1
            val = _safe_num(cells[1]) if len(cells) > 1 else None
            if "promoter" in category and "pledge" not in category:
                data["promoter_holding"] = val
            elif "pledge" in category:
                data["promoter_pledge_pct"] = val
            elif "fii" in category or "foreign" in category:
                data["fii_holding"] = val
            elif "dii" in category or "domestic inst" in category:
                data["dii_holding"] = val
            elif "public" in category or "retail" in category:
                data["public_holding"] = val

        # Build shareholding history from quarterly columns
        if len(headers) > 1 and len(rows) > 0:
            for qi, qhdr in enumerate(headers[1:], start=1):
                entry: Dict[str, Any] = {"quarter": qhdr}
                for row in rows:
                    cells = [td.get_text(strip=True) for td in row.find_all("td")]
                    if not cells or qi >= len(cells):
                        continue
                    cat = cells[0].lower()
                    v = _safe_num(cells[qi])
                    if "promoter" in cat and "pledge" not in cat:
                        entry["promoter"] = v
                    elif "fii" in cat or "foreign" in cat:
                        entry["fii"] = v
                    elif "dii" in cat or "domestic inst" in cat:
                        entry["dii"] = v
                    elif "public" in cat or "retail" in cat:
                        entry["public"] = v
                if any(k in entry for k in ("promoter", "fii", "dii")):
                    history_rows.append(entry)
            data["shareholding_history"] = history_rows[:12]
    except Exception as e:
        logger.debug("parse_shareholding: %s", e)
    return data


def _parse_screener_quarterly(soup: BeautifulSoup) -> Dict:
    data: Dict[str, Any] = {"quarterly_results": []}
    try:
        section = soup.find("section", id="quarters")
        if not section:
            return data
        table = section.find("table")
        if not table:
            return data

        headers = [th.get_text(strip=True) for th in table.find_all("th")][1:]
        rows: Dict[str, List] = {}
        for tr in table.find_all("tr")[1:]:
            cells = [td.get_text(strip=True) for td in tr.find_all("td")]
            if cells:
                rows[cells[0].lower().strip()] = cells[1:]

        quarters = []
        for i, period in enumerate(headers[:10]):
            q: Dict[str, Any] = {"period": period}
            for key, vals in rows.items():
                if i >= len(vals):
                    continue
                v = _safe_num(vals[i])
                if "sales" in key and "growth" not in key:
                    q["revenue"] = v
                elif "expenses" in key and "other" not in key:
                    q["expenses"] = v
                elif "operating profit" in key:
                    q["operating_profit"] = v
                elif "opm" in key:
                    q["opm_pct"] = v
                elif "other income" in key:
                    q["other_income"] = v
                elif "interest" in key and "coverage" not in key:
                    q["interest"] = v
                elif "depreciation" in key:
                    q["depreciation"] = v
                elif "profit before tax" in key or "pbt" in key:
                    q["pbt"] = v
                elif "net profit" in key or ("tax" not in key and "pat" in key):
                    q["pat"] = v
                elif "eps" in key:
                    q["eps"] = v
            quarters.append(q)
        data["quarterly_results"] = quarters
    except Exception as e:
        logger.debug("parse_quarterly: %s", e)
    return data


def _parse_screener_annual_pl(soup: BeautifulSoup) -> Dict:
    """Parse annual P&L section from screener.in."""
    data: Dict[str, Any] = {"annual_profit_loss": []}
    try:
        section = soup.find("section", id="profit-loss")
        if not section:
            return data
        table = section.find("table")
        if not table:
            return data

        headers = [th.get_text(strip=True) for th in table.find_all("th")][1:]
        rows: Dict[str, List] = {}
        for tr in table.find_all("tr")[1:]:
            cells = [td.get_text(strip=True) for td in tr.find_all("td")]
            if cells:
                rows[cells[0].lower().strip()] = cells[1:]

        annual = []
        for i, period in enumerate(headers[:7]):
            pl: Dict[str, Any] = {"period": period}
            for key, vals in rows.items():
                if i >= len(vals):
                    continue
                v = _safe_num(vals[i])
                if "sales" in key and "growth" not in key:
                    pl["revenue"] = v
                elif "operating profit" in key:
                    pl["operating_profit"] = v
                elif "opm" in key:
                    pl["opm_pct"] = v
                elif "net profit" in key or "pat" in key:
                    pl["pat"] = v
                elif "eps" in key:
                    pl["eps"] = v
            annual.append(pl)
        data["annual_profit_loss"] = annual

        # Latest year scalars
        if annual:
            latest = annual[0]
            data["revenue"] = latest.get("revenue")
            data["ebitda"] = latest.get("operating_profit")
            data["pat"] = latest.get("pat")
            data["eps"] = data.get("eps") or latest.get("eps")
            if latest.get("revenue") and latest.get("pat"):
                data["net_margin"] = round(latest["pat"] / latest["revenue"] * 100, 2)
            if latest.get("revenue") and latest.get("operating_profit"):
                data["ebitda_margin"] = round(latest["operating_profit"] / latest["revenue"] * 100, 2)
    except Exception as e:
        logger.debug("parse_annual_pl: %s", e)
    return data


def _parse_screener_balance_sheet(soup: BeautifulSoup) -> Dict:
    data: Dict[str, Any] = {"annual_balance_sheet": []}
    try:
        section = soup.find("section", id="balance-sheet")
        if not section:
            return data
        table = section.find("table")
        if not table:
            return data

        headers = [th.get_text(strip=True) for th in table.find_all("th")][1:]
        rows: Dict[str, List] = {}
        for tr in table.find_all("tr")[1:]:
            cells = [td.get_text(strip=True) for td in tr.find_all("td")]
            if cells:
                rows[cells[0].lower().strip()] = cells[1:]

        for i, period in enumerate(headers[:5]):
            bs: Dict[str, Any] = {"period": period}
            for key, vals in rows.items():
                if i >= len(vals):
                    continue
                v = _safe_num(vals[i])
                if "equity capital" in key:
                    bs["equity_capital"] = v
                elif "reserves" in key:
                    bs["reserves"] = v
                elif "borrowings" in key:
                    bs["borrowings"] = v
                elif "other liabilities" in key:
                    bs["other_liabilities"] = v
                elif "total liabilities" in key:
                    bs["total_liabilities"] = v
                elif "fixed assets" in key:
                    bs["fixed_assets"] = v
                elif "cwip" in key:
                    bs["cwip"] = v
                elif "investments" in key:
                    bs["investments"] = v
                elif "other assets" in key:
                    bs["other_assets"] = v
                elif "total assets" in key:
                    bs["total_assets"] = v
            data["annual_balance_sheet"].append(bs)

        if data["annual_balance_sheet"]:
            latest = data["annual_balance_sheet"][0]
            data["total_assets"] = latest.get("total_assets")
            data["total_debt"] = latest.get("borrowings")
            net_worth = None
            if latest.get("equity_capital") and latest.get("reserves"):
                net_worth = (latest["equity_capital"] or 0) + (latest["reserves"] or 0)
            data["net_worth"] = net_worth
            data["shareholders_equity"] = net_worth
            if latest.get("borrowings") and net_worth and net_worth > 0:
                data["debt_equity"] = data.get("debt_equity") or round(latest["borrowings"] / net_worth, 2)
    except Exception as e:
        logger.debug("parse_balance_sheet: %s", e)
    return data


def _parse_screener_cashflow(soup: BeautifulSoup) -> Dict:
    data: Dict[str, Any] = {"cashflow": []}
    try:
        section = soup.find("section", id="cash-flow")
        if not section:
            return data
        table = section.find("table")
        if not table:
            return data

        headers = [th.get_text(strip=True) for th in table.find_all("th")][1:]
        rows: Dict[str, List] = {}
        for tr in table.find_all("tr")[1:]:
            cells = [td.get_text(strip=True) for td in tr.find_all("td")]
            if cells:
                rows[cells[0].lower().strip()] = cells[1:]

        for i, period in enumerate(headers[:5]):
            cf: Dict[str, Any] = {"period": period}
            for key, vals in rows.items():
                if i >= len(vals):
                    continue
                v = _safe_num(vals[i])
                if "operating" in key:
                    cf["operating_cf"] = v
                elif "investing" in key:
                    cf["investing_cf"] = v
                elif "financing" in key:
                    cf["financing_cf"] = v
                elif "net" in key:
                    cf["net_cf"] = v
            data["cashflow"].append(cf)

        if data["cashflow"]:
            latest = data["cashflow"][0]
            data["operating_cf"] = latest.get("operating_cf")
            data["investing_cf"] = latest.get("investing_cf")
            data["financing_cf"] = latest.get("financing_cf")
            if latest.get("operating_cf") is not None and latest.get("investing_cf") is not None:
                capex = abs(latest.get("investing_cf") or 0)
                data["free_cf"] = (latest["operating_cf"] or 0) - capex
    except Exception as e:
        logger.debug("parse_cashflow: %s", e)
    return data


def _parse_screener_peers(soup: BeautifulSoup) -> Dict:
    data: Dict[str, Any] = {"peers": []}
    try:
        section = soup.find("section", id="peers")
        if not section:
            return data
        table = section.find("table")
        if not table:
            return data

        headers = [th.get_text(strip=True) for th in table.find_all("th")]
        for tr in table.find_all("tr")[1:][:15]:
            cells = [td.get_text(strip=True) for td in tr.find_all("td")]
            if len(cells) < 2:
                continue
            peer: Dict[str, Any] = {"name": cells[0]}
            # Extract NSE symbol from hyperlink if present
            link = tr.find("a")
            if link and link.get("href"):
                m = re.search(r"/company/([A-Z0-9&-]+)/", link["href"])
                if m:
                    peer["symbol"] = m.group(1)
            for idx, hdr in enumerate(headers[1:], start=1):
                if idx >= len(cells):
                    break
                hdr_l = hdr.lower()
                v = _safe_num(cells[idx])
                if "cmp" in hdr_l or "price" in hdr_l:
                    peer["cmp"] = v
                elif "p/e" in hdr_l:
                    peer["pe"] = v
                elif "market cap" in hdr_l:
                    peer["market_cap"] = v
                elif "div yield" in hdr_l:
                    peer["dividend_yield"] = v
                elif "roe" in hdr_l:
                    peer["roe"] = v
                elif "roce" in hdr_l:
                    peer["roce"] = v
                elif "sales" in hdr_l:
                    peer["revenue"] = v
            data["peers"].append(peer)
    except Exception as e:
        logger.debug("parse_peers: %s", e)
    return data


def _parse_screener_management(soup: BeautifulSoup) -> Dict:
    data: Dict[str, Any] = {"management": []}
    try:
        # Management section appears in multiple forms on screener.in
        mgmt_section = (
            soup.find("section", id="management")
            or soup.find("div", class_="management-grid")
            or soup.find("div", class_="company-management")
        )
        if mgmt_section:
            for row in mgmt_section.find_all(["tr", "li", "div"], class_=re.compile(r"row|person|member", re.I)):
                name_el = row.find(class_=re.compile(r"name", re.I)) or row.find("strong") or row.find("b")
                role_el = row.find(class_=re.compile(r"role|designation|title", re.I))
                name = name_el.get_text(strip=True) if name_el else ""
                role = role_el.get_text(strip=True) if role_el else ""
                if name:
                    data["management"].append({"name": name, "designation": role})
        # Also look in any table with 'Director' content
        if not data["management"]:
            for table in soup.find_all("table"):
                headers = [th.get_text(strip=True).lower() for th in table.find_all("th")]
                if any("director" in h or "name" in h for h in headers):
                    for tr in table.find_all("tr")[1:][:10]:
                        cells = [td.get_text(strip=True) for td in tr.find_all("td")]
                        if cells:
                            data["management"].append({
                                "name": cells[0],
                                "designation": cells[1] if len(cells) > 1 else "",
                            })
                    break
    except Exception as e:
        logger.debug("parse_management: %s", e)
    return data


# ═══════════════════════════════════════════════════════════════════════════════
#  TRENDLYNE  (secondary / fallback source)
# ═══════════════════════════════════════════════════════════════════════════════

async def fetch_trendlyne_data(symbol: str) -> Dict:
    """
    Scrape Trendlyne for financial metrics + DVM score as screener.in fallback.
    URL: https://trendlyne.com/equity/{symbol}/NSE/
    """
    result: Dict[str, Any] = {}
    try:
        # Trendlyne uses slugs; try symbol directly first
        url = f"{TRENDLYNE_BASE}/equity/{symbol}/NSE/"
        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(
            headers=TRENDLYNE_HEADERS,
            timeout=timeout,
            connector=_make_connector(),
        ) as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    return result
                html = await resp.text()

        soup = BeautifulSoup(html, "lxml")

        # Extract key metrics from the summary card
        for row in soup.find_all(["tr", "li", "div"], class_=re.compile(r"metric|ratio|stat", re.I)):
            spans = row.find_all("span")
            if len(spans) < 2:
                continue
            key = spans[0].get_text(strip=True).lower()
            val = _safe_num(spans[-1].get_text(strip=True))
            if val is None:
                continue
            if "p/e" in key and "forward" not in key:
                result["pe_ratio"] = val
            elif "p/b" in key:
                result["pb_ratio"] = val
            elif "roe" in key:
                result["roe"] = val
            elif "roce" in key:
                result["roce"] = val
            elif "debt" in key and "equity" in key:
                result["debt_equity"] = val
            elif "eps" in key:
                result["eps"] = val
            elif "market cap" in key:
                result["market_cap"] = val

        # DVM score (quality/value/momentum composite)
        for el in soup.find_all(class_=re.compile(r"dvm|score|rating", re.I)):
            text = el.get_text(strip=True)
            m = re.search(r"(\d+(?:\.\d+)?)\s*/\s*100", text)
            if m:
                result["dvm_score"] = float(m.group(1))
                break

        # Description fallback
        if not result.get("description"):
            about = soup.find("div", class_=re.compile(r"about|description|summary", re.I))
            if about:
                result["description"] = about.get_text(" ", strip=True)[:1000]

        logger.debug("trendlyne %s: got %d fields", symbol, len(result))
    except Exception as e:
        logger.debug("trendlyne %s: %s", symbol, e)
    return result


# ═══════════════════════════════════════════════════════════════════════════════
#  TICKERTAPE  (tertiary — JSON API, more accessible)
# ═══════════════════════════════════════════════════════════════════════════════

async def fetch_tickertape_data(symbol: str) -> Dict:
    """
    Fetch financial summary from Tickertape's public endpoint.
    Returns ratios + company overview.
    """
    result: Dict[str, Any] = {}
    try:
        # Tickertape uses ISIN-based lookup; try symbol-based scrape
        url = f"https://www.tickertape.in/stocks/{symbol.lower()}-NSE"
        timeout = aiohttp.ClientTimeout(total=12)
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,*/*;q=0.8",
        }
        async with aiohttp.ClientSession(headers=headers, timeout=timeout, connector=_make_connector()) as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    return result
                html = await resp.text()

        # Extract JSON-LD or __NEXT_DATA__ props
        soup = BeautifulSoup(html, "lxml")
        next_data = soup.find("script", id="__NEXT_DATA__")
        if next_data:
            import json
            try:
                nd = json.loads(next_data.string or "{}")
                props = nd.get("props", {}).get("pageProps", {}).get("stockData", {})
                ratios = props.get("ratios", {})
                if ratios.get("pe"):
                    result["pe_ratio"] = ratios["pe"]
                if ratios.get("pb"):
                    result["pb_ratio"] = ratios["pb"]
                if ratios.get("roe"):
                    result["roe"] = ratios["roe"]
                if ratios.get("roce"):
                    result["roce"] = ratios["roce"]
                info = props.get("info", {})
                if info.get("description"):
                    result["description"] = info["description"][:1000]
                if info.get("sector"):
                    result["sector"] = info["sector"]
            except Exception:
                pass
        logger.debug("tickertape %s: got %d fields", symbol, len(result))
    except Exception as e:
        logger.debug("tickertape %s: %s", symbol, e)
    return result


# ═══════════════════════════════════════════════════════════════════════════════
#  NSE CORPORATE INFO  (supplementary — official structured data)
# ═══════════════════════════════════════════════════════════════════════════════

async def fetch_nse_company_info(symbol: str) -> Dict:
    """
    NSE public API for company overview: ISIN, sector, listing date, financials.
    """
    result: Dict[str, Any] = {}
    try:
        from data.nse_data import _nse_session, NSE_HEADERS
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(
            headers=NSE_HEADERS, timeout=timeout, connector=_make_connector()
        ) as session:
            # Prime NSE cookies
            try:
                async with session.get("https://www.nseindia.com", timeout=aiohttp.ClientTimeout(total=5)):
                    pass
            except Exception:
                pass
            url = f"https://www.nseindia.com/api/quote-equity?symbol={symbol}"
            async with session.get(url) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    info = data.get("info", {})
                    result["name"] = info.get("companyName", "")
                    result["isin"] = info.get("isin", "")
                    result["sector"] = info.get("industry", "")  # NSE uses 'industry' for sector
                    meta = data.get("metadata", {})
                    result["face_value"] = meta.get("pdFaceValue")
                    result["listing_date"] = meta.get("pdListingDate")
    except Exception as e:
        logger.debug("nse_company_info %s: %s", symbol, e)
    return result


# ═══════════════════════════════════════════════════════════════════════════════
#  PUBLIC API  (used by deep-dive endpoint in main.py)
# ═══════════════════════════════════════════════════════════════════════════════

async def fetch_full_fundamentals(symbol: str) -> Dict:
    """
    Merge screener.in + Trendlyne + NSE data.
    Screener wins where it has data; Trendlyne fills gaps; NSE fills rest.
    """
    screener, trendlyne, nse = await asyncio.gather(
        fetch_screener_data(symbol),
        fetch_trendlyne_data(symbol),
        fetch_nse_company_info(symbol),
        return_exceptions=True,
    )
    if isinstance(screener, Exception):
        screener = {}
    if isinstance(trendlyne, Exception):
        trendlyne = {}
    if isinstance(nse, Exception):
        nse = {}

    # Screener wins; Trendlyne fills gaps; NSE fills rest
    merged: Dict[str, Any] = {}
    for src in (nse, trendlyne, screener):
        for k, v in src.items():
            if v is not None and (merged.get(k) is None or merged.get(k) == ""):
                merged[k] = v
    return merged


async def fetch_management_data(symbol: str) -> Dict:
    """
    Fetch management from screener.in (primary) — no yfinance.
    """
    try:
        screener = await fetch_screener_data(symbol)
        return {
            "symbol": symbol,
            "management": screener.get("management", []),
            "website": screener.get("website", ""),
            "description": screener.get("description", ""),
        }
    except Exception as e:
        logger.error("fetch_management %s: %s", symbol, e)
        return {"symbol": symbol, "management": []}
