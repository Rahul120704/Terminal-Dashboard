# Bloomberg Terminal India (BTI)

A production-ready Bloomberg Terminal replica for NSE/BSE Indian stock markets.

## Features

| Module | Details |
|--------|---------|
| **Live Quotes** | Every NSE/BSE ticker via WebSocket, 5-second refresh |
| **Charts** | Candlestick + Volume, 5m/15m/1h/1d/1wk/1mo, TradingView Lightweight Charts |
| **Technical Indicators** | EMA 20/50/200, SMA, RSI, MACD, Bollinger Bands, VWAP, ATR, ADX, Stochastics, Ichimoku |
| **Fundamentals** | P&L, Balance Sheet, Cash Flow, Shareholding, Peers — from screener.in + yfinance |
| **News** | 8+ RSS feeds (ET, Mint, MoneyControl, BS, Reuters), sentiment-scored, per-ticker |
| **Filings** | NSE + BSE announcements, polling every 2 min, impact-classified (HIGH/MEDIUM/LOW) |
| **Earnings Calendar** | Upcoming + past results, YoY growth, EPS/Revenue surprise |
| **Options Chain** | Full chain with OI buildup, PCR, Max Pain, IV Skew, Unusual Activity detection |
| **Volume Shockers** | Daily volume ≥ 2x 20-day average, auto-scanned every 30 min |
| **Insider Activity** | NSE SAST disclosures + Block/Bulk deals |
| **FII/DII Flows** | Daily institutional flows from NSE, 30-day chart |
| **Macro Dashboard** | RBI rates, India VIX, USD/INR, crude, gold, US markets, World Bank indicators |
| **Sector Heatmap** | 12 sectors, color-coded by performance, drill to individual stocks |
| **Sentiment Analysis** | Bull/Bear regime, PCR, VIX, A/D ratio, news sentiment, EMA positioning |
| **Guardian Agent** | Auto-heals crashed agents, monitors CPU/memory/disk, restarts services |

## Quick Start

```powershell
# 1. Setup (run once)
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

# 2. Start everything
powershell -ExecutionPolicy Bypass -File scripts\start.ps1

# 3. Open browser
# http://localhost:8000   (production — built React served by FastAPI)
# http://localhost:3000   (dev — React dev server with hot reload)
```

## Development Mode (hot reload)
```powershell
# Terminal 1 — Backend
cd backend
venv\Scripts\python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — Frontend
cd frontend
npm start
```

## Manual Guardian
```powershell
# Run standalone guardian (monitors backend process, restarts on crash)
python scripts\guardian.py
```

## Keyboard Shortcuts

| Key | View |
|-----|------|
| F1 | Dashboard |
| F2 | Chart |
| F3 | Fundamentals |
| F4 | News |
| F5 | Filings |
| F6 | Earnings Calendar |
| F7 | Options Chain |
| F8 | Insider Activity |
| F9 | Macro Dashboard |
| F10 | Sector Heatmap |
| F11 | Guardian Status |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/quote/{symbol}` | Live quote for a symbol |
| `GET /api/ohlcv/{symbol}?period=1y&interval=1d` | Historical OHLCV |
| `GET /api/fundamentals/{symbol}` | Full fundamentals |
| `GET /api/options/{symbol}` | Options chain |
| `GET /api/news?ticker=RELIANCE` | News feed |
| `GET /api/filings?symbol=TCS` | Exchange filings |
| `GET /api/earnings` | Earnings calendar |
| `GET /api/insider-trades` | Insider trading |
| `GET /api/macro` | Macro dashboard |
| `GET /api/sentiment` | Market sentiment |
| `GET /api/technicals/{symbol}` | Technical indicators |
| `GET /api/volume-shockers` | Volume shockers |
| `GET /api/fii-dii` | FII/DII flows |
| `GET /api/indices` | All NSE indices |
| `GET /api/gainers-losers` | Top movers |
| `WS /ws` | Live data WebSocket |
| `GET /docs` | Swagger API docs |

## Architecture

```
Browser (React+TS)  ←—WebSocket——→  FastAPI Backend
    lightweight-charts               │
    recharts                         ├── NewsAgent (RSS, 3min)
    TypeScript types                 ├── FilingsAgent (NSE/BSE, 2min)
                                     ├── MacroAgent (yfinance, 5min)
                                     ├── TechnicalsAgent (1d, 15min)
                                     ├── SentimentAgent (5min)
                                     ├── GuardianAgent (30s watchdog)
                                     │
                                     ├── DuckDB (OHLCV history)
                                     ├── SQLite (news/filings/meta)
                                     └── Redis/Memurai (live cache, optional)
```

## Data Sources

- **yfinance** — OHLCV, quotes, fundamentals
- **NSE Unofficial API** — Options chain, announcements, FII/DII, block deals
- **BSE API** — Corporate announcements
- **screener.in** — Detailed Indian fundamentals, shareholding, quarterly results
- **RSS Feeds** — ET, Mint, MoneyControl, BS, NDTV Profit, Reuters
- **World Bank API** — CPI, GDP, macroeconomic indicators
- **RBI** — Policy rates

## Notes

- Redis/Memurai is optional — system degrades gracefully without it
- NSE API requires cookie-based sessions (auto-handled by NSESession class)
- Rate limits apply to screener.in scraping — fundamentals refresh every 5 minutes
- All times displayed in IST
