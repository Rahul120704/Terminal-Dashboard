"""
BTI Terminal Copilot — AI assistant powered by Ollama (local LLM)
with Claude API as fallback.

- Primary: Ollama openai-compatible endpoint (llama3.1:8b)
- Fallback: Anthropic Claude API (if ANTHROPIC_API_KEY set)
- Context-aware: receives terminal state (ticker, news, signals)
- Quick prompts: pre-built financial analysis templates
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

logger = logging.getLogger(__name__)

OLLAMA_API_KEY = os.getenv("OLLAMA_API_KEY", "")
OLLAMA_CLOUD_URL = os.getenv("OLLAMA_BASE_URL", "https://api.ollama.ai/v1")
OLLAMA_LOCAL_URL = "http://localhost:11434/v1"
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

# Priority chain: cloud Ollama (if key set) → local Ollama → Claude API → error
OLLAMA_ENDPOINTS: list[dict] = []
if OLLAMA_API_KEY:
    OLLAMA_ENDPOINTS.append({"url": OLLAMA_CLOUD_URL, "key": OLLAMA_API_KEY, "label": "ollama-cloud"})
OLLAMA_ENDPOINTS.append({"url": OLLAMA_LOCAL_URL, "key": "", "label": "ollama-local"})

SYSTEM_PROMPT = """You are BTI Copilot — an expert financial analyst assistant embedded in the Bloomberg Terminal India (BTI) platform.

You have deep expertise in:
- NSE/BSE Indian equity markets (Nifty, Sensex, all sectors)
- Fundamental analysis: P/E, EV/EBITDA, ROCE, D/E, promoter holding
- Technical analysis: EMA, SMA, RSI, MACD, Bollinger Bands, volume analysis
- Options: Greeks, IV surface, PCR, OI buildup, unusual activity
- Macro: RBI policy, FII/DII flows, USD/INR, crude, GIFT Nifty
- Hedge fund strategies: momentum, mean-reversion, factor models
- FinBERT sentiment, XGBoost signal generation

When answering:
1. Be concise and structured — use bullet points for lists
2. Always cite specific metrics when available (e.g., "RSI=68, overbought signal")
3. Quantify risks (e.g., "Support at ₹1,240 — 8% downside")
4. Use Indian market context (SEBI rules, corporate governance, promoter dynamics)
5. Never give direct buy/sell advice — frame as "technical signals suggest..." or "fundamental analysis indicates..."

Format responses in markdown for the terminal UI."""

QUICK_PROMPTS = {
    "explain_signal": "Explain the current hedge fund signal for {ticker} based on: XGBoost proba={xgb_proba}, RSI={rsi}, sentiment={sentiment}. What does this mean for a short-term trader?",
    "news_impact": "Analyze the impact of this news on {ticker}: '{headline}'. Consider sector dynamics, management quality, and market positioning.",
    "fundamental_check": "Give a quick fundamental health check for {ticker} trading at ₹{price} with P/E={pe}, ROCE={roce}, D/E={de}. Is the valuation justified?",
    "risk_assessment": "What are the top 3 risks for {ticker} right now? Consider macro environment, sector headwinds, and stock-specific factors.",
    "compare_sector": "Compare {ticker} to its NSE sector peers. What are the relative strengths and weaknesses?",
    "options_strategy": "Given PCR={pcr} and IV={iv}% for {ticker}, what options strategy makes sense? Market view: {bias}",
    "macro_impact": "How does the current macro environment (RBI={rbi_rate}%, FII flows={fii_flow}cr, USD/INR={usdinr}) affect {sector} sector stocks?",
    "earnings_preview": "Preview upcoming earnings for {ticker}. What should traders watch? Historical beat/miss rate matters.",
    "technical_summary": "Technical summary for {ticker}: price=₹{price}, vs 20SMA={sma20_diff}%, 50SMA={sma50_diff}%, 200SMA={sma200_diff}%, RSI={rsi}, MACD={macd_signal}.",
    "portfolio_review": "Review this portfolio and suggest optimizations: {portfolio_json}. Consider concentration, sector exposure, and risk.",
}


@dataclass
class CopilotMessage:
    role: str   # "user" | "assistant" | "system"
    content: str


@dataclass
class CopilotSession:
    session_id: str
    messages: List[CopilotMessage] = field(default_factory=list)
    context: Dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    provider_used: str = "ollama"


@dataclass
class CopilotResponse:
    content: str
    provider: str
    model: str
    latency_ms: float
    tokens_used: int = 0
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "content": self.content,
            "provider": self.provider,
            "model": self.model,
            "latency_ms": round(self.latency_ms, 1),
            "tokens_used": self.tokens_used,
            "error": self.error,
        }


class TerminalCopilot:
    """
    AI copilot for BTI terminal.
    Provider chain: Ollama cloud → Ollama local (localhost:11434) → Claude API → error message.
    Each endpoint is tried in order; first success wins.
    """

    MAX_SESSIONS = 50
    SESSION_TTL = 3600  # 1 hour

    def __init__(self):
        self._sessions: Dict[str, CopilotSession] = {}
        self._client = httpx.AsyncClient(timeout=60.0)
        # Track which endpoints are reachable: None = not yet checked, True/False = result
        self._endpoint_status: Dict[str, Optional[bool]] = {
            ep["label"]: None for ep in OLLAMA_ENDPOINTS
        }
        # Time of last check per endpoint — re-check failures every 5 minutes
        self._endpoint_check_ts: Dict[str, float] = {ep["label"]: 0.0 for ep in OLLAMA_ENDPOINTS}
        self._ENDPOINT_RETRY_TTL = 300  # 5 minutes
        logger.info(
            f"TerminalCopilot init: ollama_key={'SET' if OLLAMA_API_KEY else 'MISSING'}, "
            f"anthropic_key={'SET' if ANTHROPIC_API_KEY else 'MISSING'}, "
            f"model={OLLAMA_MODEL}, endpoints={[e['label'] for e in OLLAMA_ENDPOINTS]}"
        )

    async def _check_endpoint(self, endpoint: dict) -> bool:
        """Check if a specific Ollama endpoint is reachable. Retries failed endpoints every 5 min."""
        label = endpoint["label"]
        cached = self._endpoint_status.get(label)
        if cached is True:
            return True   # known good — no need to re-check
        if cached is False:
            # Re-check if enough time has passed
            if time.time() - self._endpoint_check_ts.get(label, 0) < self._ENDPOINT_RETRY_TTL:
                return False
            # Time to retry
            self._endpoint_status[label] = None
        self._endpoint_check_ts[label] = time.time()
        try:
            headers = {"Authorization": f"Bearer {endpoint['key']}"} if endpoint["key"] else {}
            resp = await self._client.get(
                f"{endpoint['url']}/models", headers=headers, timeout=4.0
            )
            ok = resp.status_code in (200, 401, 404)   # 404 = old Ollama with no /models route
            self._endpoint_status[label] = ok
            logger.info(f"Ollama {label}: status={resp.status_code}, reachable={ok}")
        except Exception as e:
            logger.warning(f"Ollama {label} unreachable: {e}")
            self._endpoint_status[label] = False
        return bool(self._endpoint_status[label])

    async def _call_one_endpoint(self, endpoint: dict, messages: List[Dict], max_tokens: int) -> CopilotResponse:
        """Call a single Ollama-compatible endpoint."""
        t0 = time.perf_counter()
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if endpoint["key"]:
            headers["Authorization"] = f"Bearer {endpoint['key']}"
        payload = {
            "model": OLLAMA_MODEL,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.4,
            "stream": False,
        }
        try:
            resp = await self._client.post(
                f"{endpoint['url']}/chat/completions",
                headers=headers,
                json=payload,
                timeout=45.0,
            )
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            tokens = data.get("usage", {}).get("total_tokens", 0)
            latency = (time.perf_counter() - t0) * 1000
            return CopilotResponse(
                content=content, provider=endpoint["label"], model=OLLAMA_MODEL,
                latency_ms=latency, tokens_used=tokens,
            )
        except Exception as e:
            latency = (time.perf_counter() - t0) * 1000
            logger.warning(f"Ollama {endpoint['label']} call failed: {e}")
            self._endpoint_status[endpoint["label"]] = None  # reset so it retries next time
            return CopilotResponse(
                content="", provider=endpoint["label"], model=OLLAMA_MODEL,
                latency_ms=latency, error=str(e),
            )

    async def _call_ollama(self, messages: List[Dict], max_tokens: int = 1024) -> CopilotResponse:
        """Try all configured Ollama endpoints in order; return first success."""
        for ep in OLLAMA_ENDPOINTS:
            reachable = await self._check_endpoint(ep)
            if not reachable:
                continue
            resp = await self._call_one_endpoint(ep, messages, max_tokens)
            if not resp.error:
                return resp
        # All Ollama endpoints failed
        return CopilotResponse(
            content="", provider="ollama", model=OLLAMA_MODEL,
            latency_ms=0, error="All Ollama endpoints unreachable",
        )

    async def _call_claude(self, messages: List[Dict], max_tokens: int = 1024) -> CopilotResponse:
        """Call Anthropic Claude API as fallback."""
        if not ANTHROPIC_API_KEY:
            return CopilotResponse(content="", provider="claude", model="claude-3-haiku-20240307",
                                   latency_ms=0, error="ANTHROPIC_API_KEY not set")
        t0 = time.perf_counter()
        headers = {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        # Convert openai format to Anthropic format
        system_msg = next((m["content"] for m in messages if m["role"] == "system"), SYSTEM_PROMPT)
        user_messages = [m for m in messages if m["role"] != "system"]

        payload = {
            "model": "claude-3-haiku-20240307",
            "max_tokens": max_tokens,
            "system": system_msg,
            "messages": user_messages,
        }
        try:
            resp = await self._client.post(
                "https://api.anthropic.com/v1/messages",
                headers=headers,
                json=payload,
                timeout=45.0,
            )
            resp.raise_for_status()
            data = resp.json()
            content = data["content"][0]["text"]
            tokens = data.get("usage", {}).get("output_tokens", 0)
            latency = (time.perf_counter() - t0) * 1000
            return CopilotResponse(content=content, provider="claude", model="claude-3-haiku-20240307",
                                   latency_ms=latency, tokens_used=tokens)
        except Exception as e:
            latency = (time.perf_counter() - t0) * 1000
            logger.error(f"Claude API call failed: {e}")
            return CopilotResponse(content="", provider="claude", model="claude-3-haiku-20240307",
                                   latency_ms=latency, error=str(e))

    def _build_context_prefix(self, context: Dict[str, Any]) -> str:
        """Build a context prefix from terminal state."""
        if not context:
            return ""
        parts = ["[TERMINAL CONTEXT]\n"]
        if ticker := context.get("ticker"):
            parts.append(f"- Active ticker: {ticker}")
        if price := context.get("price"):
            parts.append(f"- Current price: ₹{price}")
        if signal := context.get("hedge_fund_signal"):
            parts.append(f"- Hedge fund signal: {signal}")
        if sentiment := context.get("sentiment"):
            parts.append(f"- FinBERT sentiment: {sentiment}")
        if rsi := context.get("rsi"):
            parts.append(f"- RSI(14): {rsi}")
        if xgb := context.get("xgb_proba_up"):
            parts.append(f"- XGBoost P(up): {xgb:.1%}")
        if news := context.get("recent_news"):
            parts.append(f"- Recent news: {news[:200]}...")
        return "\n".join(parts) + "\n\n"

    async def query(
        self,
        user_message: str,
        session_id: str = "default",
        context: Optional[Dict[str, Any]] = None,
        max_tokens: int = 1024,
    ) -> CopilotResponse:
        """
        Main entry point. Tries Ollama first, falls back to Claude.
        Maintains conversation history per session.
        """
        # Get or create session
        session = self._sessions.get(session_id)
        if session is None or (time.time() - session.created_at) > self.SESSION_TTL:
            session = CopilotSession(session_id=session_id, context=context or {})
            self._sessions[session_id] = session

        # Prune old sessions
        if len(self._sessions) > self.MAX_SESSIONS:
            oldest = sorted(self._sessions, key=lambda k: self._sessions[k].created_at)[:10]
            for k in oldest:
                del self._sessions[k]

        # Build message list
        ctx_prefix = self._build_context_prefix(context or session.context)
        augmented_message = ctx_prefix + user_message if ctx_prefix else user_message

        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        # Add history (last 8 exchanges = 16 messages)
        for msg in session.messages[-16:]:
            messages.append({"role": msg.role, "content": msg.content})
        messages.append({"role": "user", "content": augmented_message})

        # Try Ollama (cloud → local chain)
        response = await self._call_ollama(messages, max_tokens)
        if not response.error:
            session.messages.append(CopilotMessage(role="user", content=user_message))
            session.messages.append(CopilotMessage(role="assistant", content=response.content))
            session.provider_used = response.provider
            return response
        logger.warning(f"All Ollama endpoints failed, trying Claude: {response.error}")

        # Claude fallback
        response = await self._call_claude(messages, max_tokens)
        if not response.error:
            session.messages.append(CopilotMessage(role="user", content=user_message))
            session.messages.append(CopilotMessage(role="assistant", content=response.content))
            session.provider_used = "claude"
            return response

        # LLM unavailable — fall back to rule-based expert system
        t0 = time.perf_counter()
        rb_content = self._rule_based_response(user_message, context or session.context)
        latency = (time.perf_counter() - t0) * 1000
        rb_response = CopilotResponse(
            content=rb_content,
            provider="rule-based",
            model="BTI Expert System v1",
            latency_ms=latency,
            tokens_used=0,
        )
        session.messages.append(CopilotMessage(role="user", content=user_message))
        session.messages.append(CopilotMessage(role="assistant", content=rb_content))
        session.provider_used = "rule-based"
        return rb_response

    def _rule_based_response(self, question: str, context: Dict[str, Any]) -> str:
        """
        Expert-system fallback when no LLM is reachable.
        Covers the 20 most common financial analysis questions with
        professional, context-aware responses.
        """
        q = question.lower()
        ticker = context.get("ticker", "the selected stock")
        price = context.get("price")
        rsi = context.get("rsi")
        signal = context.get("hedge_fund_signal", "NEUTRAL")
        xgb = context.get("xgb_proba_up")
        sentiment = context.get("sentiment", "NEUTRAL")

        price_str = f"₹{price:,.2f}" if price else "current price"
        rsi_str = f"{rsi:.1f}" if rsi else "N/A"
        xgb_str = f"{xgb:.1%}" if xgb else "N/A"

        # ── RSI / Momentum ────────────────────────────────────────────────
        if any(w in q for w in ["rsi", "relative strength"]):
            rsi_interp = ""
            if rsi:
                if rsi >= 80: rsi_interp = f"**Extremely overbought** ({rsi_str}) — high reversal risk, consider tightening stops."
                elif rsi >= 70: rsi_interp = f"**Overbought** ({rsi_str}) — momentum is strong but stretched; wait for pullback."
                elif rsi <= 20: rsi_interp = f"**Extremely oversold** ({rsi_str}) — potential capitulation; watch for reversal candles."
                elif rsi <= 30: rsi_interp = f"**Oversold** ({rsi_str}) — value zone, but confirm with price action before entry."
                elif 40 <= rsi <= 60: rsi_interp = f"**Neutral zone** ({rsi_str}) — no strong directional bias from momentum alone."
                else: rsi_interp = f"**Trending** ({rsi_str}) — moderate momentum, trend continuation likely."
            return f"""## RSI Analysis — {ticker}

**RSI(14) for {ticker}:** {rsi_interp if rsi_interp else rsi_str}

### Interpretation Framework
- **70–100**: Overbought — stock may be due for a pullback; professionals look for divergence
- **50–70**: Bullish momentum — trend is intact, dips are buying opportunities
- **30–50**: Bearish momentum — watch for reversal signals
- **0–30**: Oversold — potential bottom, but "buy" only on confirmation

### RSI Divergence (critical signal)
- **Bullish divergence**: Price makes lower low, RSI makes higher low → reversal signal
- **Bearish divergence**: Price makes higher high, RSI makes lower high → exhaustion signal

### Hedge Fund Use
Institutions don't use RSI in isolation. They combine it with:
1. Volume confirmation (high-volume RSI bounces = institutional participation)
2. Price at key support/resistance levels
3. Sector RSI comparison (relative strength)

> **Current signal for {ticker}:** {signal} | XGBoost P(up)={xgb_str}"""

        # ── MACD ──────────────────────────────────────────────────────────
        if "macd" in q:
            return f"""## MACD Analysis — {ticker}

**Moving Average Convergence Divergence** is a trend-following momentum indicator.

### Components
| Component | Calculation | Signal |
|-----------|------------|--------|
| MACD Line | EMA(12) – EMA(26) | Direction of trend |
| Signal Line | EMA(9) of MACD | Trigger for entries/exits |
| Histogram | MACD – Signal | Momentum acceleration |

### Key Signals
- **Bullish crossover**: MACD crosses above signal line → potential buy
- **Bearish crossover**: MACD crosses below signal line → potential sell
- **Zero-line cross**: MACD crosses zero → trend change confirmation
- **Histogram expansion**: Momentum strengthening in trend direction
- **Histogram contraction**: Momentum fading → potential reversal

### Hedge Fund Application
Professional desks use MACD with:
1. **Weekly chart for trend direction** → Daily for entry timing
2. **Divergence** (price vs. MACD) as high-conviction reversal signals
3. Combined with volume — MACD crossover on high volume = institutional move

> **{ticker} at {price_str}** | Signal: {signal} | Market regime: {sentiment}"""

        # ── Bollinger Bands ────────────────────────────────────────────────
        if any(w in q for w in ["bollinger", "band", "bb"]):
            return f"""## Bollinger Bands — {ticker}

### Structure
- **Middle Band**: 20-period SMA
- **Upper Band**: SMA + 2σ (standard deviations)
- **Lower Band**: SMA – 2σ
- **%B = (Price – Lower) / (Upper – Lower)**

### Trading Signals
| Condition | Implication |
|-----------|-------------|
| Price touches upper band | Overbought (in range-bound); momentum signal (in trend) |
| Price touches lower band | Oversold (in range-bound); continuation (in downtrend) |
| **Band squeeze** (width < 20-period avg) | **Low volatility = major move pending** |
| **Band expansion** | Momentum spike — direction determines trade |
| Walk the band | Strong trend — "overbought" can stay overbought |

### Bandwidth (Squeeze Detection)
`Bandwidth = (Upper – Lower) / Middle × 100`
- **< 5%**: Extreme squeeze — potential breakout imminent
- **> 25%**: High volatility — mean reversion favored

> **Current setup:** {ticker} @ {price_str} | HF signal: {signal}"""

        # ── Moving Averages ────────────────────────────────────────────────
        if any(w in q for w in ["ema", "sma", "moving average", "200 day", "50 day"]):
            return f"""## Moving Average Analysis — {ticker}

### Key Levels Tracked by Institutions
| MA | Period | Significance |
|----|--------|-------------|
| EMA(9) | 9 days | Short-term momentum (intraday traders) |
| EMA(21) | 21 days | Swing trading signal |
| EMA(50) | 50 days | **Trend filter** — most watched by funds |
| SMA(100) | 100 days | Medium-term support/resistance |
| SMA(200) | 200 days | **Bull/Bear dividing line** — golden/death cross |

### Golden Cross / Death Cross
- **Golden Cross**: 50-SMA crosses above 200-SMA → long-term bullish, attracts institutional buying
- **Death Cross**: 50-SMA crosses below 200-SMA → long-term bearish, triggers systematic sells

### Mean Reversion Framework
- Price **30%+ above 200-SMA** → extended, increase caution
- Price **at 200-SMA** → major inflection point, watch volume
- Price **below 200-SMA** → structural downtrend; rallies are selling opportunities

### Indian Market Specifics
- NSE uses **20 EMA** as benchmark for short-term (Fibonacci level preference)
- **20/50/200 EMA** combo is the standard hedge fund toolkit for Indian large caps

> **{ticker}:** {price_str} | Signal: {signal} | Regime: {sentiment}"""

        # ── VWAP ──────────────────────────────────────────────────────────
        if "vwap" in q:
            return f"""## VWAP Analysis — {ticker}

**Volume Weighted Average Price** = Σ(Price × Volume) / Σ(Volume)

### Why Institutions Use VWAP
1. **Execution benchmark**: Institutional orders measured vs VWAP — beating it = good execution
2. **Intraday trend**: Price above VWAP = buyers in control; below = sellers
3. **Support/Resistance**: VWAP acts as intraday S/R for active traders

### VWAP Strategies
| Setup | Condition | Action |
|-------|-----------|--------|
| **Long VWAP bounce** | Price dips to VWAP + RSI oversold | Buy at VWAP retest |
| **Short VWAP reject** | Price hits VWAP from below, fails | Short with VWAP as stop |
| **VWAP breakout** | High-volume candle closes above VWAP | Momentum long |

### Standard Deviation Bands
- VWAP ±1σ: Contains ~68% of daily price action
- VWAP ±2σ: Extreme intraday moves — reversion likely

### NSE Intraday Use
- **09:30–10:00 IST**: VWAP unreliable (opening volatility)
- **After 11:00 IST**: VWAP becomes reliable institutional anchor
- **Pre-close (14:45+)**: Prices gravitate toward VWAP (institutional rebalancing)

> **{ticker}:** {price_str} | Current session sentiment: {sentiment}"""

        # ── Options / PCR ─────────────────────────────────────────────────
        if any(w in q for w in ["option", "pcr", "put call", "iv", "implied vol", "greek", "delta", "gamma"]):
            return f"""## Options Analysis — {ticker}

### Greeks Overview
| Greek | What It Measures | Practical Use |
|-------|-----------------|--------------|
| **Delta (Δ)** | Price sensitivity per ₹1 move | Position hedging; 0.5 = ATM |
| **Gamma (Γ)** | Rate of delta change | Risk near expiry — high Γ = volatile P&L |
| **Vega (ν)** | Sensitivity to IV change | News/event plays; buy before events |
| **Theta (θ)** | Time decay per day | Accelerates near expiry; sellers benefit |
| **Rho (ρ)** | Interest rate sensitivity | Less critical for Indian index options |

### PCR (Put-Call Ratio) Interpretation
| PCR | Interpretation |
|-----|---------------|
| **> 1.3** | Extreme fear — contrarian buy signal (too many puts) |
| **1.0 – 1.3** | Mildly bearish sentiment |
| **0.7 – 1.0** | Neutral to mildly bullish |
| **< 0.7** | Greed / overconfidence — contrarian caution |

### IV (Implied Volatility) Signals
- **IV Rank < 20%**: Low IV → buy options (cheap insurance)
- **IV Rank > 80%**: High IV → sell options (collect premium)
- **IV Crush**: Post-earnings IV collapses — dangerous for option buyers
- India VIX > 20 = elevated fear; < 15 = complacency

> **{ticker} at {price_str}** | HF Signal: {signal}"""

        # ── Fundamental / Valuation ───────────────────────────────────────
        if any(w in q for w in ["fundamental", "valuation", "pe ratio", "ev/ebitda", "roce", "debt", "balance sheet"]):
            return f"""## Fundamental Analysis Framework — {ticker}

### Valuation Matrix
| Metric | What It Tells You | Red Flag |
|--------|-------------------|----------|
| **P/E Ratio** | Price / EPS | > 40x for non-growth stocks |
| **EV/EBITDA** | Enterprise value vs operating profit | > 20x for mature businesses |
| **P/B Ratio** | Price vs book value | > 5x without high ROE |
| **PEG Ratio** | P/E adjusted for growth | > 1.5x = expensive growth |

### Quality Metrics (Hedge Fund Checklist)
| Metric | Target | Why It Matters |
|--------|--------|----------------|
| **ROCE** | > 15% | Returns above cost of capital = value creation |
| **Cash Conversion** | CFO/PAT > 0.85 | Low = accounting quality risk |
| **D/E Ratio** | < 1.0 (ideally < 0.5) | Leveraged firms amplify losses in downturns |
| **Promoter Holding** | > 50% (stable/rising) | Skin in the game |
| **Promoter Pledge %** | < 5% | High pledge = forced selling risk |
| **Revenue Growth (YoY)** | > Sector avg | Market share gain |

### NSE-Specific Red Flags
1. Promoter pledging exceeds 30% → HIGH RISK
2. Cash flow consistently below reported profit → investigate
3. Related party transactions > 10% of revenue → governance concern
4. Auditor qualified opinion → avoid
5. F&O ban list inclusion → no new positions (SEBI mandate)

> **Analyzing:** {ticker} at {price_str}"""

        # ── Sector Analysis ────────────────────────────────────────────────
        if any(w in q for w in ["sector", "rotation", "it sector", "banking", "pharma", "auto", "fmcg"]):
            return f"""## Sector Analysis Framework

### NSE Sector Performance Drivers
| Sector | Key Drivers | FII Preference |
|--------|------------|----------------|
| **IT** | USD/INR, US tech capex, deal wins | High (USD-denominated revenues) |
| **Banking** | RBI rate cycle, credit growth, NPAs | Medium-High |
| **FMCG** | Rural demand, inflation, volume growth | Medium (defensive) |
| **Auto** | Volume data (SIAM), inventory, EV transition | Medium |
| **Pharma** | FDA outcomes, domestic pricing, API costs | Low-Medium |
| **Metals** | China PMI, LME prices, domestic infra spend | Low |
| **Oil & Gas** | Brent crude, GRM spreads, marketing margins | Low |
| **Realty** | Interest rates, registration data, launches | Very Low |

### Sector Rotation Signal (Macro-Based)
```
RBI CUTTING: Banks → Real Estate → Auto → FMCG
RBI HIKING:  IT (defensive) → Pharma → FMCG → Cash
FII BUYING:  IT + Banks (high cap, liquid)
FII SELLING: Midcaps first, then large caps
```

### India VIX → Sector Preference
- **VIX < 15**: Risk-on → Cyclicals (Auto, Metal, Realty)
- **VIX 15–20**: Balanced → Banks + IT
- **VIX > 20**: Risk-off → FMCG + Pharma + Cash

> **Current market regime:** {sentiment}"""

        # ── FII/DII Flows ──────────────────────────────────────────────────
        if any(w in q for w in ["fii", "dii", "institutional", "flow", "foreign"]):
            return f"""## FII/DII Flow Analysis

### Why Flows Matter
- FIIs own ~23% of NSE market cap → their moves drive large-cap direction
- DIIs (mutual funds + insurance) act as **counter-buyers** during FII selling
- Net flows published daily by NSDL/CDSL (FII) and SEBI (DII)

### Interpretation Matrix
| FII | DII | Market Implication |
|-----|-----|--------------------|
| Buying | Buying | **Strongly bullish** — institutional consensus |
| Buying | Selling | Bullish — FII driving; DII taking profits |
| Selling | Buying | Support level — DIIs absorbing FII selling |
| Selling | Selling | **Bearish** — broad institutional exit |

### Key Thresholds (NSE)
- **FII > ₹3,000 Cr/day buy**: Major accumulation — follow the money
- **FII > ₹3,000 Cr/day sell**: Significant outflow — track USD/INR, GIFT Nifty
- **Consecutive 5-day FII sell**: Pattern that precedes index correction

### Macro Triggers for FII Flows
1. **US Fed decisions** (rate hike → EM outflows; pause/cut → EM inflows)
2. **USD/INR** (INR weakening > 0.5%/day → FII flight risk)
3. **India macro data** (CPI, GDP, IIP releases)
4. **MSCI weight changes** (passive FII flows, predictable)
5. **Global risk events** (VIX spike → EM sell-off)

> **Current regime:** {sentiment} | Active ticker: {ticker}"""

        # ── Earnings ──────────────────────────────────────────────────────
        if any(w in q for w in ["earnings", "result", "concall", "beat", "miss", "eps"]):
            return f"""## Earnings Analysis Framework — {ticker}

### Earnings Season Calendar (India)
- **Q1 FY** (Apr-Jun): Results in **July**
- **Q2 FY** (Jul-Sep): Results in **October**
- **Q3 FY** (Oct-Dec): Results in **January**
- **Q4 FY** (Jan-Mar): Results in **April-May**

### Key Metrics to Track
| Metric | Beat Signal | Miss Signal |
|--------|------------|-------------|
| Revenue | > Consensus estimate | < Consensus |
| PAT | > Consensus | < Consensus |
| EBITDA Margin | Expansion QoQ | Compression |
| Management Guidance | Raised | Lowered/withdrawn |
| CFO vs PAT | > 0.85 | < 0.70 |

### IV Crush Risk (Options)
- IV typically spikes 15–30% **before earnings**
- **IV crush** post-results: IV collapses 30–60% even on positive results
- **Strategy**: Don't buy straddles unless IV Rank < 30%

### Concall Analysis Checklist
1. **Order book / pipeline** comments (forward guidance)
2. **Margin trajectory** — input cost commentary
3. **Working capital** changes (inventory/receivables buildup = warning)
4. **Management tone** — confident vs cautious

> **{ticker} at {price_str}** | HF signal: {signal}"""

        # ── Default comprehensive response ────────────────────────────────
        return f"""## BTI Analysis — {ticker}

**Current Status:**
- Price: {price_str}
- RSI(14): {rsi_str}
- XGBoost Signal: {signal} (P(up)={xgb_str})
- Market Regime: {sentiment}

### Quick Analysis
Based on the available terminal data for **{ticker}**:

**Technical Position:**
{"- RSI " + rsi_str + " — " + ("overbought territory; momentum stretched" if rsi and rsi > 70 else "oversold; potential reversal zone" if rsi and rsi < 30 else "neutral momentum zone") if rsi else "- RSI data loading..."}
- Hedge fund model signal: **{signal}**
- AI probability of upside move: **{xgb_str}**

**Market Context:**
- Overall regime: **{sentiment}**
- A {sentiment} regime {"favors momentum continuation" if sentiment == "RISK_ON" else "favors defensive positioning" if sentiment == "RISK_OFF" else "requires selective stock picking"}

### Suggested Analysis Views
Press **F2** → CHART for visual technical analysis
Press **F6** → OPTIONS for derivatives signals
Use **FUNDAMENTALS** panel for valuation metrics
Use **HEDGE FUND** panel for full factor model breakdown

> *AI Copilot Rule-Based Mode — Configure Ollama or ANTHROPIC_API_KEY for full LLM capabilities*"""

    def quick_prompt(self, template_key: str, **kwargs) -> str:
        """Fill a quick prompt template."""
        template = QUICK_PROMPTS.get(template_key, "")
        if not template:
            return f"Unknown template: {template_key}"
        try:
            return template.format(**kwargs)
        except KeyError as e:
            return template.replace("{" + str(e).strip("'") + "}", f"[{e}]")

    def clear_session(self, session_id: str) -> bool:
        if session_id in self._sessions:
            del self._sessions[session_id]
            return True
        return False

    def get_quick_prompts(self) -> List[Dict[str, str]]:
        return [{"key": k, "label": k.replace("_", " ").title()} for k in QUICK_PROMPTS]

    async def close(self):
        await self._client.aclose()
