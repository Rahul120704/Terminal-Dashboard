"""Options chain data, PCR analysis, OI buildup detection, BS Greeks."""

import logging
import asyncio
import math
from typing import Optional, Dict, List, Any
from datetime import datetime, date
import numpy as np

logger = logging.getLogger(__name__)

# ── Pure-Python Black-Scholes (no scipy dependency) ──────────────────────────

_SQRT2 = math.sqrt(2.0)
_SQRT2PI = math.sqrt(2.0 * math.pi)

def _ncdf(x: float) -> float:
    """Standard normal CDF via erfc — ~5x faster than scipy.norm.cdf."""
    return 0.5 * math.erfc(-x / _SQRT2)

def _npdf(x: float) -> float:
    """Standard normal PDF."""
    return math.exp(-0.5 * x * x) / _SQRT2PI

_INDIA_RFR = 0.065   # RBI repo rate proxy — update if repo rate changes

def _bs_greeks(S: float, K: float, T: float, sigma: float, option_type: str) -> Dict:
    """
    Black-Scholes Greeks for a European option.
    S     = spot price
    K     = strike price
    T     = time to expiry in years  (e.g. 30/365)
    sigma = implied vol as decimal   (NSE gives percentage → divide by 100)
    option_type = 'CE' | 'PE'
    Returns dict with delta, gamma, theta (per day), vega (per 1% σ move).
    Returns all None if inputs are degenerate.
    """
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return {"delta": None, "gamma": None, "theta": None, "vega": None}
    try:
        r      = _INDIA_RFR
        sqrtT  = math.sqrt(T)
        d1     = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
        d2     = d1 - sigma * sqrtT
        e_rT   = math.exp(-r * T)
        n_d1   = _npdf(d1)

        gamma  = n_d1 / (S * sigma * sqrtT)
        vega   = S * n_d1 * sqrtT / 100.0   # per 1% change in σ

        if option_type == "CE":
            delta = _ncdf(d1)
            theta = (-(S * n_d1 * sigma) / (2 * sqrtT) - r * K * e_rT * _ncdf(d2)) / 365.0
        else:                                 # PE
            delta = _ncdf(d1) - 1.0
            theta = (-(S * n_d1 * sigma) / (2 * sqrtT) + r * K * e_rT * _ncdf(-d2)) / 365.0

        return {
            "delta": round(delta, 4),
            "gamma": round(gamma, 6),
            "theta": round(theta, 2),
            "vega":  round(vega,  2),
        }
    except Exception:
        return {"delta": None, "gamma": None, "theta": None, "vega": None}


def _bs_price(S: float, K: float, T: float, sigma: float, option_type: str) -> float:
    """Black-Scholes theoretical price. Returns 0 on degenerate inputs."""
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return 0.0
    r     = _INDIA_RFR
    sqrtT = math.sqrt(T)
    d1    = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
    d2    = d1 - sigma * sqrtT
    e_rT  = math.exp(-r * T)
    if option_type == "CE":
        return S * _ncdf(d1) - K * e_rT * _ncdf(d2)
    return K * e_rT * _ncdf(-d2) - S * _ncdf(-d1)


def _implied_vol(price: float, S: float, K: float, T: float, option_type: str) -> float:
    """
    Back out Black-Scholes implied volatility from a traded option price.

    Fyers (unlike NSE) does NOT publish IV, so we solve it from the LTP.
    Method: bisection over σ ∈ [0.1%, 500%]. BS price is monotonically
    increasing in σ, so a single bracket guarantees convergence (~40 iters
    → < 1e-4 precision). Bisection over Newton-Raphson: no derivative blow-up
    for deep ITM/OTM strikes where vega → 0 — correctness over speed (the
    whole chain is ~40 strikes, cached 60s, so cost is irrelevant).

    Returns IV as a PERCENTAGE (e.g. 18.5) to match NSE's convention used
    downstream, or 0.0 if it cannot be solved (price below intrinsic, etc.).
    """
    if price <= 0 or T <= 0 or S <= 0 or K <= 0:
        return 0.0
    r = _INDIA_RFR
    # No-arbitrage floor: a real option can't trade below intrinsic value.
    if option_type == "CE":
        intrinsic = max(0.0, S - K * math.exp(-r * T))
    else:
        intrinsic = max(0.0, K * math.exp(-r * T) - S)
    if price < intrinsic - 0.01:
        return 0.0   # stale/crossed print — don't fabricate an IV

    lo, hi = 1e-3, 5.0
    if price >= _bs_price(S, K, T, hi, option_type):
        return round(hi * 100.0, 2)   # price exceeds model max → cap at 500%

    for _ in range(50):
        mid = 0.5 * (lo + hi)
        pm  = _bs_price(S, K, T, mid, option_type)
        if abs(pm - price) < 1e-4:
            break
        if pm < price:
            lo = mid
        else:
            hi = mid
    iv = 0.5 * (lo + hi) * 100.0
    return round(iv, 2) if iv > 0.01 else 0.0


def _expiry_to_years(expiry_str: str) -> float:
    """Convert NSE expiry string like '30-Jan-2025' or '2025-01-30' to years from today."""
    if not expiry_str:
        return 0.0
    try:
        for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%d-%m-%Y", "%b %d, %Y"):
            try:
                exp_date = datetime.strptime(expiry_str.strip(), fmt).date()
                days = (exp_date - date.today()).days
                return max(days, 0) / 365.0
            except ValueError:
                continue
    except Exception:
        pass
    return 0.0


def calculate_pcr(option_data: Dict) -> Optional[float]:
    if not option_data:
        return None
    return option_data.get("pcr")


def find_max_pain(strikes_data: List[Dict]) -> Optional[float]:
    """
    Max pain = strike where total option value (ITM CE + ITM PE) is minimized.
    O(n²) but n is small (typically < 100 strikes).
    """
    try:
        strikes = sorted(set(s["strike"] for s in strikes_data if s.get("strike")))
        if not strikes:
            return None

        min_pain = float("inf")
        max_pain_strike = strikes[0]

        for test_strike in strikes:
            total_pain = 0.0
            for s in strikes_data:
                sk = s.get("strike", 0)
                ce_oi = s.get("call_oi", 0) or 0
                pe_oi = s.get("put_oi", 0) or 0
                if sk < test_strike:
                    total_pain += ce_oi * (test_strike - sk)
                elif sk > test_strike:
                    total_pain += pe_oi * (sk - test_strike)

            if total_pain < min_pain:
                min_pain = total_pain
                max_pain_strike = test_strike

        return max_pain_strike
    except Exception as e:
        logger.error("max_pain: %s", e)
        return None


def find_oi_resistance_support(strikes_data: List[Dict], underlying: float) -> Dict:
    """
    Key resistance: highest call OI above current price.
    Key support: highest put OI below current price.
    """
    try:
        above = [s for s in strikes_data if s.get("strike", 0) > underlying]
        below = [s for s in strikes_data if s.get("strike", 0) < underlying]

        resistance_strike = None
        if above:
            max_ce = max(above, key=lambda x: x.get("call_oi", 0) or 0)
            resistance_strike = max_ce.get("strike")

        support_strike = None
        if below:
            max_pe = max(below, key=lambda x: x.get("put_oi", 0) or 0)
            support_strike = max_pe.get("strike")

        return {"resistance": resistance_strike, "support": support_strike}
    except Exception as e:
        logger.error("oi_resistance_support: %s", e)
        return {}


def detect_unusual_options_activity(strikes_data: List[Dict]) -> List[Dict]:
    """
    Flag unusual OI buildup: OI change > 2x average OI change for that expiry.
    """
    alerts = []
    try:
        ce_changes = [abs(s.get("call_oi_change", 0) or 0) for s in strikes_data]
        pe_changes = [abs(s.get("put_oi_change", 0) or 0) for s in strikes_data]

        avg_ce = np.mean(ce_changes) if ce_changes else 0
        avg_pe = np.mean(pe_changes) if pe_changes else 0

        threshold_mult = 3.0

        for s in strikes_data:
            ce_chg = s.get("call_oi_change", 0) or 0
            pe_chg = s.get("put_oi_change", 0) or 0
            strike = s.get("strike", 0)
            expiry = s.get("expiry", "")

            if avg_ce > 0 and abs(ce_chg) > threshold_mult * avg_ce:
                alerts.append({
                    "type": "UNUSUAL_CALL_OI",
                    "strike": strike,
                    "expiry": expiry,
                    "oi_change": ce_chg,
                    "multiplier": round(abs(ce_chg) / avg_ce, 1),
                    "direction": "BULL" if ce_chg > 0 else "BEAR_UNWIND",
                })
            if avg_pe > 0 and abs(pe_chg) > threshold_mult * avg_pe:
                alerts.append({
                    "type": "UNUSUAL_PUT_OI",
                    "strike": strike,
                    "expiry": expiry,
                    "oi_change": pe_chg,
                    "multiplier": round(abs(pe_chg) / avg_pe, 1),
                    "direction": "BEAR" if pe_chg > 0 else "BULL_UNWIND",
                })

    except Exception as e:
        logger.error("detect_unusual_oi: %s", e)
    return alerts


def calculate_iv_skew(strikes_data: List[Dict], underlying: float) -> Dict:
    """
    IV skew: compare OTM put IV vs OTM call IV.
    Negative skew (put IV > call IV) is normal in indices.
    """
    try:
        atm = min(strikes_data, key=lambda x: abs(x.get("strike", 0) - underlying))
        atm_strike = atm.get("strike", underlying)

        otm_calls = [s for s in strikes_data
                     if s.get("strike", 0) > atm_strike * 1.01 and s.get("call_iv")]
        otm_puts = [s for s in strikes_data
                    if s.get("strike", 0) < atm_strike * 0.99 and s.get("put_iv")]

        avg_call_iv = np.mean([s["call_iv"] for s in otm_calls[:3]]) if otm_calls else None
        avg_put_iv = np.mean([s["put_iv"] for s in otm_puts[-3:]]) if otm_puts else None
        atm_iv = ((atm.get("call_iv", 0) or 0) + (atm.get("put_iv", 0) or 0)) / 2

        skew = None
        if avg_put_iv and avg_call_iv:
            skew = round(avg_put_iv - avg_call_iv, 2)

        return {
            "atm_iv": round(atm_iv, 2) if atm_iv else None,
            "avg_call_iv": round(avg_call_iv, 2) if avg_call_iv else None,
            "avg_put_iv": round(avg_put_iv, 2) if avg_put_iv else None,
            "skew": skew,
            "skew_interpretation": "FEAR" if skew and skew > 3 else ("COMPLACENT" if skew and skew < 0 else "NORMAL"),
        }
    except Exception as e:
        logger.error("iv_skew: %s", e)
        return {}


def enrich_option_chain(option_data: Dict) -> Dict:
    """
    Add max pain, OI levels, unusual activity, IV skew, and Black-Scholes
    Greeks (delta, gamma, theta, vega) for every strike in the chain.
    Greeks are shown in the OptionsChain.tsx table columns.
    """
    if not option_data:
        return option_data

    strikes    = option_data.get("strikes", [])
    underlying = float(option_data.get("underlying_value", 0) or 0)

    # ── IV + Greeks per strike ────────────────────────────────────────────────
    # NSE publishes IV directly; Fyers does NOT — so when IV is missing we back
    # it out from the traded LTP via Black-Scholes (_implied_vol). IV is stored
    # as a PERCENTAGE throughout (matches NSE), then divided by 100 for Greeks.
    for s in strikes:
        K      = float(s.get("strike") or 0)
        expiry = s.get("expiry", "")
        T      = _expiry_to_years(expiry)
        if underlying <= 0 or K <= 0 or T <= 0:
            continue

        # ── Call side ───────────────────────────────────────────────────────
        call_iv = float(s.get("call_iv") or 0)
        if call_iv <= 0:
            call_iv = _implied_vol(float(s.get("call_ltp") or 0), underlying, K, T, "CE")
            s["call_iv"] = call_iv
        if call_iv > 0:
            cg = _bs_greeks(underlying, K, T, call_iv / 100.0, "CE")
            s["call_delta"] = cg["delta"]
            s["call_gamma"] = cg["gamma"]
            s["call_theta"] = cg["theta"]
            s["call_vega"]  = cg["vega"]

        # ── Put side ────────────────────────────────────────────────────────
        put_iv = float(s.get("put_iv") or 0)
        if put_iv <= 0:
            put_iv = _implied_vol(float(s.get("put_ltp") or 0), underlying, K, T, "PE")
            s["put_iv"] = put_iv
        if put_iv > 0:
            pg = _bs_greeks(underlying, K, T, put_iv / 100.0, "PE")
            s["put_delta"] = pg["delta"]
            s["put_gamma"] = pg["gamma"]
            s["put_theta"] = pg["theta"]
            s["put_vega"]  = pg["vega"]

    option_data["max_pain"]        = find_max_pain(strikes)
    option_data["oi_levels"]       = find_oi_resistance_support(strikes, underlying)
    option_data["unusual_activity"]= detect_unusual_options_activity(strikes)
    option_data["iv_skew"]         = calculate_iv_skew(strikes, underlying)

    return option_data
