export interface Quote {
  symbol: string;
  name?: string;
  price: number;
  change: number;
  change_pct: number;
  open: number;
  high: number;
  low: number;
  prev_close: number;
  volume: number;
  avg_volume?: number;
  market_cap?: number;
  pe?: number;
  week_52_high?: number;
  week_52_low?: number;
  bid?: number;
  ask?: number;
  timestamp?: string;
}

export interface OHLCVBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NewsItem {
  id?: number;
  ticker?: string;
  headline: string;
  summary?: string;
  source: string;
  url?: string;
  published_at: string;
  sentiment: number;
  category?: string;
}

export interface FilingItem {
  id?: number;
  symbol?: string;
  exchange: string;
  filing_type: string;
  subject: string;
  url?: string;
  filed_at: string;
  impact?: string;
}

export interface EarningsItem {
  symbol: string;
  company_name: string;
  result_date: string;
  quarter: string;
  result_type: string;
  revenue_actual?: number;
  eps_actual?: number;
  revenue_surprise_pct?: number;
  eps_surprise_pct?: number;
  yoy_revenue_growth?: number;
  yoy_pat_growth?: number;
  status: string;
  concall_date?: string;
  concall_time?: string;
}

export interface Fundamentals {
  symbol: string;
  name?: string;
  sector?: string;
  industry?: string;
  description?: string;
  pe_ratio?: number;
  pb_ratio?: number;
  ev_ebitda?: number;
  div_yield?: number;
  revenue?: number;
  revenue_growth?: number;
  ebitda?: number;
  ebitda_margin?: number;
  pat?: number;
  pat_margin?: number;
  eps?: number;
  book_value?: number;
  roe?: number;
  roce?: number;
  roa?: number;
  current_ratio?: number;
  debt_equity?: number;
  promoter_holding?: number;
  fii_holding?: number;
  dii_holding?: number;
  promoter_pledge_pct?: number;
  total_assets?: number;
  net_worth?: number;
  operating_cf?: number;
  free_cf?: number;
  market_cap?: number;
  enterprise_value?: number;
  week_52_high?: number;
  week_52_low?: number;
  quarterly_results?: QuarterlyResult[];
  annual_balance_sheet?: BalanceSheetEntry[];
  cashflow?: CashflowEntry[];
  peers?: PeerEntry[];
  updated_at?: string;
}

export interface QuarterlyResult {
  period: string;
  revenue?: number;
  operating_profit?: number;
  pat?: number;
  opm_pct?: number;
  eps?: number;
}

export interface BalanceSheetEntry {
  period: string;
  total_assets?: number;
  total_liabilities?: number;
  borrowings?: number;
  net_worth?: number;
}

export interface CashflowEntry {
  period: string;
  operating_cf?: number;
  investing_cf?: number;
  financing_cf?: number;
}

export interface PeerEntry {
  name: string;
  cmp?: number;
  pe?: number;
  market_cap?: number;
}

export interface TechnicalSignal {
  symbol: string;
  close?: number;   // last close price (used by TechnicalIndicators as price fallback)
  ema20?: number;
  ema50?: number;
  ema200?: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
  rsi14?: number;
  macd?: number;
  macd_signal?: number;
  macd_hist?: number;
  bb_upper?: number;
  bb_mid?: number;
  bb_lower?: number;
  vwap?: number;
  atr14?: number;
  adx14?: number;
  stoch_k?: number;
  stoch_d?: number;
  signal?: string;
  trend?: string;
  strength?: number;
  signal_reasons?: string[];
}

export interface MacroDashboard {
  indicators: MacroIndicator[];
  fii_dii_flows: FIIDIIFlow[];
  market_prices: Record<string, { name: string; value: number; change_pct: number }>;
  updated_at: string;
  // Sentiment overlay fields sent alongside macro data
  regime?: string;
  india_vix?: number;
  bull_bear_score?: number;
}

export interface MacroIndicator {
  indicator: string;
  value: number;
  unit: string;
  period: string;
  source: string;
  updated_at: string;
}

export interface FIIDIIFlow {
  date: string;
  fii_buy: number;
  fii_sell: number;
  fii_net: number;
  dii_buy: number;
  dii_sell: number;
  dii_net: number;
}

export interface MarketSentiment {
  regime: string;
  bull_bear_score: number;
  advance_decline: { advances: number; declines: number; unchanged: number; ratio: number };
  india_vix?: number;
  pcr_nifty?: number;
  signals?: string[];
  updated_at: string;
}

export interface IndexData {
  name: string;
  value: number;
  change: number;
  change_pct: number;
  open: number;
  high: number;
  low: number;
  prev_close: number;
  year_high: number;
  year_low: number;
}

export interface OptionsChain {
  symbol: string;
  expiry_dates: string[];
  strikes: OptionsStrike[];
  total_ce_oi: number;
  total_pe_oi: number;
  pcr: number;
  underlying_value: number;
  max_pain?: number;
  oi_levels?: { resistance?: number; support?: number };
  unusual_activity?: UnusualActivity[];
  iv_skew?: IVSkew;
}

export interface OptionsStrike {
  strike: number;
  expiry: string;
  call_oi?: number;
  call_oi_change?: number;
  call_volume?: number;
  call_iv?: number;
  call_ltp?: number;
  put_oi?: number;
  put_oi_change?: number;
  put_volume?: number;
  put_iv?: number;
  put_ltp?: number;
  pcr?: number;
}

export interface UnusualActivity {
  type: string;
  strike: number;
  expiry: string;
  oi_change: number;
  multiplier: number;
  direction: string;
}

export interface IVSkew {
  atm_iv?: number;
  avg_call_iv?: number;
  avg_put_iv?: number;
  skew?: number;
  skew_interpretation?: string;
}

export interface VolumeShockerItem {
  symbol: string;
  name?: string;
  volume: number;
  avg_volume_20d: number;
  volume_ratio: number;
  price: number;
  change_pct: number;
  reason?: string;
}

export interface InsiderTrade {
  symbol: string;
  person_name: string;
  person_type: string;
  transaction_type: string;
  shares: number;
  price: number;
  value: number;
  holding_pct_before?: number;
  holding_pct_after?: number;
  date: string;
}

export interface SystemHealth {
  agents: AgentHealth[];
  system: {
    cpu_pct: number;
    mem_pct: number;
    mem_available_gb: number;
    disk_pct: number;
    disk_free_gb: number;
  };
  updated_at: string;
}

export interface AgentHealth {
  name: string;
  status: string;
  last_beat_seconds_ago: number;
  restart_count: number;
  last_error: string;
}

export type ActiveView =
  | 'dashboard'
  | 'chart'
  | 'fundamentals'
  | 'news'
  | 'filings'
  | 'earnings'
  | 'options'
  | 'insider'
  | 'macro'
  | 'sector'
  | 'screener'
  | 'srch'
  | 'guardian'
  | 'global'
  | 'port'
  | 'alrt'
  | 'wlist'
  | 'ecow';
