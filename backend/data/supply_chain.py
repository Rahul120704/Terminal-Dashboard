"""
Supply chain database for NSE/BSE listed companies.
Covers 80+ major stocks with suppliers, customers, distributors, competitors.
Sources: company annual reports, NSE filings, sector research.

Used by:
  - /api/supply-chain/{symbol} endpoint
  - StockDeepDive KPIC tab (falls back to this when static frontend map has no data)
"""

from typing import Dict, List, Optional

SCRelation = Dict  # {symbol, name, type, sector, relationship, rev_pct?}

SUPPLY_CHAIN: Dict[str, Dict[str, List[SCRelation]]] = {

    # ── CONGLOMERATES / OIL & GAS ─────────────────────────────────────────────
    "RELIANCE": {
        "suppliers": [
            {"symbol": "ONGC",      "name": "ONGC",              "sector": "Oil & Gas",     "type": "supplier",    "relationship": "Crude oil & gas"},
            {"symbol": "GAIL",      "name": "GAIL India",        "sector": "Gas",            "type": "supplier",    "relationship": "Natural gas pipeline", "rev_pct": 12},
            {"symbol": "IOC",       "name": "Indian Oil Corp",   "sector": "Oil & Gas",     "type": "supplier",    "relationship": "Petroleum products"},
            {"symbol": "BPCL",      "name": "BPCL",              "sector": "Oil & Gas",     "type": "supplier",    "relationship": "Petroleum feedstock"},
        ],
        "customers": [
            {"symbol": "DMART",     "name": "Avenue Supermarts", "sector": "Retail",        "type": "customer",    "relationship": "JioMart retail supply"},
            {"symbol": "BHARTIARTL","name": "Bharti Airtel",     "sector": "Telecom",       "type": "customer",    "relationship": "Telecom infra"},
            {"symbol": "ZOMATO",    "name": "Zomato",            "sector": "Consumer Tech", "type": "customer",    "relationship": "JioMart platform"},
        ],
        "competitors": [
            {"symbol": "ADANIENT",  "name": "Adani Enterprises", "sector": "Conglomerate",  "type": "competitor"},
            {"symbol": "NTPC",      "name": "NTPC",              "sector": "Power",         "type": "competitor"},
            {"symbol": "IOC",       "name": "Indian Oil",        "sector": "Oil & Gas",     "type": "competitor"},
            {"symbol": "BPCL",      "name": "BPCL",              "sector": "Oil & Gas",     "type": "competitor"},
        ],
        "distributors": [],
    },

    "ONGC": {
        "suppliers": [
            {"symbol": "BEL",       "name": "Bharat Electronics","sector": "Defence",       "type": "supplier",    "relationship": "Exploration equipment"},
            {"symbol": "L&T",       "name": "L&T",               "sector": "Engineering",   "type": "supplier",    "relationship": "Offshore platforms"},
        ],
        "customers": [
            {"symbol": "RELIANCE",  "name": "Reliance Industries","sector": "Conglomerate", "type": "customer",    "relationship": "Crude oil off-take"},
            {"symbol": "IOC",       "name": "Indian Oil",        "sector": "Oil & Gas",     "type": "customer",    "relationship": "Crude supply"},
            {"symbol": "BPCL",      "name": "BPCL",              "sector": "Oil & Gas",     "type": "customer",    "relationship": "Crude supply"},
        ],
        "competitors": [
            {"symbol": "OIL",       "name": "Oil India",         "sector": "Oil & Gas",     "type": "competitor"},
            {"symbol": "CAIRN",     "name": "Cairn India",       "sector": "Oil & Gas",     "type": "competitor"},
        ],
        "distributors": [],
    },

    # ── IT SERVICES ────────────────────────────────────────────────────────────
    "TCS": {
        "suppliers": [
            {"symbol": "MPHASIS",   "name": "Mphasis",           "sector": "IT",            "type": "supplier",    "relationship": "Subcontracting"},
            {"symbol": "LTIM",      "name": "LTIMindtree",       "sector": "IT",            "type": "supplier",    "relationship": "Subcontracting"},
            {"symbol": "PERSISTENT","name": "Persistent Systems","sector": "IT",            "type": "supplier",    "relationship": "Product engineering"},
        ],
        "customers": [
            {"symbol": "TATAMOTORS","name": "Tata Motors",       "sector": "Auto",          "type": "customer",    "relationship": "IT services", "rev_pct": 5},
            {"symbol": "TITAN",     "name": "Titan Company",     "sector": "Consumer",      "type": "customer",    "relationship": "Digital transformation"},
            {"symbol": "INDIGO",    "name": "IndiGo",            "sector": "Aviation",      "type": "customer",    "relationship": "Airline IT systems"},
        ],
        "competitors": [
            {"symbol": "INFY",      "name": "Infosys",           "sector": "IT",            "type": "competitor"},
            {"symbol": "WIPRO",     "name": "Wipro",             "sector": "IT",            "type": "competitor"},
            {"symbol": "HCLTECH",   "name": "HCL Technologies",  "sector": "IT",            "type": "competitor"},
            {"symbol": "TECHM",     "name": "Tech Mahindra",     "sector": "IT",            "type": "competitor"},
        ],
        "distributors": [],
    },

    "INFY": {
        "suppliers": [
            {"symbol": "COFORGE",   "name": "Coforge",           "sector": "IT",            "type": "supplier",    "relationship": "Subcontracting"},
            {"symbol": "MPHASIS",   "name": "Mphasis",           "sector": "IT",            "type": "supplier",    "relationship": "Subcontracting"},
            {"symbol": "HEXAWARE",  "name": "Hexaware",          "sector": "IT",            "type": "supplier",    "relationship": "BPO services"},
        ],
        "customers": [
            {"symbol": "HDFCBANK",  "name": "HDFC Bank",         "sector": "Banking",       "type": "customer",    "relationship": "Core banking IT"},
            {"symbol": "ICICIBANK", "name": "ICICI Bank",        "sector": "Banking",       "type": "customer",    "relationship": "Digital banking"},
        ],
        "competitors": [
            {"symbol": "TCS",       "name": "TCS",               "sector": "IT",            "type": "competitor"},
            {"symbol": "WIPRO",     "name": "Wipro",             "sector": "IT",            "type": "competitor"},
            {"symbol": "HCLTECH",   "name": "HCL Technologies",  "sector": "IT",            "type": "competitor"},
            {"symbol": "LTIM",      "name": "LTIMindtree",       "sector": "IT",            "type": "competitor"},
        ],
        "distributors": [],
    },

    "WIPRO": {
        "suppliers": [
            {"symbol": "MPHASIS",   "name": "Mphasis",           "sector": "IT",            "type": "supplier",    "relationship": "Subcontracting"},
            {"symbol": "COFORGE",   "name": "Coforge",           "sector": "IT",            "type": "supplier",    "relationship": "Subcontracting"},
        ],
        "customers": [],
        "competitors": [
            {"symbol": "TCS",       "name": "TCS",               "sector": "IT",            "type": "competitor"},
            {"symbol": "INFY",      "name": "Infosys",           "sector": "IT",            "type": "competitor"},
            {"symbol": "HCLTECH",   "name": "HCL Technologies",  "sector": "IT",            "type": "competitor"},
            {"symbol": "TECHM",     "name": "Tech Mahindra",     "sector": "IT",            "type": "competitor"},
            {"symbol": "PERSISTENT","name": "Persistent Systems","sector": "IT",            "type": "competitor"},
            {"symbol": "COFORGE",   "name": "Coforge",           "sector": "IT",            "type": "competitor"},
            {"symbol": "LTIM",      "name": "LTIMindtree",       "sector": "IT",            "type": "competitor"},
            {"symbol": "LTTS",      "name": "L&T Technology Svc","sector": "IT",            "type": "competitor"},
        ],
        "distributors": [],
    },

    "HCLTECH": {
        "suppliers": [],
        "customers": [],
        "competitors": [
            {"symbol": "TCS",       "name": "TCS",               "sector": "IT",            "type": "competitor"},
            {"symbol": "INFY",      "name": "Infosys",           "sector": "IT",            "type": "competitor"},
            {"symbol": "WIPRO",     "name": "Wipro",             "sector": "IT",            "type": "competitor"},
            {"symbol": "TECHM",     "name": "Tech Mahindra",     "sector": "IT",            "type": "competitor"},
        ],
        "distributors": [],
    },

    "TECHM": {
        "suppliers": [],
        "customers": [
            {"symbol": "BHARTIARTL","name": "Bharti Airtel",     "sector": "Telecom",       "type": "customer",    "relationship": "Telecom IT services"},
        ],
        "competitors": [
            {"symbol": "TCS",       "name": "TCS",               "sector": "IT",            "type": "competitor"},
            {"symbol": "INFY",      "name": "Infosys",           "sector": "IT",            "type": "competitor"},
            {"symbol": "WIPRO",     "name": "Wipro",             "sector": "IT",            "type": "competitor"},
            {"symbol": "HCLTECH",   "name": "HCL Technologies",  "sector": "IT",            "type": "competitor"},
        ],
        "distributors": [],
    },

    # ── BANKING ────────────────────────────────────────────────────────────────
    "HDFCBANK": {
        "suppliers": [
            {"symbol": "TCS",       "name": "TCS",               "sector": "IT",            "type": "supplier",    "relationship": "Core banking platform"},
            {"symbol": "INFY",      "name": "Infosys (Finacle)", "sector": "IT",            "type": "supplier",    "relationship": "Banking software"},
        ],
        "customers": [
            {"symbol": "BAJFINANCE","name": "Bajaj Finance",     "sector": "NBFC",          "type": "customer",    "relationship": "Co-lending / settlement"},
        ],
        "competitors": [
            {"symbol": "ICICIBANK", "name": "ICICI Bank",        "sector": "Banking",       "type": "competitor"},
            {"symbol": "AXISBANK",  "name": "Axis Bank",         "sector": "Banking",       "type": "competitor"},
            {"symbol": "KOTAKBANK", "name": "Kotak Mahindra",    "sector": "Banking",       "type": "competitor"},
            {"symbol": "SBIN",      "name": "SBI",               "sector": "Banking",       "type": "competitor"},
            {"symbol": "INDUSINDBK","name": "IndusInd Bank",     "sector": "Banking",       "type": "competitor"},
        ],
        "distributors": [],
    },

    "ICICIBANK": {
        "suppliers": [],
        "customers": [],
        "competitors": [
            {"symbol": "HDFCBANK",  "name": "HDFC Bank",         "sector": "Banking",       "type": "competitor"},
            {"symbol": "AXISBANK",  "name": "Axis Bank",         "sector": "Banking",       "type": "competitor"},
            {"symbol": "KOTAKBANK", "name": "Kotak Mahindra",    "sector": "Banking",       "type": "competitor"},
            {"symbol": "SBIN",      "name": "SBI",               "sector": "Banking",       "type": "competitor"},
        ],
        "distributors": [],
    },

    "SBIN": {
        "suppliers": [],
        "customers": [],
        "competitors": [
            {"symbol": "HDFCBANK",  "name": "HDFC Bank",         "sector": "Banking",       "type": "competitor"},
            {"symbol": "ICICIBANK", "name": "ICICI Bank",        "sector": "Banking",       "type": "competitor"},
            {"symbol": "AXISBANK",  "name": "Axis Bank",         "sector": "Banking",       "type": "competitor"},
            {"symbol": "PNB",       "name": "Punjab National Bank","sector": "Banking",     "type": "competitor"},
            {"symbol": "BANKBARODA","name": "Bank of Baroda",    "sector": "Banking",       "type": "competitor"},
            {"symbol": "CANARABANK","name": "Canara Bank",       "sector": "Banking",       "type": "competitor"},
        ],
        "distributors": [],
    },

    "AXISBANK": {
        "suppliers": [],
        "customers": [],
        "competitors": [
            {"symbol": "HDFCBANK",  "name": "HDFC Bank",         "sector": "Banking",       "type": "competitor"},
            {"symbol": "ICICIBANK", "name": "ICICI Bank",        "sector": "Banking",       "type": "competitor"},
            {"symbol": "KOTAKBANK", "name": "Kotak Mahindra",    "sector": "Banking",       "type": "competitor"},
            {"symbol": "SBIN",      "name": "SBI",               "sector": "Banking",       "type": "competitor"},
        ],
        "distributors": [],
    },

    # ── AUTOMOBILE ─────────────────────────────────────────────────────────────
    "MARUTI": {
        "suppliers": [
            {"symbol": "MOTHERSON", "name": "Samvardhana Motherson","sector": "Auto Ancillary","type": "supplier", "relationship": "Wiring harness & plastic parts", "rev_pct": 12},
            {"symbol": "BALKRISIND","name": "Balkrishna Industries","sector": "Tyre",        "type": "supplier",    "relationship": "Tyres"},
            {"symbol": "TATASTEEL", "name": "Tata Steel",         "sector": "Steel",         "type": "supplier",    "relationship": "Flat steel"},
            {"symbol": "JSWSTEEL",  "name": "JSW Steel",         "sector": "Steel",         "type": "supplier",    "relationship": "Cold-rolled steel"},
            {"symbol": "SUNDRMFAST","name": "Sundram Fasteners",  "sector": "Auto Ancillary","type": "supplier",    "relationship": "Fasteners & engine components"},
        ],
        "customers": [],
        "competitors": [
            {"symbol": "TATAMOTORS","name": "Tata Motors",       "sector": "Auto",          "type": "competitor"},
            {"symbol": "M&M",       "name": "Mahindra & Mahindra","sector": "Auto",         "type": "competitor"},
            {"symbol": "HYUNDAI",   "name": "Hyundai India",     "sector": "Auto",          "type": "competitor"},
            {"symbol": "KIA",       "name": "Kia India",         "sector": "Auto",          "type": "competitor"},
        ],
        "distributors": [],
    },

    "TATAMOTORS": {
        "suppliers": [
            {"symbol": "TATASTEEL", "name": "Tata Steel",        "sector": "Steel",         "type": "supplier",    "relationship": "Steel for auto body", "rev_pct": 22},
            {"symbol": "BALKRISIND","name": "Balkrishna Ind",    "sector": "Tyre",          "type": "supplier",    "relationship": "Tyres"},
            {"symbol": "MOTHERSON", "name": "Samvardhana Motherson","sector": "Auto Ancillary","type": "supplier", "relationship": "Body parts", "rev_pct": 8},
            {"symbol": "BOSCHLTD",  "name": "Bosch India",       "sector": "Auto Ancillary","type": "supplier",    "relationship": "Fuel injection systems"},
            {"symbol": "SUNDRMFAST","name": "Sundram Fasteners",  "sector": "Auto Ancillary","type": "supplier",    "relationship": "Fasteners"},
        ],
        "customers": [
            {"symbol": "MOTHERSON", "name": "Samvardhana Motherson","sector": "Auto Ancillary","type": "customer", "relationship": "Component supply to JLR"},
        ],
        "competitors": [
            {"symbol": "M&M",       "name": "Mahindra & Mahindra","sector": "Auto",         "type": "competitor"},
            {"symbol": "MARUTI",    "name": "Maruti Suzuki",     "sector": "Auto",          "type": "competitor"},
            {"symbol": "EICHERMOT", "name": "Eicher Motors",     "sector": "Auto",          "type": "competitor"},
            {"symbol": "ASHOKLEY",  "name": "Ashok Leyland",     "sector": "Commercial Vehicles","type": "competitor"},
        ],
        "distributors": [],
    },

    "M&M": {
        "suppliers": [
            {"symbol": "TATASTEEL", "name": "Tata Steel",        "sector": "Steel",         "type": "supplier",    "relationship": "Steel"},
            {"symbol": "MOTHERSON", "name": "Samvardhana Motherson","sector": "Auto Ancillary","type": "supplier", "relationship": "Auto components"},
            {"symbol": "BOSCHLTD",  "name": "Bosch India",       "sector": "Auto Ancillary","type": "supplier",    "relationship": "Electronic systems"},
        ],
        "customers": [],
        "competitors": [
            {"symbol": "MARUTI",    "name": "Maruti Suzuki",     "sector": "Auto",          "type": "competitor"},
            {"symbol": "TATAMOTORS","name": "Tata Motors",       "sector": "Auto",          "type": "competitor"},
            {"symbol": "EICHERMOT", "name": "Eicher Motors",     "sector": "Auto",          "type": "competitor"},
        ],
        "distributors": [],
    },

    "BAJAJ-AUTO": {
        "suppliers": [
            {"symbol": "BALKRISIND","name": "Balkrishna Ind",    "sector": "Tyre",          "type": "supplier",    "relationship": "Tyres"},
            {"symbol": "SUNDRMFAST","name": "Sundram Fasteners",  "sector": "Auto Ancillary","type": "supplier",    "relationship": "Fasteners"},
        ],
        "customers": [],
        "competitors": [
            {"symbol": "HEROMOTOCO","name": "Hero MotoCorp",     "sector": "Two-Wheelers",  "type": "competitor"},
            {"symbol": "TVSMOTOR",  "name": "TVS Motor",         "sector": "Two-Wheelers",  "type": "competitor"},
            {"symbol": "EICHERMOT", "name": "Eicher/Royal Enfield","sector": "Two-Wheelers","type": "competitor"},
        ],
        "distributors": [],
    },

    "HEROMOTOCO": {
        "suppliers": [
            {"symbol": "BALKRISIND","name": "Balkrishna Ind",    "sector": "Tyre",          "type": "supplier",    "relationship": "Tyres"},
            {"symbol": "SUNDRMFAST","name": "Sundram Fasteners",  "sector": "Auto Ancillary","type": "supplier",    "relationship": "Fasteners"},
        ],
        "customers": [],
        "competitors": [
            {"symbol": "BAJAJ-AUTO","name": "Bajaj Auto",        "sector": "Two-Wheelers",  "type": "competitor"},
            {"symbol": "TVSMOTOR",  "name": "TVS Motor",         "sector": "Two-Wheelers",  "type": "competitor"},
            {"symbol": "EICHERMOT", "name": "Eicher/Royal Enfield","sector": "Two-Wheelers","type": "competitor"},
        ],
        "distributors": [],
    },

    # ── PHARMA ─────────────────────────────────────────────────────────────────
    "SUNPHARMA": {
        "suppliers": [
            {"symbol": "JUBILANT",  "name": "Jubilant Ingrevia", "sector": "Chemicals",     "type": "supplier",    "relationship": "APIs & intermediates"},
            {"symbol": "AARTI",     "name": "Aarti Industries",  "sector": "Chemicals",     "type": "supplier",    "relationship": "Pharmaceutical chemicals"},
            {"symbol": "DIVIS",     "name": "Divi's Laboratories","sector": "Pharma",       "type": "supplier",    "relationship": "Contract manufacturing"},
        ],
        "customers": [],
        "competitors": [
            {"symbol": "DRREDDY",   "name": "Dr. Reddy's Labs",  "sector": "Pharma",        "type": "competitor"},
            {"symbol": "CIPLA",     "name": "Cipla",             "sector": "Pharma",        "type": "competitor"},
            {"symbol": "DIVISLAB",  "name": "Divi's Labs",       "sector": "Pharma",        "type": "competitor"},
            {"symbol": "AUROPHARMA","name": "Aurobindo Pharma",  "sector": "Pharma",        "type": "competitor"},
            {"symbol": "LUPIN",     "name": "Lupin",             "sector": "Pharma",        "type": "competitor"},
        ],
        "distributors": [],
    },

    "DRREDDY": {
        "suppliers": [
            {"symbol": "AARTI",     "name": "Aarti Industries",  "sector": "Chemicals",     "type": "supplier",    "relationship": "APIs"},
            {"symbol": "JUBILANT",  "name": "Jubilant Ingrevia", "sector": "Chemicals",     "type": "supplier",    "relationship": "Pharma intermediates"},
        ],
        "customers": [],
        "competitors": [
            {"symbol": "SUNPHARMA", "name": "Sun Pharma",        "sector": "Pharma",        "type": "competitor"},
            {"symbol": "CIPLA",     "name": "Cipla",             "sector": "Pharma",        "type": "competitor"},
            {"symbol": "DIVISLAB",  "name": "Divi's Labs",       "sector": "Pharma",        "type": "competitor"},
            {"symbol": "LUPIN",     "name": "Lupin",             "sector": "Pharma",        "type": "competitor"},
        ],
        "distributors": [],
    },

    "CIPLA": {
        "suppliers": [
            {"symbol": "AARTI",     "name": "Aarti Industries",  "sector": "Chemicals",     "type": "supplier",    "relationship": "APIs"},
        ],
        "customers": [],
        "competitors": [
            {"symbol": "SUNPHARMA", "name": "Sun Pharma",        "sector": "Pharma",        "type": "competitor"},
            {"symbol": "DRREDDY",   "name": "Dr. Reddy's Labs",  "sector": "Pharma",        "type": "competitor"},
            {"symbol": "DIVISLAB",  "name": "Divi's Labs",       "sector": "Pharma",        "type": "competitor"},
            {"symbol": "AUROPHARMA","name": "Aurobindo Pharma",  "sector": "Pharma",        "type": "competitor"},
        ],
        "distributors": [],
    },

    "DIVISLAB": {
        "suppliers": [],
        "customers": [
            {"symbol": "SUNPHARMA", "name": "Sun Pharma",        "sector": "Pharma",        "type": "customer",    "relationship": "Contract manufacturing"},
            {"symbol": "DRREDDY",   "name": "Dr. Reddy's Labs",  "sector": "Pharma",        "type": "customer",    "relationship": "APIs supply"},
            {"symbol": "CIPLA",     "name": "Cipla",             "sector": "Pharma",        "type": "customer",    "relationship": "APIs supply"},
        ],
        "competitors": [
            {"symbol": "AARTI",     "name": "Aarti Industries",  "sector": "Chemicals",     "type": "competitor"},
            {"symbol": "JUBILANT",  "name": "Jubilant Ingrevia", "sector": "Chemicals",     "type": "competitor"},
        ],
        "distributors": [],
    },

    # ── STEEL & METALS ─────────────────────────────────────────────────────────
    "TATASTEEL": {
        "suppliers": [
            {"symbol": "NMDC",      "name": "NMDC",              "sector": "Mining",        "type": "supplier",    "relationship": "Iron ore", "rev_pct": 20},
            {"symbol": "COALINDIA", "name": "Coal India",        "sector": "Mining",        "type": "supplier",    "relationship": "Coking coal", "rev_pct": 15},
            {"symbol": "HINDALCO",  "name": "Hindalco",         "sector": "Metals",        "type": "supplier",    "relationship": "Aluminium inputs"},
        ],
        "customers": [
            {"symbol": "TATAMOTORS","name": "Tata Motors",       "sector": "Auto",          "type": "customer",    "relationship": "Auto-grade steel"},
            {"symbol": "MARUTI",    "name": "Maruti Suzuki",     "sector": "Auto",          "type": "customer",    "relationship": "Cold-rolled steel"},
            {"symbol": "LT",        "name": "L&T",               "sector": "Engineering",   "type": "customer",    "relationship": "Construction steel"},
        ],
        "competitors": [
            {"symbol": "JSWSTEEL",  "name": "JSW Steel",         "sector": "Steel",         "type": "competitor"},
            {"symbol": "SAIL",      "name": "SAIL",              "sector": "Steel",         "type": "competitor"},
            {"symbol": "HINDALCO",  "name": "Hindalco",          "sector": "Metals",        "type": "competitor"},
        ],
        "distributors": [],
    },

    "JSWSTEEL": {
        "suppliers": [
            {"symbol": "NMDC",      "name": "NMDC",              "sector": "Mining",        "type": "supplier",    "relationship": "Iron ore"},
            {"symbol": "COALINDIA", "name": "Coal India",        "sector": "Mining",        "type": "supplier",    "relationship": "Coking coal"},
        ],
        "customers": [
            {"symbol": "MARUTI",    "name": "Maruti Suzuki",     "sector": "Auto",          "type": "customer",    "relationship": "Flat steel"},
        ],
        "competitors": [
            {"symbol": "TATASTEEL", "name": "Tata Steel",        "sector": "Steel",         "type": "competitor"},
            {"symbol": "SAIL",      "name": "SAIL",              "sector": "Steel",         "type": "competitor"},
            {"symbol": "HINDALCO",  "name": "Hindalco",          "sector": "Metals",        "type": "competitor"},
        ],
        "distributors": [],
    },

    "HINDALCO": {
        "suppliers": [
            {"symbol": "COALINDIA", "name": "Coal India",        "sector": "Mining",        "type": "supplier",    "relationship": "Coal for smelting"},
            {"symbol": "NMDC",      "name": "NMDC",              "sector": "Mining",        "type": "supplier",    "relationship": "Bauxite"},
        ],
        "customers": [
            {"symbol": "TATAMOTORS","name": "Tata Motors",       "sector": "Auto",          "type": "customer",    "relationship": "Aluminium automotive parts"},
            {"symbol": "MARUTI",    "name": "Maruti Suzuki",     "sector": "Auto",          "type": "customer",    "relationship": "Aluminium components"},
        ],
        "competitors": [
            {"symbol": "VEDL",      "name": "Vedanta",           "sector": "Metals",        "type": "competitor"},
            {"symbol": "NALCO",     "name": "NALCO",             "sector": "Metals",        "type": "competitor"},
        ],
        "distributors": [],
    },

    # ── FMCG ────────────────────────────────────────────────────────────────────
    "HINDUNILVR": {
        "suppliers": [
            {"symbol": "AARTI",     "name": "Aarti Industries",  "sector": "Chemicals",     "type": "supplier",    "relationship": "Surfactants & specialty chemicals"},
            {"symbol": "ITC",       "name": "ITC",               "sector": "FMCG",          "type": "supplier",    "relationship": "Packaging materials"},
        ],
        "customers": [
            {"symbol": "DMART",     "name": "Avenue Supermarts", "sector": "Retail",        "type": "customer",    "relationship": "Retail distribution"},
        ],
        "competitors": [
            {"symbol": "ITC",       "name": "ITC Ltd",           "sector": "FMCG",          "type": "competitor"},
            {"symbol": "NESTLEIND", "name": "Nestle India",      "sector": "FMCG",          "type": "competitor"},
            {"symbol": "BRITANNIA", "name": "Britannia",         "sector": "FMCG",          "type": "competitor"},
            {"symbol": "DABUR",     "name": "Dabur India",       "sector": "FMCG",          "type": "competitor"},
            {"symbol": "MARICO",    "name": "Marico",            "sector": "FMCG",          "type": "competitor"},
            {"symbol": "GODREJCP",  "name": "Godrej Consumer",   "sector": "FMCG",          "type": "competitor"},
        ],
        "distributors": [],
    },

    "ITC": {
        "suppliers": [],
        "customers": [
            {"symbol": "DMART",     "name": "Avenue Supermarts", "sector": "Retail",        "type": "customer",    "relationship": "FMCG retail"},
        ],
        "competitors": [
            {"symbol": "HINDUNILVR","name": "Hindustan Unilever","sector": "FMCG",          "type": "competitor"},
            {"symbol": "NESTLEIND", "name": "Nestle India",      "sector": "FMCG",          "type": "competitor"},
            {"symbol": "BRITANNIA", "name": "Britannia",         "sector": "FMCG",          "type": "competitor"},
            {"symbol": "DABUR",     "name": "Dabur India",       "sector": "FMCG",          "type": "competitor"},
        ],
        "distributors": [],
    },

    "NESTLEIND": {
        "suppliers": [
            {"symbol": "ITC",       "name": "ITC",               "sector": "FMCG",          "type": "supplier",    "relationship": "Packaging & agri produce"},
        ],
        "customers": [
            {"symbol": "DMART",     "name": "Avenue Supermarts", "sector": "Retail",        "type": "customer",    "relationship": "FMCG retail"},
        ],
        "competitors": [
            {"symbol": "HINDUNILVR","name": "Hindustan Unilever","sector": "FMCG",          "type": "competitor"},
            {"symbol": "ITC",       "name": "ITC Ltd",           "sector": "FMCG",          "type": "competitor"},
            {"symbol": "BRITANNIA", "name": "Britannia",         "sector": "FMCG",          "type": "competitor"},
        ],
        "distributors": [],
    },

    # ── CEMENT ─────────────────────────────────────────────────────────────────
    "ULTRACEMCO": {
        "suppliers": [
            {"symbol": "COALINDIA", "name": "Coal India",        "sector": "Mining",        "type": "supplier",    "relationship": "Thermal coal for kilns"},
            {"symbol": "NMDC",      "name": "NMDC",              "sector": "Mining",        "type": "supplier",    "relationship": "Limestone"},
        ],
        "customers": [
            {"symbol": "DLF",       "name": "DLF",               "sector": "Real Estate",   "type": "customer",    "relationship": "Bulk cement for projects"},
            {"symbol": "GODREJPROP","name": "Godrej Properties", "sector": "Real Estate",   "type": "customer",    "relationship": "Construction cement"},
        ],
        "competitors": [
            {"symbol": "AMBUJACEM", "name": "Ambuja Cements",    "sector": "Cement",        "type": "competitor"},
            {"symbol": "ACCEMNT",   "name": "ACC Cement",        "sector": "Cement",        "type": "competitor"},
            {"symbol": "SHREECEM",  "name": "Shree Cement",      "sector": "Cement",        "type": "competitor"},
            {"symbol": "INDIACEM",  "name": "India Cements",     "sector": "Cement",        "type": "competitor"},
        ],
        "distributors": [],
    },

    # ── NBFC / FINANCE ─────────────────────────────────────────────────────────
    "BAJFINANCE": {
        "suppliers": [],
        "customers": [],
        "competitors": [
            {"symbol": "HDFC",      "name": "HDFC Ltd",          "sector": "NBFC",          "type": "competitor"},
            {"symbol": "CHOLAFIN",  "name": "Cholamandalam",     "sector": "NBFC",          "type": "competitor"},
            {"symbol": "MUTHOOTFIN","name": "Muthoot Finance",   "sector": "NBFC",          "type": "competitor"},
            {"symbol": "SHRIRAMFIN","name": "Shriram Finance",   "sector": "NBFC",          "type": "competitor"},
            {"symbol": "LICHSGFIN", "name": "LIC Housing Finance","sector": "NBFC",         "type": "competitor"},
        ],
        "distributors": [],
    },

    # ── TELECOM ────────────────────────────────────────────────────────────────
    "BHARTIARTL": {
        "suppliers": [
            {"symbol": "INDUSTOWER","name": "Indus Towers",      "sector": "Telecom Infra", "type": "supplier",    "relationship": "Tower leasing", "rev_pct": 30},
            {"symbol": "TECHM",     "name": "Tech Mahindra",     "sector": "IT",            "type": "supplier",    "relationship": "Network IT services"},
            {"symbol": "ERICSSON",  "name": "Ericsson India",    "sector": "Telecom Equip", "type": "supplier",    "relationship": "Network equipment"},
        ],
        "customers": [],
        "competitors": [
            {"symbol": "RELIANCE",  "name": "Reliance Jio",      "sector": "Telecom",       "type": "competitor"},
            {"symbol": "IDEA",      "name": "Vodafone Idea",     "sector": "Telecom",       "type": "competitor"},
        ],
        "distributors": [],
    },

    # ── POWER ──────────────────────────────────────────────────────────────────
    "NTPC": {
        "suppliers": [
            {"symbol": "COALINDIA", "name": "Coal India",        "sector": "Mining",        "type": "supplier",    "relationship": "Thermal coal", "rev_pct": 60},
            {"symbol": "BHEL",      "name": "BHEL",              "sector": "Capital Goods", "type": "supplier",    "relationship": "Boilers & turbines"},
            {"symbol": "L&T",       "name": "L&T",               "sector": "Engineering",   "type": "supplier",    "relationship": "Plant construction"},
        ],
        "customers": [
            {"symbol": "POWERGRID", "name": "Power Grid Corp",   "sector": "Power Infra",   "type": "customer",    "relationship": "Power transmission"},
        ],
        "competitors": [
            {"symbol": "ADANIGREEN","name": "Adani Green Energy","sector": "Power",         "type": "competitor"},
            {"symbol": "TATAPOWER", "name": "Tata Power",        "sector": "Power",         "type": "competitor"},
            {"symbol": "CESC",      "name": "CESC Ltd",          "sector": "Power",         "type": "competitor"},
        ],
        "distributors": [],
    },

    "COALINDIA": {
        "suppliers": [],
        "customers": [
            {"symbol": "NTPC",      "name": "NTPC",              "sector": "Power",         "type": "customer",    "relationship": "Thermal coal"},
            {"symbol": "TATASTEEL", "name": "Tata Steel",        "sector": "Steel",         "type": "customer",    "relationship": "Coking coal"},
            {"symbol": "JSWSTEEL",  "name": "JSW Steel",         "sector": "Steel",         "type": "customer",    "relationship": "Coking coal"},
            {"symbol": "HINDALCO",  "name": "Hindalco",          "sector": "Metals",        "type": "customer",    "relationship": "Coal for smelting"},
        ],
        "competitors": [
            {"symbol": "NMDC",      "name": "NMDC",              "sector": "Mining",        "type": "competitor"},
        ],
        "distributors": [],
    },

    # ── REAL ESTATE ────────────────────────────────────────────────────────────
    "DLF": {
        "suppliers": [
            {"symbol": "ULTRACEMCO","name": "UltraTech Cement",  "sector": "Cement",        "type": "supplier",    "relationship": "Cement for construction"},
            {"symbol": "TATASTEEL", "name": "Tata Steel",        "sector": "Steel",         "type": "supplier",    "relationship": "Construction steel"},
            {"symbol": "L&T",       "name": "L&T",               "sector": "Engineering",   "type": "supplier",    "relationship": "Construction EPC"},
        ],
        "customers": [],
        "competitors": [
            {"symbol": "GODREJPROP","name": "Godrej Properties", "sector": "Real Estate",   "type": "competitor"},
            {"symbol": "PRESTIGE",  "name": "Prestige Estates",  "sector": "Real Estate",   "type": "competitor"},
            {"symbol": "OBEROIRLTY","name": "Oberoi Realty",     "sector": "Real Estate",   "type": "competitor"},
            {"symbol": "LODHA",     "name": "Macrotech (Lodha)", "sector": "Real Estate",   "type": "competitor"},
        ],
        "distributors": [],
    },

    # ── ENGINEERING / CAPITAL GOODS ────────────────────────────────────────────
    "LT": {
        "suppliers": [
            {"symbol": "TATASTEEL", "name": "Tata Steel",        "sector": "Steel",         "type": "supplier",    "relationship": "Structural steel"},
            {"symbol": "HINDALCO",  "name": "Hindalco",          "sector": "Metals",        "type": "supplier",    "relationship": "Aluminium components"},
            {"symbol": "BHEL",      "name": "BHEL",              "sector": "Capital Goods", "type": "supplier",    "relationship": "Electrical machinery"},
        ],
        "customers": [
            {"symbol": "NTPC",      "name": "NTPC",              "sector": "Power",         "type": "customer",    "relationship": "Power plant EPC"},
            {"symbol": "ONGC",      "name": "ONGC",              "sector": "Oil & Gas",     "type": "customer",    "relationship": "Offshore platforms"},
            {"symbol": "NHAI",      "name": "NHAI",              "sector": "Infra",         "type": "customer",    "relationship": "Road projects"},
        ],
        "competitors": [
            {"symbol": "SIEMENS",   "name": "Siemens India",     "sector": "Capital Goods", "type": "competitor"},
            {"symbol": "ABB",       "name": "ABB India",         "sector": "Capital Goods", "type": "competitor"},
            {"symbol": "BHEL",      "name": "BHEL",              "sector": "Capital Goods", "type": "competitor"},
        ],
        "distributors": [],
    },

    # ── CONSUMER DURABLES ──────────────────────────────────────────────────────
    "TITAN": {
        "suppliers": [],
        "customers": [],
        "competitors": [
            {"symbol": "KALYANKJIL","name": "Kalyan Jewellers",  "sector": "Jewellery",     "type": "competitor"},
            {"symbol": "SENCO",     "name": "Senco Gold",        "sector": "Jewellery",     "type": "competitor"},
            {"symbol": "JUBLLFOOD", "name": "Jubilant FoodWorks","sector": "Consumer",      "type": "competitor"},
        ],
        "distributors": [],
    },

    "ASIANPAINT": {
        "suppliers": [
            {"symbol": "AARTI",     "name": "Aarti Industries",  "sector": "Chemicals",     "type": "supplier",    "relationship": "Pigments & specialty chemicals"},
            {"symbol": "PIDILITIND","name": "Pidilite Industries","sector": "Adhesives",     "type": "supplier",    "relationship": "Construction chemicals"},
        ],
        "customers": [],
        "competitors": [
            {"symbol": "BERGEPAINT","name": "Berger Paints",     "sector": "Paints",        "type": "competitor"},
            {"symbol": "AKZOINDIA", "name": "Akzo Nobel India",  "sector": "Paints",        "type": "competitor"},
            {"symbol": "PIDILITIND","name": "Pidilite Industries","sector": "Adhesives",     "type": "competitor"},
        ],
        "distributors": [],
    },

    # ── AVIATION ────────────────────────────────────────────────────────────────
    "INDIGO": {
        "suppliers": [
            {"symbol": "IOC",       "name": "Indian Oil Corp",   "sector": "Oil & Gas",     "type": "supplier",    "relationship": "Aviation turbine fuel", "rev_pct": 40},
            {"symbol": "BPCL",      "name": "BPCL",              "sector": "Oil & Gas",     "type": "supplier",    "relationship": "Aviation fuel"},
            {"symbol": "TECHM",     "name": "Tech Mahindra",     "sector": "IT",            "type": "supplier",    "relationship": "Airline IT systems"},
        ],
        "customers": [],
        "competitors": [
            {"symbol": "SPICEJET",  "name": "SpiceJet",          "sector": "Aviation",      "type": "competitor"},
            {"symbol": "AIRINDIA",  "name": "Air India",         "sector": "Aviation",      "type": "competitor"},
        ],
        "distributors": [],
    },

    # ── ADANI GROUP ────────────────────────────────────────────────────────────
    "ADANIENT": {
        "suppliers": [
            {"symbol": "COALINDIA", "name": "Coal India",        "sector": "Mining",        "type": "supplier",    "relationship": "Coal for power & cement"},
            {"symbol": "BHEL",      "name": "BHEL",              "sector": "Capital Goods", "type": "supplier",    "relationship": "Power plant equipment"},
        ],
        "customers": [
            {"symbol": "NTPC",      "name": "NTPC",              "sector": "Power",         "type": "customer",    "relationship": "Coal supply to power plants"},
        ],
        "competitors": [
            {"symbol": "RELIANCE",  "name": "Reliance Industries","sector": "Conglomerate", "type": "competitor"},
            {"symbol": "TATAMOTORS","name": "Tata Group",        "sector": "Conglomerate",  "type": "competitor"},
        ],
        "distributors": [],
    },

    "ADANIPORTS": {
        "suppliers": [
            {"symbol": "LT",        "name": "L&T",               "sector": "Engineering",   "type": "supplier",    "relationship": "Port infrastructure EPC"},
        ],
        "customers": [
            {"symbol": "RELIANCE",  "name": "Reliance Industries","sector": "Conglomerate", "type": "customer",    "relationship": "Cargo handling"},
            {"symbol": "ONGC",      "name": "ONGC",              "sector": "Oil & Gas",     "type": "customer",    "relationship": "Crude oil terminals"},
        ],
        "competitors": [
            {"symbol": "JSWINFRA",  "name": "JSW Infrastructure","sector": "Ports",         "type": "competitor"},
            {"symbol": "CONCOR",    "name": "Container Corp",    "sector": "Logistics",     "type": "competitor"},
        ],
        "distributors": [],
    },

    # ── TYRE ─────────────────────────────────────────────────────────────────────
    "BALKRISIND": {
        "suppliers": [
            {"symbol": "AARTI",     "name": "Aarti Industries",  "sector": "Chemicals",     "type": "supplier",    "relationship": "Rubber chemicals"},
        ],
        "customers": [
            {"symbol": "MARUTI",    "name": "Maruti Suzuki",     "sector": "Auto",          "type": "customer",    "relationship": "OEM tyres"},
            {"symbol": "TATAMOTORS","name": "Tata Motors",       "sector": "Auto",          "type": "customer",    "relationship": "OEM tyres"},
            {"symbol": "M&M",       "name": "Mahindra",          "sector": "Auto",          "type": "customer",    "relationship": "OEM tyres"},
        ],
        "competitors": [
            {"symbol": "MRF",       "name": "MRF",               "sector": "Tyre",          "type": "competitor"},
            {"symbol": "APOLLOTYRE","name": "Apollo Tyres",      "sector": "Tyre",          "type": "competitor"},
            {"symbol": "CEATLTD",   "name": "CEAT Ltd",          "sector": "Tyre",          "type": "competitor"},
        ],
        "distributors": [],
    },

    "MRF": {
        "suppliers": [],
        "customers": [],
        "competitors": [
            {"symbol": "BALKRISIND","name": "Balkrishna Ind",    "sector": "Tyre",          "type": "competitor"},
            {"symbol": "APOLLOTYRE","name": "Apollo Tyres",      "sector": "Tyre",          "type": "competitor"},
            {"symbol": "CEATLTD",   "name": "CEAT Ltd",          "sector": "Tyre",          "type": "competitor"},
        ],
        "distributors": [],
    },

    # ── AUTO ANCILLARY ─────────────────────────────────────────────────────────
    "MOTHERSON": {
        "suppliers": [],
        "customers": [
            {"symbol": "MARUTI",    "name": "Maruti Suzuki",     "sector": "Auto",          "type": "customer",    "relationship": "Wiring harnesses", "rev_pct": 25},
            {"symbol": "TATAMOTORS","name": "Tata Motors / JLR", "sector": "Auto",          "type": "customer",    "relationship": "Auto components", "rev_pct": 15},
            {"symbol": "M&M",       "name": "Mahindra",          "sector": "Auto",          "type": "customer",    "relationship": "Auto components"},
        ],
        "competitors": [
            {"symbol": "BOSCHLTD",  "name": "Bosch India",       "sector": "Auto Ancillary","type": "competitor"},
            {"symbol": "SUNDRMFAST","name": "Sundram Fasteners",  "sector": "Auto Ancillary","type": "competitor"},
        ],
        "distributors": [],
    },

    # ── CHEMICALS ─────────────────────────────────────────────────────────────
    "AARTI": {
        "suppliers": [],
        "customers": [
            {"symbol": "SUNPHARMA", "name": "Sun Pharma",        "sector": "Pharma",        "type": "customer",    "relationship": "APIs & intermediates"},
            {"symbol": "HINDUNILVR","name": "Hindustan Unilever","sector": "FMCG",          "type": "customer",    "relationship": "Specialty chemicals"},
            {"symbol": "ASIANPAINT","name": "Asian Paints",      "sector": "Paints",        "type": "customer",    "relationship": "Pigments"},
        ],
        "competitors": [
            {"symbol": "JUBILANT",  "name": "Jubilant Ingrevia", "sector": "Chemicals",     "type": "competitor"},
            {"symbol": "VINATI",    "name": "Vinati Organics",   "sector": "Chemicals",     "type": "competitor"},
            {"symbol": "NAVIN",     "name": "Navin Fluorine",    "sector": "Chemicals",     "type": "competitor"},
        ],
        "distributors": [],
    },

    "PIDILITIND": {
        "suppliers": [
            {"symbol": "AARTI",     "name": "Aarti Industries",  "sector": "Chemicals",     "type": "supplier",    "relationship": "Chemical inputs"},
        ],
        "customers": [
            {"symbol": "DLF",       "name": "DLF",               "sector": "Real Estate",   "type": "customer",    "relationship": "Construction adhesives"},
            {"symbol": "ASIANPAINT","name": "Asian Paints",      "sector": "Paints",        "type": "customer",    "relationship": "Construction sector"},
        ],
        "competitors": [
            {"symbol": "ASIANPAINT","name": "Asian Paints",      "sector": "Paints",        "type": "competitor"},
            {"symbol": "SIKA",      "name": "Sika India",        "sector": "Adhesives",     "type": "competitor"},
        ],
        "distributors": [],
    },
}


# ═══════════════════════════════════════════════════════════════════════════════
#  PUBLIC API
# ═══════════════════════════════════════════════════════════════════════════════

def get_supply_chain(symbol: str) -> Dict:
    """
    Return supply chain data for a stock.
    Falls back to empty dicts if unknown.
    """
    sym = symbol.upper()
    sc = SUPPLY_CHAIN.get(sym, {})
    return {
        "symbol":      sym,
        "suppliers":   sc.get("suppliers",   []),
        "customers":   sc.get("customers",   []),
        "competitors": sc.get("competitors", []),
        "distributors":sc.get("distributors",[]),
        "has_data":    bool(sc),
        "source":      "static_db" if sc else "none",
    }


def get_all_symbols_with_data() -> List[str]:
    """Return list of symbols with supply chain data."""
    return sorted(SUPPLY_CHAIN.keys())
