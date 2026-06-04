"""
News Agent: Polls 500+ RSS feeds with tiered intervals.
Priority Indian feeds: every 60s.  Standard feeds: every 180s.
Stores to SQLite. Pushes breaking news over WebSocket.
"""

import asyncio
import aiohttp
import feedparser
import logging
import hashlib
import time
from datetime import datetime, timezone
from typing import Optional, Callable, List, Dict, Set
from db.database import get_sqlite, get_redis
import re

from agents.guardian_agent import AgentHeartbeat, heartbeat_sleep

logger = logging.getLogger(__name__)

RSS_FEEDS = [
    # ── Economic Times (multiple sections) ───────────────────────────────────
    {"name": "ET Markets",          "url": "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",       "category": "markets"},
    {"name": "ET Stocks",           "url": "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms",    "category": "stocks"},
    {"name": "ET Economy",          "url": "https://economictimes.indiatimes.com/economy/rssfeeds/1373380680.cms",        "category": "macro"},
    {"name": "ET Industry",         "url": "https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms",         "category": "industry"},
    {"name": "ET Tech",             "url": "https://economictimes.indiatimes.com/tech/rssfeeds/13357270.cms",             "category": "tech"},
    {"name": "ET Banking",          "url": "https://economictimes.indiatimes.com/industry/banking/finance/rssfeeds/13358174.cms", "category": "banking"},
    {"name": "ET Mutual Funds",     "url": "https://economictimes.indiatimes.com/mf/rssfeeds/13355714.cms",              "category": "markets"},
    {"name": "ET IPO",              "url": "https://economictimes.indiatimes.com/markets/ipos/fpos/rssfeeds/17072980.cms","category": "ipo"},
    {"name": "ET Small Biz",        "url": "https://economictimes.indiatimes.com/small-biz/rssfeeds/6519736.cms",         "category": "sme"},
    {"name": "ET Commodities",      "url": "https://economictimes.indiatimes.com/markets/commodities/rssfeeds/1808978133.cms","category": "commodities"},
    {"name": "ET Forex",            "url": "https://economictimes.indiatimes.com/markets/forex/rssfeeds/1808978131.cms",  "category": "forex"},
    {"name": "ET Derivatives",      "url": "https://economictimes.indiatimes.com/markets/derivatives/rssfeeds/1808978132.cms","category": "derivatives"},
    {"name": "ET Bonds",            "url": "https://economictimes.indiatimes.com/markets/bonds/rssfeeds/1808978139.cms",  "category": "bonds"},
    # ── Livemint ─────────────────────────────────────────────────────────────
    {"name": "Mint Markets",        "url": "https://www.livemint.com/rss/markets",                                       "category": "markets"},
    {"name": "Mint Companies",      "url": "https://www.livemint.com/rss/companies",                                     "category": "companies"},
    {"name": "Mint Economy",        "url": "https://www.livemint.com/rss/economy",                                       "category": "macro"},
    {"name": "Mint Money",          "url": "https://www.livemint.com/rss/money",                                         "category": "markets"},
    {"name": "Mint Politics",       "url": "https://www.livemint.com/rss/politics",                                      "category": "macro"},
    {"name": "Mint News",           "url": "https://www.livemint.com/rss/news",                                          "category": "markets"},
    {"name": "Mint Tech",           "url": "https://www.livemint.com/rss/technology",                                    "category": "tech"},
    {"name": "Mint AI",             "url": "https://www.livemint.com/rss/ai",                                            "category": "tech"},
    # ── MoneyControl ─────────────────────────────────────────────────────────
    {"name": "MC Latest",           "url": "https://www.moneycontrol.com/rss/latestnews.xml",                            "category": "markets"},
    {"name": "MC Business",         "url": "https://www.moneycontrol.com/rss/business.xml",                              "category": "macro"},
    {"name": "MC Markets",          "url": "https://www.moneycontrol.com/rss/marketreports.xml",                         "category": "markets"},
    {"name": "MC Economy",          "url": "https://www.moneycontrol.com/rss/economy.xml",                               "category": "macro"},
    {"name": "MC IPO",              "url": "https://www.moneycontrol.com/rss/ipo.xml",                                   "category": "ipo"},
    {"name": "MC Mutual Funds",     "url": "https://www.moneycontrol.com/rss/mutualfunds.xml",                           "category": "markets"},
    {"name": "MC Commodities",      "url": "https://www.moneycontrol.com/rss/commodities.xml",                           "category": "commodities"},
    {"name": "MC Forex",            "url": "https://www.moneycontrol.com/rss/forex.xml",                                 "category": "forex"},
    {"name": "MC Banking",          "url": "https://www.moneycontrol.com/rss/banking.xml",                               "category": "banking"},
    # ── Business Standard ────────────────────────────────────────────────────
    {"name": "BS Markets",          "url": "https://www.business-standard.com/rss/markets-106.rss",                      "category": "markets"},
    {"name": "BS Economy",          "url": "https://www.business-standard.com/rss/economy-policy-101.rss",               "category": "macro"},
    {"name": "BS Companies",        "url": "https://www.business-standard.com/rss/companies-101.rss",                    "category": "companies"},
    {"name": "BS Finance",          "url": "https://www.business-standard.com/rss/finance-102.rss",                      "category": "markets"},
    {"name": "BS Industry",         "url": "https://www.business-standard.com/rss/industry-108.rss",                     "category": "industry"},
    {"name": "BS IPO",              "url": "https://www.business-standard.com/rss/ipo-104.rss",                          "category": "ipo"},
    {"name": "BS Opinion",          "url": "https://www.business-standard.com/rss/opinion-109.rss",                      "category": "macro"},
    {"name": "BS Technology",       "url": "https://www.business-standard.com/rss/technology-108.rss",                   "category": "tech"},
    {"name": "BS International",    "url": "https://www.business-standard.com/rss/international-104.rss",                "category": "global"},
    # ── Financial Express ────────────────────────────────────────────────────
    {"name": "FE Markets",          "url": "https://www.financialexpress.com/market/feed/",                              "category": "markets"},
    {"name": "FE Economy",          "url": "https://www.financialexpress.com/economy/feed/",                             "category": "macro"},
    {"name": "FE Business",         "url": "https://www.financialexpress.com/business/feed/",                            "category": "companies"},
    {"name": "FE Industry",         "url": "https://www.financialexpress.com/industry/feed/",                            "category": "industry"},
    {"name": "FE Money",            "url": "https://www.financialexpress.com/money/feed/",                               "category": "markets"},
    # ── NDTV Profit ──────────────────────────────────────────────────────────
    {"name": "NDTV Profit",         "url": "https://feeds.feedburner.com/NdtvProfitLatestNews",                          "category": "markets"},
    # ── Zee Business ────────────────────────────────────────────────────────
    {"name": "Zee Business",        "url": "https://zeenews.india.com/rss/business.xml",                                 "category": "markets"},
    # ── Hindu BusinessLine ────────────────────────────────────────────────────
    {"name": "BL Markets",          "url": "https://www.thehindubusinessline.com/markets/?service=rss",                  "category": "markets"},
    {"name": "BL Economy",          "url": "https://www.thehindubusinessline.com/economy/?service=rss",                  "category": "macro"},
    {"name": "BL Companies",        "url": "https://www.thehindubusinessline.com/companies/?service=rss",                "category": "companies"},
    {"name": "BL Money",            "url": "https://www.thehindubusinessline.com/money-banking/?service=rss",            "category": "banking"},
    {"name": "BL Agri",             "url": "https://www.thehindubusinessline.com/agri-biz/?service=rss",                 "category": "commodities"},
    # ── Regulatory / Official ─────────────────────────────────────────────────
    {"name": "RBI Press",           "url": "https://www.rbi.org.in/scripts/rss.aspx?RSSType=pressrelease",               "category": "macro"},
    {"name": "PIB Finance",         "url": "https://pib.gov.in/RssMain.aspx?ModId=8&Lang=1",                            "category": "macro"},
    {"name": "PIB Commerce",        "url": "https://pib.gov.in/RssMain.aspx?ModId=28&Lang=1",                           "category": "macro"},
    # ── Other Indian Sources ──────────────────────────────────────────────────
    {"name": "India Today Biz",     "url": "https://www.indiatoday.in/rss/1206514",                                      "category": "markets"},
    {"name": "The Print Economy",   "url": "https://theprint.in/category/economy/feed/",                                 "category": "macro"},
    {"name": "The Print Tech",      "url": "https://theprint.in/category/tech/feed/",                                    "category": "tech"},
    {"name": "News18 Business",     "url": "https://www.news18.com/rss/business.xml",                                    "category": "markets"},
    {"name": "ABP Business",        "url": "https://news.abplive.com/business/feed",                                     "category": "markets"},
    {"name": "Outlook Business",    "url": "https://www.outlookindia.com/business/feed",                                  "category": "markets"},
    {"name": "Inventure Growth",    "url": "https://www.indiainvestments.com/rss",                                        "category": "markets"},
    {"name": "Goodreturns",         "url": "https://www.goodreturns.in/rss.xml",                                         "category": "markets"},
    {"name": "Equitymaster",        "url": "https://www.equitymaster.com/rss/rss.xml",                                   "category": "markets"},
    {"name": "ValueResearchOnline", "url": "https://www.valueresearchonline.com/rss/news/",                              "category": "markets"},
    {"name": "Cafemutual",          "url": "https://cafemutual.com/news/rss",                                            "category": "markets"},
    {"name": "Edelweiss MF",        "url": "https://www.edelweissmf.com/blog/rss",                                       "category": "markets"},
    # ── Reuters (multiple regions/sections) ───────────────────────────────────
    {"name": "Reuters Business",    "url": "https://feeds.reuters.com/reuters/businessNews",                             "category": "global"},
    {"name": "Reuters India",       "url": "https://feeds.reuters.com/reuters/INbusinessNews",                           "category": "india"},
    {"name": "Reuters World",       "url": "https://feeds.reuters.com/reuters/worldNews",                                "category": "global"},
    {"name": "Reuters Markets",     "url": "https://feeds.reuters.com/reuters/UKFinancialServicesAndRealEstateNews",     "category": "global"},
    {"name": "Reuters Commodities", "url": "https://feeds.reuters.com/reuters/commoditiesNews",                          "category": "commodities"},
    {"name": "Reuters Tech",        "url": "https://feeds.reuters.com/reuters/technologyNews",                           "category": "tech"},
    # ── Bloomberg ────────────────────────────────────────────────────────────
    {"name": "Bloomberg Markets",   "url": "https://feeds.bloomberg.com/markets/news.rss",                               "category": "global"},
    {"name": "Bloomberg Tech",      "url": "https://feeds.bloomberg.com/technology/news.rss",                            "category": "tech"},
    {"name": "Bloomberg Politics",  "url": "https://feeds.bloomberg.com/politics/news.rss",                              "category": "macro"},
    # ── CNBC ─────────────────────────────────────────────────────────────────
    {"name": "CNBC Business",       "url": "https://www.cnbc.com/id/10001147/device/rss/rss.html",                      "category": "global"},
    {"name": "CNBC Markets",        "url": "https://www.cnbc.com/id/20910258/device/rss/rss.html",                      "category": "global"},
    {"name": "CNBC Investing",      "url": "https://www.cnbc.com/id/15839069/device/rss/rss.html",                      "category": "global"},
    {"name": "CNBC Finance",        "url": "https://www.cnbc.com/id/10000664/device/rss/rss.html",                      "category": "global"},
    {"name": "CNBC Asia",           "url": "https://www.cnbc.com/id/100727362/device/rss/rss.html",                     "category": "global"},
    {"name": "CNBC Economy",        "url": "https://www.cnbc.com/id/20910274/device/rss/rss.html",                      "category": "macro"},
    # ── Wall Street Journal ────────────────────────────────────────────────────
    {"name": "WSJ Top Stories",     "url": "https://feeds.content.dowjones.io/public/rss/mw_topstories",                "category": "global"},
    {"name": "MarketWatch Latest",  "url": "https://feeds.content.dowjones.io/public/rss/mw_latestnews",                "category": "global"},
    {"name": "MarketWatch Economy", "url": "https://feeds.content.dowjones.io/public/rss/mw_economy",                   "category": "macro"},
    # ── Financial Times ───────────────────────────────────────────────────────
    {"name": "FT Home",             "url": "https://www.ft.com/rss/home",                                               "category": "global"},
    {"name": "FT Markets",          "url": "https://www.ft.com/markets?format=rss",                                     "category": "global"},
    {"name": "FT Companies",        "url": "https://www.ft.com/companies?format=rss",                                   "category": "companies"},
    # ── Yahoo Finance ─────────────────────────────────────────────────────────
    {"name": "Yahoo Finance",       "url": "https://finance.yahoo.com/news/rssindex",                                   "category": "global"},
    # ── BBC ───────────────────────────────────────────────────────────────────
    {"name": "BBC Business",        "url": "http://feeds.bbci.co.uk/news/business/rss.xml",                             "category": "global"},
    {"name": "BBC Tech",            "url": "http://feeds.bbci.co.uk/news/technology/rss.xml",                           "category": "tech"},
    # ── The Guardian ─────────────────────────────────────────────────────────
    {"name": "Guardian Business",   "url": "https://www.theguardian.com/business/rss",                                  "category": "global"},
    {"name": "Guardian Economy",    "url": "https://www.theguardian.com/business/economics/rss",                        "category": "macro"},
    {"name": "Guardian Finance",    "url": "https://www.theguardian.com/money/investing/rss",                           "category": "global"},
    # ── NYT / WaPo ────────────────────────────────────────────────────────────
    {"name": "NYT Business",        "url": "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",                 "category": "global"},
    {"name": "NYT Economy",         "url": "https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml",                  "category": "macro"},
    {"name": "WaPo Business",       "url": "https://feeds.washingtonpost.com/rss/business",                             "category": "global"},
    # ── Seeking Alpha / Motley Fool / Forbes ─────────────────────────────────
    {"name": "Seeking Alpha",       "url": "https://seekingalpha.com/feed.xml",                                         "category": "stocks"},
    {"name": "Forbes Business",     "url": "https://www.forbes.com/business/feed/",                                     "category": "global"},
    {"name": "Forbes Finance",      "url": "https://www.forbes.com/money/feed/",                                        "category": "global"},
    {"name": "Fortune",             "url": "https://fortune.com/feed/",                                                 "category": "global"},
    {"name": "Business Insider",    "url": "https://feeds.businessinsider.com/custom/all",                              "category": "global"},
    {"name": "Barron's",            "url": "https://www.barrons.com/feed",                                              "category": "global"},
    {"name": "The Economist",       "url": "https://www.economist.com/finance-and-economics/rss.xml",                   "category": "macro"},
    # ── Macro / Central Banks ─────────────────────────────────────────────────
    {"name": "IMF News",            "url": "https://www.imf.org/en/News/rss?language=ENG&Topic=ALL",                    "category": "macro"},
    {"name": "World Bank Blog",     "url": "https://blogs.worldbank.org/en/rss.xml",                                    "category": "macro"},
    {"name": "Fed Reserve",         "url": "https://www.federalreserve.gov/feeds/press_all.xml",                        "category": "macro"},
    {"name": "ECB News",            "url": "https://www.ecb.europa.eu/rss/press.html",                                  "category": "macro"},
    {"name": "BIS Research",        "url": "https://www.bis.org/rss/all_work.rss",                                      "category": "macro"},
    # ── Crypto ────────────────────────────────────────────────────────────────
    {"name": "CoinDesk",            "url": "https://www.coindesk.com/arc/outboundfeeds/rss/",                           "category": "crypto"},
    {"name": "Cointelegraph",       "url": "https://cointelegraph.com/rss",                                             "category": "crypto"},
    {"name": "Decrypt",             "url": "https://decrypt.co/feed",                                                   "category": "crypto"},
    {"name": "CryptoPanic",         "url": "https://cryptopanic.com/news/rss/",                                         "category": "crypto"},
    {"name": "Bitcoin Magazine",    "url": "https://bitcoinmagazine.com/.rss/full/",                                    "category": "crypto"},
    {"name": "The Block",           "url": "https://www.theblock.co/rss.xml",                                           "category": "crypto"},
    {"name": "BeInCrypto",          "url": "https://beincrypto.com/feed/",                                              "category": "crypto"},
    {"name": "Crypto Briefing",     "url": "https://cryptobriefing.com/feed/",                                          "category": "crypto"},
    {"name": "NewsBTC",             "url": "https://www.newsbtc.com/feed/",                                             "category": "crypto"},
    {"name": "AMBCrypto",           "url": "https://ambcrypto.com/feed/",                                               "category": "crypto"},
    {"name": "Blockworks",          "url": "https://blockworks.co/feed",                                                "category": "crypto"},
    {"name": "CoinGape",            "url": "https://coingape.com/feed/",                                                "category": "crypto"},
    {"name": "Cryptonews",          "url": "https://cryptonews.com/news/feed/",                                         "category": "crypto"},
    {"name": "DailyCoin",           "url": "https://dailycoin.com/feed/",                                               "category": "crypto"},
    {"name": "UseTheBitcoin",       "url": "https://usethebitcoin.com/feed/",                                           "category": "crypto"},
    {"name": "CoinJournal",         "url": "https://coinjournal.net/feed/",                                             "category": "crypto"},
    {"name": "Crypto Potato",       "url": "https://cryptopotato.com/feed/",                                            "category": "crypto"},
    # ── Commodities / Energy ─────────────────────────────────────────────────
    {"name": "Kitco News",          "url": "https://www.kitco.com/rss/kitconews.xml",                                   "category": "commodities"},
    {"name": "OilPrice",            "url": "https://oilprice.com/rss/main",                                             "category": "commodities"},
    {"name": "Mining.com",          "url": "https://www.mining.com/feed/",                                              "category": "commodities"},
    {"name": "Metal Bulletin",      "url": "https://www.metalbulletin.com/rss/rss.xml",                                 "category": "commodities"},
    {"name": "Platts",              "url": "https://www.spglobal.com/commodityinsights/en/rss?type=news",               "category": "commodities"},
    {"name": "Agrimoney",           "url": "https://www.agrimoney.com/news/rss/",                                       "category": "commodities"},
    # ── Technology / AI ───────────────────────────────────────────────────────
    {"name": "TechCrunch",          "url": "https://techcrunch.com/feed/",                                              "category": "tech"},
    {"name": "The Verge",           "url": "https://www.theverge.com/rss/index.xml",                                    "category": "tech"},
    {"name": "Ars Technica",        "url": "https://feeds.arstechnica.com/arstechnica/index",                           "category": "tech"},
    {"name": "Wired Business",      "url": "https://www.wired.com/feed/category/business/latest/rss",                  "category": "tech"},
    {"name": "VentureBeat",         "url": "https://venturebeat.com/feed/",                                             "category": "tech"},
    {"name": "MIT Tech Review",     "url": "https://www.technologyreview.com/feed/",                                    "category": "tech"},
    {"name": "ZDNet",               "url": "https://www.zdnet.com/news/rss.xml",                                        "category": "tech"},
    # ── Sector-specific India ─────────────────────────────────────────────────
    {"name": "Pharma Biz",          "url": "https://www.pharmabiz.com/rss.aspx",                                        "category": "pharma"},
    {"name": "Auto Car India",      "url": "https://www.autocarindia.com/rss.xml",                                      "category": "auto"},
    {"name": "Economic Times Auto", "url": "https://economictimes.indiatimes.com/industry/auto/rssfeeds/1072131701.cms","category": "auto"},
    {"name": "ET Energy",           "url": "https://economictimes.indiatimes.com/industry/energy/rssfeeds/18429987.cms","category": "energy"},
    {"name": "ET Realty",           "url": "https://economictimes.indiatimes.com/industry/services/property-/-realty/rssfeeds/1672765567.cms","category": "realty"},
    {"name": "ET FMCG",             "url": "https://economictimes.indiatimes.com/industry/cons-products/fmcg/rssfeeds/1213610413.cms","category": "fmcg"},
    {"name": "ET Retail",           "url": "https://economictimes.indiatimes.com/industry/services/retail/rssfeeds/1213570735.cms","category": "retail"},
    {"name": "ET Telecom",          "url": "https://economictimes.indiatimes.com/industry/telecom/rssfeeds/13358659.cms","category": "telecom"},
    {"name": "BL Agri-Business",    "url": "https://www.thehindubusinessline.com/agri-biz/feed",                        "category": "agri"},
    # ── Asian / EM Markets ────────────────────────────────────────────────────
    {"name": "Nikkei Asia",         "url": "https://asia.nikkei.com/rss/feed/markets",                                  "category": "global"},
    {"name": "South China Morning", "url": "https://www.scmp.com/rss/5/feed",                                           "category": "global"},
    {"name": "Straits Times Biz",   "url": "https://www.straitstimes.com/news/business/rss.xml",                        "category": "global"},
    {"name": "Arab News Business",  "url": "https://www.arabnews.com/rss.xml/business",                                 "category": "global"},
    # ── Derivatives / Options ──────────────────────────────────────────────────
    {"name": "ET Derivatives",      "url": "https://economictimes.indiatimes.com/markets/derivatives/rssfeeds/1808978132.cms","category": "derivatives"},
    # ── IPO / SME / Startup ───────────────────────────────────────────────────
    {"name": "Inc42",               "url": "https://inc42.com/feed/",                                                   "category": "startup"},
    {"name": "YourStory",           "url": "https://yourstory.com/feed",                                                "category": "startup"},
    {"name": "Entrackr",            "url": "https://entrackr.com/feed/",                                                "category": "startup"},
    {"name": "The Ken",             "url": "https://the-ken.com/feed/",                                                 "category": "startup"},
    # ── ESG / Sustainability ──────────────────────────────────────────────────
    {"name": "ESG Today",           "url": "https://www.esgtoday.com/feed/",                                            "category": "esg"},
    {"name": "Responsible Investor","url": "https://www.responsible-investor.com/feed/",                                "category": "esg"},
    # ── Real Estate / Infrastructure ─────────────────────────────────────────
    {"name": "ET Real Estate",      "url": "https://realty.economictimes.indiatimes.com/rss/rss.aspx",                  "category": "realty"},
    {"name": "PropTiger",           "url": "https://www.proptiger.com/news/rss",                                        "category": "realty"},
    # ── Insurance / NBFC ─────────────────────────────────────────────────────
    {"name": "Insurance Regulatory","url": "https://www.irdai.gov.in/rss/index.aspx",                                   "category": "insurance"},
    # ── Trade / Policy ────────────────────────────────────────────────────────
    {"name": "DGFT Notifications",  "url": "https://www.dgft.gov.in/CP/rss.xml",                                        "category": "trade"},
    {"name": "WTO News",            "url": "https://www.wto.org/english/news_e/rss_e/news_e.xml",                       "category": "trade"},
    {"name": "OECD News",           "url": "https://oecdinsights.org/feed/",                                            "category": "macro"},
    # ── Fund Management ───────────────────────────────────────────────────────
    {"name": "AMFI",                "url": "https://www.amfiindia.com/rss.aspx",                                        "category": "mf"},
    {"name": "MF Distribution",     "url": "https://www.mfdistributors.in/rss",                                         "category": "mf"},
    # ── Alternative / Commodities ────────────────────────────────────────────
    {"name": "MCX India",           "url": "https://www.mcxindia.com/rss/rss.xml",                                      "category": "commodities"},
    {"name": "CRISIL Research",     "url": "https://www.crisil.com/en/home/newsroom/rss.xml",                           "category": "macro"},
    # ── International Biz Wires ───────────────────────────────────────────────
    {"name": "AP Business",         "url": "https://rsshub.app/apnews/topics/business",                                  "category": "global"},
    {"name": "Investopedia",        "url": "https://www.investopedia.com/feedbuilder/feed/getfeed/?feedName=investopedia-term-of-the-day","category": "global"},
    {"name": "Zacks",               "url": "https://www.zacks.com/commentary/rss.php",                                  "category": "stocks"},
    {"name": "Motley Fool",         "url": "https://www.fool.com/feeds/index.aspx",                                     "category": "stocks"},
    # ── Hedge Fund / Institutional ────────────────────────────────────────────
    {"name": "Institutional Investor","url": "https://www.institutionalinvestor.com/feed",                              "category": "global"},
    {"name": "Pensions & Investments","url": "https://www.pionline.com/rss/article",                                    "category": "global"},
    {"name": "Funds Europe",        "url": "https://www.funds-europe.com/rss",                                          "category": "global"},
    # ── Economic Research ─────────────────────────────────────────────────────
    {"name": "CEPR VoxEU",          "url": "https://feeds.feedburner.com/voxeu/whats-new",                              "category": "macro"},
    {"name": "NBER",                "url": "https://www.nber.org/feeds/working_papers.rss",                             "category": "macro"},
    {"name": "Bruegel",             "url": "https://www.bruegel.org/rss",                                               "category": "macro"},
    # ── Social/Trading ────────────────────────────────────────────────────────
    {"name": "StockTwits",          "url": "https://api.stocktwits.com/api/2/streams/trending.rss",                     "category": "social"},
    {"name": "Reddit WSB",          "url": "https://www.reddit.com/r/wallstreetbets/hot/.rss?limit=25",                 "category": "social"},
    {"name": "Reddit IndiaInvests", "url": "https://www.reddit.com/r/IndiaInvestments/hot/.rss?limit=25",               "category": "social"},
    {"name": "Reddit Stocks",       "url": "https://www.reddit.com/r/stocks/hot/.rss?limit=25",                         "category": "social"},
    {"name": "Reddit Investing",    "url": "https://www.reddit.com/r/investing/hot/.rss?limit=25",                      "category": "social"},
    # ── Debt / Credit Markets ────────────────────────────────────────────────
    {"name": "BondEvalue",          "url": "https://bondevalue.com/news/feed/",                                         "category": "bonds"},
    {"name": "Fixed Income Analyst","url": "https://www.fixedincomeinvestor.co.uk/rss.asp",                             "category": "bonds"},
    # ── Research / Analysis ───────────────────────────────────────────────────
    {"name": "Morningstar India",   "url": "https://www.morningstar.in/rss.aspx",                                       "category": "stocks"},
    {"name": "Value Pickr",         "url": "https://www.valuepickr.com/feed",                                           "category": "stocks"},
    {"name": "PMS AIF World",       "url": "https://www.pmsaifworld.com/feed/",                                         "category": "markets"},

    # ── More ET Sections ─────────────────────────────────────────────────────────
    {"name": "ET Infrastructure",   "url": "https://economictimes.indiatimes.com/industry/indl-goods/svs/engineering/rssfeeds/13357265.cms", "category": "industry"},
    {"name": "ET Steel",            "url": "https://economictimes.indiatimes.com/industry/indl-goods/svs/metals-mining/rssfeeds/13357261.cms","category": "commodities"},
    {"name": "ET Aviation",         "url": "https://economictimes.indiatimes.com/industry/transportation/airlines-/-aviation/rssfeeds/1213610315.cms","category": "aviation"},
    {"name": "ET Defence",          "url": "https://economictimes.indiatimes.com/news/defence/rssfeeds/46025594.cms",                          "category": "defence"},
    {"name": "ET Politics",         "url": "https://economictimes.indiatimes.com/news/politics-and-nation/rssfeeds/1052732854.cms",            "category": "macro"},
    {"name": "ET NRI",              "url": "https://economictimes.indiatimes.com/nri/rssfeeds/1054442.cms",                                    "category": "global"},
    {"name": "ET International",    "url": "https://economictimes.indiatimes.com/news/international/rssfeeds/1052734387.cms",                  "category": "global"},
    {"name": "ET Enterprise",       "url": "https://economictimes.indiatimes.com/small-biz/money/rssfeeds/1213610300.cms",                     "category": "sme"},
    {"name": "ET Media",            "url": "https://economictimes.indiatimes.com/industry/media-entertainment-print-/rssfeeds/13359290.cms",   "category": "media"},
    {"name": "ET Healthcare",       "url": "https://economictimes.indiatimes.com/industry/healthcare-biotech/rssfeeds/13357293.cms",           "category": "pharma"},
    {"name": "ET Consumer",         "url": "https://economictimes.indiatimes.com/industry/cons-products/rssfeeds/1213610259.cms",              "category": "fmcg"},
    {"name": "ET Services",         "url": "https://economictimes.indiatimes.com/industry/services/rssfeeds/13358186.cms",                     "category": "services"},
    {"name": "ET Wealth",           "url": "https://economictimes.indiatimes.com/wealth/rssfeeds/1054412.cms",                                 "category": "markets"},
    {"name": "ET Travel",           "url": "https://economictimes.indiatimes.com/industry/services/travel/rssfeeds/1213570721.cms",            "category": "travel"},

    # ── More Livemint Sections ───────────────────────────────────────────────────
    {"name": "Mint Opinion",        "url": "https://www.livemint.com/rss/opinion",                                                             "category": "macro"},
    {"name": "Mint Education",      "url": "https://www.livemint.com/rss/education",                                                           "category": "macro"},
    {"name": "Mint Budget",         "url": "https://www.livemint.com/rss/budget",                                                              "category": "macro"},
    {"name": "Mint Insurance",      "url": "https://www.livemint.com/rss/insurance",                                                           "category": "insurance"},
    {"name": "Mint Mutual Fund",    "url": "https://www.livemint.com/rss/mutual-fund",                                                         "category": "markets"},
    {"name": "Mint Property",       "url": "https://www.livemint.com/rss/real-estate",                                                         "category": "realty"},

    # ── More MC Sections ─────────────────────────────────────────────────────────
    {"name": "MC SME",              "url": "https://www.moneycontrol.com/rss/sme.xml",                                                         "category": "sme"},
    {"name": "MC Personal Finance", "url": "https://www.moneycontrol.com/rss/personal-finance.xml",                                           "category": "markets"},
    {"name": "MC Currency",         "url": "https://www.moneycontrol.com/rss/currency.xml",                                                    "category": "forex"},
    {"name": "MC Earnings",         "url": "https://www.moneycontrol.com/rss/results.xml",                                                     "category": "earnings"},
    {"name": "MC Buzzing Stocks",   "url": "https://www.moneycontrol.com/rss/buzzingstocks.xml",                                               "category": "stocks"},
    {"name": "MC Stock Ideas",      "url": "https://www.moneycontrol.com/rss/stockideas.xml",                                                  "category": "stocks"},
    {"name": "MC Options",          "url": "https://www.moneycontrol.com/rss/options.xml",                                                     "category": "derivatives"},
    {"name": "MC Technicals",       "url": "https://www.moneycontrol.com/rss/technicals.xml",                                                  "category": "stocks"},
    {"name": "MC Block Deals",      "url": "https://www.moneycontrol.com/rss/blockdeals.xml",                                                  "category": "stocks"},

    # ── Business Standard additional ──────────────────────────────────────────────
    {"name": "BS Banking",          "url": "https://www.business-standard.com/rss/finance-banking-102.rss",                                   "category": "banking"},
    {"name": "BS Pharma",           "url": "https://www.business-standard.com/rss/health-108.rss",                                            "category": "pharma"},
    {"name": "BS Commodities",      "url": "https://www.business-standard.com/rss/current-affairs-7.rss",                                     "category": "commodities"},
    {"name": "BS Auto",             "url": "https://www.business-standard.com/rss/automobile-104.rss",                                        "category": "auto"},
    {"name": "BS Energy",           "url": "https://www.business-standard.com/rss/energy-102.rss",                                            "category": "energy"},
    {"name": "BS Real Estate",      "url": "https://www.business-standard.com/rss/real-estate-108.rss",                                       "category": "realty"},
    {"name": "BS Retail",           "url": "https://www.business-standard.com/rss/retail-115.rss",                                            "category": "retail"},
    {"name": "BS SME",              "url": "https://www.business-standard.com/rss/sme-103.rss",                                               "category": "sme"},

    # ── Financial Express additional ──────────────────────────────────────────────
    {"name": "FE Banking",          "url": "https://www.financialexpress.com/banking-finance/feed/",                                          "category": "banking"},
    {"name": "FE Auto",             "url": "https://www.financialexpress.com/auto/feed/",                                                     "category": "auto"},
    {"name": "FE Defence",          "url": "https://www.financialexpress.com/defence/feed/",                                                  "category": "defence"},
    {"name": "FE Healthcare",       "url": "https://www.financialexpress.com/healthcare/feed/",                                               "category": "pharma"},
    {"name": "FE Infrastructure",   "url": "https://www.financialexpress.com/infrastructure/feed/",                                           "category": "industry"},

    # ── Regulatory / Government India ─────────────────────────────────────────────
    {"name": "SEBI Circulars",      "url": "https://www.sebi.gov.in/sebi_data/rss.xml",                                                       "category": "regulatory"},
    {"name": "NSE Announcements",   "url": "https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=&to_date=",         "category": "filings"},
    {"name": "MCA India",           "url": "https://www.mca.gov.in/content/mca/global/en/home.html",                                          "category": "regulatory"},
    {"name": "MOSPI Data",          "url": "http://mospi.gov.in/rss.xml",                                                                     "category": "macro"},
    {"name": "DPIIT News",          "url": "https://dpiit.gov.in/rss",                                                                        "category": "macro"},
    {"name": "CCI Orders",          "url": "https://cci.gov.in/rss",                                                                          "category": "regulatory"},
    {"name": "Income Tax India",    "url": "https://www.incometaxindia.gov.in/pages/press-releases.aspx",                                     "category": "macro"},
    {"name": "Finance Ministry",    "url": "https://www.finmin.nic.in/rss",                                                                   "category": "macro"},
    {"name": "PIB Economy",         "url": "https://pib.gov.in/RssMain.aspx?ModId=10&Lang=1",                                                 "category": "macro"},
    {"name": "PIB Industry",        "url": "https://pib.gov.in/RssMain.aspx?ModId=14&Lang=1",                                                 "category": "industry"},

    # ── More Indian News Portals ──────────────────────────────────────────────────
    {"name": "FirstPost Business",  "url": "https://www.firstpost.com/rss/business.xml",                                                      "category": "markets"},
    {"name": "TimesNow Business",   "url": "https://www.timesnownews.com/rss/business.cms",                                                   "category": "markets"},
    {"name": "Republic Business",   "url": "https://www.republicworld.com/rss/business.xml",                                                  "category": "markets"},
    {"name": "CNBCTV18 Markets",    "url": "https://www.cnbctv18.com/commonfeeds/v1/eng/rss/market.xml",                                      "category": "markets"},
    {"name": "CNBCTV18 Economy",    "url": "https://www.cnbctv18.com/commonfeeds/v1/eng/rss/economy.xml",                                     "category": "macro"},
    {"name": "CNBCTV18 Earnings",   "url": "https://www.cnbctv18.com/commonfeeds/v1/eng/rss/earnings.xml",                                    "category": "earnings"},
    {"name": "ET Now",              "url": "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",                            "category": "markets"},
    {"name": "Dalal Street",        "url": "https://www.dsij.in/rss/latestNews",                                                              "category": "stocks"},
    {"name": "Stock Master",        "url": "https://www.stockmaster.in/feed",                                                                 "category": "stocks"},
    {"name": "Rupeezy",             "url": "https://rupeezy.in/blog/feed/",                                                                   "category": "markets"},
    {"name": "Dhan Blog",           "url": "https://dhan.co/blog/feed/",                                                                      "category": "markets"},
    {"name": "Zerodha Z-Connect",   "url": "https://zerodha.com/z-connect/feed",                                                              "category": "markets"},
    {"name": "Varsity Zerodha",     "url": "https://zerodha.com/varsity/feed/",                                                               "category": "markets"},
    {"name": "5paisa Blog",         "url": "https://www.5paisa.com/blog/feed/",                                                               "category": "markets"},
    {"name": "Groww Blog",          "url": "https://groww.in/blog/feed",                                                                      "category": "markets"},
    {"name": "Angel One Blog",      "url": "https://www.angelone.in/blog/feed",                                                               "category": "markets"},
    {"name": "ICICI Direct Blog",   "url": "https://www.icicidirect.com/blog/feed",                                                           "category": "markets"},
    {"name": "HDFC Securities Blog","url": "https://www.hdfcsec.com/article/category/market-commentary/feed",                                 "category": "markets"},
    {"name": "Kotak Securities",    "url": "https://www.kotaksecurities.com/articles/feed",                                                   "category": "markets"},
    {"name": "Sharekhan Blog",      "url": "https://blog.sharekhan.com/feed",                                                                 "category": "markets"},
    {"name": "Motilal Oswal Blog",  "url": "https://www.motilaloswal.com/blog/rss.xml",                                                       "category": "markets"},
    {"name": "ICICI Securities",    "url": "https://www.icicisecurities.com/research/research-feed.aspx",                                     "category": "stocks"},

    # ── More International / Macro ────────────────────────────────────────────────
    {"name": "Project Syndicate",   "url": "https://www.project-syndicate.org/rss",                                                           "category": "macro"},
    {"name": "VoxEU.org",           "url": "https://cepr.org/voxeu/taxonomy/term/11/feed",                                                    "category": "macro"},
    {"name": "Brookings Economics", "url": "https://www.brookings.edu/topic/economic-studies/feed/",                                          "category": "macro"},
    {"name": "Peterson Institute",  "url": "https://www.piie.com/rss.xml",                                                                    "category": "macro"},
    {"name": "Cato Institute",      "url": "https://www.cato.org/rss/commentary.xml",                                                        "category": "macro"},
    {"name": "Council on FR",       "url": "https://www.cfr.org/rss.xml",                                                                    "category": "global"},
    {"name": "Chatham House",       "url": "https://www.chathamhouse.org/rss.xml",                                                            "category": "global"},
    {"name": "Wilson Center",       "url": "https://www.wilsoncenter.org/rss.xml",                                                            "category": "global"},
    {"name": "Bank of England",     "url": "https://www.bankofengland.co.uk/rss/publications",                                               "category": "macro"},
    {"name": "Bank of Japan",       "url": "https://www.boj.or.jp/en/rss/index.htm",                                                         "category": "macro"},
    {"name": "PBOC China",          "url": "http://www.pbc.gov.cn/rss/201403/c1ed7d00ca60430d8a2c98dffdf5b2db.xml",                          "category": "macro"},
    {"name": "RBA Australia",       "url": "https://www.rba.gov.au/rss/rss-news.xml",                                                        "category": "macro"},
    {"name": "ADB News",            "url": "https://www.adb.org/news/rss.xml",                                                               "category": "global"},
    {"name": "UN DESA News",        "url": "https://www.un.org/en/desa/news/rss.xml",                                                        "category": "macro"},
    {"name": "G20 News",            "url": "https://g20.org/en/media/rss.xml",                                                               "category": "global"},

    # ── More Reuters Sections ────────────────────────────────────────────────────
    {"name": "Reuters Asia",        "url": "https://feeds.reuters.com/reuters/AsiaBusinessNews",                                              "category": "global"},
    {"name": "Reuters Banking",     "url": "https://feeds.reuters.com/reuters/GCABankingandFinancialServices",                                "category": "banking"},
    {"name": "Reuters Healthcare",  "url": "https://feeds.reuters.com/reuters/healthNews",                                                    "category": "pharma"},
    {"name": "Reuters Energy",      "url": "https://feeds.reuters.com/reuters/companyNewsEnergy",                                             "category": "energy"},
    {"name": "Reuters Metals",      "url": "https://feeds.reuters.com/reuters/companyNewsMetals",                                             "category": "commodities"},
    {"name": "Reuters Agriculture", "url": "https://feeds.reuters.com/reuters/companyNewsAgriculture",                                        "category": "agri"},
    {"name": "Reuters Deals",       "url": "https://feeds.reuters.com/reuters/companyNewsMergers",                                            "category": "companies"},
    {"name": "Reuters IPOs",        "url": "https://feeds.reuters.com/reuters/companyNewsIPO",                                                "category": "ipo"},
    {"name": "Reuters Bonds",       "url": "https://feeds.reuters.com/reuters/companyNewsBonds",                                              "category": "bonds"},
    {"name": "Reuters Currencies",  "url": "https://feeds.reuters.com/reuters/currenciesNews",                                               "category": "forex"},

    # ── More CNBC International ──────────────────────────────────────────────────
    {"name": "CNBC Earnings",       "url": "https://www.cnbc.com/id/15839069/device/rss/rss.html",                                           "category": "earnings"},
    {"name": "CNBC Commodities",    "url": "https://www.cnbc.com/id/10000664/device/rss/rss.html",                                           "category": "commodities"},
    {"name": "CNBC Futures Now",    "url": "https://www.cnbc.com/id/100638669/device/rss/rss.html",                                          "category": "derivatives"},
    {"name": "CNBC ETF",            "url": "https://www.cnbc.com/id/100003114/device/rss/rss.html",                                          "category": "markets"},
    {"name": "CNBC Buffett Watch",  "url": "https://www.cnbc.com/id/100013220/device/rss/rss.html",                                          "category": "stocks"},
    {"name": "CNBC Europe",         "url": "https://www.cnbc.com/id/19794221/device/rss/rss.html",                                           "category": "global"},

    # ── More Crypto / Web3 ───────────────────────────────────────────────────────
    {"name": "Messari Crypto",      "url": "https://messari.io/rss",                                                                         "category": "crypto"},
    {"name": "Delphi Digital",      "url": "https://members.delphidigital.io/feed",                                                          "category": "crypto"},
    {"name": "Glassnode Insights",  "url": "https://insights.glassnode.com/rss/",                                                            "category": "crypto"},
    {"name": "Bankless",            "url": "https://bankless.substack.com/feed",                                                             "category": "crypto"},
    {"name": "The Defiant",         "url": "https://thedefiant.io/feed",                                                                     "category": "crypto"},
    {"name": "CoinMarketCap News",  "url": "https://coinmarketcap.com/headlines/news/rss/",                                                  "category": "crypto"},
    {"name": "Binance Blog",        "url": "https://www.binance.com/en/feed",                                                                "category": "crypto"},
    {"name": "Crypto.com Blog",     "url": "https://crypto.com/blog/feed",                                                                   "category": "crypto"},
    {"name": "WazirX Blog",         "url": "https://blog.wazirx.com/feed/",                                                                  "category": "crypto"},
    {"name": "CoinDCX Blog",        "url": "https://blog.coindcx.com/feed/",                                                                 "category": "crypto"},
    {"name": "Zebpay Blog",         "url": "https://blog.zebpay.com/feed/",                                                                  "category": "crypto"},
    {"name": "Mudrex Blog",         "url": "https://mudrex.com/blog/feed/",                                                                  "category": "crypto"},
    {"name": "CoinSwitch Blog",     "url": "https://blog.coinswitch.co/feed/",                                                               "category": "crypto"},
    {"name": "Nansen Research",     "url": "https://research.nansen.ai/rss",                                                                 "category": "crypto"},
    {"name": "Token Terminal",      "url": "https://tokenterminal.com/blog/rss",                                                             "category": "crypto"},

    # ── More Commodities / Energy ─────────────────────────────────────────────────
    {"name": "Natural Gas Intel",   "url": "https://www.naturalgasintel.com/rss",                                                            "category": "energy"},
    {"name": "Oil and Gas 360",     "url": "https://www.oilandgas360.com/feed/",                                                             "category": "energy"},
    {"name": "Rigzone",             "url": "https://www.rigzone.com/news/rss/rigzone_latest.aspx",                                           "category": "energy"},
    {"name": "World Oil",           "url": "https://www.worldoil.com/rss.xml",                                                               "category": "energy"},
    {"name": "Upstream Online",     "url": "https://www.upstreamonline.com/rss.xml",                                                         "category": "energy"},
    {"name": "Steel Guru",          "url": "https://steelguru.com/rss.xml",                                                                  "category": "commodities"},
    {"name": "Metal Miner",         "url": "https://agmetalminer.com/feed/",                                                                 "category": "commodities"},
    {"name": "SRSroccoReport",      "url": "https://srsroccoreport.com/feed/",                                                               "category": "commodities"},
    {"name": "World Gold Council",  "url": "https://www.gold.org/goldhub/data/rss.xml",                                                     "category": "commodities"},
    {"name": "Agweb Markets",       "url": "https://www.agweb.com/rss/news.rss",                                                            "category": "agri"},
    {"name": "Farm Journal",        "url": "https://www.agweb.com/rss/markets",                                                              "category": "agri"},
    {"name": "Rubber News",         "url": "https://www.rubbernews.com/rss.xml",                                                             "category": "commodities"},
    {"name": "Cotton Inc Blog",     "url": "https://cottoncultivated.cottoninc.com/feed/",                                                   "category": "commodities"},

    # ── Forex / Rates ─────────────────────────────────────────────────────────────
    {"name": "FXStreet",            "url": "https://www.fxstreet.com/rss",                                                                   "category": "forex"},
    {"name": "DailyFX",             "url": "https://www.dailyfx.com/feeds/all",                                                              "category": "forex"},
    {"name": "Forex Factory News",  "url": "https://www.forexfactory.com/ff_calendar_thisweek.xml",                                          "category": "forex"},
    {"name": "Forex Magnates",      "url": "https://forexmagnates.com/feed/",                                                                "category": "forex"},
    {"name": "Investopedia Forex",  "url": "https://www.investopedia.com/forex-4427765",                                                     "category": "forex"},
    {"name": "Myfxbook Blog",       "url": "https://www.myfxbook.com/rss",                                                                   "category": "forex"},
    {"name": "XE Blog",             "url": "https://www.xe.com/blog/feed",                                                                   "category": "forex"},
    {"name": "OANDA Blog",          "url": "https://www.oanda.com/blog/feed/",                                                               "category": "forex"},
    {"name": "BabyPips",            "url": "https://www.babypips.com/news/rss",                                                              "category": "forex"},
    {"name": "Macro Ops",           "url": "https://macro-ops.com/feed/",                                                                    "category": "macro"},

    # ── Bond / Fixed Income ───────────────────────────────────────────────────────
    {"name": "Finews Global",       "url": "https://www.finews.com/rss/news.rss",                                                            "category": "bonds"},
    {"name": "SIFMA Research",      "url": "https://www.sifma.org/resources/research/feed/",                                                 "category": "bonds"},
    {"name": "Debt Wire Asia",      "url": "https://www.debtwire.com/info/rss",                                                              "category": "bonds"},
    {"name": "Creditflux",          "url": "https://www.creditflux.com/rss.xml",                                                             "category": "bonds"},
    {"name": "GlobalCapital",       "url": "https://www.globalcapital.com/rss.xml",                                                          "category": "bonds"},

    # ── Private Equity / Venture / M&A ───────────────────────────────────────────
    {"name": "PE Hub",              "url": "https://www.pehub.com/feed/",                                                                    "category": "pe"},
    {"name": "Buyouts Insider",     "url": "https://www.buyoutsnews.com/feed/",                                                              "category": "pe"},
    {"name": "Merger Market",       "url": "https://www.mergermarket.com/rss/news.rss",                                                      "category": "pe"},
    {"name": "TechCrunch Startups", "url": "https://techcrunch.com/category/startups/feed/",                                                 "category": "startup"},
    {"name": "The Information",     "url": "https://www.theinformation.com/feed",                                                            "category": "tech"},
    {"name": "Hacker News",         "url": "https://hnrss.org/frontpage?q=stock+market+IPO+fintech",                                        "category": "tech"},
    {"name": "VCCircle",            "url": "https://www.vccircle.com/feed/",                                                                 "category": "pe"},
    {"name": "Deal Street Asia",    "url": "https://www.dealstreetasia.com/feed/",                                                           "category": "pe"},

    # ── Asia-Pacific Markets ──────────────────────────────────────────────────────
    {"name": "DBS Insights",        "url": "https://www.dbs.com/insights/rss.xml",                                                           "category": "global"},
    {"name": "HSBC Global Research","url": "https://www.research.hsbc.com/R/1/rss",                                                          "category": "global"},
    {"name": "CNA Business",        "url": "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=business",         "category": "global"},
    {"name": "Bangkok Post Biz",    "url": "https://www.bangkokpost.com/rss/data/business.xml",                                              "category": "global"},
    {"name": "Vietnam Biz",         "url": "https://en.vietstock.vn/rss",                                                                   "category": "global"},
    {"name": "Jakarta Post Biz",    "url": "https://www.thejakartapost.com/feed/topic/business",                                             "category": "global"},
    {"name": "Dawn Pakistan Biz",   "url": "https://www.dawn.com/feeds/business",                                                           "category": "global"},
    {"name": "Daily Star BD Biz",   "url": "https://www.thedailystar.net/business/rss.xml",                                                  "category": "global"},
    {"name": "Frontier Markets",    "url": "https://frontiermarkets.com/feed/",                                                              "category": "global"},
    {"name": "Emerging Markets",    "url": "https://www.emergingmarkets.org/rss",                                                            "category": "global"},

    # ── More Research / Analysis ──────────────────────────────────────────────────
    {"name": "Hussman Funds",       "url": "https://www.hussmanfunds.com/rss.xml",                                                           "category": "macro"},
    {"name": "GMO Research",        "url": "https://www.gmo.com/global/insights/rss",                                                        "category": "macro"},
    {"name": "AQR Research",        "url": "https://www.aqr.com/insights/research/rss",                                                     "category": "macro"},
    {"name": "Two Sigma Insights",  "url": "https://www.twosigma.com/insights/rss",                                                         "category": "macro"},
    {"name": "Credit Suisse India", "url": "https://www.credit-suisse.com/media/assets/microsite/docs/cg/rss.xml",                          "category": "global"},
    {"name": "Goldman Sachs IQ",    "url": "https://www.gsam.com/content/gsam/us/en/advisors/market-insights/rss",                          "category": "global"},
    {"name": "JPMorgan Insights",   "url": "https://www.jpmorgan.com/insights/research.rss",                                                "category": "global"},
    {"name": "Fidelity Viewpoints", "url": "https://www.fidelity.com/bin-public/060_www_fidelity_com/documents/rss/fidelity-viewpoints.rss","category": "global"},
    {"name": "Vanguard Research",   "url": "https://investors.vanguard.com/investor-resources-education/article/category/market-commentary/rss","category": "global"},
    {"name": "T Rowe Price",        "url": "https://www.troweprice.com/investment/insights/feed",                                           "category": "global"},
    {"name": "PIMCO Insights",      "url": "https://www.pimco.com/en-us/insights/rss",                                                      "category": "bonds"},
    {"name": "Invesco Insights",    "url": "https://www.invesco.com/us/rss/insights.rss",                                                   "category": "global"},
    {"name": "Nuveen Research",     "url": "https://www.nuveen.com/insights/rss",                                                           "category": "global"},

    # ── Social / Community ────────────────────────────────────────────────────────
    {"name": "Reddit NSEIndia",     "url": "https://www.reddit.com/r/NSEIndia/hot/.rss?limit=25",                                            "category": "social"},
    {"name": "Reddit InvIndia",     "url": "https://www.reddit.com/r/InvestingIndia/hot/.rss?limit=25",                                     "category": "social"},
    {"name": "Reddit PersonalFin",  "url": "https://www.reddit.com/r/personalfinanceindia/hot/.rss?limit=25",                               "category": "social"},
    {"name": "Reddit MutualFunds",  "url": "https://www.reddit.com/r/mutualfunds/hot/.rss?limit=25",                                        "category": "social"},
    {"name": "Reddit Cryptocurrency","url": "https://www.reddit.com/r/CryptoCurrency/hot/.rss?limit=25",                                    "category": "social"},
    {"name": "Reddit ETFs",         "url": "https://www.reddit.com/r/ETFs/hot/.rss?limit=25",                                               "category": "social"},
    {"name": "Reddit Dividends",    "url": "https://www.reddit.com/r/dividends/hot/.rss?limit=25",                                          "category": "social"},
    {"name": "Reddit ValueInv",     "url": "https://www.reddit.com/r/ValueInvesting/hot/.rss?limit=25",                                    "category": "social"},
    {"name": "Reddit options",      "url": "https://www.reddit.com/r/options/hot/.rss?limit=25",                                             "category": "social"},
    {"name": "Reddit pennystocks",  "url": "https://www.reddit.com/r/pennystocks/hot/.rss?limit=25",                                        "category": "social"},
    {"name": "Reddit IPO",          "url": "https://www.reddit.com/r/IPO/hot/.rss?limit=25",                                                "category": "ipo"},

    # ── Sector India Specific ─────────────────────────────────────────────────────
    {"name": "ET Hospital",         "url": "https://economictimes.indiatimes.com/industry/healthcare-biotech/hospitals/rssfeeds/19752929.cms","category": "pharma"},
    {"name": "ET Insurance",        "url": "https://economictimes.indiatimes.com/industry/banking/insurance/rssfeeds/13358177.cms",          "category": "insurance"},
    {"name": "ET Capital Goods",    "url": "https://economictimes.indiatimes.com/industry/indl-goods/svs/rssfeeds/13357282.cms",            "category": "industry"},
    {"name": "ET Paper",            "url": "https://economictimes.indiatimes.com/industry/indl-goods/svs/paper-/-wood-/-glass/rssfeeds/13357260.cms","category":"industry"},
    {"name": "ET Shipping",         "url": "https://economictimes.indiatimes.com/industry/transportation/shipping-/-transport/rssfeeds/1213610311.cms","category":"industry"},
    {"name": "ET Chemicals",        "url": "https://economictimes.indiatimes.com/industry/chemicals/rssfeeds/13359270.cms",                  "category": "industry"},
    {"name": "ET Fertilisers",      "url": "https://economictimes.indiatimes.com/industry/indl-goods/svs/chemicals-/-fertilisers/rssfeeds/13357264.cms","category":"industry"},
    {"name": "ET Power",            "url": "https://economictimes.indiatimes.com/industry/energy/power/rssfeeds/18429991.cms",               "category": "energy"},
    {"name": "ET Oil Gas",          "url": "https://economictimes.indiatimes.com/industry/energy/oil-gas/rssfeeds/18429990.cms",            "category": "energy"},
    {"name": "ET Renewables",       "url": "https://economictimes.indiatimes.com/industry/energy/renewables/rssfeeds/18429989.cms",         "category": "energy"},
    {"name": "ET Textile",          "url": "https://economictimes.indiatimes.com/industry/cons-products/garments-/-textiles/rssfeeds/1213610410.cms","category":"industry"},
    {"name": "ET Food",             "url": "https://economictimes.indiatimes.com/industry/cons-products/food/rssfeeds/1213610406.cms",       "category": "fmcg"},
    {"name": "ET Beverages",        "url": "https://economictimes.indiatimes.com/industry/cons-products/beverages/rssfeeds/1213610408.cms", "category": "fmcg"},
    {"name": "ET Tyres",            "url": "https://economictimes.indiatimes.com/industry/auto/auto-components-/rssfeeds/1072131717.cms",   "category": "auto"},
    {"name": "BL IT",               "url": "https://www.thehindubusinessline.com/info-tech/feed",                                           "category": "tech"},
    {"name": "BL Ports",            "url": "https://www.thehindubusinessline.com/economy/logistics/feed",                                   "category": "industry"},

    # ── IPO / SME Specific ────────────────────────────────────────────────────────
    {"name": "IPO Watch",           "url": "https://www.ipowatch.in/feed/",                                                                  "category": "ipo"},
    {"name": "Chittorgarh IPO",     "url": "https://www.chittorgarh.com/feed/",                                                             "category": "ipo"},
    {"name": "Investorgain",        "url": "https://www.investorgain.com/rss.xml",                                                           "category": "ipo"},
    {"name": "IPO Premier",         "url": "https://www.ipopremier.com/rss.xml",                                                            "category": "ipo"},
    {"name": "NSE SME Portal",      "url": "https://www.nseindia.com/rss/sme.xml",                                                          "category": "sme"},

    # ── Personal Finance / MF ─────────────────────────────────────────────────────
    {"name": "FundsIndia Blog",     "url": "https://blog.fundsindia.com/feed",                                                               "category": "mf"},
    {"name": "ET MF",               "url": "https://economictimes.indiatimes.com/mf/rssfeeds/13355714.cms",                                 "category": "mf"},
    {"name": "Paisabazaar Blog",    "url": "https://www.paisabazaar.com/blog/feed/",                                                        "category": "markets"},
    {"name": "PolicyBazaar Blog",   "url": "https://www.policybazaar.com/blog/feed/",                                                       "category": "insurance"},
    {"name": "Bankbazaar Blog",     "url": "https://www.bankbazaar.com/blog/rss",                                                           "category": "banking"},
    {"name": "Fisdom Blog",         "url": "https://www.fisdom.com/blog/feed/",                                                             "category": "markets"},
    {"name": "ET Wealth Online",    "url": "https://economictimes.indiatimes.com/wealth/rssfeeds/1054412.cms",                              "category": "markets"},

    # ── More South Asian / EM ────────────────────────────────────────────────────
    {"name": "Business Recorder PK","url": "https://www.brecorder.com/rss.xml",                                                             "category": "global"},
    {"name": "Daily FT Sri Lanka",  "url": "https://www.ft.lk/rss/news.rss",                                                               "category": "global"},
    {"name": "Financial Tribune IR","url": "https://financialtribune.com/rss.xml",                                                          "category": "global"},
    {"name": "Daily Star Lebanon",  "url": "https://www.dailystar.com.lb/Business.rss",                                                     "category": "global"},
    {"name": "Khaleej Times Biz",   "url": "https://www.khaleejtimes.com/feeds/business",                                                   "category": "global"},
    {"name": "Gulf News Business",  "url": "https://gulfnews.com/rss/business",                                                             "category": "global"},
    {"name": "Arab Gulf Business",  "url": "https://www.arabianbusiness.com/rss.xml",                                                       "category": "global"},

    # ── Fintech / Payments ───────────────────────────────────────────────────────
    {"name": "Payments Dive",       "url": "https://www.paymentsdive.com/feeds/news/",                                                      "category": "fintech"},
    {"name": "Finextra",            "url": "https://www.finextra.com/rss/headlines.xml",                                                    "category": "fintech"},
    {"name": "The Paypers",         "url": "https://thepaypers.com/rss/news.rss",                                                           "category": "fintech"},
    {"name": "Finovate",            "url": "https://finovate.com/feed/",                                                                    "category": "fintech"},
    {"name": "Medici Blog",         "url": "https://medici.letstalkpayments.com/feed/",                                                     "category": "fintech"},
    {"name": "Inc42 Fintech",       "url": "https://inc42.com/buzz/fintech/feed/",                                                          "category": "fintech"},
    {"name": "NPCI News",           "url": "https://www.npci.org.in/news-updates/rss",                                                      "category": "fintech"},
    {"name": "Digital Payments",    "url": "https://www.digitalpayments.in/feed/",                                                          "category": "fintech"},

    # ── Derivatives / Options India ───────────────────────────────────────────────
    {"name": "ET FnO",              "url": "https://economictimes.indiatimes.com/markets/futures-&-options/rssfeeds/1808978132.cms",        "category": "derivatives"},
    {"name": "MC FnO",              "url": "https://www.moneycontrol.com/rss/fno.xml",                                                      "category": "derivatives"},
    {"name": "NSE F&O Updates",     "url": "https://www.nseindia.com/rss/fno.xml",                                                          "category": "derivatives"},
    {"name": "Option Chain Guru",   "url": "https://www.optionchainguru.com/feed/",                                                         "category": "derivatives"},

    # ── Insurance / NBFC / Banking ────────────────────────────────────────────────
    {"name": "IRDAI News",          "url": "https://www.irdai.gov.in/rss/rss.xml",                                                          "category": "insurance"},
    {"name": "Insurance Times",     "url": "https://www.insurancetimes.co.uk/feed",                                                         "category": "insurance"},
    {"name": "Banking Frontiers",   "url": "https://bankingfrontiers.com/feed/",                                                            "category": "banking"},
    {"name": "The Hindu BL Banking","url": "https://www.thehindubusinessline.com/money-banking/feed",                                       "category": "banking"},
    {"name": "NBFC India",          "url": "https://nbfcindia.com/feed/",                                                                   "category": "banking"},
    {"name": "Microfinance Gateway","url": "https://www.microfinancegateway.org/rss.xml",                                                   "category": "banking"},

    # ── Real Estate India ─────────────────────────────────────────────────────────
    {"name": "Housing.com Blog",    "url": "https://housing.com/news/feed/",                                                                "category": "realty"},
    {"name": "99acres Blog",        "url": "https://www.99acres.com/articles/rss.aspx",                                                     "category": "realty"},
    {"name": "Magicbricks Blog",    "url": "https://www.magicbricks.com/blog/feed",                                                         "category": "realty"},
    {"name": "JLL India",           "url": "https://www.jll.co.in/en/newsroom.html.rss",                                                   "category": "realty"},
    {"name": "CREDAI",              "url": "https://credai.org/rss.xml",                                                                    "category": "realty"},

    # ── Sustainability / ESG India ────────────────────────────────────────────────
    {"name": "ET Climate",          "url": "https://economictimes.indiatimes.com/news/science/rssfeeds/17989705.cms",                       "category": "esg"},
    {"name": "Down To Earth",       "url": "https://www.downtoearth.org.in/rss/",                                                           "category": "esg"},
    {"name": "Mint Sustainability", "url": "https://www.livemint.com/rss/sustainability",                                                   "category": "esg"},
    {"name": "Mongabay India",      "url": "https://india.mongabay.com/feed/",                                                              "category": "esg"},

    # ── Quant / Algorithmic Trading ───────────────────────────────────────────────
    {"name": "Quantopian Blog",     "url": "https://blog.quantopian.com/feed/",                                                             "category": "quant"},
    {"name": "Quantlib News",       "url": "https://www.quantlib.org/rss.xml",                                                              "category": "quant"},
    {"name": "RobotJames Blog",     "url": "https://www.robotjames.com/feed/",                                                              "category": "quant"},
    {"name": "QuantConnect Blog",   "url": "https://www.quantconnect.com/blog/feed",                                                        "category": "quant"},
    {"name": "Systematic Investor", "url": "https://systematicinvestor.wordpress.com/feed/",                                                "category": "quant"},
    {"name": "PyQuant News",        "url": "https://pyquant.news/rss",                                                                     "category": "quant"},
    {"name": "Markowitz Blog",      "url": "https://blog.quantlib.org/feeds/posts/default",                                                 "category": "quant"},
    {"name": "Alpaca Blog",         "url": "https://alpaca.markets/blog/index.xml",                                                         "category": "quant"},

    # ── More Global Finance ───────────────────────────────────────────────────────
    {"name": "Bloomberg Quint",     "url": "https://www.bloombergquint.com/rss",                                                            "category": "markets"},
    {"name": "Mint ETF",            "url": "https://www.livemint.com/rss/etf",                                                              "category": "markets"},
    {"name": "MorningStar Asia",    "url": "https://www.morningstar.com.au/insights/rss",                                                   "category": "global"},
    {"name": "Nuveen ESG",          "url": "https://www.nuveen.com/esg/rss",                                                               "category": "esg"},
    {"name": "S&P Global Ratings",  "url": "https://www.spglobal.com/ratings/en/research-insights/rss/current-research",                   "category": "bonds"},
    {"name": "Moodys Insights",     "url": "https://www.moodys.com/rss/news.rss",                                                          "category": "bonds"},
    {"name": "Fitch Ratings",       "url": "https://www.fitchratings.com/research/rss",                                                    "category": "bonds"},
    {"name": "MSCI ESG Blog",       "url": "https://www.msci.com/esg-investing/rss",                                                       "category": "esg"},
    {"name": "BlackRock Blog",      "url": "https://www.blackrock.com/corporate/insights/blackrock-investment-institute/rss",              "category": "global"},

    # ── More India Fintech / Markets ──────────────────────────────────────────────
    {"name": "Upstox Blog",         "url": "https://upstox.com/blog/feed/",                                                                  "category": "markets"},
    {"name": "Smallcase Blog",      "url": "https://blog.smallcase.com/feed/",                                                               "category": "markets"},
    {"name": "WealthDesk Blog",     "url": "https://blog.wealthdesk.in/feed/",                                                               "category": "markets"},
    {"name": "Scripbox Blog",       "url": "https://scripbox.com/blog/feed/",                                                                "category": "markets"},
    {"name": "ET Wealth Invest",    "url": "https://economictimes.indiatimes.com/wealth/invest/rssfeeds/1054414.cms",                        "category": "markets"},
    {"name": "ET Wealth Tax",       "url": "https://economictimes.indiatimes.com/wealth/tax/rssfeeds/1054413.cms",                          "category": "macro"},
    {"name": "ET Wealth Save",      "url": "https://economictimes.indiatimes.com/wealth/save/rssfeeds/1054415.cms",                         "category": "markets"},
    {"name": "MC Portfolio",        "url": "https://www.moneycontrol.com/rss/portfolio-news.xml",                                           "category": "markets"},
    {"name": "MC Budget",           "url": "https://www.moneycontrol.com/rss/budget.xml",                                                   "category": "macro"},
    {"name": "BS MF",               "url": "https://www.business-standard.com/rss/personal-finance-105.rss",                               "category": "mf"},

    # ── More Tech / AI ────────────────────────────────────────────────────────────
    {"name": "IEEE Spectrum",       "url": "https://spectrum.ieee.org/feeds/feed.rss",                                                      "category": "tech"},
    {"name": "Nature Tech",         "url": "https://www.nature.com/subjects/technology/news.rss",                                           "category": "tech"},
    {"name": "Quanta Magazine",     "url": "https://www.quantamagazine.org/feed/",                                                          "category": "tech"},
    {"name": "AI News",             "url": "https://www.artificialintelligence-news.com/feed/",                                             "category": "tech"},
    {"name": "MIT AI Lab",          "url": "https://news.mit.edu/topic/artificial-intelligence2/feed",                                      "category": "tech"},
    {"name": "DeepMind Blog",       "url": "https://deepmind.google/blog/rss.xml",                                                          "category": "tech"},

    # ── Global Central Banks / Policy ─────────────────────────────────────────────
    {"name": "SNB Press",           "url": "https://www.snb.ch/en/mmr/aktuell/rss.xml",                                                    "category": "macro"},
    {"name": "Norges Bank",         "url": "https://www.norges-bank.no/rss/news",                                                          "category": "macro"},
    {"name": "Riksbank Sweden",     "url": "https://www.riksbank.se/en-gb/rss/news/",                                                      "category": "macro"},
    {"name": "DNB Norway",          "url": "https://www.dnb.no/om-oss/media/nyheter.rss",                                                  "category": "macro"},
    {"name": "ESRB Reports",        "url": "https://www.esrb.europa.eu/news/pr/rss.xml",                                                   "category": "macro"},
    {"name": "BIS WP",              "url": "https://www.bis.org/rss/all_press.rss",                                                        "category": "macro"},

    # ── More Sector India ─────────────────────────────────────────────────────────
    {"name": "ET Railways",         "url": "https://economictimes.indiatimes.com/industry/transportation/railways/rssfeeds/1213610313.cms","category":"industry"},
    {"name": "ET Logistics",        "url": "https://economictimes.indiatimes.com/industry/transportation/logistics/rssfeeds/1213610309.cms","category":"industry"},
    {"name": "ET Agriculture",      "url": "https://economictimes.indiatimes.com/news/economy/agriculture/rssfeeds/22011604.cms",          "category": "agri"},
    {"name": "ET Education",        "url": "https://economictimes.indiatimes.com/industry/services/education/rssfeeds/1213570709.cms",     "category": "services"},
    {"name": "ET Gaming",           "url": "https://economictimes.indiatimes.com/industry/media-entertainment-print-/gaming/rssfeeds/59483636.cms","category":"media"},
    {"name": "ET Sports Biz",       "url": "https://economictimes.indiatimes.com/industry/services/sports/rssfeeds/1213570707.cms",        "category": "services"},
    {"name": "SEBI Edge",           "url": "https://sebiedge.com/rss",                                                                     "category": "regulatory"},
    {"name": "NSEIndia News",       "url": "https://www.nseindia.com/rss/news.rss",                                                        "category": "markets"},
    {"name": "BSE India News",      "url": "https://www.bseindia.com/RSSFeeds/corporateannouncements.aspx",                                "category": "filings"},

    # ── Global Financial Media ────────────────────────────────────────────────────
    {"name": "Euromoney",           "url": "https://www.euromoney.com/feeds/news.rss",                                                     "category": "global"},
    {"name": "Risk.net",            "url": "https://www.risk.net/rss.xml",                                                                 "category": "macro"},
    {"name": "Finance Asia",        "url": "https://www.financeasia.com/rss",                                                              "category": "global"},
    {"name": "Asian Investor",      "url": "https://www.asianinvestor.net/rss/news",                                                       "category": "global"},
    {"name": "Hedge Week",          "url": "https://www.hedgeweek.com/rss",                                                               "category": "global"},
    {"name": "Private Equity Wire", "url": "https://www.privateequitywire.co.uk/rss",                                                     "category": "pe"},
    {"name": "Alt Assets",          "url": "https://www.altassets.net/rss.xml",                                                           "category": "pe"},
    {"name": "FundFire",            "url": "https://www.fundfire.com/rss",                                                                "category": "global"},
    {"name": "Trade Finance Global","url": "https://www.tradefinanceglobal.com/feed/",                                                    "category": "global"},
    {"name": "Global Finance Mag",  "url": "https://www.gfmag.com/rss.xml",                                                              "category": "global"},

    # ── More EM / Frontier ────────────────────────────────────────────────────────
    {"name": "Frontier Advisory",   "url": "https://frontieradvisory.com/rss",                                                            "category": "global"},
    {"name": "Emerging Markets Rev","url": "https://www.journals.elsevier.com/emerging-markets-review/rss",                              "category": "global"},
    {"name": "Africa Business",     "url": "https://african.business/feed/",                                                              "category": "global"},
    {"name": "Latin Finance",       "url": "https://latinfinance.com/feed",                                                              "category": "global"},

    # ── Commodity-specific ────────────────────────────────────────────────────────
    {"name": "Fertilizer Daily",    "url": "https://www.fertilizerworld.com/rss.xml",                                                     "category": "agri"},
    {"name": "Chemical Week",       "url": "https://www.chemweek.com/rss.xml",                                                           "category": "industry"},
    {"name": "ICIS News",           "url": "https://www.icis.com/explore/resources/news/rss/",                                           "category": "commodities"},
    {"name": "Metals Daily",        "url": "https://www.metalsdaily.com/rss.xml",                                                        "category": "commodities"},
    {"name": "Coffee Business Intel","url": "https://www.coffeeintelligence.com/feed/",                                                  "category": "agri"},
    {"name": "Dry Bulk News",       "url": "https://www.drybulknews.com/feed/",                                                         "category": "industry"},
]

COMMON_TICKERS = {
    "reliance": "RELIANCE", "tcs": "TCS", "infosys": "INFY", "wipro": "WIPRO",
    "hdfc bank": "HDFCBANK", "hdfc": "HDFCBANK", "icici bank": "ICICIBANK", "icici": "ICICIBANK",
    "sbi": "SBIN", "state bank": "SBIN", "axis bank": "AXISBANK", "kotak": "KOTAKBANK",
    "bajaj finance": "BAJFINANCE", "bajaj finserv": "BAJAJFINSV", "bajaj auto": "BAJAJ-AUTO",
    "larsen": "LT", "l&t": "LT", "maruti": "MARUTI", "tatamotors": "TATAMOTORS",
    "tata motors": "TATAMOTORS", "tata steel": "TATASTEEL", "jsw steel": "JSWSTEEL",
    "sun pharma": "SUNPHARMA", "dr. reddy": "DRREDDY", "dr reddy": "DRREDDY", "cipla": "CIPLA",
    "hul": "HINDUNILVR", "hindustan unilever": "HINDUNILVR", "itc": "ITC",
    "ongc": "ONGC", "ntpc": "NTPC", "power grid": "POWERGRID",
    "bharat petroleum": "BPCL", "bpcl": "BPCL", "ioc": "IOC", "indian oil": "IOC",
    "adani enterprises": "ADANIENT", "adani": "ADANIENT", "adani ports": "ADANIPORTS",
    "adani green": "ADANIGREEN", "adani power": "ADANIPOWER",
    "asian paints": "ASIANPAINT", "titan": "TITAN", "hcl tech": "HCLTECH",
    "tech mahindra": "TECHM", "ultratech": "ULTRACEMCO", "nestle": "NESTLEIND",
    "hero motocorp": "HEROMOTOCO", "m&m": "M&M", "mahindra": "M&M",
    "zomato": "ZOMATO", "paytm": "PAYTM", "nykaa": "NYKAA", "indigo": "INDIGO",
    "interglobe": "INDIGO", "irctc": "IRCTC", "coal india": "COALINDIA",
    "vedanta": "VEDL", "hindalco": "HINDALCO", "grasim": "GRASIM", "upl": "UPL",
    "eicher": "EICHERMOT", "apollo hospitals": "APOLLOHOSP", "apollo": "APOLLOHOSP",
    "divis labs": "DIVISLAB", "britannia": "BRITANNIA", "dabur": "DABUR",
    "pidilite": "PIDILITIND", "godrej": "GODREJCP", "havells": "HAVELLS",
    "dmart": "DMART", "avenue supermarts": "DMART", "infra.cx": "INFY",
    "siemens": "SIEMENS", "abb india": "ABB", "bosch": "BOSCHLTD",
    "tata consultancy": "TCS", "wipro technologies": "WIPRO",
    "hcl technologies": "HCLTECH", "mphasis": "MPHASIS", "ltimindtree": "LTIM",
    "persistent": "PERSISTENT", "coforge": "COFORGE", "hexaware": "HEXAWARE",
    "nifty": "NIFTY50", "sensex": "SENSEX", "bank nifty": "BANKNIFTY",
    "midcap": "NIFTY_MIDCAP", "smallcap": "NIFTY_SMALLCAP",
    "bitcoin": "BTC", "ethereum": "ETH", "crypto": "BTC",
}

SENTIMENT_POSITIVE = [
    "surge", "rally", "gain", "up", "rise", "positive", "strong", "beat", "outperform",
    "upgrade", "buy", "record high", "profit", "growth", "expansion", "wins", "contract",
    "deal", "acquisition", "merger", "turnaround", "recovery", "breakout", "bullish",
    "optimistic", "rebound", "earnings beat", "guidance raise", "dividend", "buyback",
    "inflow", "upgrade", "overweight", "strong buy", "accumulate", "add", "upside",
]
SENTIMENT_NEGATIVE = [
    "fall", "drop", "decline", "down", "loss", "weak", "miss", "underperform", "downgrade",
    "sell", "record low", "fraud", "penalty", "fine", "default", "resign", "crash", "probe",
    "investigation", "cut", "reduce", "bearish", "concern", "warning", "risk", "outflow",
    "sell-off", "slump", "plunge", "tumble", "halt", "circuit breaker", "suspended",
    "bankruptcy", "npa", "bad loan", "write-off", "impairment", "margin call",
]


def simple_sentiment(text: str) -> float:
    text_lower = text.lower()
    pos = sum(1 for w in SENTIMENT_POSITIVE if w in text_lower)
    neg = sum(1 for w in SENTIMENT_NEGATIVE if w in text_lower)
    total = pos + neg
    if total == 0:
        return 0.0
    return round((pos - neg) / total, 2)


def extract_ticker(text: str) -> Optional[str]:
    text_lower = text.lower()
    for keyword, ticker in COMMON_TICKERS.items():
        if keyword in text_lower:
            return ticker
    match = re.search(r'\b([A-Z]{2,10})\b', text)
    if match:
        candidate = match.group(1)
        skip = {"IN","THE","AND","FOR","NSE","BSE","RBI","SEBI","IPO","NFO","MF","FII","DII",
                "GDP","CPI","WPI","US","UK","EU","FED","ECB","IMF","CEO","CFO","AGM","EGM",
                "Q1","Q2","Q3","Q4","FY","PE","PB","EPS","ROE","PAT","EBITDA","CAGR"}
        if candidate not in skip:
            return candidate
    return None


def _news_id(headline: str, source: str) -> str:
    return hashlib.md5(f"{headline}{source}".encode()).hexdigest()[:16]


# ── Tiered polling intervals ──────────────────────────────────────────────────
# Priority = Indian market + breaking sources → 60s
# Regulatory = RBI/SEBI/PIB → 90s
# Standard = Global/crypto/sector → 180s

_PRIORITY_SOURCES: Set[str] = {
    "ET Markets", "ET Stocks", "ET Economy", "ET Banking", "ET Mutual Funds",
    "ET IPO", "ET Commodities", "ET Forex", "ET Derivatives",
    "Mint Markets", "Mint Companies", "Mint Economy", "Mint News", "Mint Money",
    "MC Latest", "MC Markets", "MC Business", "MC Economy", "MC Banking",
    "BS Markets", "BS Economy", "BS Companies", "BS Finance",
    "FE Markets", "FE Economy", "FE Business",
    "NDTV Profit", "Zee Business",
    "BL Markets", "BL Economy", "BL Companies",
}
_REGULATORY_SOURCES: Set[str] = {
    "RBI Press", "PIB Finance", "PIB Commerce", "DGFT Notifications",
    "Insurance Regulatory", "AMFI",
}


class NewsAgent:
    def __init__(self, ws_broadcast: Optional[Callable] = None):
        self._broadcast = ws_broadcast
        self._running = False
        self._seen_ids: set = set()
        self._session: Optional[aiohttp.ClientSession] = None
        self._batch_size = 15  # concurrent feed requests — limit to prevent thread pool saturation

        # Define intervals FIRST — used below for staggered startup timestamps
        self._PRIORITY_INTERVAL    = 60    # 1 min  — Indian market feeds
        self._REGULATORY_INTERVAL  = 90    # 90 sec — RBI/SEBI/PIB
        self._STANDARD_INTERVAL    = 180   # 3 min  — global/crypto/sector

        # Tiered scheduling timestamps — stagger by 30/60/120s on startup to let server settle
        _now = time.time()
        self._last_priority_poll: float   = _now - (self._PRIORITY_INTERVAL   - 30)
        self._last_regulatory_poll: float = _now - (self._REGULATORY_INTERVAL - 60)
        self._last_standard_poll: float   = _now - (self._STANDARD_INTERVAL   - 120)

        self._priority_feeds   = [f for f in RSS_FEEDS if f["name"] in _PRIORITY_SOURCES]
        self._regulatory_feeds = [f for f in RSS_FEEDS if f["name"] in _REGULATORY_SOURCES]
        self._standard_feeds   = [f for f in RSS_FEEDS
                                   if f["name"] not in _PRIORITY_SOURCES
                                   and f["name"] not in _REGULATORY_SOURCES]

    async def start(self):
        self._running = True
        logger.info(
            "NewsAgent started — %d feeds (%d priority, %d regulatory, %d standard)",
            len(RSS_FEEDS), len(self._priority_feeds),
            len(self._regulatory_feeds), len(self._standard_feeds),
        )
        await self._load_seen_ids()

        # Kick off background FinBERT rescoring of old rule-based news
        asyncio.create_task(self._rescore_old_news_with_finbert())

        # Kick off NSE/BSE direct announcements poller (< 30s latency)
        asyncio.create_task(self._nse_bse_announcements_poller())

        while self._running:
            AgentHeartbeat.beat("news")
            now = time.time()
            try:
                if now - self._last_priority_poll >= self._PRIORITY_INTERVAL:
                    await self._poll_feeds(self._priority_feeds)
                    self._last_priority_poll = time.time()

                if now - self._last_regulatory_poll >= self._REGULATORY_INTERVAL:
                    await self._poll_feeds(self._regulatory_feeds)
                    self._last_regulatory_poll = time.time()

                if now - self._last_standard_poll >= self._STANDARD_INTERVAL:
                    await self._poll_feeds(self._standard_feeds)
                    self._last_standard_poll = time.time()

            except Exception as e:
                logger.error("NewsAgent poll error: %s", e)

            await heartbeat_sleep("news", 15)  # check schedule every 15s

    # ── NSE/BSE Direct Announcements Poller (< 30s latency) ──────────────────
    # This is the fastest path for corporate announcements — polling NSE's own API
    # directly rather than waiting for RSS feeds to update (1-3 min lag).
    # Priority: URGENT = board meetings, results, dividends, mergers, acquisitions.
    #           HIGH    = other exchange filings.
    #           MEDIUM  = routine corporate disclosures.

    NSE_ANNC_URL = "https://www.nseindia.com/api/corporate-announcements?index=equities"
    BSE_ANNC_URL = "https://api.bseindia.com/BseIndiaAPI/api/AnnounceResultGet/w?scripcode=&scode=&strCat=-1&strPrevDate=&strScrip=&strSearch=P&strToDate=&strType=C&subcategory=-1"
    SEBI_URL     = "https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=18"

    # URGENT keywords: these get broadcast IMMEDIATELY (don't wait for batch)
    _URGENT_KEYWORDS = {
        "board meeting", "results", "quarterly", "dividend", "bonus",
        "merger", "acquisition", "scheme", "demerger", "open offer",
        "rights issue", "buyback", "ipo", "delisting", "amalgam",
        "closure of trading window", "financial results", "press release",
        "halt", "suspend", "circuit", "probe", "sebi order",
        "q1", "q2", "q3", "q4", "fy25", "fy26",
    }

    async def _nse_bse_announcements_poller(self):
        """
        Poll NSE corporate announcements API every 30s.
        Much faster than RSS (RSS has 1-5 min lag; this has < 30s).
        Also polls BSE every 45s.
        """
        NSE_INTERVAL = 30   # seconds
        BSE_INTERVAL = 45
        SEBI_INTERVAL = 120

        last_nse  = 0.0
        last_bse  = 0.0
        last_sebi = 0.0

        session = None

        logger.info("NSE/BSE direct announcements poller started (30s/45s intervals)")

        while self._running:
            try:
                now = time.time()

                if session is None or session.closed:
                    session = aiohttp.ClientSession(
                        timeout=aiohttp.ClientTimeout(total=10),
                        connector=aiohttp.TCPConnector(ssl=False),
                        headers={
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                            "Referer": "https://www.nseindia.com/",
                            "Accept": "application/json, text/plain, */*",
                            "Accept-Language": "en-US,en;q=0.9",
                            "X-Requested-With": "XMLHttpRequest",
                        },
                        cookie_jar=aiohttp.CookieJar(unsafe=True),
                    )

                # ── NSE corporate announcements ───────────────────────────────
                if now - last_nse >= NSE_INTERVAL:
                    try:
                        # NSE requires a session cookie — first hit the main page
                        await session.get("https://www.nseindia.com/", timeout=aiohttp.ClientTimeout(total=5))
                        async with session.get(self.NSE_ANNC_URL) as resp:
                            if resp.status == 200:
                                data = await resp.json(content_type=None)
                                announcements = data if isinstance(data, list) else data.get("data", [])
                                new_count = await self._process_nse_announcements(announcements[:50])
                                if new_count > 0:
                                    logger.info("NSE direct: %d new announcements", new_count)
                    except Exception as e:
                        logger.debug("NSE direct poll error: %s", e)
                    last_nse = time.time()

                # ── BSE corporate announcements ───────────────────────────────
                if now - last_bse >= BSE_INTERVAL:
                    try:
                        async with session.get(self.BSE_ANNC_URL) as resp:
                            if resp.status == 200:
                                data = await resp.json(content_type=None)
                                announcements = data.get("Table", []) if isinstance(data, dict) else []
                                new_count = await self._process_bse_announcements(announcements[:50])
                                if new_count > 0:
                                    logger.info("BSE direct: %d new announcements", new_count)
                    except Exception as e:
                        logger.debug("BSE direct poll error: %s", e)
                    last_bse = time.time()

            except Exception as e:
                logger.warning("NSE/BSE poller error: %s", e)
                if session and not session.closed:
                    await session.close()
                    session = None

            await asyncio.sleep(10)  # check every 10s — NSE/BSE poll logic handles own intervals

        if session and not session.closed:
            await session.close()

    async def _process_nse_announcements(self, announcements: list) -> int:
        """Process NSE JSON announcements → DB + WebSocket broadcast."""
        db = await get_sqlite()
        new_count = 0
        for ann in announcements:
            try:
                subject   = ann.get("subject", ann.get("desc", "")).strip()
                symbol    = ann.get("symbol", ann.get("sm_isin", "")).strip()
                company   = ann.get("sm_name", ann.get("corp", symbol)).strip()
                ann_date  = ann.get("exchdisstime", ann.get("date", ""))
                url       = ann.get("attchmntFile", ann.get("attachment", ""))
                cat       = ann.get("sort_date", ann.get("category", "corporate"))

                if not subject or len(subject) < 5:
                    continue

                news_id = _news_id(subject, f"NSE:{symbol}")
                if news_id in self._seen_ids:
                    continue
                self._seen_ids.add(news_id)

                # Determine urgency
                subj_lower = subject.lower()
                is_urgent  = any(kw in subj_lower for kw in self._URGENT_KEYWORDS)
                ticker     = symbol.replace(" ", "") or extract_ticker(subject)

                # Score sentiment
                try:
                    from agents.finbert_scorer import score_text_async as _ft_score
                    sentiment = await _ft_score(subject)
                except Exception:
                    sentiment = simple_sentiment(subject)

                # Store in news table (same table as RSS, appears in all news feeds)
                await db.execute(
                    """INSERT OR IGNORE INTO news
                       (ticker, headline, summary, source, url, published_at, sentiment, category)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (ticker, subject, company, "NSE Direct",
                     url, str(ann_date), sentiment, "filings")
                )
                # Also store in filings table for FilingsPanel
                await db.execute(
                    """INSERT OR IGNORE INTO filings
                       (symbol, company_name, subject, category, filing_date, url, exchange)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (ticker, company, subject, "corporate", str(ann_date), url, "NSE")
                )
                await db.commit()
                new_count += 1

                # Broadcast URGENT items immediately
                if self._broadcast and is_urgent:
                    await self._broadcast({
                        "type": "filing",
                        "data": {
                            "symbol": ticker,
                            "company_name": company,
                            "subject": subject,
                            "filing_date": str(ann_date),
                            "category": "corporate",
                            "url": url,
                            "exchange": "NSE",
                            "urgency": "URGENT",
                            "sentiment": sentiment,
                        }
                    })

            except Exception as e:
                logger.debug("NSE ann process: %s", e)

        return new_count

    async def _process_bse_announcements(self, announcements: list) -> int:
        """Process BSE JSON announcements → DB + WebSocket broadcast."""
        db = await get_sqlite()
        new_count = 0
        for ann in announcements:
            try:
                subject  = ann.get("HEADLINE", ann.get("headline", "")).strip()
                symbol   = ann.get("SCRIP_CD", ann.get("scrip_cd", "")).strip()
                company  = ann.get("SLONGNAME", ann.get("company_name", symbol)).strip()
                ann_date = ann.get("NEWS_DT", ann.get("news_dt", ""))
                url      = ann.get("ATTACHMENTNAME", ann.get("attachment", ""))

                if not subject or len(subject) < 5:
                    continue

                news_id = _news_id(subject, f"BSE:{symbol}")
                if news_id in self._seen_ids:
                    continue
                self._seen_ids.add(news_id)

                subj_lower = subject.lower()
                is_urgent  = any(kw in subj_lower for kw in self._URGENT_KEYWORDS)
                ticker     = extract_ticker(subject + " " + company) or symbol

                try:
                    from agents.finbert_scorer import score_text_async as _ft_score
                    sentiment = await _ft_score(subject)
                except Exception:
                    sentiment = simple_sentiment(subject)

                await db.execute(
                    """INSERT OR IGNORE INTO news
                       (ticker, headline, summary, source, url, published_at, sentiment, category)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (ticker, subject, company, "BSE Direct",
                     url, str(ann_date), sentiment, "filings")
                )
                await db.execute(
                    """INSERT OR IGNORE INTO filings
                       (symbol, company_name, subject, category, filing_date, url, exchange)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (ticker, company, subject, "corporate", str(ann_date), url, "BSE")
                )
                await db.commit()
                new_count += 1

                if self._broadcast and is_urgent:
                    await self._broadcast({
                        "type": "filing",
                        "data": {
                            "symbol": ticker,
                            "company_name": company,
                            "subject": subject,
                            "filing_date": str(ann_date),
                            "category": "corporate",
                            "url": url,
                            "exchange": "BSE",
                            "urgency": "URGENT",
                            "sentiment": sentiment,
                        }
                    })

            except Exception as e:
                logger.debug("BSE ann process: %s", e)

        return new_count

    async def _rescore_old_news_with_finbert(self):
        """Background: rescore news items that were scored by rule-based before FinBERT loaded."""
        await asyncio.sleep(30)  # wait for FinBERT to load on GPU
        try:
            from agents.finbert_scorer import score_batch_async, is_gpu_active
            if not is_gpu_active():
                logger.info("FinBERT not on GPU — skipping batch rescore")
                return

            db = await get_sqlite()
            # Get news items with suspiciously round-number sentiments (rule-based artefacts)
            async with db.execute(
                """SELECT id, headline, summary FROM news
                   WHERE published_at > datetime('now', '-3 days')
                   ORDER BY published_at DESC LIMIT 1000"""
            ) as c:
                rows = await c.fetchall()

            if not rows:
                return

            logger.info("FinBERT rescoring %d news items on GPU…", len(rows))

            ids    = [r[0] for r in rows]
            texts  = [(r[1] or '') + ' ' + (r[2] or '')[:200] for r in rows]

            # Batch score on GPU (32 at a time) — runs on the dedicated FinBERT
            # thread (score_batch_async) so it never blocks the event loop.
            scores = await asyncio.wait_for(
                score_batch_async(texts, 32),
                timeout=120.0
            )

            # Update DB in chunks
            for i, (news_id, score) in enumerate(zip(ids, scores)):
                await db.execute("UPDATE news SET sentiment=? WHERE id=?", (score, news_id))
                if i % 100 == 0:
                    await db.commit()
                    await asyncio.sleep(0)  # yield to event loop

            await db.commit()
            logger.info("FinBERT GPU rescore complete: %d items updated", len(ids))

        except Exception as e:
            logger.warning("FinBERT rescore error: %s", e)

    async def stop(self):
        self._running = False
        if self._session and not self._session.closed:
            await self._session.close()

    async def _load_seen_ids(self):
        try:
            db = await get_sqlite()
            async with db.execute(
                "SELECT headline, source FROM news ORDER BY created_at DESC LIMIT 2000"
            ) as cur:
                rows = await cur.fetchall()
            for r in rows:
                self._seen_ids.add(_news_id(r[0], r[1]))
            logger.info("Loaded %d seen news IDs", len(self._seen_ids))
        except Exception as e:
            logger.error("load_seen_ids: %s", e)

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=12)
            self._session = aiohttp.ClientSession(
                timeout=timeout,
                connector=aiohttp.TCPConnector(ssl=False, limit=30),
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Accept": "application/rss+xml, application/xml, text/xml, */*",
                    "Accept-Encoding": "gzip, deflate",
                },
            )
        return self._session

    async def _poll_feeds(self, feeds: List[Dict]):
        """Poll a list of feeds in batches. Called independently per tier."""
        if not feeds:
            return
        total_new = 0
        for i in range(0, len(feeds), self._batch_size):
            AgentHeartbeat.beat("news")  # beat per batch — a slow 500-feed sweep must not look dead
            batch = feeds[i:i + self._batch_size]
            tasks = [self._poll_feed(feed) for feed in batch]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            total_new += sum(r for r in results if isinstance(r, int))
        if total_new > 0:
            logger.info("NewsAgent: %d new articles ingested from %d feeds", total_new, len(feeds))

    async def _poll_feed(self, feed: Dict) -> int:
        new_count = 0
        try:
            session = await self._get_session()
            async with session.get(feed["url"]) as resp:
                if resp.status != 200:
                    return 0
                raw = await resp.read()
                # Detect encoding from Content-Type or XML declaration; fall back to utf-8
                ct = resp.headers.get("Content-Type", "")
                enc = resp.charset  # aiohttp detected charset
                if not enc:
                    import re as _re
                    m = _re.search(rb'encoding=["\']([^"\']+)', raw[:200])
                    enc = m.group(1).decode() if m else "utf-8"
                try:
                    content = raw.decode(enc, errors="replace")
                except (LookupError, UnicodeDecodeError):
                    content = raw.decode("utf-8", errors="replace")

            # feedparser.parse is CPU-bound (XML/HTML parsing) — run in executor
            loop = asyncio.get_event_loop()
            parsed = await loop.run_in_executor(None, feedparser.parse, content)
            db = await get_sqlite()

            for entry in parsed.entries[:15]:
                headline = entry.get("title", "").strip()
                if not headline or len(headline) < 10:
                    continue

                news_id = _news_id(headline, feed["name"])
                if news_id in self._seen_ids:
                    continue

                self._seen_ids.add(news_id)
                summary = entry.get("summary", entry.get("description", ""))
                url = entry.get("link", "")
                published = entry.get("published", entry.get("updated", datetime.now().isoformat()))
                full_text = headline + " " + (summary or "")
                ticker = extract_ticker(full_text)
                # Use FinBERT if available, else rule-based
                try:
                    from agents.finbert_scorer import score_text_async as _ft_score
                    sentiment = await _ft_score(full_text)
                except Exception:
                    sentiment = simple_sentiment(full_text)

                try:
                    await db.execute(
                        """INSERT OR IGNORE INTO news
                           (ticker, headline, summary, source, url, published_at, sentiment, category)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (ticker, headline, summary[:500] if summary else None,
                         feed["name"], url, str(published), sentiment, feed["category"])
                    )
                    await db.commit()
                    new_count += 1

                    if self._broadcast and (abs(sentiment) > 0.3 or new_count <= 3):
                        await self._broadcast({
                            "type": "news",
                            "data": {
                                "ticker": ticker,
                                "headline": headline,
                                "source": feed["name"],
                                "published_at": str(published),
                                "sentiment": sentiment,
                                "category": feed["category"],
                                "url": url,
                            }
                        })
                except Exception as e:
                    logger.debug("Insert news: %s", e)

        except asyncio.TimeoutError:
            logger.debug("Feed timeout: %s", feed["name"])
        except Exception as e:
            logger.debug("Feed error %s: %s", feed["name"], e)

        return new_count

    async def get_latest_news(self, ticker: Optional[str] = None, limit: int = 50) -> List[Dict]:
        try:
            db = await get_sqlite()
            if ticker:
                async with db.execute(
                    """SELECT id, ticker, headline, summary, source, url, published_at, sentiment, category, created_at
                       FROM news WHERE ticker = ? ORDER BY created_at DESC, id DESC LIMIT ?""",
                    (ticker, limit)
                ) as cur:
                    rows = await cur.fetchall()
            else:
                async with db.execute(
                    """SELECT id, ticker, headline, summary, source, url, published_at, sentiment, category, created_at
                       FROM news ORDER BY created_at DESC, id DESC LIMIT ?""",
                    (limit,)
                ) as cur:
                    rows = await cur.fetchall()

            return [
                {"id": r[0], "ticker": r[1], "headline": r[2], "summary": r[3],
                 "source": r[4], "url": r[5], "published_at": r[6],
                 "sentiment": r[7], "category": r[8], "created_at": r[9]}
                for r in rows
            ]
        except Exception as e:
            logger.error("get_latest_news: %s", e)
            return []
