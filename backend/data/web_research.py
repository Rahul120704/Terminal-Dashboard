"""
Web Research Module — deep internet research for NSE/BSE stocks.

Sources fetched in parallel:
  • Google News RSS  — latest news from ET, BS, Mint, MC, Hindu BL
  • NSE India API    — live financials, 52w data, sector
  • BSE India API    — company details, quarterly results, announcements
  • Tickertape API   — analyst targets, ratings, detailed ratios

AI synthesis via Ollama (primary) → Claude API (fallback).
"""

import aiohttp
import asyncio
import logging
import xml.etree.ElementTree as ET
import json
import re
from typing import Dict, List, Any, Optional
from urllib.parse import quote
from email.utils import parsedate_to_datetime
from datetime import datetime

logger = logging.getLogger(__name__)

_BROWSER = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
}
_NSE = {
    **_BROWSER,
    "Referer": "https://www.nseindia.com/",
    "Accept": "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
}
_BSE = {
    **_BROWSER,
    "Origin": "https://www.bseindia.com",
    "Referer": "https://www.bseindia.com/",
    "Accept": "application/json, text/plain, */*",
}


# ─────────────────────────────────────────────────────────────────────────────
# Google News RSS
# ─────────────────────────────────────────────────────────────────────────────

async def fetch_google_news(company_name: str, symbol: str, limit: int = 25) -> List[Dict]:
    """
    Fetch latest news from Google News RSS.
    Uses two targeted queries to maximise coverage of results + analysis.
    """
    queries = [
        f'"{company_name}" quarterly results earnings 2025 OR 2026',
        f'{symbol} NSE India stock analysis outlook',
        f'"{company_name}" NSE management guidance expansion',
    ]
    items: List[Dict] = []
    seen: set = set()

    async with aiohttp.ClientSession() as sess:
        for q in queries:
            url = (
                f"https://news.google.com/rss/search"
                f"?q={quote(q)}&hl=en-IN&gl=IN&ceid=IN:en"
            )
            try:
                async with sess.get(
                    url, headers=_BROWSER,
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as r:
                    if r.status != 200:
                        continue
                    xml_text = await r.text()
                    root = ET.fromstring(xml_text)
                    chan = root.find("channel")
                    if chan is None:
                        continue
                    for it in chan.findall("item"):
                        title = (it.findtext("title") or "").strip()
                        link  = it.findtext("link") or ""
                        pub   = it.findtext("pubDate") or ""
                        src_el = it.find("source")
                        source = (src_el.text if src_el is not None else "") or "News"
                        desc   = re.sub(r"<[^>]+>", "", it.findtext("description") or "")[:300]

                        key = title[:60].lower()
                        if key in seen or not title:
                            continue
                        seen.add(key)

                        try:
                            dt = parsedate_to_datetime(pub)
                            pub_str = dt.strftime("%d %b %Y")
                        except Exception:
                            pub_str = pub[:16]

                        items.append({
                            "title":     title,
                            "url":       link,
                            "source":    source,
                            "published": pub_str,
                            "snippet":   desc.strip(),
                        })
            except Exception as e:
                logger.debug("Google News RSS [%s] error: %s", q[:40], e)

    # Sort by most recent (rough: items come newest-first from RSS, just deduplicate)
    return items[:limit]


# ─────────────────────────────────────────────────────────────────────────────
# NSE India direct API
# ─────────────────────────────────────────────────────────────────────────────

async def fetch_nse_data(symbol: str) -> Dict:
    """Fetch NSE quote-equity + fundamentals. Needs cookie seeding first."""
    result: Dict = {}
    try:
        async with aiohttp.ClientSession() as sess:
            # Seed NSE cookie (required for CSRF)
            try:
                await sess.get(
                    "https://www.nseindia.com",
                    headers=_NSE,
                    timeout=aiohttp.ClientTimeout(total=6),
                )
            except Exception:
                pass

            # Quote + trade info
            r = await sess.get(
                f"https://www.nseindia.com/api/quote-equity?symbol={quote(symbol)}",
                headers=_NSE,
                timeout=aiohttp.ClientTimeout(total=10),
            )
            if r.status == 200:
                d = await r.json()
                info  = d.get("info", {})
                meta  = d.get("metadata", {})
                pri   = d.get("priceInfo", {})
                ind   = d.get("industryInfo", {})
                sdata = d.get("securityInfo", {})
                whl   = pri.get("weekHighLow", {})
                result = {
                    "company_name":  info.get("companyName", ""),
                    "isin":          meta.get("isin", ""),
                    "listing_date":  meta.get("listingDate", ""),
                    "face_value":    meta.get("pdFaceValue"),
                    "industry":      ind.get("industry", ""),
                    "macro_sector":  ind.get("macroSector", ""),
                    "basic_industry": ind.get("basicIndustry", ""),
                    "52w_high":      whl.get("max"),
                    "52w_low":       whl.get("min"),
                    "52w_high_date": whl.get("maxDate", ""),
                    "52w_low_date":  whl.get("minDate", ""),
                    "close":         pri.get("previousClose"),
                    "total_traded_value": pri.get("totalTradedValue"),
                    "series":        sdata.get("series", "EQ"),
                }

            # Financial results (board meetings / results dates)
            try:
                r2 = await sess.get(
                    f"https://www.nseindia.com/api/event-calendar?symbol={quote(symbol)}",
                    headers=_NSE,
                    timeout=aiohttp.ClientTimeout(total=8),
                )
                if r2.status == 200:
                    events = await r2.json()
                    result["upcoming_events"] = [
                        {
                            "date": e.get("date", ""),
                            "purpose": e.get("purpose", ""),
                            "ex_date": e.get("exDate", ""),
                        }
                        for e in (events or [])[:10]
                    ]
            except Exception:
                pass

    except Exception as e:
        logger.debug("NSE data error [%s]: %s", symbol, e)
    return result


# ─────────────────────────────────────────────────────────────────────────────
# BSE India public API
# ─────────────────────────────────────────────────────────────────────────────

async def fetch_bse_data(bse_code: str) -> Dict:
    """Company details, financial summary, and latest corporate announcements from BSE."""
    if not str(bse_code).strip():
        return {}

    result: Dict = {}
    async with aiohttp.ClientSession() as sess:

        # ── Company header details ──────────────────────────────────────────
        try:
            r = await sess.get(
                f"https://api.bseindia.com/BseIndiaAPI/api/CompanyHeaderDetails/w"
                f"?scrip_code={bse_code}",
                headers=_BSE,
                timeout=aiohttp.ClientTimeout(total=8),
            )
            if r.status == 200:
                rows = await r.json()
                if isinstance(rows, list) and rows:
                    d = rows[0]
                    mc = (d.get("MARKET_CAP_IN_LACS") or 0)
                    result["details"] = {
                        "name":           d.get("LONG_NAME", ""),
                        "sector":         d.get("SECTOR", ""),
                        "industry":       d.get("INDUSTRY", ""),
                        "market_cap_cr":  round(mc / 100, 2) if mc else None,
                        "pe":             d.get("PE_RATIO"),
                        "pb":             d.get("PB_RATIO"),
                        "eps":            d.get("EPS"),
                        "div_yield":      d.get("DIV_YIELD"),
                        "52w_high":       d.get("FIFTY_TWO_WEEK_HIGH"),
                        "52w_low":        d.get("FIFTY_TWO_WEEK_LOW"),
                        "face_value":     d.get("FACE_VALUE"),
                        "book_value":     d.get("BOOK_VALUE"),
                        "total_shares":   d.get("TOTAL_SHARES"),
                        "promoter_pct":   d.get("PROMOTER_HOLDIND"),
                        "fii_pct":        d.get("FII_HOLDING"),
                        "roe":            d.get("RETURN_ON_NET_WORTH"),
                        "roce":           d.get("RETURN_ON_CE"),
                    }
        except Exception as e:
            logger.debug("BSE header [%s]: %s", bse_code, e)

        # ── Latest quarterly results ────────────────────────────────────────
        try:
            r = await sess.get(
                f"https://api.bseindia.com/BseIndiaAPI/api/ResultsDetails/w"
                f"?bseid={bse_code}",
                headers=_BSE,
                timeout=aiohttp.ClientTimeout(total=8),
            )
            if r.status == 200:
                data = await r.json()
                quarters = []
                for row in (data or [])[:8]:
                    quarters.append({
                        "period":       row.get("PERIOD", ""),
                        "net_sales":    row.get("NET_SALES"),
                        "net_profit":   row.get("NET_PROFIT"),
                        "eps":          row.get("EPS"),
                        "result_date":  row.get("RESULT_DATE", "")[:10],
                    })
                if quarters:
                    result["quarterly_results"] = quarters
        except Exception as e:
            logger.debug("BSE results [%s]: %s", bse_code, e)

        # ── Recent corporate announcements ──────────────────────────────────
        try:
            r = await sess.get(
                f"https://api.bseindia.com/BseIndiaAPI/api/Corpfeed/w"
                f"?pageno=1&strSearch=&ddlscrip_code={bse_code}&strCat=-1",
                headers=_BSE,
                timeout=aiohttp.ClientTimeout(total=8),
            )
            if r.status == 200:
                data = await r.json()
                anns = []
                for ann in (data.get("Table", []) or [])[:20]:
                    subj = (ann.get("SLONGNAME") or ann.get("CATEGORYNAME") or "").strip()
                    if not subj:
                        continue
                    anns.append({
                        "date":     (ann.get("DisseminationDate") or "")[:10],
                        "subject":  subj,
                        "category": ann.get("CATEGORYNAME", ""),
                    })
                if anns:
                    result["announcements"] = anns
        except Exception as e:
            logger.debug("BSE announcements [%s]: %s", bse_code, e)

        # ── Shareholding pattern ────────────────────────────────────────────
        try:
            r = await sess.get(
                f"https://api.bseindia.com/BseIndiaAPI/api/ShareholdingPattern/w"
                f"?scrip_code={bse_code}&qtrid=",
                headers=_BSE,
                timeout=aiohttp.ClientTimeout(total=8),
            )
            if r.status == 200:
                data = await r.json()
                if isinstance(data, list) and data:
                    latest = data[0]
                    result["shareholding_bse"] = {
                        "period":      latest.get("PERIOD", ""),
                        "promoter":    latest.get("PROMOTER"),
                        "fii":         latest.get("FII"),
                        "dii":         latest.get("DII"),
                        "public":      latest.get("PUBLIC"),
                        "total_shares": latest.get("TOTAL"),
                    }
        except Exception as e:
            logger.debug("BSE shareholding [%s]: %s", bse_code, e)

    return result


# ─────────────────────────────────────────────────────────────────────────────
# Tickertape supplementary data
# ─────────────────────────────────────────────────────────────────────────────

async def fetch_tickertape_data(symbol: str) -> Dict:
    """Fetch analyst consensus and key metrics from Tickertape's public API."""
    result: Dict = {}
    try:
        # Tickertape uses a slug (lowercase symbol, some remapping needed)
        slug = symbol.lower().replace("&", "and").replace("-", "")
        async with aiohttp.ClientSession() as sess:
            r = await sess.get(
                f"https://api.tickertape.in/stocks/{slug}/ratings",
                headers=_BROWSER,
                timeout=aiohttp.ClientTimeout(total=8),
            )
            if r.status == 200:
                d = await r.json()
                result["ratings"] = d.get("data", {})

            # Financial snapshot
            r2 = await sess.get(
                f"https://api.tickertape.in/stocks/{slug}/financials",
                headers=_BROWSER,
                timeout=aiohttp.ClientTimeout(total=8),
            )
            if r2.status == 200:
                d2 = await r2.json()
                result["financials"] = d2.get("data", {})
    except Exception as e:
        logger.debug("Tickertape [%s]: %s", symbol, e)
    return result


# ─────────────────────────────────────────────────────────────────────────────
# AI Analysis (Ollama primary → Claude fallback)
# ─────────────────────────────────────────────────────────────────────────────

def _build_analysis_prompt(
    symbol: str,
    company_name: str,
    sector: str,
    description: str,
    live_quote: Dict,
    screener: Dict,
    bse_data: Dict,
    nse_data: Dict,
    web_news: List[Dict],
) -> str:
    """Build a dense, data-rich prompt for the AI model."""

    price     = live_quote.get("price") or 0
    chg       = live_quote.get("change_pct") or 0
    mktcap    = live_quote.get("market_cap") or screener.get("market_cap")
    high52    = live_quote.get("high_52w") or nse_data.get("52w_high")
    low52     = live_quote.get("low_52w") or nse_data.get("52w_low")

    # Financial ratios
    def sc(*keys):
        for k in keys:
            v = screener.get(k)
            if v is not None:
                return v
        return None

    ratios = {
        "P/E":             sc("pe_ratio", "stock_pe"),
        "P/B":             sc("pb_ratio"),
        "EV/EBITDA":       sc("ev_ebitda"),
        "ROE%":            sc("roe"),
        "ROCE%":           sc("roce"),
        "Net Margin%":     sc("pat_margin", "net_margin"),
        "EBITDA Margin%":  sc("ebitda_margin"),
        "D/E":             sc("debt_equity"),
        "Interest Coverage": sc("interest_coverage"),
        "Rev Growth YoY%": sc("revenue_growth", "sales_growth"),
        "PAT Growth YoY%": sc("pat_growth"),
        "Div Yield%":      sc("div_yield", "dividend_yield"),
        "Promoter%":       screener.get("promoter_holding"),
        "FII%":            screener.get("fii_holding"),
    }
    bse_det = bse_data.get("details", {})
    if bse_det:
        for k, v in [("BSE P/E", bse_det.get("pe")), ("BSE P/B", bse_det.get("pb")),
                     ("BSE EPS", bse_det.get("eps")), ("BSE ROE%", bse_det.get("roe")),
                     ("BSE Mkt Cap Cr", bse_det.get("market_cap_cr"))]:
            if v is not None:
                ratios[k] = v

    ratio_block = "\n".join(
        f"  {k}: {v}" for k, v in ratios.items() if v is not None
    ) or "  (limited data available)"

    # Quarterly results — from BSE API (most reliable) or screener
    qr_rows = (bse_data.get("quarterly_results") or
               screener.get("quarterly_results") or [])[:6]
    qr_block = ""
    if qr_rows:
        lines = []
        for q in qr_rows:
            period = q.get("period") or q.get("date") or q.get("Period") or ""
            rev    = q.get("net_sales") or q.get("sales") or q.get("revenue") or q.get("NetSales")
            pat    = q.get("net_profit") or q.get("pat") or q.get("NetProfit")
            eps_v  = q.get("eps") or q.get("EPS")
            lines.append(f"  {period}: Revenue ₹{rev} Cr  |  PAT ₹{pat} Cr  |  EPS ₹{eps_v}")
        qr_block = "\n".join(lines)
    else:
        qr_block = "  (quarterly results not available from BSE/screener)"

    # Annual P&L trend
    pl_rows = screener.get("annual_profit_loss", [])[:5]
    pl_block = ""
    if pl_rows:
        pl_lines = []
        for row in pl_rows:
            yr   = row.get("Mar") or row.get("year") or ""
            rev  = row.get("Sales") or row.get("Revenue") or ""
            pat  = row.get("Net Profit") or row.get("PAT") or ""
            pl_lines.append(f"  {yr}: Sales ₹{rev} Cr, PAT ₹{pat} Cr")
        pl_block = "\n".join(pl_lines)

    # Recent announcements
    anns = (bse_data.get("announcements") or [])[:8]
    ann_block = "\n".join(
        f"  [{a['date']}] {a['subject']}" for a in anns
    ) or "  (no recent announcements)"

    # Web news
    news_block = "\n".join(
        f"  [{n['source']}] {n['title']} ({n['published']})"
        for n in web_news[:10]
    ) or "  (no recent news found)"

    # Management
    mgmt = screener.get("management", [])[:6]
    mgmt_block = "\n".join(
        f"  {m.get('name','')}: {m.get('designation','')}" for m in mgmt
    ) or "  (management data not available)"

    return f"""You are a top-tier equity research analyst at a leading Indian fund house (like HDFC AMC, Kotak, Mirae).
Write a COMPREHENSIVE institutional-grade investment research note for {company_name} ({symbol}, NSE India).

Be SPECIFIC with numbers. Reference actual data provided. Use ₹ Cr for financials. Total: 700–900 words.

## 1. BUSINESS MODEL & COMPETITIVE POSITION
What exactly does this company do? Revenue breakdown, geographic mix, key brands/products/services.
Market position, moat, competitive advantages vs peers.

## 2. LATEST RESULTS & PERFORMANCE TREND
Analyse the most recent quarterly results. QoQ and YoY growth in revenue, EBITDA, PAT.
Margin trajectory (expanding/compressing and why). Any exceptional items or one-offs.
What has management guided for next quarter/year?

## 3. FINANCIAL HEALTH SCORECARD
Balance sheet: debt levels (D/E ratio), net debt/EBITDA, pledging.
Cash flow: OCF quality, FCF generation, capex intensity.
Return ratios (ROE, ROCE trend). Working capital efficiency.

## 4. GROWTH DRIVERS & CATALYSTS (next 12–24 months)
Industry tailwinds. Company-specific projects, expansions, new launches.
Order book/pipeline (if applicable). Government policy tailwinds/headwinds.
Management's stated growth strategy.

## 5. KEY RISKS
Company-specific: concentration risk, management change, regulatory headwinds.
Financial: forex exposure, commodity prices, debt refinancing.
Sector risks. Any recent negative news/events.

## 6. SHAREHOLDING & GOVERNANCE
Promoter track record, any pledge concerns, institutional confidence trend.
Recent bulk/insider trades. Any governance red flags.

## 7. VALUATION
Current P/E, P/B, EV/EBITDA vs 3yr average and sector peers.
Premium or discount — is it justified? Any re-rating triggers.

## 8. BULL vs BEAR THESIS
Bull Case (30%+ upside in 12m): 2–3 specific triggers with magnitude.
Bear Case (20%+ downside in 12m): 2–3 specific risks with magnitude.

## 9. ANALYST VERDICT
Rating: BUY / ACCUMULATE / HOLD / REDUCE / SELL
12-month Price Target: ₹[estimate based on P/E or DCF if data allows, else state "insufficient data"]
Top 3 Monitorables: [key metrics/events to track]

---
COMPANY DATA:
Company: {company_name} ({symbol})  |  Sector: {sector}
CMP: ₹{price} ({chg:+.2f}%)  |  Mkt Cap: ₹{mktcap} Cr  |  52W: ₹{low52}–₹{high52}
Listing Date: {nse_data.get('listing_date','—')}  |  Industry: {nse_data.get('industry','—')}

Business Description:
{(description or '(not available)')[:600]}

KEY FINANCIAL RATIOS:
{ratio_block}

QUARTERLY RESULTS (latest 6 quarters):
{qr_block}

ANNUAL P&L TREND:
{pl_block or '  (not available)'}

MANAGEMENT:
{mgmt_block}

RECENT BSE/NSE ANNOUNCEMENTS:
{ann_block}

LATEST INTERNET NEWS:
{news_block}"""


async def generate_ai_analysis(
    symbol: str,
    company_name: str,
    sector: str,
    description: str,
    live_quote: Dict,
    screener: Dict,
    bse_data: Dict,
    nse_data: Dict,
    web_news: List[Dict],
) -> Dict:
    """
    Run the AI analysis. Tries Ollama first, falls back to Claude API.
    Returns {analysis, model, provider, generated_at, word_count}
    """
    prompt = _build_analysis_prompt(
        symbol, company_name, sector, description,
        live_quote, screener, bse_data, nse_data, web_news,
    )

    analysis_text = ""
    model_used = ""
    provider_used = ""

    # ── Try Ollama ────────────────────────────────────────────────────────────
    try:
        from ai.terminal_copilot import OLLAMA_ENDPOINTS, OLLAMA_MODEL, OLLAMA_API_KEY
        hdrs: Dict = {"Content-Type": "application/json"}
        if OLLAMA_API_KEY:
            hdrs["Authorization"] = f"Bearer {OLLAMA_API_KEY}"

        payload = {
            "model": OLLAMA_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 3000,
            "stream": False,
            "temperature": 0.3,
        }
        async with aiohttp.ClientSession() as sess:
            for ep in OLLAMA_ENDPOINTS:
                try:
                    async with sess.post(
                        f"{ep['url']}/chat/completions",
                        headers=hdrs,
                        json=payload,
                        timeout=aiohttp.ClientTimeout(total=120),
                    ) as r:
                        if r.status == 200:
                            d = await r.json()
                            analysis_text = d["choices"][0]["message"]["content"]
                            model_used = OLLAMA_MODEL
                            provider_used = ep["label"]
                            break
                except Exception as e:
                    logger.debug("Ollama [%s] error: %s", ep["label"], e)
    except Exception as e:
        logger.debug("Ollama setup error: %s", e)

    # ── Fallback: Claude API ──────────────────────────────────────────────────
    if not analysis_text:
        try:
            from ai.terminal_copilot import ANTHROPIC_API_KEY
            if ANTHROPIC_API_KEY:
                claude_hdrs = {
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                }
                claude_payload = {
                    "model": "claude-haiku-4-5",
                    "max_tokens": 3000,
                    "messages": [{"role": "user", "content": prompt}],
                }
                async with aiohttp.ClientSession() as sess:
                    async with sess.post(
                        "https://api.anthropic.com/v1/messages",
                        headers=claude_hdrs,
                        json=claude_payload,
                        timeout=aiohttp.ClientTimeout(total=60),
                    ) as r:
                        if r.status == 200:
                            d = await r.json()
                            analysis_text = d["content"][0]["text"]
                            model_used = "claude-haiku-4-5"
                            provider_used = "Claude"
                        else:
                            err_body = await r.text()
                            logger.warning("Claude API %s: %s", r.status, err_body[:200])
        except Exception as e:
            logger.debug("Claude fallback error: %s", e)

    return {
        "analysis":      analysis_text,
        "model":         model_used,
        "provider":      provider_used,
        "generated_at":  datetime.now().isoformat(),
        "word_count":    len(analysis_text.split()) if analysis_text else 0,
        "available":     bool(analysis_text),
    }
