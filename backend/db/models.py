"""Pydantic models for API responses and WebSocket messages."""

from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict
from datetime import datetime


class OHLCVBar(BaseModel):
    time: int  # unix timestamp
    open: float
    high: float
    low: float
    close: float
    volume: int


class TickerQuote(BaseModel):
    symbol: str
    name: str
    price: float
    change: float
    change_pct: float
    open: float
    high: float
    low: float
    prev_close: float
    volume: int
    avg_volume: int
    market_cap: Optional[float] = None
    pe: Optional[float] = None
    week_52_high: Optional[float] = None
    week_52_low: Optional[float] = None
    bid: Optional[float] = None
    ask: Optional[float] = None
    bid_qty: Optional[int] = None
    ask_qty: Optional[int] = None
    circuit_high: Optional[float] = None
    circuit_low: Optional[float] = None
    timestamp: str = Field(default_factory=lambda: datetime.now().isoformat())


class NewsItem(BaseModel):
    id: Optional[int] = None
    ticker: Optional[str] = None
    headline: str
    summary: Optional[str] = None
    source: str
    url: Optional[str] = None
    published_at: str
    sentiment: float = 0.0
    category: Optional[str] = None


class FilingItem(BaseModel):
    id: Optional[int] = None
    symbol: Optional[str] = None
    exchange: str
    filing_type: str
    subject: str
    description: Optional[str] = None
    url: Optional[str] = None
    filed_at: str
    impact: Optional[str] = None


class EarningsItem(BaseModel):
    symbol: str
    company_name: str
    result_date: str
    quarter: str
    result_type: str
    revenue_est: Optional[float] = None
    eps_est: Optional[float] = None
    revenue_actual: Optional[float] = None
    eps_actual: Optional[float] = None
    revenue_surprise_pct: Optional[float] = None
    eps_surprise_pct: Optional[float] = None
    yoy_revenue_growth: Optional[float] = None
    yoy_pat_growth: Optional[float] = None
    status: str = "upcoming"
    concall_date: Optional[str] = None
    concall_time: Optional[str] = None


class InsiderTrade(BaseModel):
    symbol: str
    person_name: str
    person_type: str
    transaction_type: str
    shares: int
    price: float
    value: float
    holding_pct_before: Optional[float] = None
    holding_pct_after: Optional[float] = None
    date: str


class FIIDIIFlow(BaseModel):
    date: str
    fii_buy: float
    fii_sell: float
    fii_net: float
    dii_buy: float
    dii_sell: float
    dii_net: float


class MacroIndicator(BaseModel):
    indicator: str
    value: float
    unit: str
    period: str
    source: str
    updated_at: str


class Fundamentals(BaseModel):
    symbol: str
    pe_ratio: Optional[float] = None
    pb_ratio: Optional[float] = None
    ps_ratio: Optional[float] = None
    ev_ebitda: Optional[float] = None
    div_yield: Optional[float] = None
    revenue: Optional[float] = None
    revenue_growth: Optional[float] = None
    ebitda: Optional[float] = None
    ebitda_margin: Optional[float] = None
    pat: Optional[float] = None
    pat_margin: Optional[float] = None
    pat_growth: Optional[float] = None
    eps: Optional[float] = None
    book_value: Optional[float] = None
    roe: Optional[float] = None
    roce: Optional[float] = None
    roa: Optional[float] = None
    current_ratio: Optional[float] = None
    debt_equity: Optional[float] = None
    interest_coverage: Optional[float] = None
    promoter_holding: Optional[float] = None
    fii_holding: Optional[float] = None
    dii_holding: Optional[float] = None
    promoter_pledge_pct: Optional[float] = None
    total_assets: Optional[float] = None
    net_worth: Optional[float] = None
    operating_cf: Optional[float] = None
    free_cf: Optional[float] = None
    market_cap: Optional[float] = None
    enterprise_value: Optional[float] = None
    week_52_high: Optional[float] = None
    week_52_low: Optional[float] = None
    updated_at: Optional[str] = None


class OptionsChainEntry(BaseModel):
    strike: float
    expiry: str
    call_oi: Optional[int] = None
    call_oi_change: Optional[int] = None
    call_volume: Optional[int] = None
    call_iv: Optional[float] = None
    call_ltp: Optional[float] = None
    call_bid: Optional[float] = None
    call_ask: Optional[float] = None
    put_oi: Optional[int] = None
    put_oi_change: Optional[int] = None
    put_volume: Optional[int] = None
    put_iv: Optional[float] = None
    put_ltp: Optional[float] = None
    put_bid: Optional[float] = None
    put_ask: Optional[float] = None
    pcr: Optional[float] = None


class TechnicalSignals(BaseModel):
    symbol: str
    ema20: Optional[float] = None
    ema50: Optional[float] = None
    ema200: Optional[float] = None
    sma20: Optional[float] = None
    sma50: Optional[float] = None
    sma200: Optional[float] = None
    rsi14: Optional[float] = None
    macd: Optional[float] = None
    macd_signal: Optional[float] = None
    macd_hist: Optional[float] = None
    bb_upper: Optional[float] = None
    bb_mid: Optional[float] = None
    bb_lower: Optional[float] = None
    vwap: Optional[float] = None
    atr14: Optional[float] = None
    adx14: Optional[float] = None
    stoch_k: Optional[float] = None
    stoch_d: Optional[float] = None
    trend: Optional[str] = None
    signal: Optional[str] = None
    strength: Optional[float] = None


class VolumeShockerItem(BaseModel):
    symbol: str
    name: Optional[str] = None
    volume: int
    avg_volume_20d: int
    volume_ratio: float
    price: float
    change_pct: float
    reason: Optional[str] = None


class MarketSentiment(BaseModel):
    regime: str
    bull_bear_score: float
    advance_decline: Dict[str, int]
    pcr_nifty: Optional[float] = None
    india_vix: Optional[float] = None
    gift_nifty_gap: Optional[float] = None
    breadth_score: float
    updated_at: str


class WSMessage(BaseModel):
    type: str
    data: Any
    timestamp: str = Field(default_factory=lambda: datetime.now().isoformat())
