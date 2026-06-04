# Bloomberg Terminal India (BTI)

A production-ready Bloomberg Terminal replica for NSE/BSE Indian markets — real-time ticks, 55 panels, GPU-accelerated ML, and a micro-frontend architecture.

**Backend:** FastAPI + WebSockets · Port 8000  
**Frontend:** React 18 + TypeScript + Vite · Port 3000  
**Electron:** Optional desktop wrapper

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI, aiosqlite, DuckDB, Fyers API v3 |
| Frontend | React 18, TypeScript, Vite 5, Zustand, Lightweight Charts |
| ML / AI | PyTorch 2.11 (CUDA 13.2), FinBERT, XGBoost 3.2 GPU, scikit-learn |
| MFE | vite-plugin-federation, RxJS event bus, Bloomberg mnemonic CLI |
| Desktop | Electron 28 |
| Databases | DuckDB (OHLCV), SQLite (news/filings/meta) |

---

## Features

### Market Data
- Live WebSocket ticks via Fyers API — 33 NSE equity symbols, 33ms batch broadcast
- Index tiles: Nifty 50, Bank Nifty, India VIX, Nifty IT, Nifty 100
- Candlestick charts with EMA/SMA/RSI/MACD/BB/VWAP/ATR/Ichimoku sub-panes
- Market Depth (Level 2 order book), tick-level price updates via direct DOM mutation
- Gainers / Losers, Volume Shockers (≥2× 20d avg), Sector Heatmap

### Intelligence & AI
- **FinBERT** (`ProsusAI/finbert`) — GPU batch sentiment scoring, retroactive 3-day rescore on startup
- **XGBoost GPU** — 13-factor model (momentum, volatility, RSI, SMA ratios, FinBERT sentiment) → 20-day return direction prediction
- **AI Copilot** — Claude / Ollama / rule-based expert system chain with session memory and 10 quick prompts
- **Anomaly Detector** — 3σ z-score on price and volume, real-time alerts
- **Earnings Predictor** — Beat probability for 30-stock calendar (Q4FY26 / Q1FY27)
- **Filings Summarizer** — LLM impact classification (HIGH / MEDIUM / LOW) + summaries

### Hedge Fund Team (8 Agents + PM Orchestrator)
| Agent | Role | Interval |
|-------|------|----------|
| ResearchAgent | Quality score: ROCE, ROE, D/E, P/E, promoter holding | 10 min |
| AnalystAgent | BUY / SELL / HOLD — momentum + fundamentals | 5 min |
| RiskAnalystAgent | India VIX, US VIX, Nifty vs SMA200, FII flows | 2 min |
| DataScientistAgent | XGBoost GPU — 13-factor signal | 15 min |
| SentimentAnalystAgent | FinBERT aggregated per ticker + sector | 3 min |
| NewsFinderAgent | Alert triage: CRITICAL / HIGH / MEDIUM | 1 min |
| GlobalMacroAgent | RBI, FII, USD/INR, crude, GIFT Nifty, regime | 5 min |
| PortfolioManagerAgent | Orchestrator — blends all signals → APPROVED BUY / AVOID | 5 min |

### News & Filings
- **508 RSS feeds** across 20+ categories (global, macro, markets, crypto, commodities, tech…)
- FinBERT GPU sentiment per article, trending tickers extraction, search + filter UI
- NSE + BSE exchange filings polled every 2 min, AI-classified by impact

### Quant Tools
- **IV Surface** — Black-Scholes implied volatility heatmap (moneyness × DTE), ATM term structure, PCR
- **Backtester** — Polars vectorized engine, 4 strategies, Sharpe / Sortino / Calmar metrics, SVG equity curve
- **Options Chain** — Full chain with OI buildup, Max Pain, IV skew, unusual activity

### Micro-Frontend Architecture
- Bloomberg-style amber CLI bar — type any mnemonic (DES, GP, YCRV…) to load a panel
- Module Federation via `vite-plugin-federation` — remotes load from `/mfe/<slug>/assets/remoteEntry.js`
- **DES remote** — company deep-dive (quote bar, tabs, financial ratios, cross-navigation)
- **GP remote** — TradingView-style OHLCV chart with period / type / indicator toolbar
- RxJS typed event bus (`TICKER_CHANGE`, `PANEL_NAVIGATE`…) for shell ↔ remote communication
- Same-origin hosting: Vite middleware in dev, FastAPI `StaticFiles` in prod

### Other Panels (55 total)
Portfolio tracker, Price Alerts, Watchlist, Economic Calendar, Screener (8 presets), FII/DII Flows, Insider Activity, Block/Bulk Deals, Shareholding, Peer Comparison, DCF Valuation, WACC Calculator, Beta Analysis, ESG, Concall transcripts, Trade Replay, Crypto Dashboard, FX Matrix, Yield Curve, Rate Hike Probability, Supply Chain, M&A Tracker, Social Sentiment, Delivery Volume, Market Breadth, Global Markets

---

## Quick Start

```powershell
# 1. Setup (run once)
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

# 2. Start everything
powershell -ExecutionPolicy Bypass -File scripts\start.ps1

# 3. Open
# http://localhost:8000   (production build served by FastAPI)
# http://localhost:3000   (Vite dev server with HMR)
```

### Manual Start

```powershell
# Backend
cd D:\BB\backend
D:\BB\backend\venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Frontend (dev)
cd D:\BB\frontend
npm run dev

# Electron (desktop)
npm run electron:dev
```

### MFE Deploy (after editing a remote)

```powershell
cd D:\BB\frontend
npm run mfe:deploy   # builds mfe-des + mfe-gp → copies to mfe-host/
```

---

## Keyboard Shortcuts

| Key | Panel |
|-----|-------|
| F1 | Dashboard |
| F2 | Chart |
| F3 | News Feed |
| F4 | Filings |
| F5 | Earnings |
| F6 | Options |
| F7 | Insider Activity |
| F8 | Macro |
| F9 | Sector Map |
| Ctrl+/ | Stock Search |

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/quote/{symbol}` | Live quote |
| `GET /api/ohlcv/{symbol}` | Historical OHLCV (DuckDB) |
| `GET /api/fundamentals/{symbol}` | Fundamentals (screener.in + yfinance) |
| `GET /api/options/{symbol}` | Options chain + Greeks |
| `GET /api/news` | News feed (508 sources) |
| `GET /api/filings` | Exchange filings |
| `GET /api/earnings-calendar` | Earnings calendar |
| `GET /api/hedge-fund/state` | Full hedge fund team state |
| `GET /api/hedge-fund/signals` | Summary signals |
| `POST /api/quant/backtest` | Run backtest |
| `GET /api/quant/iv-surface/{symbol}` | IV surface data |
| `GET /api/quant/anomalies` | Active anomaly alerts |
| `POST /api/ai/query` | AI Copilot query |
| `GET /api/gpu/status` | CUDA / FinBERT / VRAM status |
| `WS /ws/v2` | Compact live tick stream |
| `GET /docs` | Swagger UI |

---

## Architecture

```
Fyers WebSocket (live ticks)
        │
backend/main.py  ←── asyncio, single process
        │  ├── _tick_batch_broadcaster()   33ms batching → /ws/v2
        │  ├── _live_quote_broadcaster()   3s REST heartbeat
        │  └── agents/*.py                9 agents, staggered startup
        │
        ▼  WebSocket /ws/v2
frontend/src/workers/marketWorker.ts   ← off main thread
        │  parses compact ticks, 16ms batching
        ▼
frontend/src/hooks/useMarketWorker.ts
        ├── marketStore.ts      quotes + indices  (RAF-batched)
        └── liveDataStore.ts    news / sentiment / macro / hedgefund
                ▼  useSyncExternalStore()
        React components  ← only the subscribing component re-renders
```

---

## Environment

| Item | Value |
|------|-------|
| Python | 3.12, venv at `backend/venv/` |
| PyTorch | 2.11.0+cu128 — CUDA 13.2, RTX 5060 8GB |
| XGBoost | 3.2.0, `device='cuda'` |
| Node | 20+, Vite 5 |
| Fyers App ID | G64FR8CRS7-200 |

`.env` at `backend/.env` — set `ANTHROPIC_API_KEY` to enable Claude backend for AI Copilot (falls back to rule-based expert system without it).

---

## Data Sources

- **Fyers API v3** — live WebSocket ticks, OHLCV
- **NSE APIs** — options chain, FII/DII, block deals, filings, indices
- **screener.in** — Indian fundamentals, shareholding, quarterly results
- **yfinance** — fallback quotes, global market data
- **RBI** — policy rates
- **508 RSS feeds** — ET, Mint, MoneyControl, Business Standard, Reuters, Bloomberg, CNBC, and more
