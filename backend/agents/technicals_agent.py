"""
Technicals Agent: Computes EMA, SMA, RSI, MACD, Bollinger Bands, VWAP, ATR, ADX, Stochastics.
Runs on a 15-minute cycle during market hours. Stores to DuckDB.
"""

import asyncio
import logging
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Optional, Callable, Dict, List
import yfinance as yf
import ta

from agents.guardian_agent import AgentHeartbeat, heartbeat_sleep

logger = logging.getLogger(__name__)


def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute all technical indicators on an OHLCV DataFrame.
    Input: df with columns [open, high, low, close, volume]
    Output: df with added indicator columns.
    Uses the `ta` library (wraps pandas-ta style calculations).
    """
    if len(df) < 20:
        return df

    close = df["close"].astype(float)
    high = df["high"].astype(float)
    low = df["low"].astype(float)
    volume = df["volume"].astype(float)

    df["ema20"] = ta.trend.EMAIndicator(close, window=20).ema_indicator()
    df["ema50"] = ta.trend.EMAIndicator(close, window=50).ema_indicator()
    df["ema200"] = ta.trend.EMAIndicator(close, window=200).ema_indicator()
    df["sma20"] = ta.trend.SMAIndicator(close, window=20).sma_indicator()
    df["sma50"] = ta.trend.SMAIndicator(close, window=50).sma_indicator()
    df["sma200"] = ta.trend.SMAIndicator(close, window=200).sma_indicator()

    rsi = ta.momentum.RSIIndicator(close, window=14)
    df["rsi14"] = rsi.rsi()

    macd = ta.trend.MACD(close)
    df["macd"] = macd.macd()
    df["macd_signal"] = macd.macd_signal()
    df["macd_hist"] = macd.macd_diff()

    bb = ta.volatility.BollingerBands(close, window=20, window_dev=2)
    df["bb_upper"] = bb.bollinger_hband()
    df["bb_mid"] = bb.bollinger_mavg()
    df["bb_lower"] = bb.bollinger_lband()

    atr = ta.volatility.AverageTrueRange(high, low, close, window=14)
    df["atr14"] = atr.average_true_range()

    adx = ta.trend.ADXIndicator(high, low, close, window=14)
    df["adx14"] = adx.adx()

    stoch = ta.momentum.StochasticOscillator(high, low, close, window=14, smooth_window=3)
    df["stoch_k"] = stoch.stoch()
    df["stoch_d"] = stoch.stoch_signal()

    # VWAP (daily)
    if "volume" in df.columns and len(df) > 0:
        typical_price = (high + low + close) / 3
        cumvol = volume.cumsum()
        cumtpvol = (typical_price * volume).cumsum()
        df["vwap"] = cumtpvol / cumvol.replace(0, np.nan)

    # Ichimoku (9,26,52)
    ichi = ta.trend.IchimokuIndicator(high, low, window1=9, window2=26, window3=52)
    df["ichi_a"] = ichi.ichimoku_a()
    df["ichi_b"] = ichi.ichimoku_b()
    df["ichi_base"] = ichi.ichimoku_base_line()
    df["ichi_conv"] = ichi.ichimoku_conversion_line()

    # Supertrend (approximation using ATR)
    df["supertrend_upper"] = ((high + low) / 2) + (3 * df["atr14"])
    df["supertrend_lower"] = ((high + low) / 2) - (3 * df["atr14"])

    return df


def generate_signal(row: pd.Series, prev_row: Optional[pd.Series] = None) -> Dict:
    """
    Generate a composite trading signal from indicator values.
    Returns: signal (BUY/SELL/HOLD), strength (0-1), trend (UPTREND/DOWNTREND/SIDEWAYS)
    """
    signals = []
    close = row.get("close", 0)

    # EMA trend
    ema20 = row.get("ema20")
    ema50 = row.get("ema50")
    ema200 = row.get("ema200")

    if all(v is not None and not np.isnan(v) for v in [close, ema20, ema50, ema200]):
        if close > ema20 > ema50 > ema200:
            signals.append(("BUY", 0.9, "strong uptrend"))
        elif close > ema20 > ema50:
            signals.append(("BUY", 0.7, "uptrend"))
        elif close < ema20 < ema50 < ema200:
            signals.append(("SELL", 0.9, "strong downtrend"))
        elif close < ema20 < ema50:
            signals.append(("SELL", 0.7, "downtrend"))
        else:
            signals.append(("HOLD", 0.5, "mixed"))

    # RSI
    rsi = row.get("rsi14")
    if rsi is not None and not np.isnan(rsi):
        if rsi > 70:
            signals.append(("SELL", 0.6, "overbought RSI"))
        elif rsi < 30:
            signals.append(("BUY", 0.6, "oversold RSI"))
        elif 45 < rsi < 60:
            signals.append(("BUY", 0.4, "neutral RSI bullish zone"))
        elif 40 < rsi <= 45:
            signals.append(("HOLD", 0.4, "neutral RSI"))

    # MACD crossover
    macd = row.get("macd")
    macd_signal = row.get("macd_signal")
    if macd is not None and macd_signal is not None:
        if not (np.isnan(macd) or np.isnan(macd_signal)):
            if macd > macd_signal:
                signals.append(("BUY", 0.5, "MACD bullish"))
            else:
                signals.append(("SELL", 0.5, "MACD bearish"))

    # ADX strength
    adx = row.get("adx14")
    if adx is not None and not np.isnan(adx):
        if adx < 20:
            for i, (sig, str_, reason) in enumerate(signals):
                signals[i] = (sig, str_ * 0.7, reason + " (weak trend)")

    # Aggregate
    if not signals:
        return {"signal": "HOLD", "strength": 0.5, "trend": "SIDEWAYS", "reasons": []}

    buy_weight = sum(s[1] for s in signals if s[0] == "BUY")
    sell_weight = sum(s[1] for s in signals if s[0] == "SELL")

    if buy_weight > sell_weight * 1.2:
        final_signal = "BUY"
        strength = min(buy_weight / len(signals), 1.0)
        trend = "UPTREND"
    elif sell_weight > buy_weight * 1.2:
        final_signal = "SELL"
        strength = min(sell_weight / len(signals), 1.0)
        trend = "DOWNTREND"
    else:
        final_signal = "HOLD"
        strength = 0.5
        trend = "SIDEWAYS"

    reasons = [s[2] for s in signals]
    return {
        "signal": final_signal,
        "strength": round(strength, 2),
        "trend": trend,
        "reasons": reasons[:3],
    }


class TechnicalsAgent:
    def __init__(self, ws_broadcast: Optional[Callable] = None):
        self._broadcast = ws_broadcast
        self._running = False
        self._signals_cache: Dict[str, Dict] = {}

    async def start(self):
        self._running = True
        logger.info("TechnicalsAgent started")

        from data.nse_data import ALL_TRACKED
        await self._compute_all(ALL_TRACKED[:50])

        while self._running:
            AgentHeartbeat.beat("technicals")
            try:
                from data.nse_data import ALL_TRACKED
                await self._compute_all(ALL_TRACKED[:50])
            except Exception as e:
                logger.error("TechnicalsAgent error: %s", e)
            await heartbeat_sleep("technicals", 900)

    async def stop(self):
        self._running = False

    async def _compute_all(self, symbols: List[str]):
        """Compute technicals for a batch of symbols."""
        tasks = [self._compute_symbol(sym) for sym in symbols]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        errors = sum(1 for r in results if isinstance(r, Exception))
        logger.debug("TechnicalsAgent: computed %d symbols, %d errors",
                     len(symbols) - errors, errors)

        if self._broadcast:
            await self._broadcast({
                "type": "technicals_update",
                "data": self._signals_cache,
            })

    async def _compute_symbol(self, symbol: str):
        """Fetch OHLCV and compute indicators for one symbol."""
        try:
            from data.nse_data import fetch_ohlcv, _YF_EXECUTOR
            df = await asyncio.get_event_loop().run_in_executor(
                _YF_EXECUTOR, lambda: yf.download(
                    f"{symbol}.NS", period="1y", interval="1d",
                    auto_adjust=True, progress=False
                )
            )

            if df is None or df.empty or len(df) < 20:
                return

            df.columns = [c.lower() for c in df.columns]
            df = df.reset_index()
            df = compute_indicators(df)

            last = df.iloc[-1]
            prev = df.iloc[-2] if len(df) > 1 else None
            sig = generate_signal(last, prev)

            result = {
                "symbol": symbol,
                "ema20": _safe_round(last.get("ema20")),
                "ema50": _safe_round(last.get("ema50")),
                "ema200": _safe_round(last.get("ema200")),
                "sma20": _safe_round(last.get("sma20")),
                "sma50": _safe_round(last.get("sma50")),
                "sma200": _safe_round(last.get("sma200")),
                "rsi14": _safe_round(last.get("rsi14"), 1),
                "macd": _safe_round(last.get("macd"), 3),
                "macd_signal": _safe_round(last.get("macd_signal"), 3),
                "macd_hist": _safe_round(last.get("macd_hist"), 3),
                "bb_upper": _safe_round(last.get("bb_upper")),
                "bb_mid": _safe_round(last.get("bb_mid")),
                "bb_lower": _safe_round(last.get("bb_lower")),
                "vwap": _safe_round(last.get("vwap")),
                "atr14": _safe_round(last.get("atr14")),
                "adx14": _safe_round(last.get("adx14"), 1),
                "stoch_k": _safe_round(last.get("stoch_k"), 1),
                "stoch_d": _safe_round(last.get("stoch_d"), 1),
                "ichi_conv": _safe_round(last.get("ichi_conv")),
                "ichi_base": _safe_round(last.get("ichi_base")),
                "signal": sig["signal"],
                "trend": sig["trend"],
                "strength": sig["strength"],
                "signal_reasons": sig["reasons"],
                "close": _safe_round(float(last.get("close", last.get("Close", 0)))),
            }
            self._signals_cache[symbol] = result

            from db.database import get_duckdb
            conn = get_duckdb()
            try:
                ts = str(last.get("Date", last.get("index", datetime.now())))
                conn.execute(
                    """INSERT OR REPLACE INTO technicals
                       (symbol, ts, ema20, ema50, ema200, sma20, sma50, sma200,
                        rsi14, macd, macd_signal, macd_hist, bb_upper, bb_mid, bb_lower,
                        vwap, atr14, adx14, stoch_k, stoch_d)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (symbol, ts, result["ema20"], result["ema50"], result["ema200"],
                     result["sma20"], result["sma50"], result["sma200"],
                     result["rsi14"], result["macd"], result["macd_signal"],
                     result["macd_hist"], result["bb_upper"], result["bb_mid"],
                     result["bb_lower"], result["vwap"], result["atr14"],
                     result["adx14"], result["stoch_k"], result["stoch_d"])
                )
            finally:
                conn.close()

        except Exception as e:
            logger.debug("compute_symbol %s: %s", symbol, e)

    def get_signal(self, symbol: str) -> Optional[Dict]:
        return self._signals_cache.get(symbol)

    def get_all_signals(self) -> Dict[str, Dict]:
        return dict(self._signals_cache)

    async def compute_on_demand(self, symbol: str) -> Optional[Dict]:
        await self._compute_symbol(symbol)
        return self._signals_cache.get(symbol)


def _safe_round(v, decimals: int = 2) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
        if np.isnan(f) or np.isinf(f):
            return None
        return round(f, decimals)
    except (TypeError, ValueError):
        return None
