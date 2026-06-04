"""
Company data module — DES, Shareholding, Corporate Actions, Peers, DCF, Yield Curve, Delivery.
Uses yfinance for global data; NSE session for India-specific data.
"""

import asyncio
import logging
import math
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any

import yfinance as yf
import numpy as np

logger = logging.getLogger(__name__)

# ── Sector peer map (NSE universe) ──────────────────────────────────────────
SECTOR_PEERS: Dict[str, List[str]] = {
    "Information Technology": ["TCS","INFY","WIPRO","HCLTECH","TECHM","MPHASIS","PERSISTENT","COFORGE","LTTS","OFSS"],
    "Financial Services":     ["HDFCBANK","ICICIBANK","KOTAKBANK","AXISBANK","SBIN","BANDHANBNK","IDFCFIRSTB","FEDERALBNK","PNB","INDUSINDBK"],
    "Consumer Goods":         ["HINDUNILVR","ITC","NESTLEIND","BRITANNIA","DABUR","MARICO","COLPAL","GODREJCP","TATACONSUM","EMAMILTD"],
    "Automobile":             ["MARUTI","TATAMOTORS","M&M","BAJAJ-AUTO","HEROMOTOCO","EICHERMOT","ASHOKLEY","TVSMOTOR","BALKRISIND","MRF"],
    "Pharma":                 ["SUNPHARMA","DRREDDY","CIPLA","DIVISLAB","TORNTPHARM","ALKEM","IPCALAB","AUROPHARMA","BIOCON","ABBOTINDIA"],
    "Oil & Gas":              ["RELIANCE","ONGC","BPCL","IOC","GAIL","MGL","IGL","PETRONET","HINDPETRO","MRPL"],
    "Metals & Mining":        ["TATASTEEL","JSWSTEEL","HINDALCO","VEDL","COALINDIA","NMDC","SAIL","NALCO","HINDCOPPER","NATIONALUM"],
    "Infrastructure":         ["LT","ADANIPORTS","ADANIENT","NTPC","POWERGRID","NHPC","TATAPOWER","TORNTPOWER","CESC","JPPOWER"],
    "Real Estate":            ["DLF","GODREJPROP","PRESTIGE","OBEROIRLTY","PHOENIXLTD","SOBHA","BRIGADE","MAHLIFE","SUNTECK","KOLTEPATIL"],
    "Chemicals":              ["PIDILITIND","UPL","AARTI","DEEPAKNTR","ALKYLAMINE","NAVINFLUOR","GNFC","TATACHEM","GSFC","SRF"],
    "Cement":                 ["ULTRACEMCO","GRASIM","AMBUJACEM","ACC","SHREECEM","DALMIA","RAMCOCEM","JKCEMENT","HEIDELBERG","BIRLACORPN"],
    "Telecom":                ["BHARTIARTL","VODAFONE","INDUSTOWER","BSOFT","TTML","IDEA"],
    "FMCG":                   ["HINDUNILVR","ITC","NESTLEIND","BRITANNIA","DABUR","MARICO","COLPAL","GODREJCP","TATACONSUM","VARUN"],
    "Banking":                ["HDFCBANK","ICICIBANK","KOTAKBANK","AXISBANK","SBIN","BANDHANBNK","IDFCFIRSTB","FEDERALBNK","PNB","INDUSINDBK"],
    "NBFC":                   ["BAJFINANCE","BAJAJFINSV","CHOLAFIN","MUTHOOTFIN","SHRIRAMFIN","MANAPPURAM","LICHSGFIN","M&MFIN","AAVAS","CANFINHOME"],
    "Insurance":              ["HDFCLIFE","SBILIFE","ICICIPRULI","LICI","NIACL","GIC","STARHEALTH","POLICYBZR"],
    "Aviation":               ["INDIGO","SPICEJET","AIRINDIA"],
    "Hospitality":            ["IHCL","EIHOTEL","LEMONTREE","MAHINDRAHOLIDAYRESORTS","KAMAT"],
    "Retail":                 ["DMART","TRENT","NYKAA","ABFRL","SHOPPERSSTOP","ZOMATO","SWIGGY"],
    "Power":                  ["NTPC","POWERGRID","NHPC","TATAPOWER","TORNTPOWER","CESC","ADANIGREEN","JSWENERGY","INOXWIND"],
}


def _yf_sym(symbol: str) -> str:
    s = symbol.upper().replace("-", "").replace("&", "")
    # Handle special NSE symbols
    if symbol == "M&M":
        return "MM.NS"
    if symbol == "BAJAJ-AUTO":
        return "BAJAJ-AUTO.NS"
    if not s.endswith(".NS") and not s.endswith(".BO"):
        return f"{symbol.upper()}.NS"
    return symbol.upper()


async def fetch_company_overview(symbol: str) -> Dict:
    """
    Bloomberg DES equivalent — comprehensive company profile.
    Returns business description, management, products, key metrics.
    """
    sym = symbol.upper().strip()
    yf_sym = _yf_sym(sym)

    loop = asyncio.get_event_loop()

    def _fetch():
        try:
            tk = yf.Ticker(yf_sym)
            info = tk.info or {}
            # Officers/management — info.get() returns None (not default) when key exists but is null
            officers = info.get("companyOfficers") or []
            management = []
            for off in (officers or [])[:15]:
                management.append({
                    "name": off.get("name", ""),
                    "title": off.get("title", ""),
                    "age": off.get("age"),
                    "total_pay": off.get("totalPay"),
                    "year_born": off.get("yearBorn"),
                })

            # Business segments (yfinance doesn't always have this)
            business_desc = info.get("longBusinessSummary", "")

            return {
                "symbol": sym,
                "name": info.get("longName") or info.get("shortName") or sym,
                "sector": info.get("sector", ""),
                "industry": info.get("industry", ""),
                "country": info.get("country", "India"),
                "city": info.get("city", ""),
                "state": info.get("state", ""),
                "address": info.get("address1", ""),
                "website": info.get("website", ""),
                "phone": info.get("phone", ""),
                "employees": info.get("fullTimeEmployees"),
                "founded": info.get("companyFounded"),
                "description": business_desc,
                "exchange": info.get("exchange", "NSE"),
                "currency": info.get("currency", "INR"),
                "isin": info.get("isin", ""),
                # Key metrics
                "market_cap": info.get("marketCap"),
                "enterprise_value": info.get("enterpriseValue"),
                "pe_ratio": info.get("trailingPE"),
                "forward_pe": info.get("forwardPE"),
                "pb_ratio": info.get("priceToBook"),
                "ps_ratio": info.get("priceToSalesTrailing12Months"),
                "ev_ebitda": info.get("enterpriseToEbitda"),
                "dividend_yield": info.get("dividendYield"),
                "payout_ratio": info.get("payoutRatio"),
                "beta": info.get("beta"),
                "52w_high": info.get("fiftyTwoWeekHigh"),
                "52w_low": info.get("fiftyTwoWeekLow"),
                "avg_volume_10d": info.get("averageVolume10days"),
                "float_shares": info.get("floatShares"),
                "shares_outstanding": info.get("sharesOutstanding"),
                "shares_short": info.get("sharesShort"),
                "short_ratio": info.get("shortRatio"),
                # Financial metrics
                "revenue": info.get("totalRevenue"),
                "gross_profit": info.get("grossProfits"),
                "ebitda": info.get("ebitda"),
                "net_income": info.get("netIncomeToCommon"),
                "total_cash": info.get("totalCash"),
                "total_debt": info.get("totalDebt"),
                "free_cashflow": info.get("freeCashflow"),
                "roe": info.get("returnOnEquity"),
                "roa": info.get("returnOnAssets"),
                "profit_margins": info.get("profitMargins"),
                "operating_margins": info.get("operatingMargins"),
                "gross_margins": info.get("grossMargins"),
                "revenue_growth": info.get("revenueGrowth"),
                "earnings_growth": info.get("earningsGrowth"),
                "current_ratio": info.get("currentRatio"),
                "quick_ratio": info.get("quickRatio"),
                "debt_to_equity": info.get("debtToEquity"),
                # Management
                "management": management,
                # Recommendations
                "recommendation": info.get("recommendationKey", ""),
                "target_price": info.get("targetMeanPrice"),
                "analyst_count": info.get("numberOfAnalystOpinions"),
                "updated_at": datetime.now().isoformat(),
            }
        except Exception as e:
            logger.warning("company_overview %s: %s", symbol, e)
            return {"symbol": sym, "error": str(e), "updated_at": datetime.now().isoformat()}

    from data.nse_data import _YF_EXECUTOR
    return await loop.run_in_executor(_YF_EXECUTOR, _fetch)


async def fetch_shareholding(symbol: str) -> Dict:
    """
    NSE shareholding pattern — Promoter/FII/DII/Public breakdown.
    Falls back to yfinance major holders if NSE unavailable.
    """
    sym = symbol.upper()
    from data.nse_data import _nse_session, _YF_EXECUTOR

    # Try NSE API first
    try:
        data = await _nse_session.get(
            f"corporate-shareholding-patterns?symbol={sym}&series=EQ"
        )
        if data and isinstance(data, list) and len(data) > 0:
            # NSE returns list of quarterly snapshots
            latest = data[0] if isinstance(data[0], dict) else {}
            history = []
            for entry in data[:8]:
                if not isinstance(entry, dict):
                    continue
                q = {
                    "date": entry.get("date", ""),
                    "promoter": entry.get("totPromoterHolding") or entry.get("proHolding"),
                    "fii": entry.get("totFIIHolding") or entry.get("fiillHolding"),
                    "dii": entry.get("totDIIHolding") or entry.get("mfHolding"),
                    "public": entry.get("totPublicHolding") or entry.get("pubHolding"),
                    "pledge_pct": entry.get("promotersPledges"),
                }
                history.append(q)
            return {
                "symbol": sym,
                "source": "NSE",
                "latest": history[0] if history else {},
                "history": history,
                "updated_at": datetime.now().isoformat(),
            }
    except Exception as e:
        logger.debug("NSE shareholding %s: %s", sym, e)

    # Fallback: yfinance major holders
    loop = asyncio.get_event_loop()

    def _fetch_yf():
        try:
            tk = yf.Ticker(_yf_sym(sym))
            inst = tk.institutional_holders
            major = tk.major_holders

            promoter = None
            fii = None
            public = None

            if major is not None and not major.empty:
                for _, row in major.iterrows():
                    label = str(row.iloc[1]).lower()
                    val = row.iloc[0]
                    if isinstance(val, str):
                        val = float(val.strip("%")) / 100
                    if "institution" in label:
                        fii = round(float(val) * 100, 2)
                    elif "insider" in label or "promoter" in label:
                        promoter = round(float(val) * 100, 2)

            if fii and promoter:
                public = round(100 - fii - promoter, 2)

            holders = []
            if inst is not None and not inst.empty:
                for _, row in inst.head(20).iterrows():
                    holders.append({
                        "institution": row.get("Holder", ""),
                        "shares": int(row.get("Shares", 0)),
                        "pct_held": round(float(row.get("% Out", 0)) * 100, 4) if row.get("% Out") else None,
                    })

            return {
                "symbol": sym,
                "source": "yfinance",
                "latest": {
                    "promoter": promoter,
                    "fii": fii,
                    "dii": None,
                    "public": public,
                    "pledge_pct": None,
                },
                "history": [],
                "institutional_holders": holders,
                "updated_at": datetime.now().isoformat(),
            }
        except Exception as e:
            logger.warning("yf shareholding %s: %s", sym, e)
            return {"symbol": sym, "latest": {}, "history": [], "source": "unavailable"}

    return await loop.run_in_executor(_YF_EXECUTOR, _fetch_yf)


async def fetch_corporate_actions(symbol: str) -> Dict:
    """
    Dividends, splits, bonuses, buy-backs.
    NSE API + yfinance history.
    """
    sym = symbol.upper()
    from data.nse_data import _nse_session, _YF_EXECUTOR
    loop = asyncio.get_event_loop()

    # NSE corporate actions
    nse_actions = []
    try:
        data = await _nse_session.get(
            f"corporates-corporateActions?index=equities&symbol={sym}"
        )
        if data and isinstance(data, list):
            for item in data[:50]:
                nse_actions.append({
                    "symbol": item.get("symbol", sym),
                    "purpose": item.get("purpose", ""),
                    "ex_date": item.get("exDate", ""),
                    "record_date": item.get("recDate", ""),
                    "bc_start": item.get("bcStartDate", ""),
                    "bc_end": item.get("bcEndDate", ""),
                    "nd_start": item.get("ndStartDate", ""),
                    "nd_end": item.get("ndEndDate", ""),
                    "payment_date": item.get("paymentDate", ""),
                    "series": item.get("series", "EQ"),
                })
    except Exception as e:
        logger.debug("NSE corp actions %s: %s", sym, e)

    # yfinance dividends + splits
    def _fetch_yf():
        try:
            tk = yf.Ticker(_yf_sym(sym))
            divs = tk.dividends
            splits = tk.splits

            div_list = []
            if divs is not None and not divs.empty:
                for date, amount in divs[-20:].items():
                    div_list.append({
                        "date": str(date)[:10],
                        "amount": round(float(amount), 4),
                        "type": "Dividend",
                    })

            split_list = []
            if splits is not None and not splits.empty:
                for date, ratio in splits.items():
                    split_list.append({
                        "date": str(date)[:10],
                        "ratio": f"{ratio:.0f}:1",
                        "type": "Split",
                    })

            return div_list, split_list
        except Exception as e:
            logger.debug("yf corp actions %s: %s", sym, e)
            return [], []

    from data.nse_data import _YF_EXECUTOR
    div_list, split_list = await loop.run_in_executor(_YF_EXECUTOR, _fetch_yf)

    return {
        "symbol": sym,
        "nse_actions": nse_actions,
        "dividends": div_list,
        "splits": split_list,
        "updated_at": datetime.now().isoformat(),
    }


async def fetch_peers(symbol: str) -> Dict:
    """
    Bloomberg RV equivalent — peer comparison with valuation multiples.
    Finds sector peers and fetches key metrics via yfinance.
    """
    sym = symbol.upper()
    from data.nse_data import _YF_EXECUTOR
    loop = asyncio.get_event_loop()

    # First get this company's sector
    def _get_info(s: str):
        try:
            tk = yf.Ticker(_yf_sym(s))
            info = tk.info or {}
            return {
                "symbol": s,
                "name": info.get("shortName") or info.get("longName") or s,
                "sector": info.get("sector", ""),
                "industry": info.get("industry", ""),
                "market_cap": info.get("marketCap"),
                "pe_ratio": info.get("trailingPE"),
                "forward_pe": info.get("forwardPE"),
                "pb_ratio": info.get("priceToBook"),
                "ps_ratio": info.get("priceToSalesTrailing12Months"),
                "ev_ebitda": info.get("enterpriseToEbitda"),
                "roe": info.get("returnOnEquity"),
                "roa": info.get("returnOnAssets"),
                "profit_margins": info.get("profitMargins"),
                "revenue_growth": info.get("revenueGrowth"),
                "debt_to_equity": info.get("debtToEquity"),
                "dividend_yield": info.get("dividendYield"),
                "beta": info.get("beta"),
                "price": info.get("currentPrice") or info.get("regularMarketPrice"),
                "52w_high": info.get("fiftyTwoWeekHigh"),
                "52w_low": info.get("fiftyTwoWeekLow"),
                "avg_volume": info.get("averageVolume"),
            }
        except Exception:
            return {"symbol": s, "name": s}

    # Get target company info
    target = await loop.run_in_executor(_YF_EXECUTOR, lambda: _get_info(sym))
    sector = target.get("sector", "")

    # Find peers from sector map
    peer_syms = []
    for sec_name, peers in SECTOR_PEERS.items():
        if sym in peers or (sector and sec_name.lower() in sector.lower()):
            peer_syms = [p for p in peers if p != sym][:9]
            break

    if not peer_syms:
        # Default to Nifty 50 top companies as fallback
        from data.nse_data import NIFTY_50
        peer_syms = [p for p in NIFTY_50 if p != sym][:9]

    # Fetch peer data concurrently
    peer_tasks = [
        loop.run_in_executor(_YF_EXECUTOR, lambda s=p: _get_info(s))
        for p in peer_syms
    ]
    peers_data = await asyncio.gather(*peer_tasks, return_exceptions=True)
    peers_list = [p for p in peers_data if isinstance(p, dict)]

    # Compute sector medians for comparison
    all_data = [target] + peers_list
    def _median(key: str):
        vals = [d.get(key) for d in all_data if d.get(key) is not None]
        if not vals:
            return None
        return round(float(np.median(vals)), 2)

    sector_medians = {
        "pe_ratio": _median("pe_ratio"),
        "pb_ratio": _median("pb_ratio"),
        "ev_ebitda": _median("ev_ebitda"),
        "roe": _median("roe"),
        "profit_margins": _median("profit_margins"),
        "revenue_growth": _median("revenue_growth"),
        "debt_to_equity": _median("debt_to_equity"),
        "dividend_yield": _median("dividend_yield"),
    }

    return {
        "symbol": sym,
        "target": target,
        "peers": peers_list,
        "sector_medians": sector_medians,
        "updated_at": datetime.now().isoformat(),
    }


async def fetch_dcf(symbol: str, wacc: float = 0.12, terminal_growth: float = 0.04,
                    years: int = 10, revenue_growth: Optional[float] = None,
                    margin: Optional[float] = None) -> Dict:
    """
    DCF (Discounted Cash Flow) valuation model.
    Uses last reported free cash flow and applies growth assumptions.
    Returns intrinsic value per share and margin of safety.
    """
    sym = symbol.upper()
    from data.nse_data import _YF_EXECUTOR
    loop = asyncio.get_event_loop()

    def _fetch():
        try:
            tk = yf.Ticker(_yf_sym(sym))
            info = tk.info or {}
            cf = tk.cashflow

            # Base FCF
            free_cf = info.get("freeCashflow")
            if free_cf is None and cf is not None and not cf.empty:
                try:
                    ocf_row = cf.loc["Operating Cash Flow"] if "Operating Cash Flow" in cf.index else None
                    capex_row = cf.loc["Capital Expenditure"] if "Capital Expenditure" in cf.index else None
                    if ocf_row is not None and capex_row is not None:
                        ocf = float(ocf_row.iloc[0])
                        capex = float(capex_row.iloc[0])
                        free_cf = ocf + capex  # capex is usually negative
                except Exception:
                    free_cf = None

            if free_cf is None:
                # Estimate from net income + D&A
                net_income = info.get("netIncomeToCommon", 0) or 0
                ebitda = info.get("ebitda", 0) or 0
                revenue = info.get("totalRevenue", 0) or 0
                # Assume 10% FCF margin on revenue as last resort
                free_cf = revenue * 0.10 if revenue else net_income

            if free_cf is None or free_cf == 0:
                return {"error": "Insufficient cash flow data", "symbol": sym}

            shares = info.get("sharesOutstanding") or info.get("impliedSharesOutstanding", 0)
            current_price = info.get("currentPrice") or info.get("regularMarketPrice", 0)
            revenue = info.get("totalRevenue") or 0
            net_income = info.get("netIncomeToCommon") or 0

            # Use provided growth rate or estimate from historical
            g = revenue_growth
            if g is None:
                g = info.get("revenueGrowth") or 0.10
                g = max(min(g, 0.30), -0.05)  # cap 30% / floor -5%

            # FCF margin
            fcf_margin = margin
            if fcf_margin is None:
                fcf_margin = free_cf / revenue if revenue > 0 else 0.10

            # Project FCF for N years
            projected_fcf = []
            fcf = float(free_cf)
            for year in range(1, years + 1):
                # Declining growth: full growth first 5 years, half for 6-10
                yr_g = g if year <= 5 else g * 0.5
                fcf = fcf * (1 + yr_g)
                discount_factor = 1 / ((1 + wacc) ** year)
                pv = fcf * discount_factor
                projected_fcf.append({
                    "year": year,
                    "fcf": round(fcf / 1e7, 2),  # in crores
                    "growth_rate": round(yr_g * 100, 1),
                    "discount_factor": round(discount_factor, 4),
                    "pv_fcf": round(pv / 1e7, 2),
                })

            # Terminal value
            terminal_fcf = fcf * (1 + terminal_growth)
            terminal_value = terminal_fcf / (wacc - terminal_growth)
            terminal_pv = terminal_value / ((1 + wacc) ** years)

            # Sum of PVs
            sum_pv = sum(r["pv_fcf"] * 1e7 for r in projected_fcf) + terminal_pv

            # Intrinsic value per share
            intrinsic_per_share = (sum_pv / shares) if shares else 0
            margin_of_safety = ((intrinsic_per_share - current_price) / intrinsic_per_share * 100) if intrinsic_per_share else 0

            # Sensitivity: vary WACC and terminal growth
            sensitivity = []
            for w in [wacc - 0.02, wacc, wacc + 0.02]:
                row = []
                for tg in [terminal_growth - 0.01, terminal_growth, terminal_growth + 0.01]:
                    if w <= tg:
                        row.append(None)
                        continue
                    tv = fcf * (1 + tg) / (w - tg)
                    tv_pv = tv / ((1 + w) ** years)
                    s_pv = sum(
                        float(free_cf) * (1 + (g if yr <= 5 else g * 0.5)) ** yr / ((1 + w) ** yr)
                        for yr in range(1, years + 1)
                    )
                    val = (s_pv + tv_pv) / shares if shares else 0
                    row.append(round(val, 2))
                sensitivity.append({"wacc": round(w * 100, 1), "values": row})

            return {
                "symbol": sym,
                "assumptions": {
                    "wacc": round(wacc * 100, 1),
                    "terminal_growth": round(terminal_growth * 100, 1),
                    "revenue_growth": round(g * 100, 1),
                    "fcf_margin": round(fcf_margin * 100, 1),
                    "years": years,
                },
                "base_fcf_cr": round(float(free_cf) / 1e7, 2),
                "projected_fcf": projected_fcf,
                "terminal_value_cr": round(terminal_value / 1e7, 2),
                "terminal_pv_cr": round(terminal_pv / 1e7, 2),
                "sum_pv_cr": round(sum_pv / 1e7, 2),
                "intrinsic_value": round(intrinsic_per_share, 2),
                "current_price": round(float(current_price), 2),
                "margin_of_safety_pct": round(margin_of_safety, 1),
                "upside_pct": round(margin_of_safety, 1),
                "verdict": "UNDERVALUED" if margin_of_safety > 15 else ("OVERVALUED" if margin_of_safety < -15 else "FAIR VALUE"),
                "sensitivity_labels": {
                    "wacc_range": [f"{(wacc - 0.02)*100:.0f}%", f"{wacc*100:.0f}%", f"{(wacc + 0.02)*100:.0f}%"],
                    "tg_range": [f"{(terminal_growth - 0.01)*100:.0f}%", f"{terminal_growth*100:.0f}%", f"{(terminal_growth + 0.01)*100:.0f}%"],
                },
                "sensitivity": sensitivity,
                "shares_outstanding": shares,
                "revenue_cr": round(revenue / 1e7, 2) if revenue else None,
                "net_income_cr": round(net_income / 1e7, 2) if net_income else None,
                "updated_at": datetime.now().isoformat(),
            }
        except Exception as e:
            logger.error("DCF %s: %s", sym, e)
            return {"error": str(e), "symbol": sym}

    return await loop.run_in_executor(_YF_EXECUTOR, _fetch)


async def fetch_yield_curve() -> Dict:
    """
    US Treasury yield curve + India 10Y bond yield.
    Uses yfinance for Treasury yields.
    """
    from data.nse_data import _YF_EXECUTOR
    loop = asyncio.get_event_loop()

    YIELD_TICKERS = {
        "US 3M": "^IRX",
        "US 6M": "^FVX",   # closest proxy; actual 6M not available
        "US 2Y": "2YY=F",
        "US 5Y": "^FVX",
        "US 10Y": "^TNX",
        "US 30Y": "^TYX",
        "India 10Y": "IN10YT=RR",
        "India 91D": "INPTBILL.NS",
    }

    # Simpler reliable set
    RELIABLE_TICKERS = {
        "US 3M": "^IRX",
        "US 5Y": "^FVX",
        "US 10Y": "^TNX",
        "US 30Y": "^TYX",
    }

    def _fetch():
        results = {}
        history = {}
        tickers_str = " ".join(RELIABLE_TICKERS.values())
        try:
            import yfinance as yf
            data = yf.download(tickers_str, period="1y", interval="1d",
                               auto_adjust=True, progress=False)
            if data is not None and not data.empty:
                close_data = data["Close"] if "Close" in data.columns else data
                for label, ticker in RELIABLE_TICKERS.items():
                    try:
                        if ticker in close_data.columns:
                            series = close_data[ticker].dropna()
                            current = float(series.iloc[-1])
                            one_year_ago = float(series.iloc[0]) if len(series) > 0 else current
                            six_months_ago = float(series.iloc[-130]) if len(series) > 130 else float(series.iloc[0])
                            one_month_ago = float(series.iloc[-22]) if len(series) > 22 else current
                            one_week_ago = float(series.iloc[-5]) if len(series) > 5 else current
                            results[label] = {
                                "current": round(current, 3),
                                "1w_change": round(current - one_week_ago, 3),
                                "1m_change": round(current - one_month_ago, 3),
                                "6m_change": round(current - six_months_ago, 3),
                                "1y_change": round(current - one_year_ago, 3),
                                "1y_high": round(float(series.max()), 3),
                                "1y_low": round(float(series.min()), 3),
                            }
                            # Historical for chart (last 90 days)
                            hist_series = series.tail(90)
                            history[label] = [
                                {"date": str(idx)[:10], "yield": round(float(val), 3)}
                                for idx, val in hist_series.items()
                                if not math.isnan(float(val))
                            ]
                    except Exception as e:
                        logger.debug("yield %s: %s", label, e)
        except Exception as e:
            logger.warning("yield curve fetch error: %s", e)

        # Compute spread (10Y - 2Y) — inversion indicator
        y10 = results.get("US 10Y", {}).get("current")
        y3m = results.get("US 3M", {}).get("current")
        spread_10_2 = round(y10 - y3m, 3) if y10 and y3m else None
        inverted = spread_10_2 is not None and spread_10_2 < 0

        return {
            "yields": results,
            "history": history,
            "spread_10y_3m": spread_10_2,
            "inverted": inverted,
            "inversion_signal": "RECESSION RISK" if inverted else "NORMAL",
            "updated_at": datetime.now().isoformat(),
        }

    return await loop.run_in_executor(_YF_EXECUTOR, _fetch)


async def fetch_delivery_volume(symbol: str, days: int = 30) -> Dict:
    """
    NSE delivery volume data — shows institutional conviction.
    High delivery % = strong conviction (not just intraday).
    """
    sym = symbol.upper()
    from data.nse_data import _nse_session
    from datetime import datetime, timedelta

    to_date = datetime.now().strftime("%d-%m-%Y")
    from_date = (datetime.now() - timedelta(days=days + 10)).strftime("%d-%m-%Y")

    try:
        data = await _nse_session.get(
            f"historical/cm/equity?symbol={sym}&series=[%22EQ%22]"
            f"&from={from_date}&to={to_date}"
        )
        if data and isinstance(data, dict) and "data" in data:
            rows = data["data"]
            result = []
            for r in rows[-days:]:
                try:
                    volume = int(r.get("CH_TOT_TRADED_QTY", 0) or 0)
                    delivery = int(r.get("COP_DELIV_QTY", 0) or 0)
                    delivery_pct = (delivery / volume * 100) if volume > 0 else 0
                    result.append({
                        "date": r.get("CH_TIMESTAMP", "")[:10],
                        "volume": volume,
                        "delivery": delivery,
                        "delivery_pct": round(delivery_pct, 2),
                        "close": float(r.get("CH_CLOSING_PRICE", 0) or 0),
                        "change_pct": float(r.get("CH_PRCNT_CHANGE_OPEN_TO_CLOSE", 0) or 0),
                    })
                except Exception:
                    continue
            # Compute averages
            avg_delivery_pct = sum(r["delivery_pct"] for r in result) / len(result) if result else 0
            avg_volume = int(sum(r["volume"] for r in result) / len(result)) if result else 0
            latest = result[-1] if result else {}

            return {
                "symbol": sym,
                "data": result,
                "avg_delivery_pct": round(avg_delivery_pct, 2),
                "avg_volume": avg_volume,
                "latest_delivery_pct": latest.get("delivery_pct"),
                "signal": (
                    "HIGH CONVICTION" if avg_delivery_pct > 60 else
                    "MODERATE" if avg_delivery_pct > 40 else
                    "SPECULATIVE"
                ),
                "updated_at": datetime.now().isoformat(),
            }
    except Exception as e:
        logger.warning("delivery_volume %s: %s", sym, e)

    return {
        "symbol": sym,
        "data": [],
        "avg_delivery_pct": None,
        "signal": "DATA UNAVAILABLE",
        "updated_at": datetime.now().isoformat(),
    }


async def fetch_economic_indicators() -> Dict:
    """
    Scrape key economic indicators from public sources.
    India: CPI, WPI, GDP, Repo Rate, IIP
    Global: Fed Funds, ECB Rate, US CPI, US GDP
    """
    from data.nse_data import _YF_EXECUTOR
    loop = asyncio.get_event_loop()

    def _fetch():
        indicators = []
        # Use yfinance to get macro proxies
        macro_tickers = {
            "Nifty 50": "^NSEI",
            "Sensex": "^BSESN",
            "India VIX": "^INDIAVIX",
            "Gold": "GC=F",
            "Crude Oil": "CL=F",
            "USD/INR": "USDINR=X",
            "EUR/USD": "EURUSD=X",
            "US 10Y Yield": "^TNX",
            "VIX (US)": "^VIX",
            "Dollar Index": "DX-Y.NYB",
        }
        try:
            import yfinance as yf
            for name, ticker in macro_tickers.items():
                try:
                    tk = yf.Ticker(ticker)
                    info = tk.fast_info
                    price = getattr(info, "last_price", None)
                    prev = getattr(info, "previous_close", None)
                    if price:
                        chg_pct = ((price - prev) / prev * 100) if prev else 0
                        indicators.append({
                            "name": name,
                            "ticker": ticker,
                            "value": round(float(price), 4),
                            "change_pct": round(float(chg_pct), 2),
                        })
                except Exception:
                    pass
        except Exception as e:
            logger.warning("macro_fetch error: %s", e)

        return {"indicators": indicators, "updated_at": datetime.now().isoformat()}

    return await loop.run_in_executor(_YF_EXECUTOR, _fetch)


async def fetch_analyst_estimates(symbol: str) -> Dict:
    """
    Analyst consensus estimates — Bloomberg BEST/EE equivalent.
    Returns: recommendation distribution, EPS/revenue estimates, quarterly history,
    price target range, and upgrade/downgrade history.
    """
    sym = symbol.upper()
    from data.nse_data import _YF_EXECUTOR
    loop = asyncio.get_event_loop()

    def _fetch():
        try:
            tk = yf.Ticker(_yf_sym(sym))
            info = tk.info or {}

            # Recommendation counts
            reco_dict = {}
            for key in ("strongBuy", "buy", "hold", "sell", "strongSell"):
                reco_dict[key] = info.get(key, 0) or 0

            # EPS estimates
            eps_estimates = []
            revenue_estimates = []
            try:
                ee = tk.earnings_estimate
                if ee is not None and not ee.empty:
                    for period, row in ee.iterrows():
                        eps_estimates.append({
                            "period": str(period),
                            "avg": float(row["avg"]) if row.get("avg") is not None else None,
                            "low": float(row["low"]) if row.get("low") is not None else None,
                            "high": float(row["high"]) if row.get("high") is not None else None,
                            "count": int(row["numberOfAnalysts"]) if row.get("numberOfAnalysts") is not None else None,
                            "growth": float(row["growth"]) * 100 if row.get("growth") is not None else None,
                        })
            except Exception:
                pass

            try:
                re = tk.revenue_estimate
                if re is not None and not re.empty:
                    for period, row in re.iterrows():
                        revenue_estimates.append({
                            "period": str(period),
                            "avg": float(row["avg"]) if row.get("avg") is not None else None,
                            "low": float(row["low"]) if row.get("low") is not None else None,
                            "high": float(row["high"]) if row.get("high") is not None else None,
                            "count": int(row["numberOfAnalysts"]) if row.get("numberOfAnalysts") is not None else None,
                            "growth": float(row["growth"]) * 100 if row.get("growth") is not None else None,
                        })
            except Exception:
                pass

            # Quarterly EPS history
            quarterly_earnings = []
            try:
                eh = tk.earnings_history
                if eh is not None and not eh.empty:
                    for _, row in eh.tail(8).iterrows():
                        quarterly_earnings.append({
                            "quarter": str(row.get("period", "")),
                            "actual": float(row["epsActual"]) if row.get("epsActual") is not None else None,
                            "estimate": float(row["epsEstimate"]) if row.get("epsEstimate") is not None else None,
                        })
            except Exception:
                try:
                    qe = tk.quarterly_earnings
                    if qe is not None and not qe.empty:
                        for quarter, row in qe.tail(8).iterrows():
                            quarterly_earnings.append({
                                "quarter": str(quarter),
                                "actual": float(row.iloc[1]) if len(row) > 1 else None,
                                "estimate": None,
                            })
                except Exception:
                    pass

            # Upgrade/downgrade history
            upgrade_hist = []
            try:
                uh = tk.upgrades_downgrades
                if uh is not None and not uh.empty:
                    for ts, row in uh.head(20).iterrows():
                        upgrade_hist.append({
                            "date": str(ts)[:10],
                            "firm": row.get("Firm", ""),
                            "to_grade": row.get("ToGrade", ""),
                            "from_grade": row.get("FromGrade", ""),
                            "action": row.get("Action", ""),
                        })
            except Exception:
                pass

            return {
                "symbol": sym,
                "info": {
                    "recommendation": info.get("recommendationKey", ""),
                    "current_price": info.get("currentPrice") or info.get("regularMarketPrice"),
                    "target_mean_price": info.get("targetMeanPrice"),
                    "target_high_price": info.get("targetHighPrice"),
                    "target_low_price": info.get("targetLowPrice"),
                    "target_median_price": info.get("targetMedianPrice"),
                    "number_of_analyst_opinions": info.get("numberOfAnalystOpinions"),
                },
                "recommendations": reco_dict,
                "eps_estimates": eps_estimates,
                "revenue_estimates": revenue_estimates,
                "quarterly_earnings": quarterly_earnings,
                "history": upgrade_hist,
                "updated_at": datetime.now().isoformat(),
            }
        except Exception as e:
            logger.error("analyst_estimates %s: %s", sym, e)
            return {"symbol": sym, "error": str(e), "updated_at": datetime.now().isoformat()}

    return await loop.run_in_executor(_YF_EXECUTOR, _fetch)
