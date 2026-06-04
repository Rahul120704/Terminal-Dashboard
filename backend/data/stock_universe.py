"""
Stock Universe — All NSE + BSE listed securities.
Loads full equity list from NSE archives on startup.
Provides fast fuzzy search for autocomplete.
"""

import asyncio
import aiohttp
import logging
import csv
import io
from typing import List, Dict, Optional
from pathlib import Path

logger = logging.getLogger(__name__)

CACHE_FILE = Path(__file__).parent.parent / "data_store" / "stock_list.json"

# Full NSE equity list endpoint (CSV, no auth needed)
NSE_EQUITY_LIST_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"

# Will be populated on startup
_universe: List[Dict] = []
_symbol_index: Dict[str, Dict] = {}


# ── Comprehensive static list (fallback + seed) ──────────────────────────────
# All Nifty 500 + midcap + smallcap + sector indices + popular BSE stocks
STATIC_UNIVERSE = [
    # NIFTY 50
    ("RELIANCE","Reliance Industries Ltd","Energy","NSE"),("TCS","Tata Consultancy Services","IT","NSE"),
    ("HDFCBANK","HDFC Bank Ltd","Banking","NSE"),("INFY","Infosys Ltd","IT","NSE"),
    ("ICICIBANK","ICICI Bank Ltd","Banking","NSE"),("HINDUNILVR","Hindustan Unilever Ltd","FMCG","NSE"),
    ("ITC","ITC Ltd","FMCG","NSE"),("SBIN","State Bank of India","Banking","NSE"),
    ("BHARTIARTL","Bharti Airtel Ltd","Telecom","NSE"),("KOTAKBANK","Kotak Mahindra Bank","Banking","NSE"),
    ("LT","Larsen & Toubro Ltd","Infra","NSE"),("AXISBANK","Axis Bank Ltd","Banking","NSE"),
    ("ASIANPAINT","Asian Paints Ltd","Consumer","NSE"),("MARUTI","Maruti Suzuki India","Auto","NSE"),
    ("NTPC","NTPC Ltd","Power","NSE"),("SUNPHARMA","Sun Pharmaceutical Industries","Pharma","NSE"),
    ("WIPRO","Wipro Ltd","IT","NSE"),("ULTRACEMCO","UltraTech Cement Ltd","Cement","NSE"),
    ("BAJFINANCE","Bajaj Finance Ltd","NBFC","NSE"),("TECHM","Tech Mahindra Ltd","IT","NSE"),
    ("HCLTECH","HCL Technologies Ltd","IT","NSE"),("TITAN","Titan Company Ltd","Consumer","NSE"),
    ("POWERGRID","Power Grid Corporation","Power","NSE"),("ONGC","Oil & Natural Gas Corporation","Energy","NSE"),
    ("NESTLEIND","Nestle India Ltd","FMCG","NSE"),("TATAMOTORS","Tata Motors Ltd","Auto","NSE"),
    ("JSWSTEEL","JSW Steel Ltd","Metals","NSE"),("TATASTEEL","Tata Steel Ltd","Metals","NSE"),
    ("ADANIENT","Adani Enterprises Ltd","Conglomerate","NSE"),("M&M","Mahindra & Mahindra Ltd","Auto","NSE"),
    ("BAJAJFINSV","Bajaj Finserv Ltd","Finance","NSE"),("COALINDIA","Coal India Ltd","Mining","NSE"),
    ("ADANIPORTS","Adani Ports & SEZ","Logistics","NSE"),("DIVISLAB","Divi's Laboratories","Pharma","NSE"),
    ("CIPLA","Cipla Ltd","Pharma","NSE"),("BPCL","Bharat Petroleum Corporation","Energy","NSE"),
    ("DRREDDY","Dr. Reddy's Laboratories","Pharma","NSE"),("HINDALCO","Hindalco Industries Ltd","Metals","NSE"),
    ("GRASIM","Grasim Industries Ltd","Diversified","NSE"),("BRITANNIA","Britannia Industries Ltd","FMCG","NSE"),
    ("HDFCLIFE","HDFC Life Insurance","Insurance","NSE"),("SBILIFE","SBI Life Insurance","Insurance","NSE"),
    ("EICHERMOT","Eicher Motors Ltd","Auto","NSE"),("APOLLOHOSP","Apollo Hospitals Enterprise","Healthcare","NSE"),
    ("INDUSINDBK","IndusInd Bank Ltd","Banking","NSE"),("BAJAJ-AUTO","Bajaj Auto Ltd","Auto","NSE"),
    ("HEROMOTOCO","Hero MotoCorp Ltd","Auto","NSE"),("TATACONSUM","Tata Consumer Products","FMCG","NSE"),
    ("UPL","UPL Ltd","Agrochemicals","NSE"),("LTIM","LTIMindtree Ltd","IT","NSE"),
    # NIFTY NEXT 50 + other popular
    ("PIDILITIND","Pidilite Industries Ltd","Chemicals","NSE"),("SIEMENS","Siemens Ltd","Industrials","NSE"),
    ("ABB","ABB India Ltd","Industrials","NSE"),("GODREJCP","Godrej Consumer Products","FMCG","NSE"),
    ("MARICO","Marico Ltd","FMCG","NSE"),("DABUR","Dabur India Ltd","FMCG","NSE"),
    ("COLPAL","Colgate-Palmolive (India)","FMCG","NSE"),("BERGEPAINT","Berger Paints India","Consumer","NSE"),
    ("HAVELLS","Havells India Ltd","Consumer","NSE"),("INDUSTOWER","Indus Towers Ltd","Telecom","NSE"),
    ("VEDL","Vedanta Ltd","Metals","NSE"),("GAIL","GAIL (India) Ltd","Energy","NSE"),
    ("IOC","Indian Oil Corporation","Energy","NSE"),("NMDC","NMDC Ltd","Mining","NSE"),
    ("OFSS","Oracle Financial Services Software","IT","NSE"),("MPHASIS","Mphasis Ltd","IT","NSE"),
    ("PERSISTENT","Persistent Systems Ltd","IT","NSE"),("LTTS","L&T Technology Services","IT","NSE"),
    ("COFORGE","Coforge Ltd","IT","NSE"),("BIOCON","Biocon Ltd","Pharma","NSE"),
    ("TORNTPHARM","Torrent Pharmaceuticals","Pharma","NSE"),("ALKEM","Alkem Laboratories","Pharma","NSE"),
    ("AUROPHARMA","Aurobindo Pharma Ltd","Pharma","NSE"),("TATAPOWER","Tata Power Company","Power","NSE"),
    ("NHPC","NHPC Ltd","Power","NSE"),("RECLTD","REC Ltd","Finance","NSE"),
    ("PFC","Power Finance Corporation","Finance","NSE"),("IRCTC","Indian Railway Catering & Tourism","Services","NSE"),
    ("INDIGO","InterGlobe Aviation Ltd","Aviation","NSE"),("JUBLFOOD","Jubilant FoodWorks","Retail","NSE"),
    ("NYKAA","FSN E-Commerce Ventures (Nykaa)","Retail","NSE"),("ZOMATO","Zomato Ltd","Consumer Tech","NSE"),
    ("PNB","Punjab National Bank","Banking","NSE"),("BANDHANBNK","Bandhan Bank Ltd","Banking","NSE"),
    ("FEDERALBNK","Federal Bank Ltd","Banking","NSE"),("IDFCFIRSTB","IDFC First Bank Ltd","Banking","NSE"),
    ("CHOLAFIN","Cholamandalam Investment","NBFC","NSE"),("MUTHOOTFIN","Muthoot Finance Ltd","NBFC","NSE"),
    ("SHRIRAMFIN","Shriram Finance Ltd","NBFC","NSE"),("MANAPPURAM","Manappuram Finance Ltd","NBFC","NSE"),
    ("LICHSGFIN","LIC Housing Finance Ltd","NBFC","NSE"),("DLF","DLF Ltd","Real Estate","NSE"),
    ("GODREJPROP","Godrej Properties Ltd","Real Estate","NSE"),("PRESTIGE","Prestige Estates Projects","Real Estate","NSE"),
    ("OBEROIRLTY","Oberoi Realty Ltd","Real Estate","NSE"),
    # Midcap / Smallcap stars
    ("POLYCAB","Polycab India Ltd","Industrials","NSE"),("ASTRAL","Astral Ltd","Industrials","NSE"),
    ("SUPREMEIND","Supreme Industries Ltd","Industrials","NSE"),("KEI","KEI Industries Ltd","Industrials","NSE"),
    ("HFCL","HFCL Ltd","Telecom","NSE"),("RAILTEL","RailTel Corporation","Telecom","NSE"),
    ("IRFC","Indian Railway Finance Corporation","Finance","NSE"),("RVNL","Rail Vikas Nigam Ltd","Infra","NSE"),
    ("HSCL","Himadri Speciality Chemical","Chemicals","NSE"),("DEEPAKNTR","Deepak Nitrite Ltd","Chemicals","NSE"),
    ("TATACHEM","Tata Chemicals Ltd","Chemicals","NSE"),("SRF","SRF Ltd","Chemicals","NSE"),
    ("NAVINFLUOR","Navin Fluorine International","Chemicals","NSE"),("CLEAN","Clean Science and Technology","Chemicals","NSE"),
    ("FLUOROCHEM","Gujarat Fluorochemicals","Chemicals","NSE"),("PIIND","PI Industries Ltd","Agrochemicals","NSE"),
    ("SUMICHEM","Sumitomo Chemical India","Agrochemicals","NSE"),("BAYERCROP","Bayer CropScience Ltd","Agrochemicals","NSE"),
    ("CASTROLIND","Castrol India Ltd","Energy","NSE"),("GULFOILLUB","Gulf Oil Lubricants India","Energy","NSE"),
    ("CESC","CESC Ltd","Power","NSE"),("TORNTPOWER","Torrent Power Ltd","Power","NSE"),
    ("ADANIGREEN","Adani Green Energy Ltd","Renewable","NSE"),("ADANITRANS","Adani Transmission Ltd","Power","NSE"),
    ("SJVN","SJVN Ltd","Power","NSE"),("INOXWIND","Inox Wind Ltd","Renewable","NSE"),
    ("SUZLON","Suzlon Energy Ltd","Renewable","NSE"),("GREENPANEL","Greenpanel Industries","Consumer","NSE"),
    ("CENTURYPLY","Century Plyboards","Consumer","NSE"),("NILKAMAL","Nilkamal Ltd","Consumer","NSE"),
    ("VGUARD","V-Guard Industries","Consumer","NSE"),("BAJAJELEC","Bajaj Electricals Ltd","Consumer","NSE"),
    ("CROMPTON","Crompton Greaves Consumer Electricals","Consumer","NSE"),
    ("VOLTAS","Voltas Ltd","Consumer","NSE"),("BLUESTARCO","Blue Star Ltd","Consumer","NSE"),
    ("WHIRLPOOL","Whirlpool of India Ltd","Consumer","NSE"),("AMBER","Amber Enterprises India","Consumer","NSE"),
    ("DIXON","Dixon Technologies","Electronics","NSE"),("KAYNES","Kaynes Technology India","Electronics","NSE"),
    ("SYRMA","Syrma SGS Technology","Electronics","NSE"),("IDEAFORGE","ideaForge Technology","Electronics","NSE"),
    ("TANLA","Tanla Platforms Ltd","IT","NSE"),("MASTECH","Mastech Digital","IT","NSE"),
    ("HAPPSTMNDS","Happiest Minds Technologies","IT","NSE"),("BIRLASOFT","Birlasoft Ltd","IT","NSE"),
    ("INTELLECT","Intellect Design Arena","IT","NSE"),("NEWGEN","Newgen Software Technologies","IT","NSE"),
    ("KPITTECH","KPIT Technologies Ltd","IT","NSE"),("CYIENT","Cyient Ltd","IT","NSE"),
    ("ZENSAR","Zensar Technologies Ltd","IT","NSE"),("NIIT","NIIT Technologies","IT","NSE"),
    ("ROUTE","Route Mobile Ltd","IT","NSE"),("TATAELXSI","Tata Elxsi Ltd","IT","NSE"),
    ("CGPOWER","CG Power and Industrial Solutions","Industrials","NSE"),("CUMMINSIND","Cummins India Ltd","Industrials","NSE"),
    ("BHEL","Bharat Heavy Electricals Ltd","Industrials","NSE"),("BEL","Bharat Electronics Ltd","Defence","NSE"),
    ("HAL","Hindustan Aeronautics Ltd","Defence","NSE"),("COCHINSHIP","Cochin Shipyard Ltd","Defence","NSE"),
    ("MAZAGON","Mazagon Dock Shipbuilders","Defence","NSE"),("GRSE","Garden Reach Shipbuilders & Engineers","Defence","NSE"),
    ("BEML","BEML Ltd","Defence","NSE"),("MTAR","MTAR Technologies Ltd","Defence","NSE"),
    ("DELHIVERY","Delhivery Ltd","Logistics","NSE"),("BLUEDART","Blue Dart Express Ltd","Logistics","NSE"),
    ("CONCOR","Container Corporation of India","Logistics","NSE"),("ALLCARGO","Allcargo Logistics","Logistics","NSE"),
    ("GICRE","General Insurance Corporation","Insurance","NSE"),("NIACL","New India Assurance","Insurance","NSE"),
    ("STARHEALTH","Star Health and Allied Insurance","Insurance","NSE"),("ICICIPRULI","ICICI Prudential Life Insurance","Insurance","NSE"),
    ("MAXHEALTH","Max Healthcare Institute","Healthcare","NSE"),("FORTIS","Fortis Healthcare Ltd","Healthcare","NSE"),
    ("NH","Narayana Hrudayalaya Ltd","Healthcare","NSE"),("METROPOLIS","Metropolis Healthcare Ltd","Healthcare","NSE"),
    ("DRREDDY","Dr Reddy's Laboratories","Pharma","NSE"),("LUPIN","Lupin Ltd","Pharma","NSE"),
    ("CADILAHC","Cadila Healthcare Ltd","Pharma","NSE"),("ABBOTINDIA","Abbott India Ltd","Pharma","NSE"),
    ("PFIZER","Pfizer Ltd","Pharma","NSE"),("GLAXO","GlaxoSmithKline Pharmaceuticals","Pharma","NSE"),
    ("SANOFI","Sanofi India Ltd","Pharma","NSE"),("ERIS","Eris Lifesciences Ltd","Pharma","NSE"),
    ("NATPHARMA","Natco Pharma Ltd","Pharma","NSE"),("GRANULES","Granules India Ltd","Pharma","NSE"),
    ("LALPATHLAB","Dr Lal PathLabs Ltd","Diagnostics","NSE"),("THYROCARE","Thyrocare Technologies","Diagnostics","NSE"),
    ("KRSNAA","Krsnaa Diagnostics Ltd","Diagnostics","NSE"),("VIJAYA","Vijaya Diagnostic Centre","Diagnostics","NSE"),
    ("ICICIBANK","ICICI Bank Ltd","Banking","NSE"),("YESBANK","Yes Bank Ltd","Banking","NSE"),
    ("RBLBANK","RBL Bank Ltd","Banking","NSE"),("CANBK","Canara Bank","Banking","NSE"),
    ("BANKBARODA","Bank of Baroda","Banking","NSE"),("UNIONBANK","Union Bank of India","Banking","NSE"),
    ("INDIANB","Indian Bank","Banking","NSE"),("UCOBANK","UCO Bank","Banking","NSE"),
    ("BANKINDIA","Bank of India","Banking","NSE"),("CENTRALBK","Central Bank of India","Banking","NSE"),
    ("EQUITASBNK","Equitas Small Finance Bank","Banking","NSE"),("UJJIVANSFB","Ujjivan Small Finance Bank","Banking","NSE"),
    ("SURYODAY","Suryoday Small Finance Bank","Banking","NSE"),("FINCABLES","Finolex Cables Ltd","Industrials","NSE"),
    ("FINPIPE","Finolex Industries Ltd","Industrials","NSE"),("JYOTHYLAB","Jyothy Labs Ltd","FMCG","NSE"),
    ("EMAMILTD","Emami Ltd","FMCG","NSE"),("VIPIND","VIP Industries Ltd","Consumer","NSE"),
    ("VMART","V-Mart Retail Ltd","Retail","NSE"),("VEDANT","Vedant Fashions Ltd","Retail","NSE"),
    ("TRENT","Trent Ltd","Retail","NSE"),("SHOPERSTOP","Shopper's Stop Ltd","Retail","NSE"),
    ("BATA","Bata India Ltd","Retail","NSE"),("RELAXO","Relaxo Footwears Ltd","Retail","NSE"),
    ("CAMPUS","Campus Activewear Ltd","Retail","NSE"),("METRO","Metro Brands Ltd","Retail","NSE"),
    ("INDIGOPNTS","Indigo Paints Ltd","Consumer","NSE"),("KANSAINER","Kansai Nerolac Paints","Consumer","NSE"),
    ("AKZONOBEL","Akzo Nobel India Ltd","Consumer","NSE"),("JKCEMENT","JK Cement Ltd","Cement","NSE"),
    ("RAMCOCEM","The Ramco Cements Ltd","Cement","NSE"),("HEIDELBERG","HeidelbergCement India","Cement","NSE"),
    ("JKIL","JK Lakshmi Cement Ltd","Cement","NSE"),("SAGAR","Sagar Cements Ltd","Cement","NSE"),
    ("AMBUJACEM","Ambuja Cements Ltd","Cement","NSE"),("ACC","ACC Ltd","Cement","NSE"),
    ("SHREECEM","Shree Cement Ltd","Cement","NSE"),("DALMIA","Dalmia Bharat Ltd","Cement","NSE"),
    ("NUVOCO","Nuvoco Vistas Corporation","Cement","NSE"),
    # New age / tech
    ("PAYTM","One 97 Communications (Paytm)","Fintech","NSE"),("POLICYBZR","PB Fintech (PolicyBazaar)","Fintech","NSE"),
    ("CARTRADE","CarTrade Tech Ltd","Consumer Tech","NSE"),("EASEMYTRIP","Easy Trip Planners","Consumer Tech","NSE"),
    ("IXIGO","Le Travenues Technology (ixigo)","Consumer Tech","NSE"),
    ("MAPMYINDIA","CE Info Systems (MapmyIndia)","Consumer Tech","NSE"),
    ("HAPPYFRG","Happy Forgings Ltd","Industrials","NSE"),
    # Indices for reference
    ("NIFTY","Nifty 50 Index","Index","NSE"),("BANKNIFTY","Nifty Bank Index","Index","NSE"),
    ("SENSEX","BSE Sensex Index","Index","BSE"),("MIDCAPNIFTY","Nifty Midcap 50","Index","NSE"),
]


async def _fetch_nse_equity_list() -> List[Dict]:
    """Fetch full NSE equity list from archives."""
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.nseindia.com/",
        }
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.get(NSE_EQUITY_LIST_URL, timeout=aiohttp.ClientTimeout(total=15)) as r:
                if r.status == 200:
                    text = await r.text()
                    reader = csv.DictReader(io.StringIO(text))
                    results = []
                    for row in reader:
                        sym = row.get("SYMBOL", "").strip()
                        name = row.get("NAME OF COMPANY", "").strip()
                        if sym and name:
                            results.append({
                                "symbol": sym,
                                "name": name,
                                "sector": row.get("SERIES", "EQ"),
                                "exchange": "NSE",
                            })
                    logger.info("NSE equity list loaded: %d symbols", len(results))
                    return results
    except Exception as e:
        logger.warning("NSE equity list fetch failed: %s", e)
    return []


def _build_index(stocks: List[Dict]):
    global _symbol_index
    _symbol_index = {s["symbol"].upper(): s for s in stocks}


async def init_universe():
    """Load full stock universe. Call once at startup."""
    global _universe

    # Seed with static list first
    seen = set()
    for sym, name, sector, exchange in STATIC_UNIVERSE:
        if sym not in seen:
            _universe.append({"symbol": sym, "name": name, "sector": sector, "exchange": exchange})
            seen.add(sym)

    # Try fetching full NSE list
    nse_stocks = await _fetch_nse_equity_list()
    for s in nse_stocks:
        if s["symbol"] not in seen:
            _universe.append(s)
            seen.add(s["symbol"])

    _build_index(_universe)
    logger.info("Stock universe ready: %d total symbols", len(_universe))


def search_stocks(query: str, limit: int = 15) -> List[Dict]:
    """Fast fuzzy search by symbol or company name."""
    if not query or len(query) < 1:
        return []
    q = query.upper().strip()

    exact = []
    starts = []
    contains_sym = []
    contains_name = []

    for stock in _universe:
        sym = stock["symbol"].upper()
        name = stock["name"].upper()

        if sym == q:
            exact.append(stock)
        elif sym.startswith(q):
            starts.append(stock)
        elif q in sym:
            contains_sym.append(stock)
        elif q in name:
            contains_name.append(stock)

    results = (exact + starts + contains_sym + contains_name)[:limit]
    return results


def get_all_symbols() -> List[str]:
    return [s["symbol"] for s in _universe]


def get_symbol_info(symbol: str) -> Optional[Dict]:
    return _symbol_index.get(symbol.upper())


def get_universe_by_exchange(exchange: str) -> List[Dict]:
    return [s for s in _universe if s.get("exchange", "NSE").upper() == exchange.upper()]
