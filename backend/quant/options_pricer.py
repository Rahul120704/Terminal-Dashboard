"""
BTI Options Pricer — Black-Scholes engine with IV surface
- Batch BS pricing (numba JIT)
- Brent's method IV solver
- Analytical Greeks: delta, gamma, vega, theta, rho
- IVSurface: RectBivariateSpline on moneyness × maturity grid
"""

from __future__ import annotations

import math
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Try numba JIT — fall back gracefully on Windows if not installed
# ─────────────────────────────────────────────
try:
    from numba import njit, prange
    _NUMBA = True
    logger.info("Options pricer: numba JIT enabled")
except ImportError:
    _NUMBA = False
    logger.warning("Options pricer: numba not available — using pure numpy (slower)")

    def njit(*args, **kwargs):  # type: ignore
        def decorator(fn):
            return fn
        return decorator

    def prange(n):  # type: ignore
        return range(n)

try:
    from scipy.interpolate import RectBivariateSpline
    _SCIPY = True
except ImportError:
    _SCIPY = False
    logger.warning("Options pricer: scipy not available — IV surface smoothing disabled")


# ─────────────────────────────────────────────
# Data classes
# ─────────────────────────────────────────────

@dataclass
class BlackScholesGreeks:
    price: float
    delta: float
    gamma: float
    vega: float
    theta: float      # per-day
    rho: float
    implied_vol: Optional[float] = None


@dataclass
class OptionContract:
    symbol: str
    strike: float
    expiry_days: float     # calendar days to expiry
    option_type: str       # "CE" or "PE"
    market_price: float
    spot: float
    risk_free_rate: float = 0.065   # RBI repo rate proxy


@dataclass
class IVSurfacePoint:
    moneyness: float   # strike / spot
    maturity: float    # years
    iv: float


@dataclass
class IVSurface:
    symbol: str
    spot: float
    points: List[IVSurfacePoint] = field(default_factory=list)
    moneyness_grid: List[float] = field(default_factory=list)
    maturity_grid: List[float] = field(default_factory=list)
    iv_matrix: List[List[float]] = field(default_factory=list)
    timestamp: str = ""

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "spot": self.spot,
            "moneyness_grid": self.moneyness_grid,
            "maturity_grid": self.maturity_grid,
            "iv_matrix": self.iv_matrix,
            "timestamp": self.timestamp,
            "points": [
                {"moneyness": p.moneyness, "maturity": p.maturity, "iv": p.iv}
                for p in self.points
            ],
        }


# ─────────────────────────────────────────────
# Core BS math — pure python so numba can JIT it
# ─────────────────────────────────────────────

def _norm_cdf(x: float) -> float:
    """Standard normal CDF via math.erfc."""
    return 0.5 * math.erfc(-x / math.sqrt(2.0))


def _norm_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def _bs_price_scalar(S: float, K: float, T: float, r: float, sigma: float, is_call: bool) -> float:
    """Scalar Black-Scholes price."""
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return max(0.0, (S - K) if is_call else (K - S))
    sqrt_T = math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrt_T)
    d2 = d1 - sigma * sqrt_T
    if is_call:
        return S * _norm_cdf(d1) - K * math.exp(-r * T) * _norm_cdf(d2)
    else:
        return K * math.exp(-r * T) * _norm_cdf(-d2) - S * _norm_cdf(-d1)


def _bs_greeks_scalar(S: float, K: float, T: float, r: float, sigma: float, is_call: bool) -> Tuple[float, float, float, float, float, float]:
    """Returns (price, delta, gamma, vega, theta_per_day, rho)."""
    if T <= 0 or sigma <= 0:
        price = max(0.0, (S - K) if is_call else (K - S))
        return price, (1.0 if is_call and S > K else 0.0), 0.0, 0.0, 0.0, 0.0

    sqrt_T = math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrt_T)
    d2 = d1 - sigma * sqrt_T
    nd1 = _norm_pdf(d1)
    exp_rT = math.exp(-r * T)

    if is_call:
        price = S * _norm_cdf(d1) - K * exp_rT * _norm_cdf(d2)
        delta = _norm_cdf(d1)
        rho = K * T * exp_rT * _norm_cdf(d2) / 100.0
        theta = (-S * nd1 * sigma / (2.0 * sqrt_T) - r * K * exp_rT * _norm_cdf(d2)) / 365.0
    else:
        price = K * exp_rT * _norm_cdf(-d2) - S * _norm_cdf(-d1)
        delta = _norm_cdf(d1) - 1.0
        rho = -K * T * exp_rT * _norm_cdf(-d2) / 100.0
        theta = (-S * nd1 * sigma / (2.0 * sqrt_T) + r * K * exp_rT * _norm_cdf(-d2)) / 365.0

    gamma = nd1 / (S * sigma * sqrt_T)
    vega = S * nd1 * sqrt_T / 100.0   # per 1% vol move

    return price, delta, gamma, vega, theta, rho


# ─────────────────────────────────────────────
# Implied Volatility — Brent's method
# ─────────────────────────────────────────────

def _implied_vol_brent(market_price: float, S: float, K: float, T: float, r: float, is_call: bool,
                        tol: float = 1e-6, max_iter: int = 100) -> Optional[float]:
    """Brent's method IV solver. Returns None if no solution found."""
    if T <= 0 or market_price <= 0:
        return None

    # Intrinsic check
    intrinsic = max(0.0, (S - K) if is_call else (K - S))
    if market_price <= intrinsic + 1e-8:
        return None

    def f(sigma: float) -> float:
        return _bs_price_scalar(S, K, T, r, sigma, is_call) - market_price

    # Bracket
    lo, hi = 1e-4, 10.0
    f_lo, f_hi = f(lo), f(hi)
    if f_lo * f_hi > 0:
        return None

    # Brent's method
    a, b = lo, hi
    fa, fb = f_lo, f_hi
    if abs(fa) < abs(fb):
        a, b = b, a
        fa, fb = fb, fa

    c, fc = a, fa
    mflag = True
    s = 0.0

    for _ in range(max_iter):
        if abs(b - a) < tol:
            return b

        if fa != fc and fb != fc:
            # Inverse quadratic interpolation
            s = (a * fb * fc / ((fa - fb) * (fa - fc)) +
                 b * fa * fc / ((fb - fa) * (fb - fc)) +
                 c * fa * fb / ((fc - fa) * (fc - fb)))
        else:
            s = b - fb * (b - a) / (fb - fa)

        cond1 = not ((3 * a + b) / 4 < s < b or b < s < (3 * a + b) / 4)
        cond2 = mflag and abs(s - b) >= abs(b - c) / 2
        cond3 = not mflag and abs(s - b) >= abs(c - (c if c == a else a)) / 2
        cond4 = mflag and abs(b - c) < tol
        cond5 = not mflag and abs(c - (c if c == a else a)) < tol

        if cond1 or cond2 or cond3 or cond4 or cond5:
            s = (a + b) / 2
            mflag = True
        else:
            mflag = False

        fs = f(s)
        c, fc = b, fb

        if fa * fs < 0:
            b, fb = s, fs
        else:
            a, fa = s, fs

        if abs(fa) < abs(fb):
            a, b = b, a
            fa, fb = fb, fa

    return b if abs(fb) < tol * 10 else None


# ─────────────────────────────────────────────
# Batch numpy pricing
# ─────────────────────────────────────────────

def bs_batch_price(
    spots: np.ndarray,
    strikes: np.ndarray,
    T: np.ndarray,
    r: float,
    sigmas: np.ndarray,
    is_call: np.ndarray,  # bool array
) -> np.ndarray:
    """Vectorized BS pricing — returns price array."""
    T_safe = np.clip(T, 1e-10, None)
    sigma_safe = np.clip(sigmas, 1e-10, None)

    sqrt_T = np.sqrt(T_safe)
    d1 = (np.log(spots / strikes) + (r + 0.5 * sigma_safe**2) * T_safe) / (sigma_safe * sqrt_T)
    d2 = d1 - sigma_safe * sqrt_T

    from scipy.special import ndtr  # type: ignore
    Nd1 = ndtr(d1)
    Nd2 = ndtr(d2)
    exp_rT = np.exp(-r * T_safe)

    call_price = spots * Nd1 - strikes * exp_rT * Nd2
    put_price = strikes * exp_rT * (1 - Nd2) - spots * (1 - Nd1)

    prices = np.where(is_call, call_price, put_price)
    intrinsic = np.where(is_call, np.maximum(0.0, spots - strikes), np.maximum(0.0, strikes - spots))
    return np.maximum(prices, intrinsic)


# ─────────────────────────────────────────────
# Main pricer class
# ─────────────────────────────────────────────

class OptionsPricer:
    """
    Full-featured options pricer for NSE/BSE derivatives.
    - price_contract(): single BS price + all Greeks
    - implied_vol(): IV via Brent's method
    - build_iv_surface(): full moneyness × maturity IV surface
    """

    def __init__(self, risk_free_rate: float = 0.065):
        self.risk_free_rate = risk_free_rate
        logger.info(f"OptionsPricer initialized: r={risk_free_rate:.3f}, numba={_NUMBA}, scipy={_SCIPY}")

    def price_contract(self, contract: OptionContract) -> BlackScholesGreeks:
        """Price a single option contract with all Greeks."""
        S = contract.spot
        K = contract.strike
        T = contract.expiry_days / 365.0
        r = contract.risk_free_rate
        is_call = contract.option_type.upper() in ("CE", "CALL", "C")

        # Get IV from market price first
        iv = _implied_vol_brent(contract.market_price, S, K, T, r, is_call)
        sigma = iv if iv else 0.20  # fallback

        price, delta, gamma, vega, theta, rho = _bs_greeks_scalar(S, K, T, r, sigma, is_call)

        return BlackScholesGreeks(
            price=round(price, 2),
            delta=round(delta, 4),
            gamma=round(gamma, 6),
            vega=round(vega, 4),
            theta=round(theta, 4),
            rho=round(rho, 4),
            implied_vol=round(iv * 100, 2) if iv else None,
        )

    def implied_vol(self, market_price: float, S: float, K: float,
                    expiry_days: float, option_type: str,
                    r: Optional[float] = None) -> Optional[float]:
        """Return implied volatility in % (e.g. 22.5 = 22.5%)."""
        if r is None:
            r = self.risk_free_rate
        T = max(expiry_days / 365.0, 1e-10)
        is_call = option_type.upper() in ("CE", "CALL", "C")
        iv = _implied_vol_brent(market_price, S, K, T, r, is_call)
        return round(iv * 100, 3) if iv else None

    def build_iv_surface(
        self,
        contracts: List[OptionContract],
        symbol: str,
        timestamp: str = "",
        moneyness_range: Tuple[float, float] = (0.85, 1.15),
        maturity_range: Tuple[float, float] = (7, 180),
        grid_size: int = 12,
    ) -> IVSurface:
        """
        Build the IV surface from a list of option contracts.
        Returns a structured IVSurface with smoothed grid (scipy) or raw points.
        """
        spot = contracts[0].spot if contracts else 100.0

        # Compute IV for each contract
        raw_points: List[IVSurfacePoint] = []
        for c in contracts:
            if c.market_price <= 0 or c.expiry_days < 1:
                continue
            T = c.expiry_days / 365.0
            r = c.risk_free_rate
            is_call = c.option_type.upper() in ("CE", "CALL", "C")
            iv = _implied_vol_brent(c.market_price, c.spot, c.strike, T, r, is_call)
            if iv and 0.01 <= iv <= 5.0:
                moneyness = c.strike / c.spot
                raw_points.append(IVSurfacePoint(
                    moneyness=round(moneyness, 4),
                    maturity=round(T, 4),
                    iv=round(iv * 100, 3),
                ))

        surface = IVSurface(symbol=symbol, spot=spot, points=raw_points, timestamp=timestamp)

        if len(raw_points) < 4 or not _SCIPY:
            logger.warning(f"IV surface for {symbol}: only {len(raw_points)} valid points — returning raw")
            return surface

        # Build smooth grid with RectBivariateSpline
        try:
            m_lo, m_hi = moneyness_range
            t_lo_d, t_hi_d = maturity_range
            t_lo, t_hi = t_lo_d / 365, t_hi_d / 365

            moneyness_grid = np.linspace(m_lo, m_hi, grid_size)
            maturity_grid = np.linspace(t_lo, t_hi, grid_size)

            pts_m = np.array([p.moneyness for p in raw_points])
            pts_t = np.array([p.maturity for p in raw_points])
            pts_iv = np.array([p.iv for p in raw_points])

            spline = RectBivariateSpline(
                np.sort(np.unique(pts_m.round(3))),
                np.sort(np.unique(pts_t.round(4))),
                np.zeros((len(np.unique(pts_m.round(3))), len(np.unique(pts_t.round(4))))),
                kx=min(3, len(np.unique(pts_m.round(3))) - 1),
                ky=min(3, len(np.unique(pts_t.round(4))) - 1),
            )

            # Use scipy griddata as simpler alternative when spline fails
            from scipy.interpolate import griddata
            grid_m, grid_t = np.meshgrid(moneyness_grid, maturity_grid, indexing="ij")
            iv_matrix = griddata(
                np.column_stack([pts_m, pts_t]),
                pts_iv,
                (grid_m, grid_t),
                method="cubic",
                fill_value=np.nanmean(pts_iv),
            )
            # Clip to reasonable range
            iv_matrix = np.clip(iv_matrix, 1.0, 200.0)

            surface.moneyness_grid = [round(float(x), 4) for x in moneyness_grid]
            surface.maturity_grid = [round(float(t * 365), 1) for t in maturity_grid]  # show as days
            surface.iv_matrix = [[round(float(v), 2) for v in row] for row in iv_matrix.tolist()]

        except Exception as exc:
            logger.error(f"IV surface spline failed for {symbol}: {exc}")

        return surface

    def pcr_analysis(self, calls_oi: float, puts_oi: float, calls_vol: float, puts_vol: float) -> dict:
        """Put-Call Ratio analysis with regime classification."""
        pcr_oi = puts_oi / max(calls_oi, 1)
        pcr_vol = puts_vol / max(calls_vol, 1)

        if pcr_oi > 1.3:
            regime = "FEAR"
            signal = "CONTRARIAN_BULL"
        elif pcr_oi < 0.7:
            regime = "GREED"
            signal = "CONTRARIAN_BEAR"
        else:
            regime = "NEUTRAL"
            signal = "NO_SIGNAL"

        return {
            "pcr_oi": round(pcr_oi, 3),
            "pcr_vol": round(pcr_vol, 3),
            "regime": regime,
            "signal": signal,
            "calls_oi": int(calls_oi),
            "puts_oi": int(puts_oi),
        }
