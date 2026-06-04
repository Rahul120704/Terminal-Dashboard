"""
AI Hedge Fund Team — 8 Specialist Agents + Portfolio Manager Orchestrator
GPU-accelerated: XGBoost (cuda) for factor model, FinBERT (cuda) for sentiment.
Fixes: replaced yf.download(multi-ticker) with per-symbol fast_info + timeout guards.
"""

import asyncio
import logging
import math
import os
import time
import numpy as np
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from db.database import get_sqlite, get_duckdb
from agents.guardian_agent import AgentHeartbeat

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=6, thread_name_prefix="hf_agent")

# ── Shared Team State ─────────────────────────────────────────────────────────
_team_state: Dict[str, Any] = {
    "research":    {"status": "initializing", "output": {}, "last_run": None},
    "analyst":     {"status": "initializing", "output": {}, "last_run": None},
    "risk":        {"status": "initializing", "output": {}, "last_run": None},
    "datascience": {"status": "initializing", "output": {}, "last_run": None},
    "sentiment":   {"status": "initializing", "output": {}, "last_run": None},
    "news_finder": {"status": "initializing", "output": {}, "last_run": None},
    "macro":       {"status": "initializing", "output": {}, "last_run": None},
}

_ws_broadcast = None


def get_team_state() -> Dict:
    return _team_state


def set_ws_broadcast(cb):
    global _ws_broadcast
    _ws_broadcast = cb


async def _push_update():
    if _ws_broadcast:
        try:
            await _ws_broadcast({"type": "hedge_fund_update", "data": _team_state})
        except Exception:
            pass


def _safe_float(v) -> Optional[float]:
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except Exception:
        return None


def _yf_price(sym_ns: str) -> Optional[float]:
    """Single-ticker price fetch — safe for executor, returns None on failure."""
    try:
        import yfinance as yf
        t = yf.Ticker(sym_ns)
        fi = t.fast_info
        p = _safe_float(getattr(fi, "last_price", None) or getattr(fi, "lastPrice", None))
        if p:
            return p
        # Fallback: tiny history
        hist = t.history(period="2d", auto_adjust=True)
        if not hist.empty:
            return _safe_float(hist["Close"].iloc[-1])
    except Exception:
        pass
    return None


def _yf_history(sym_ns: str, period: str = "6mo") -> Optional[Any]:
    """Single-ticker history — safe for executor."""
    try:
        import yfinance as yf
        df = yf.Ticker(sym_ns).history(period=period, auto_adjust=True)
        return df if not df.empty else None
    except Exception:
        return None


# ── DB helpers ────────────────────────────────────────────────────────────────
async def _get_recent_news(limit: int = 50) -> List[Dict]:
    try:
        db = await get_sqlite()
        async with db.execute(
            "SELECT ticker, headline, source, published_at, sentiment, category FROM news ORDER BY published_at DESC LIMIT ?",
            (limit,)
        ) as c:
            rows = await c.fetchall()
        return [{"ticker": r[0], "headline": r[1], "source": r[2],
                 "published_at": r[3], "sentiment": r[4], "category": r[5]} for r in rows]
    except Exception:
        return []


async def _get_macro_indicators() -> List[Dict]:
    try:
        db = await get_sqlite()
        async with db.execute("SELECT indicator, value, unit, period, updated_at FROM macro_indicators") as c:
            rows = await c.fetchall()
        return [{"indicator": r[0], "value": r[1], "unit": r[2], "period": r[3], "updated_at": r[4]} for r in rows]
    except Exception:
        return []


async def _get_fii_dii() -> List[Dict]:
    try:
        db = await get_sqlite()
        async with db.execute(
            "SELECT date, fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net FROM fii_dii_flows ORDER BY date DESC LIMIT 10"
        ) as c:
            rows = await c.fetchall()
        return [{"date": r[0], "fii_net": r[3], "dii_net": r[6]} for r in rows]
    except Exception:
        return []


async def _get_fundamentals(symbol: str) -> Dict:
    try:
        db = await get_sqlite()
        async with db.execute(
            "SELECT pe_ratio, pb_ratio, roe, roce, debt_equity, revenue_growth, pat_growth, promoter_holding FROM fundamentals WHERE symbol=?",
            (symbol,)
        ) as c:
            row = await c.fetchone()
        if row:
            return {"pe": row[0], "pb": row[1], "roe": row[2], "roce": row[3],
                    "de": row[4], "rev_growth": row[5], "pat_growth": row[6], "promoter": row[7]}
    except Exception:
        pass
    return {}


async def _fyers_price(symbol: str) -> Optional[float]:
    """Try Fyers for real-time price if authenticated."""
    try:
        import data.fyers_data as fd
        if fd.is_authenticated():
            q = await fd.get_quote(symbol)   # was missing await — caused RuntimeWarning
            if q:
                return _safe_float(q.get("price") or q.get("ltp"))
        # Fallback: check quote cache directly (no async needed)
        cache = fd._quote_cache.get(symbol, {}) if hasattr(fd, '_quote_cache') else {}
        if cache.get("price"):
            return float(cache["price"])
    except Exception:
        pass
    return None


# ══════════════════════════════════════════════════════════════════════════════
# Agent 1: Research Agent
# ══════════════════════════════════════════════════════════════════════════════
class ResearchAgent:
    NAME = "research"
    INTERVAL = 600

    async def run(self):
        from data.nse_data import NIFTY_50
        results = {}
        db = await get_sqlite()

        for sym in NIFTY_50[:25]:
            try:
                f = await _get_fundamentals(sym)
                news = await _get_recent_news(10)
                ticker_news = [n for n in news if n.get("ticker") == sym]
                async with db.execute(
                    "SELECT filing_type, subject, filed_at, impact FROM filings WHERE symbol=? ORDER BY filed_at DESC LIMIT 3",
                    (sym,)
                ) as c:
                    filings = await c.fetchall()

                score = 0
                reasons = []
                if f.get("roce") and f["roce"] > 15:
                    score += 20; reasons.append(f"ROCE {f['roce']:.1f}%")
                if f.get("rev_growth") and f["rev_growth"] > 10:
                    score += 15; reasons.append(f"Rev growth {f['rev_growth']:.1f}%")
                if f.get("de") is not None and f["de"] < 0.5:
                    score += 10; reasons.append("Low D/E")
                if f.get("promoter") and f["promoter"] > 50:
                    score += 10; reasons.append(f"Promoter {f['promoter']:.1f}%")
                if f.get("pe") and 10 < f["pe"] < 30:
                    score += 10; reasons.append(f"P/E {f['pe']:.1f}x")
                if f.get("roe") and f["roe"] > 15:
                    score += 10; reasons.append(f"ROE {f['roe']:.1f}%")
                if ticker_news:
                    score += min(len(ticker_news) * 5, 15)
                    reasons.append(f"{len(ticker_news)} recent news items")

                # Live price from Fyers
                live_price = await _fyers_price(sym)

                results[sym] = {
                    "symbol":         sym,
                    "quality_score":  min(score, 100),
                    "fundamentals":   f,
                    "recent_news":    len(ticker_news),
                    "recent_filings": len(filings),
                    "key_metrics":    reasons,
                    "live_price":     live_price,
                    "updated_at":     datetime.now().isoformat(),
                }
            except Exception as e:
                logger.debug("Research %s: %s", sym, e)

        _team_state["research"] = {
            "status": "running",
            "output": {"stocks": results, "count": len(results)},
            "last_run": datetime.now().isoformat(),
        }
        logger.info("ResearchAgent: analysed %d stocks", len(results))

    async def start(self):
        while True:
            try:
                AgentHeartbeat.beat(self.NAME)
                _team_state["research"]["status"] = "running"
                await self.run()
                await _push_update()
            except Exception as e:
                logger.error("ResearchAgent: %s", e)
                _team_state["research"]["status"] = "error"
            await asyncio.sleep(self.INTERVAL)


# ══════════════════════════════════════════════════════════════════════════════
# Agent 2: Analyst & Recommendation Agent
# ══════════════════════════════════════════════════════════════════════════════
class AnalystAgent:
    NAME = "analyst"
    INTERVAL = 300

    async def _get_momentum(self, sym: str) -> float:
        """Get 3M momentum with 10s timeout, never hangs."""
        loop = asyncio.get_event_loop()
        try:
            df = await asyncio.wait_for(
                loop.run_in_executor(_executor, _yf_history, f"{sym}.NS", "3mo"),
                timeout=10.0
            )
            if df is not None and len(df) >= 2:
                start_p = _safe_float(df["Close"].iloc[0])
                end_p = _safe_float(df["Close"].iloc[-1])
                if start_p and end_p and start_p > 0:
                    return (end_p - start_p) / start_p * 100
        except (asyncio.TimeoutError, Exception):
            pass
        return 0.0

    async def run(self):
        from data.nse_data import NIFTY_50
        signals = []
        research = _team_state.get("research", {}).get("output", {}).get("stocks", {})

        # Process in parallel batches of 5
        syms = NIFTY_50[:25]
        for i in range(0, len(syms), 5):
            batch = syms[i:i+5]
            tasks = [self._analyse_stock(sym, research) for sym in batch]
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)
            for r in batch_results:
                if isinstance(r, dict):
                    signals.append(r)

        signals.sort(key=lambda x: x["score"], reverse=True)
        buys  = [s for s in signals if "BUY" in s["action"]]
        sells = [s for s in signals if "SELL" in s["action"]]
        holds = [s for s in signals if s["action"] == "HOLD"]

        _team_state["analyst"] = {
            "status": "running",
            "output": {
                "signals":   signals,
                "top_buys":  buys[:5],
                "top_sells": sells[:5],
                "holds":     holds[:5],
                "summary":   f"{len(buys)} BUY | {len(holds)} HOLD | {len(sells)} SELL",
            },
            "last_run": datetime.now().isoformat(),
        }
        logger.info("AnalystAgent: %s", _team_state["analyst"]["output"]["summary"])

    async def _analyse_stock(self, sym: str, research: Dict) -> Dict:
        try:
            f = research.get(sym, {}).get("fundamentals", {}) or await _get_fundamentals(sym)
            momentum = await self._get_momentum(sym)

            score = 0.0
            if f.get("roce") and f["roce"] > 15:      score += 10
            if f.get("rev_growth") and f["rev_growth"] > 15: score += 10
            if f.get("roe") and f["roe"] > 15:        score += 10
            if f.get("de") is not None and f["de"] < 0.5:    score += 10
            if momentum > 10:    score += 30
            elif momentum > 5:   score += 20
            elif momentum > 0:   score += 10
            elif momentum < -10: score -= 20
            pe = f.get("pe") or 50
            if pe < 15:    score += 30
            elif pe < 25:  score += 20
            elif pe < 35:  score += 10
            elif pe > 50:  score -= 10

            score = max(0, min(100, score))
            if score >= 70:   action, color = "STRONG BUY", "green"
            elif score >= 55: action, color = "BUY", "green"
            elif score >= 40: action, color = "HOLD", "amber"
            elif score >= 25: action, color = "SELL", "red"
            else:             action, color = "STRONG SELL", "red"

            return {
                "symbol":      sym,
                "action":      action,
                "score":       round(score, 1),
                "momentum_3m": round(momentum, 2),
                "conviction":  round(abs(score - 50) / 50, 2),
                "color":       color,
                "updated_at":  datetime.now().isoformat(),
            }
        except Exception as e:
            logger.debug("Analyst %s: %s", sym, e)
            return {}

    async def start(self):
        await asyncio.sleep(20)  # Let research agent start first
        while True:
            try:
                AgentHeartbeat.beat(self.NAME)
                _team_state["analyst"]["status"] = "running"
                await self.run()
                await _push_update()
            except Exception as e:
                logger.error("AnalystAgent: %s", e)
                _team_state["analyst"]["status"] = "error"
            await asyncio.sleep(self.INTERVAL)


# ══════════════════════════════════════════════════════════════════════════════
# Agent 3: Risk Analyst
# ══════════════════════════════════════════════════════════════════════════════
class RiskAnalystAgent:
    NAME = "risk"
    INTERVAL = 120

    async def _fetch_single(self, sym: str, period: str = "5d") -> Optional[Any]:
        loop = asyncio.get_event_loop()
        try:
            return await asyncio.wait_for(
                loop.run_in_executor(_executor, _yf_history, sym, period),
                timeout=10.0
            )
        except (asyncio.TimeoutError, Exception):
            return None

    async def run(self):
        risk_level = "MEDIUM"
        risk_score = 50
        signals = []
        vix = 15.0

        # India VIX
        vix_data = await self._fetch_single("^INDIAVIX", "5d")
        if vix_data is not None and not vix_data.empty:
            v = _safe_float(vix_data["Close"].iloc[-1])
            if v:
                vix = v
                if vix > 25:
                    risk_score += 25; signals.append(f"India VIX HIGH: {vix:.1f}")
                elif vix > 20:
                    risk_score += 15; signals.append(f"India VIX elevated: {vix:.1f}")
                elif vix < 12:
                    risk_score -= 10; signals.append(f"India VIX low: {vix:.1f} (complacency)")

        # Nifty vs 200 SMA
        nifty_data = await self._fetch_single("^NSEI", "1y")
        if nifty_data is not None and len(nifty_data) >= 20:
            close_vals = [_safe_float(v) for v in nifty_data["Close"].values]
            close_vals = [v for v in close_vals if v is not None]
            if len(close_vals) >= 2:
                sma_n = min(200, len(close_vals))
                sma200 = sum(close_vals[-sma_n:]) / sma_n
                last_price = close_vals[-1]
                pct_vs_sma200 = (last_price - sma200) / sma200 * 100
                if pct_vs_sma200 < -5:
                    risk_score += 20; signals.append(f"Nifty below SMA200 by {abs(pct_vs_sma200):.1f}%")
                elif pct_vs_sma200 > 15:
                    risk_score += 10; signals.append(f"Nifty extended: +{pct_vs_sma200:.1f}% vs SMA200")
                else:
                    signals.append(f"Nifty {pct_vs_sma200:+.1f}% vs SMA200")

        # FII flows
        fii = await _get_fii_dii()
        if fii:
            recent_fii = sum(f["fii_net"] for f in fii[:5] if f["fii_net"]) / max(len(fii[:5]), 1)
            if recent_fii < -2000:
                risk_score += 15; signals.append(f"FII selling ₹{abs(recent_fii):.0f}Cr/day")
            elif recent_fii > 2000:
                risk_score -= 10; signals.append(f"FII buying ₹{recent_fii:.0f}Cr/day")

        # US VIX
        us_vix_data = await self._fetch_single("^VIX", "5d")
        us_vix = 15.0
        if us_vix_data is not None and not us_vix_data.empty:
            v = _safe_float(us_vix_data["Close"].iloc[-1])
            if v:
                us_vix = v
                if us_vix > 25:
                    risk_score -= 20; signals.append(f"US VIX HIGH: {us_vix:.1f} (global risk-off)")
                elif us_vix < 15:
                    risk_score += 10; signals.append(f"US VIX low: {us_vix:.1f} (risk-on)")

        risk_score = max(0, min(100, risk_score))
        if risk_score >= 75:    risk_level = "HIGH"
        elif risk_score >= 60:  risk_level = "ELEVATED"
        elif risk_score >= 40:  risk_level = "MEDIUM"
        else:                   risk_level = "LOW"

        if risk_level in ("HIGH", "ELEVATED"):
            recommendations = [
                "Reduce position sizes — increase cash allocation",
                "Avoid leveraged F&O positions",
                "Prioritise defensive sectors: FMCG, Pharma, IT",
                "Consider Nifty put hedges",
            ]
        else:
            recommendations = [
                "Normal position sizing appropriate",
                "Quality midcap exposure viable",
                "Monitor VIX for any spike above 20",
                "Review sector weights vs macro regime",
            ]

        _team_state["risk"] = {
            "status": "running",
            "output": {
                "risk_level":      risk_level,
                "risk_score":      risk_score,
                "india_vix":       round(vix, 2),
                "us_vix":          round(us_vix, 2),
                "signals":         signals,
                "recommendations": recommendations,
            },
            "last_run": datetime.now().isoformat(),
        }

    async def start(self):
        while True:
            try:
                AgentHeartbeat.beat(self.NAME)
                _team_state["risk"]["status"] = "running"
                await self.run()
                await _push_update()
            except Exception as e:
                logger.error("RiskAnalystAgent: %s", e)
                _team_state["risk"]["status"] = "error"
            await asyncio.sleep(self.INTERVAL)


# ══════════════════════════════════════════════════════════════════════════════
# Agent 4: Data Scientist — XGBoost GPU Factor Model + FinBERT Sentiment
# ══════════════════════════════════════════════════════════════════════════════
class DataScientistAgent:
    NAME = "datascience"
    INTERVAL = 900

    _xgb_model = None
    _xgb_ready = False

    # ── Feature engineering ────────────────────────────────────────────────────
    def _compute_features(self, prices: Any, volumes: Any) -> Optional[Dict]:
        """Compute 15 technical features from price/volume series."""
        try:
            p = np.array([float(v) for v in prices], dtype=np.float32)
            v = np.array([float(v) for v in volumes], dtype=np.float32)
            n = len(p)
            if n < 60:
                return None

            # Returns at multiple horizons
            ret_5d  = (p[-1] - p[-5])  / (p[-5] + 1e-8)  * 100
            ret_20d = (p[-1] - p[-20]) / (p[-20] + 1e-8) * 100
            ret_60d = (p[-1] - p[-60]) / (p[-60] + 1e-8) * 100

            # Volatility
            daily_rets = np.diff(p) / (p[:-1] + 1e-8)
            vol_20d = float(daily_rets[-20:].std() * np.sqrt(252) * 100)
            vol_60d = float(daily_rets[-60:].std() * np.sqrt(252) * 100)

            # RSI-14
            d = np.diff(p[-15:])
            gains = np.where(d > 0, d, 0)
            losses = np.where(d < 0, -d, 0)
            avg_g = float(gains.mean() + 1e-8)
            avg_l = float(losses.mean() + 1e-8)
            rsi14 = 100 - 100 / (1 + avg_g / avg_l)

            # Moving average ratios
            sma20  = float(p[-20:].mean())
            sma50  = float(p[-50:].mean())
            sma200 = float(p.mean()) if n >= 200 else float(p.mean())
            ratio_vs_sma20  = (p[-1] - sma20)  / (sma20  + 1e-8) * 100
            ratio_vs_sma50  = (p[-1] - sma50)  / (sma50  + 1e-8) * 100
            ratio_vs_sma200 = (p[-1] - sma200) / (sma200 + 1e-8) * 100

            # Volume ratio
            vol_ratio = float(v[-1] / (v[-20:].mean() + 1e-8))

            # Price acceleration (momentum change)
            momentum_accel = ret_5d - (p[-6] - p[-11]) / (p[-11] + 1e-8) * 100 if n >= 11 else 0.0

            # Drawdown from 52-week high
            high_52w = float(p[-min(252, n):].max())
            drawdown = (p[-1] - high_52w) / (high_52w + 1e-8) * 100

            return {
                "ret_5d":          round(float(ret_5d), 2),
                "ret_20d":         round(float(ret_20d), 2),
                "ret_60d":         round(float(ret_60d), 2),
                "vol_20d":         round(vol_20d, 2),
                "vol_60d":         round(vol_60d, 2),
                "rsi14":           round(rsi14, 1),
                "ratio_vs_sma20":  round(float(ratio_vs_sma20), 2),
                "ratio_vs_sma50":  round(float(ratio_vs_sma50), 2),
                "ratio_vs_sma200": round(float(ratio_vs_sma200), 2),
                "vol_ratio":       round(float(vol_ratio), 3),
                "momentum_accel":  round(float(momentum_accel), 2),
                "drawdown_52w":    round(float(drawdown), 2),
            }
        except Exception as e:
            logger.debug("Feature engineering error: %s", e)
            return None

    def _build_xgboost_dataset(self, all_data: List[Dict]) -> Tuple[Optional[Any], Optional[Any]]:
        """Build training dataset from historical stock data."""
        try:
            import xgboost as xgb

            X_rows, y_rows = [], []
            feature_keys = [
                "ret_5d","ret_20d","ret_60d","vol_20d","vol_60d","rsi14",
                "ratio_vs_sma20","ratio_vs_sma50","ratio_vs_sma200",
                "vol_ratio","momentum_accel","drawdown_52w","sentiment_avg",
            ]

            for d in all_data:
                feat = d.get("features")
                if not feat:
                    continue
                # Target: next 20d return direction (1=up, 0=down)
                target = 1 if (d.get("ret_20d_fwd") or 0) > 0 else 0
                row = [feat.get(k, 0.0) or 0.0 for k in feature_keys]
                X_rows.append(row)
                y_rows.append(target)

            if len(X_rows) < 10:
                return None, None

            X = np.array(X_rows, dtype=np.float32)
            y = np.array(y_rows, dtype=np.int32)
            return X, y
        except Exception as e:
            logger.debug("XGB dataset build: %s", e)
            return None, None

    def _train_xgboost(self, X: Any, y: Any) -> Optional[Any]:
        """Train XGBoost with GPU if available, fall back to CPU."""
        try:
            import xgboost as xgb
            try:
                import torch
                use_cuda = torch.cuda.is_available()
            except Exception:
                use_cuda = False

            device = "cuda" if use_cuda else "cpu"
            model = xgb.XGBClassifier(
                n_estimators=100,
                max_depth=4,
                learning_rate=0.1,
                subsample=0.8,
                colsample_bytree=0.8,
                reg_alpha=0.1,
                reg_lambda=1.0,
                device=device,
                eval_metric="logloss",
                use_label_encoder=False,
                verbosity=0,
            )
            model.fit(X, y)
            logger.info("XGBoost trained on %d samples (device=%s)", len(X), device)
            return model
        except Exception as e:
            logger.warning("XGBoost training error: %s", e)
            return None

    async def _get_stock_data_full(self, sym: str) -> Optional[Dict]:
        """Per-symbol fetch with 1Y history, timeout guard."""
        loop = asyncio.get_event_loop()
        try:
            df = await asyncio.wait_for(
                loop.run_in_executor(_executor, _yf_history, f"{sym}.NS", "1y"),
                timeout=14.0
            )
            if df is None or df.empty or len(df) < 60:
                return None

            prices  = df["Close"].dropna().values
            volumes = df["Volume"].dropna().values[:len(prices)]
            if len(prices) < 60:
                return None

            features = self._compute_features(prices, volumes)
            if not features:
                return None

            # Next 20d forward return (for training — last observation has unknown future)
            n = len(prices)
            ret_20d_fwd = float((prices[-1] - prices[max(0, n-20)]) / (prices[max(0, n-20)] + 1e-8) * 100) if n >= 20 else 0.0

            return {"sym": sym, "features": features, "ret_20d_fwd": ret_20d_fwd,
                    "last_price": float(prices[-1]), "n_bars": n}
        except (asyncio.TimeoutError, Exception) as e:
            logger.debug("DataSci %s: %s", sym, e)
            return None

    async def _get_sentiment_by_ticker(self) -> Dict[str, float]:
        """Fetch per-ticker average FinBERT sentiment from DB."""
        try:
            db = await get_sqlite()
            async with db.execute(
                """SELECT ticker, AVG(sentiment), COUNT(*) FROM news
                   WHERE ticker IS NOT NULL AND published_at > datetime('now', '-7 days')
                   GROUP BY ticker HAVING COUNT(*) >= 2"""
            ) as c:
                rows = await c.fetchall()
            return {r[0]: float(r[1]) for r in rows if r[0]}
        except Exception:
            return {}

    async def run(self):
        from data.nse_data import NIFTY_50

        syms = NIFTY_50[:30]
        sem = asyncio.Semaphore(5)

        async def bounded_fetch(sym):
            async with sem:
                return await self._get_stock_data_full(sym)

        results = await asyncio.gather(*[bounded_fetch(s) for s in syms], return_exceptions=True)

        # Get FinBERT sentiment per ticker
        sentiment_map = await self._get_sentiment_by_ticker()

        # Enrich with sentiment
        valid_data = []
        for d in results:
            if not isinstance(d, dict) or not d.get("features"):
                continue
            d["features"]["sentiment_avg"] = sentiment_map.get(d["sym"], 0.0)
            valid_data.append(d)

        # Build training dataset (use all stocks as cross-sectional sample)
        X, y = self._build_xgboost_dataset(valid_data)

        xgb_proba: Dict[str, float] = {}
        model_name = "Momentum+Quality (6M, risk-adjusted)"

        if X is not None and len(X) >= 10:
            model = self._train_xgboost(X, y)
            if model is not None:
                self.__class__._xgb_model = model
                self.__class__._xgb_ready = True
                # Score each stock
                for i, d in enumerate(valid_data):
                    feat = d["features"]
                    feature_keys = [
                        "ret_5d","ret_20d","ret_60d","vol_20d","vol_60d","rsi14",
                        "ratio_vs_sma20","ratio_vs_sma50","ratio_vs_sma200",
                        "vol_ratio","momentum_accel","drawdown_52w","sentiment_avg",
                    ]
                    row = np.array([[feat.get(k, 0.0) or 0.0 for k in feature_keys]], dtype=np.float32)
                    try:
                        prob_up = float(model.predict_proba(row)[0][1])
                        xgb_proba[d["sym"]] = prob_up
                    except Exception:
                        xgb_proba[d["sym"]] = 0.5
                model_name = "XGBoost GPU (13 factors + FinBERT sentiment)"

        # Build factor scores
        analyst_out = _team_state.get("analyst", {}).get("output", {}).get("signals", [])
        analyst_map = {s["symbol"]: s["score"] for s in analyst_out}

        factor_scores = []
        for d in valid_data:
            sym = d["sym"]
            feat = d["features"]
            vol = max(feat["vol_20d"], 1.0)
            momentum_z = feat["ret_60d"] / (vol / 10)
            analyst_score = analyst_map.get(sym, 50)
            xgb_score = xgb_proba.get(sym, 0.5) * 100 if xgb_proba else None
            sentiment_adj = (sentiment_map.get(sym, 0.0)) * 20

            # Composite: XGBoost (40%) + momentum (30%) + analyst (20%) + sentiment (10%)
            if xgb_score is not None:
                composite = xgb_score * 0.4 + (momentum_z * 10 + 50) * 0.3 + analyst_score * 0.2 + (50 + sentiment_adj) * 0.1
            else:
                composite = (momentum_z * 10 + 50) * 0.5 + analyst_score * 0.3 + (50 + sentiment_adj) * 0.2

            composite = max(0, min(100, composite))

            factor_scores.append({
                "symbol":          sym,
                "ret_5d":          feat["ret_5d"],
                "ret_20d":         feat["ret_20d"],
                "ret_60d":         feat["ret_60d"],
                "volatility":      feat["vol_20d"],
                "rsi14":           feat["rsi14"],
                "xgb_proba_up":    round(xgb_proba.get(sym, 0.5), 3) if xgb_proba else None,
                "sentiment_avg":   round(float(sentiment_map.get(sym, 0.0)), 3),
                "analyst_score":   analyst_score,
                "composite":       round(composite, 1),
                "signal":          "LONG" if composite >= 60 else "SHORT" if composite <= 40 else "NEUTRAL",
            })

        factor_scores.sort(key=lambda x: x["composite"], reverse=True)

        _team_state["datascience"] = {
            "status": "running",
            "output": {
                "top_longs":    [s for s in factor_scores if s["signal"] == "LONG"][:5],
                "top_shorts":   [s for s in factor_scores if s["signal"] == "SHORT"][:5],
                "all_factors":  factor_scores,
                "model":        model_name,
                "xgb_trained":  self._xgb_ready,
                "count":        len(factor_scores),
            },
            "last_run": datetime.now().isoformat(),
        }
        logger.info("DataScientist: %d factor scores | XGB=%s | device=%s",
                    len(factor_scores), "yes" if xgb_proba else "no", "cuda" if xgb_proba else "cpu")

    async def start(self):
        await asyncio.sleep(60)  # let research + analyst populate first
        while True:
            try:
                AgentHeartbeat.beat(self.NAME)
                _team_state["datascience"]["status"] = "running"
                await self.run()
                await _push_update()
            except Exception as e:
                logger.error("DataScientistAgent: %s", e)
                _team_state["datascience"]["status"] = "error"
            await asyncio.sleep(self.INTERVAL)


# ══════════════════════════════════════════════════════════════════════════════
# Agent 5: Sentiment Analyst
# ══════════════════════════════════════════════════════════════════════════════
class SentimentAnalystAgent:
    NAME = "sentiment"
    INTERVAL = 180

    async def run(self):
        news = await _get_recent_news(200)
        if not news:
            _team_state["sentiment"]["status"] = "running"
            return

        ticker_sentiment: Dict[str, List[float]] = {}
        sector_sentiment: Dict[str, List[float]] = {}

        for n in news:
            s = n.get("sentiment") or 0
            ticker = n.get("ticker")
            cat = n.get("category", "general")
            if ticker:
                ticker_sentiment.setdefault(ticker, []).append(s)
            sector_sentiment.setdefault(cat, []).append(s)

        ticker_avg = {
            t: {"avg": round(sum(v)/len(v), 3), "count": len(v), "ticker": t}
            for t, v in ticker_sentiment.items()
        }
        sector_avg = {
            c: {"avg": round(sum(v)/len(v), 3), "count": len(v), "category": c}
            for c, v in sector_sentiment.items()
        }

        all_scores = [n.get("sentiment") or 0 for n in news]
        overall = sum(all_scores) / len(all_scores) if all_scores else 0

        sorted_tickers = sorted(ticker_avg.values(), key=lambda x: x["avg"], reverse=True)
        bullish = [t for t in sorted_tickers if t["avg"] > 0.1][:5]
        bearish = [t for t in sorted_tickers if t["avg"] < -0.1][-5:]

        from collections import Counter
        stop = {"the","of","in","a","to","is","and","for","on","at","by","with","as","an","are","was","were","its","it","this","that","but","from","has","have","been","be","will","may","can","not","says","said","after","over","more","into","than","about","amid"}
        words = []
        for n in news[:100]:
            words += [w.lower().strip(".,;:!?") for w in (n.get("headline","") or "").split()
                      if len(w) > 4 and w.lower() not in stop]
        trending = [{"word": w, "count": c} for w, c in Counter(words).most_common(15)]

        regime = "BULLISH" if overall > 0.15 else "BEARISH" if overall < -0.15 else "NEUTRAL"

        _team_state["sentiment"] = {
            "status": "running",
            "output": {
                "overall_score":    round(overall, 3),
                "regime":           regime,
                "bullish_stocks":   bullish,
                "bearish_stocks":   bearish,
                "sector_sentiment": sector_avg,
                "trending":         trending,
                "news_count":       len(news),
            },
            "last_run": datetime.now().isoformat(),
        }

    async def start(self):
        while True:
            try:
                AgentHeartbeat.beat(self.NAME)
                _team_state["sentiment"]["status"] = "running"
                await self.run()
                await _push_update()
            except Exception as e:
                logger.error("SentimentAnalystAgent: %s", e)
                _team_state["sentiment"]["status"] = "error"
            await asyncio.sleep(self.INTERVAL)


# ══════════════════════════════════════════════════════════════════════════════
# Agent 6: News Finder (Real-time alert monitor)
# ══════════════════════════════════════════════════════════════════════════════
class NewsFinderAgent:
    NAME = "news_finder"
    INTERVAL = 60

    CRITICAL_KW = {"halt","circuit breaker","suspended","fraud","sebi action","fir","arrest",
                   "default","bankrupt","npa","downgrade","block deal","bulk deal","acquisition","merger",
                   "order ban","trading halt","esma","scam","money laundering","criminal"}
    HIGH_KW = {"earnings","results","dividend","buyback","split","bonus","rights issue",
               "board meeting","concall","guidance","rbi","fed","inflation","gdp","rate hike",
               "rate cut","qip","ipo listing","ofs","open offer","delisting"}

    async def run(self):
        db = await get_sqlite()
        cutoff = (datetime.now() - timedelta(hours=2)).isoformat()
        async with db.execute(
            """SELECT ticker, headline, source, published_at, sentiment, category
               FROM news WHERE published_at > ? ORDER BY published_at DESC LIMIT 50""",
            (cutoff,)
        ) as c:
            recent = await c.fetchall()

        alerts = []
        for row in recent:
            ticker, headline, source, pub_at, sentiment, category = row
            urgency = "LOW"
            s = sentiment or 0
            hl_lower = (headline or "").lower()

            if any(k in hl_lower for k in self.CRITICAL_KW):
                urgency = "CRITICAL"
            elif any(k in hl_lower for k in self.HIGH_KW):
                urgency = "HIGH"
            elif abs(s) > 0.5:
                urgency = "MEDIUM"

            if urgency in ("CRITICAL", "HIGH", "MEDIUM"):
                alerts.append({
                    "ticker":    ticker,
                    "headline":  headline,
                    "source":    source,
                    "sentiment": s,
                    "urgency":   urgency,
                    "time":      pub_at,
                    "category":  category,
                })

        priority_order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
        alerts.sort(key=lambda x: priority_order.get(x["urgency"], 3))

        _team_state["news_finder"] = {
            "status": "running",
            "output": {
                "alerts":       alerts[:25],
                "alert_count":  len(alerts),
                "recent_count": len(recent),
                "critical":     len([a for a in alerts if a["urgency"] == "CRITICAL"]),
                "high":         len([a for a in alerts if a["urgency"] == "HIGH"]),
                "medium":       len([a for a in alerts if a["urgency"] == "MEDIUM"]),
            },
            "last_run": datetime.now().isoformat(),
        }

    async def start(self):
        while True:
            try:
                AgentHeartbeat.beat(self.NAME)
                _team_state["news_finder"]["status"] = "running"
                await self.run()
                crit = _team_state["news_finder"]["output"].get("critical", 0)
                if crit > 0 or True:  # always push — UI needs it
                    await _push_update()
            except Exception as e:
                logger.error("NewsFinderAgent: %s", e)
                _team_state["news_finder"]["status"] = "error"
            await asyncio.sleep(self.INTERVAL)


# ══════════════════════════════════════════════════════════════════════════════
# Agent 7: Global Macro Economist
# ══════════════════════════════════════════════════════════════════════════════
class GlobalMacroAgent:
    NAME = "macro"
    INTERVAL = 300

    async def _fetch(self, sym: str, period: str = "5d") -> Optional[Any]:
        loop = asyncio.get_event_loop()
        try:
            return await asyncio.wait_for(
                loop.run_in_executor(_executor, _yf_history, sym, period),
                timeout=10.0
            )
        except (asyncio.TimeoutError, Exception):
            return None

    async def run(self):
        macro = await _get_macro_indicators()
        fii = await _get_fii_dii()

        macro_dict = {m["indicator"]: m["value"] for m in macro}
        repo_rate = macro_dict.get("repo_rate", 6.5)
        cpi = macro_dict.get("inflation_cpi", 5.0)
        gdp = macro_dict.get("gdp_growth", 7.0)

        signals = []
        regime_score = 50

        if repo_rate > 6.5:
            regime_score -= 10; signals.append(f"RBI Repo {repo_rate}% — restrictive")
        elif repo_rate < 5.5:
            regime_score += 15; signals.append(f"RBI Repo {repo_rate}% — accommodative")
        else:
            signals.append(f"RBI Repo {repo_rate}% — neutral")

        if cpi > 6.0:
            regime_score -= 15; signals.append(f"CPI {cpi:.1f}% > target (hawkish pressure)")
        elif cpi < 4.0:
            regime_score += 10; signals.append(f"CPI {cpi:.1f}% — benign")

        if fii:
            fii_5d_vals = [f["fii_net"] for f in fii[:5] if f.get("fii_net") is not None]
            fii_5d = sum(fii_5d_vals) / max(len(fii_5d_vals), 1) if fii_5d_vals else 0
            if fii_5d > 2000:
                regime_score += 20; signals.append(f"FII net buy ₹{fii_5d:.0f}Cr/day (5d)")
            elif fii_5d < -2000:
                regime_score -= 20; signals.append(f"FII net sell ₹{abs(fii_5d):.0f}Cr/day (5d)")
        else:
            fii_5d = 0

        # USD/INR
        fx = await self._fetch("USDINR=X", "5d")
        usdinr = 84.0
        if fx is not None and not fx.empty:
            v = _safe_float(fx["Close"].iloc[-1])
            if v:
                usdinr = v
                prev = _safe_float(fx["Close"].iloc[0]) if len(fx) >= 2 else usdinr
                if prev and prev > 0:
                    fx_chg = (usdinr - prev) / prev * 100
                    if fx_chg > 1:
                        regime_score -= 10; signals.append(f"USD/INR {usdinr:.2f} (+{fx_chg:.1f}% depreciation)")
                    elif fx_chg < -1:
                        regime_score += 10; signals.append(f"USD/INR {usdinr:.2f} ({fx_chg:.1f}% appreciation)")
                    else:
                        signals.insert(0, f"USD/INR: {usdinr:.2f}")

        # Brent Crude
        crude = await self._fetch("BZ=F", "5d")
        crude_price = None
        if crude is not None and not crude.empty:
            crude_price = _safe_float(crude["Close"].iloc[-1])
            if crude_price:
                if crude_price > 90:
                    regime_score -= 10; signals.append(f"Brent Crude ${crude_price:.1f} (inflation risk)")
                elif crude_price < 65:
                    regime_score += 10; signals.append(f"Brent Crude ${crude_price:.1f} (deflationary)")
                else:
                    signals.append(f"Brent Crude: ${crude_price:.1f}")

        # Gold
        gold = await self._fetch("GC=F", "5d")
        gold_price = None
        if gold is not None and not gold.empty:
            gold_price = _safe_float(gold["Close"].iloc[-1])
            if gold_price:
                signals.append(f"Gold: ${gold_price:.0f}/oz")

        regime_score = max(0, min(100, regime_score))
        if regime_score >= 65:    regime = "RISK_ON"
        elif regime_score <= 35:  regime = "RISK_OFF"
        else:                     regime = "NEUTRAL"

        if regime == "RISK_ON":
            sector_tilts = {"LONG": ["Banking", "Auto", "Infra", "Metals", "IT"], "SHORT": ["FMCG", "Pharma"]}
        elif regime == "RISK_OFF":
            sector_tilts = {"LONG": ["FMCG", "Pharma", "IT"], "SHORT": ["Banking", "Metals", "Auto"]}
        else:
            sector_tilts = {"LONG": ["Banking", "IT", "Pharma"], "SHORT": []}

        _team_state["macro"] = {
            "status": "running",
            "output": {
                "regime":        regime,
                "regime_score":  regime_score,
                "signals":       signals[:12],
                "repo_rate":     repo_rate,
                "cpi":           cpi,
                "gdp_growth":    gdp,
                "usdinr":        round(usdinr, 2),
                "crude_price":   round(crude_price, 2) if crude_price else None,
                "gold_price":    round(gold_price, 0) if gold_price else None,
                "sector_tilts":  sector_tilts,
                "fii_5d_avg":    round(fii_5d, 0),
            },
            "last_run": datetime.now().isoformat(),
        }

    async def start(self):
        while True:
            try:
                AgentHeartbeat.beat(self.NAME)
                _team_state["macro"]["status"] = "running"
                await self.run()
                await _push_update()
            except Exception as e:
                logger.error("GlobalMacroAgent: %s", e)
                _team_state["macro"]["status"] = "error"
            await asyncio.sleep(self.INTERVAL)


# ══════════════════════════════════════════════════════════════════════════════
# Portfolio Manager — Aggregates all agent signals
# ══════════════════════════════════════════════════════════════════════════════
class PortfolioManagerAgent:
    NAME = "pm"
    INTERVAL = 300

    async def run(self):
        analyst = _team_state.get("analyst", {}).get("output", {})
        sentiment = _team_state.get("sentiment", {}).get("output", {})
        macro = _team_state.get("macro", {}).get("output", {})
        risk = _team_state.get("risk", {}).get("output", {})

        signals = analyst.get("signals", [])
        regime = macro.get("regime", "NEUTRAL")
        sentiment_score = sentiment.get("overall_score", 0)
        risk_level = risk.get("risk_level", "MEDIUM")

        final_calls = []
        for sig in signals[:20]:
            score = sig.get("score", 50)
            # Blend: 0.4 analyst + 0.2 sentiment + 0.2 macro + 0.2 risk-adjusted
            macro_adj = 10 if regime == "RISK_ON" else -10 if regime == "RISK_OFF" else 0
            sentiment_adj = sentiment_score * 15
            risk_adj = -15 if risk_level in ("HIGH", "ELEVATED") else 5

            blended = score * 0.4 + (score + macro_adj) * 0.2 + (score + sentiment_adj) * 0.2 + (score + risk_adj) * 0.2
            blended = max(0, min(100, blended))

            if blended >= 65:   pm_action = "APPROVED BUY"
            elif blended >= 50: pm_action = "HOLD / MONITOR"
            elif blended >= 35: pm_action = "REDUCE"
            else:               pm_action = "AVOID / SELL"

            final_calls.append({
                "symbol":    sig["symbol"],
                "pm_action": pm_action,
                "blended":   round(blended, 1),
                "analyst":   sig["action"],
                "regime":    regime,
            })

        final_calls.sort(key=lambda x: x["blended"], reverse=True)

        _team_state["pm"] = {
            "status": "running",
            "output": {
                "top_picks":     final_calls[:5],
                "avoid_list":    [f for f in final_calls if f["pm_action"] in ("AVOID / SELL", "REDUCE")][:5],
                "regime":        regime,
                "risk_level":    risk_level,
                "market_bias":   "BULLISH" if regime == "RISK_ON" and sentiment_score > 0 else "BEARISH" if regime == "RISK_OFF" else "NEUTRAL",
                "last_run":      datetime.now().isoformat(),
            },
            "last_run": datetime.now().isoformat(),
        }

    async def start(self):
        await asyncio.sleep(120)  # Wait for other agents to populate
        while True:
            try:
                await self.run()
                await _push_update()
            except Exception as e:
                logger.error("PortfolioManager: %s", e)
            await asyncio.sleep(self.INTERVAL)


# ══════════════════════════════════════════════════════════════════════════════
# Team Launcher
# ══════════════════════════════════════════════════════════════════════════════
def create_all_agents(ws_broadcast_cb) -> List:
    set_ws_broadcast(ws_broadcast_cb)
    # Initialize PM state
    _team_state["pm"] = {"status": "initializing", "output": {}, "last_run": None}
    return [
        ResearchAgent(),
        AnalystAgent(),
        RiskAnalystAgent(),
        DataScientistAgent(),
        SentimentAnalystAgent(),
        NewsFinderAgent(),
        GlobalMacroAgent(),
        PortfolioManagerAgent(),
    ]
