/**
 * Bloomberg Terminal India — Main Terminal Shell
 *
 * Architecture (Bloomberg-inspired):
 *  • WebSocket runs in a Web Worker (off main thread) — JSON parsing never
 *    competes with React's reconciler for CPU time.
 *  • Prices flow: Worker → marketStore (RAF-batched) → useQuote(sym) hooks
 *    Only the SPECIFIC component watching a symbol re-renders on each tick.
 *  • Non-price data (news, macro, sentiment) dispatched via requestIdleCallback
 *    so they can't interrupt a 60fps price update cycle.
 *  • React.lazy panels: only active panel's JS is executed. Off-screen panels
 *    consume zero CPU regardless of tick frequency.
 */

import React, {
  useState, useEffect, useCallback, useRef, useMemo, memo, Suspense, lazy, useContext,
} from 'react';
import { useMarketWorker } from '../hooks/useMarketWorker';
import { marketStore, useAllQuotes, useAllIndices, useQuote } from '../store/marketStore';
// useAllQuotes/useAllIndices used in PanelRouter and DashboardView (within this file)
import {
  useLiveNews, useTickerNews, useSentiment, useTechnicals,
  useLiveFilings, useVolumeShockers, useHedgeFundState,
} from '../store/liveDataStore';
import { TitleBarContext } from '../context/TitleBarContext';
import { useApiData, prefetchApi } from '../hooks/useApi';
import { TickerBar } from './TickerBar';
import { TickerSearch } from './TickerSearch';
import { AlertsToastContainer } from './PriceAlerts';
import {
  Quote, IndexData, NewsItem, FilingItem, MarketSentiment,
  MacroDashboard, TechnicalSignal, VolumeShockerItem,
} from '../types';

// ─── Lazy panel imports (each loads only when first visited) ──────────────────
const Chart            = lazy(() => import('./Chart').then(m => ({ default: m.Chart })));
const NewsPanel        = lazy(() => import('./NewsPanel').then(m => ({ default: m.NewsPanel })));
const FilingsPanel     = lazy(() => import('./FilingsPanel').then(m => ({ default: m.FilingsPanel })));
const Fundamentals     = lazy(() => import('./Fundamentals').then(m => ({ default: m.Fundamentals })));
const EarningsCalendar = lazy(() => import('./EarningsCalendar').then(m => ({ default: m.EarningsCalendar })));
const OptionsChain     = lazy(() => import('./OptionsChain').then(m => ({ default: m.OptionsChain })));
const VolumeShockers   = lazy(() => import('./VolumeShockers').then(m => ({ default: m.VolumeShockers })));
const InsiderActivity  = lazy(() => import('./InsiderActivity').then(m => ({ default: m.InsiderActivity })));
const MacroPanel       = lazy(() => import('./MacroPanel').then(m => ({ default: m.MacroPanel })));
const SectorHeatmap    = lazy(() => import('./SectorHeatmap').then(m => ({ default: m.SectorHeatmap })));
const TechnicalIndicators = lazy(() => import('./TechnicalIndicators').then(m => ({ default: m.TechnicalIndicators })));
const GuardianStatus   = lazy(() => import('./GuardianStatus').then(m => ({ default: m.GuardianStatus })));
const HedgeFundPanel   = lazy(() => import('./HedgeFundPanel').then(m => ({ default: m.HedgeFundPanel })));
const GlobalMarketsPanel = lazy(() => import('./GlobalMarketsPanel').then(m => ({ default: m.GlobalMarketsPanel })));
const Screener         = lazy(() => import('./Screener').then(m => ({ default: m.Screener })));
const Portfolio        = lazy(() => import('./Portfolio').then(m => ({ default: m.Portfolio })));
const PriceAlerts      = lazy(() => import('./PriceAlerts').then(m => ({ default: m.PriceAlerts })));
const Watchlist        = lazy(() => import('./Watchlist').then(m => ({ default: m.Watchlist })));
const EconomicCalendar = lazy(() => import('./EconomicCalendar').then(m => ({ default: m.EconomicCalendar })));
const AICopilot        = lazy(() => import('./AICopilot'));
const AnomalyPanel     = lazy(() => import('./AnomalyPanel'));
const IVSurface        = lazy(() => import('./IVSurface'));
const BacktestPanel    = lazy(() => import('./BacktestPanel'));
const EarningsAIPanel  = lazy(() => import('./EarningsAIPanel'));

// ─── New Bloomberg Feature Panels ────────────────────────────────────────────
const CompanyOverview     = lazy(() => import('./CompanyOverview').then(m => ({ default: m.CompanyOverview })));
const ShareholdingPanel   = lazy(() => import('./ShareholdingPanel').then(m => ({ default: m.ShareholdingPanel })));
const BlockBulkDealsPanel = lazy(() => import('./BlockBulkDealsPanel').then(m => ({ default: m.BlockBulkDealsPanel })));
const FIIDIIPanel         = lazy(() => import('./FIIDIIPanel').then(m => ({ default: m.FIIDIIPanel })));
const SectorMoneyFlowPanel = lazy(() => import('./SectorMoneyFlowPanel').then(m => ({ default: m.SectorMoneyFlowPanel })));
const CorporateActionsPanel = lazy(() => import('./CorporateActionsPanel').then(m => ({ default: m.CorporateActionsPanel })));
const DCFValuationPanel   = lazy(() => import('./DCFValuationPanel').then(m => ({ default: m.DCFValuationPanel })));
const PeerComparisonPanel = lazy(() => import('./PeerComparisonPanel').then(m => ({ default: m.PeerComparisonPanel })));
const YieldCurvePanel     = lazy(() => import('./YieldCurvePanel').then(m => ({ default: m.YieldCurvePanel })));
const DeliveryVolumePanel  = lazy(() => import('./DeliveryVolumePanel').then(m => ({ default: m.DeliveryVolumePanel })));
const AnalystEstimatesPanel  = lazy(() => import('./AnalystEstimatesPanel').then(m => ({ default: m.AnalystEstimatesPanel })));
const MarketBreadthPanel     = lazy(() => import('./MarketBreadthPanel').then(m => ({ default: m.MarketBreadthPanel })));
const ConcallPanel           = lazy(() => import('./ConcallPanel').then(m => ({ default: m.ConcallPanel })));
// ─── Company Deep-Dive (Bloomberg DES — global Ctrl+/ search) ────────────────
const StockDeepDive = lazy(() => import('./StockDeepDive').then(m => ({ default: m.StockDeepDive })));

// ─── Premium Bloomberg Panels (Crypto, FX, ESG, WACC, SPLC) ──────────────────
const CryptoDashboard  = lazy(() => import('./CryptoDashboard').then(m => ({ default: m.CryptoDashboard })));
const FXMatrix         = lazy(() => import('./FXMatrix').then(m => ({ default: m.FXMatrix })));
const ESGPanel         = lazy(() => import('./ESGPanel').then(m => ({ default: m.ESGPanel })));
const WACCCalculator   = lazy(() => import('./WACCCalculator').then(m => ({ default: m.WACCCalculator })));
const SupplyChainPanel = lazy(() => import('./SupplyChainPanel').then(m => ({ default: m.SupplyChainPanel })));

// ─── New Bloomberg Parity Panels (WIRP, BETA, Social, Trade Replay, EE, M&A) ──
const RateHikeProbabilityPanel = lazy(() => import('./RateHikeProbabilityPanel').then(m => ({ default: m.RateHikeProbabilityPanel })));
const BetaAnalysisPanel        = lazy(() => import('./BetaAnalysisPanel').then(m => ({ default: m.BetaAnalysisPanel })));
const SocialSentimentPanel     = lazy(() => import('./SocialSentimentPanel').then(m => ({ default: m.SocialSentimentPanel })));
const TradeReplayPanel         = lazy(() => import('./TradeReplayPanel').then(m => ({ default: m.TradeReplayPanel })));
const EarningsEstimatorPanel   = lazy(() => import('./EarningsEstimatorPanel').then(m => ({ default: m.EarningsEstimatorPanel })));
const MnATrackerPanel          = lazy(() => import('./MnATrackerPanel').then(m => ({ default: m.MnATrackerPanel })));

import { CommandBar } from './CommandBar';
import { MnemonicCLI } from './MnemonicCLI';
import { MFEMount } from './MFEMount';
import { resolve } from '../mfe/registry';
import { eventBus } from '../mfe/bus';

// ─── Sidebar sections & navigation config ────────────────────────────────────
type Section = 'MKTS' | 'ANLT' | 'AI';

interface NavItem {
  id: string;
  label: string;
  icon: string;
  kbd?: string;
}

const SIDEBAR: Record<Section, { label: string; color: string; items: NavItem[] }> = {
  MKTS: {
    label: 'MARKETS',
    color: '#ff9500',
    items: [
      { id: 'dashboard',      label: 'DASHBOARD',      icon: '⊞', kbd: 'F1' },
      { id: 'chart',          label: 'CHART',          icon: '📈', kbd: 'F2' },
      { id: 'news',           label: 'NEWS FEED',      icon: '📰', kbd: 'F3' },
      { id: 'filings',        label: 'FILINGS',        icon: '📁', kbd: 'F4' },
      { id: 'earnings',       label: 'EARNINGS',       icon: '💰', kbd: 'F5' },
      { id: 'options',        label: 'OPTIONS',        icon: '⚙', kbd: 'F6' },
      { id: 'fundamentals',   label: 'FUNDAMENTALS',   icon: '📊' },
      { id: 'deep-dive',      label: 'STOCK SEARCH ⌨', icon: '🔍', kbd: 'Ctrl+/' },
      { id: 'shareholding',   label: 'SHAREHOLDING',   icon: '🥧' },
      { id: 'corp-actions',   label: 'CORP ACTIONS',   icon: '📋' },
      { id: 'insider',        label: 'INSIDER',        icon: '👁', kbd: 'F7' },
      { id: 'block-deals',    label: 'BLOCK/BULK',     icon: '🔷' },
      { id: 'fii-dii',        label: 'FII/DII FLOWS',  icon: '🌊' },
      { id: 'sector-flow',   label: 'SECTOR MONEY FLOW', icon: '💹' },
      { id: 'macro',          label: 'MACRO',          icon: '🌐', kbd: 'F8' },
      { id: 'breadth',        label: 'MARKET BREADTH', icon: '📊' },
      { id: 'yield-curve',    label: 'YIELD CURVE',    icon: '📐' },
      { id: 'sector',         label: 'SECTOR MAP',     icon: '🗺', kbd: 'F9' },
      { id: 'global',         label: 'GLOBAL MKT',     icon: '🌍' },
      { id: 'global-news',    label: 'GLOBAL NEWS',    icon: '🗞' },
      { id: 'crypto',         label: 'CRYPTO CRYP',    icon: '₿' },
      { id: 'fx-matrix',      label: 'FX MATRIX WFX',  icon: '💱' },
      { id: 'screener',       label: 'SCREENER',       icon: '🔎' },
    ],
  },
  ANLT: {
    label: 'ANALYTICS',
    color: '#4fc3f7',
    items: [
      { id: 'hf',          label: 'HEDGE FUND',    icon: '🤖' },
      { id: 'technicals',  label: 'TECHNICALS',    icon: '📉', kbd: 'F10' },
      { id: 'beta',        label: 'BETA CORR',     icon: '📐' },
      { id: 'wirp',        label: 'RATE HIKE WIRP',icon: '🏦' },
      { id: 'social',      label: 'SOCIAL SENT.',  icon: '💬' },
      { id: 'tradereplay', label: 'TRADE REPLAY',  icon: '⏺' },
      { id: 'ee',          label: 'EARNINGS EST.', icon: '🤖' },
      { id: 'mna',         label: 'M&A TRACKER',   icon: '🤝' },
      { id: 'dcf',         label: 'DCF VALUATION', icon: '💹' },
      { id: 'wacc',        label: 'WACC CALC',     icon: '⚙' },
      { id: 'esg',         label: 'ESG SCORES',    icon: '🌱' },
      { id: 'splc',        label: 'SUPPLY CHAIN',  icon: '🔗' },
      { id: 'delivery',    label: 'DELIVERY VOL',  icon: '📦' },
      { id: 'volume',      label: 'VOL. SHOCKER',  icon: '📊' },
      { id: 'backtest',    label: 'BACKTEST',      icon: '⏮' },
      { id: 'ivsurf',      label: 'IV SURFACE',    icon: '🏔' },
      { id: 'anomaly',     label: 'ANOMALY',       icon: '⚡' },
      { id: 'portfolio',   label: 'PORTFOLIO',     icon: '💼' },
      { id: 'alerts',      label: 'PRICE ALERTS',  icon: '🔔' },
      { id: 'watchlist',   label: 'WATCHLIST',     icon: '★' },
      { id: 'calendar',    label: 'ECO CALENDAR',  icon: '📅', kbd: 'F11' },
    ],
  },
  AI: {
    label: 'AI TOOLS',
    color: '#a78bfa',
    items: [
      { id: 'copilot',       label: 'AI COPILOT',    icon: '◆' },
      { id: 'earnings_pred', label: 'EARNINGS AI',   icon: '🎯' },
      { id: 'guardian',      label: 'GUARDIAN',      icon: '🛡' },
    ],
  },
};

// WS_URL now configured inside useMarketWorker (tries /ws/v2 compact first, falls back to /ws)

function fmtPrice(v: number): string {
  if (!v) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Loading skeleton shown while a lazy panel loads ────────────────────────
const PanelSkeleton: React.FC<{ label?: string }> = ({ label }) => (
  <div className="bti-loading">
    <div className="spinner" />
    <span>{label || 'Loading…'}</span>
  </div>
);

// ─── Clock (memoised — only re-renders every second on its own) ─────────────
const Clock = memo(() => {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const ist = useMemo(
    () => new Date(time.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })),
    [time],
  );
  const isMarketOpen = useMemo(() => {
    const h = ist.getHours(), m = ist.getMinutes();
    const mins = h * 60 + m;
    return mins >= 555 && mins <= 930; // 09:15 – 15:30
  }, [ist]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <span style={{ fontSize: 10, color: isMarketOpen ? 'var(--green)' : 'var(--text-muted)' }}>
        {isMarketOpen ? '● NSE OPEN' : '○ NSE CLOSED'}
      </span>
      <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
        {ist.toLocaleTimeString('en-IN', { hour12: false })}
      </span>
      <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>IST</span>
    </div>
  );
});

// ─── Sidebar component ───────────────────────────────────────────────────────
interface SidebarProps {
  activeSection: Section;
  activeView: string;
  selectedTicker: string;
  selectedQuote: Quote | null;
  onSectionChange: (s: Section) => void;
  onViewChange: (id: string) => void;
}

const Sidebar = memo<SidebarProps>(({
  activeSection, activeView, selectedTicker, selectedQuote,
  onSectionChange, onViewChange,
}) => {
  const section = SIDEBAR[activeSection];
  return (
    <div className="bti-sidebar">
      {/* 3 section buttons */}
      <div className="bti-section-btns">
        {(Object.keys(SIDEBAR) as Section[]).map(s => (
          <button
            key={s}
            className={`bti-section-btn${activeSection === s ? ' active' : ''}`}
            onClick={() => onSectionChange(s)}
          >
            {s === 'MKTS' ? 'MARKETS' : s === 'ANLT' ? 'ANALYTICS' : 'AI'}
          </button>
        ))}
      </div>

      {/* Selected ticker badge */}
      {selectedTicker && (
        <div className="bti-ticker-badge" onClick={() => onViewChange('chart')} style={{ cursor: 'pointer' }}>
          <div className="sym">{selectedTicker}</div>
          {selectedQuote && (
            <>
              <div className="prc">₹{fmtPrice(selectedQuote.price)}</div>
              <div className="chg" style={{ color: selectedQuote.change_pct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {selectedQuote.change_pct >= 0 ? '▲' : '▼'}{Math.abs(selectedQuote.change_pct).toFixed(2)}%
              </div>
            </>
          )}
        </div>
      )}

      {/* Nav items */}
      <div className="bti-nav-list">
        {section.items.map(item => (
          <div
            key={item.id}
            className={`bti-nav-item${activeView === item.id ? ' active' : ''}`}
            onClick={() => onViewChange(item.id)}
          >
            <span className="bti-nav-icon">{item.icon}</span>
            <span className="bti-nav-label">{item.label}</span>
            {item.kbd && <span className="bti-nav-kbd">{item.kbd}</span>}
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── Main Terminal ────────────────────────────────────────────────────────────
export const Terminal: React.FC = () => {
  // ── Non-price live data — read directly from isolated stores ─────────────
  // These no longer live in Terminal useState.  Each store uses RAF-batched
  // useSyncExternalStore — only the panel that subscribes to a store re-renders
  // when that store updates.  Terminal itself only re-renders when UI state
  // (activeView, selectedTicker, wsConnected) changes.
  const liveNews      = useLiveNews();
  const sentiment     = useSentiment();
  const technicals    = useTechnicals();
  const hedgeFundState = useHedgeFundState();
  const [lastTick, setLastTick] = useState<{ symbol: string; price: number; volume?: number } | null>(null);

  const [activeSection, setActiveSection] = useState<Section>('MKTS');
  const [activeView, setActiveView]       = useState<string>('dashboard');
  const [selectedTicker, setSelectedTicker] = useState<string>('RELIANCE');
  const [wsConnected, setWsConnected]     = useState(false);
  const [fyersAuth, setFyersAuth]         = useState<boolean | null>(null);
  const [deepDiveOpen, setDeepDiveOpen]   = useState(false);
  // MFE-layer state: activeMnemonic tracks the CLI breadcrumb; activeMfeKey is
  // the registry key for the currently mounted remote panel (null = internal panel).
  const [activeMnemonic, setActiveMnemonic] = useState<string>('');
  const [activeMfeKey, setActiveMfeKey]     = useState<string>('');

  const selectedTickerRef = useRef<string>('RELIANCE');

  // ── Selected ticker quote — re-renders Terminal ONLY when this symbol ticks ──
  // (not on every tick from every symbol, as useAllQuotes() would do)
  const selectedQuote = useQuote(selectedTicker) ?? null;
  const selectedTechnicals = useMemo(() => technicals[selectedTicker] ?? null, [technicals, selectedTicker]);
  const tickerNewsItems = useTickerNews(selectedTicker);
  const hedgeFundSignal = useMemo(() => hedgeFundState?.analyst?.stocks?.[selectedTicker]?.signal, [hedgeFundState, selectedTicker]);
  const xgbProba = useMemo(() => hedgeFundState?.data_scientist?.stocks?.[selectedTicker]?.xgb_proba_up, [hedgeFundState, selectedTicker]);

  // ── Push live state up to Chromium title bar ────────────────────────────
  // Ref pattern: always holds the latest context value without putting it in
  // useEffect deps. Adding an object with setters to deps causes infinite loops
  // when the context or its containing component re-renders.
  const titleBarCtx    = useContext(TitleBarContext);
  const titleBarCtxRef = useRef(titleBarCtx);
  titleBarCtxRef.current = titleBarCtx;

  // ── Seed indices from REST on first load (before WS connects) ──────────
  const { data: initIndices } = useApiData<IndexData[]>('/api/indices', 0, 60_000);
  useEffect(() => {
    if (initIndices?.length) marketStore.setIndicesArray(initIndices);
  }, [initIndices]);

  // ── REST quote seeding: fallback when WS pipeline is slow/empty ─────────
  // Fetches top-100 quotes from Fyers REST every 15s.
  // This ensures Dashboard always shows prices even if:
  //  - WS initial snapshot was empty (cache not yet warm at connect time)
  //  - Fyers WS is offline (outside market hours)
  //  - Worker tick pipeline has a transient issue
  // When WS ticks are flowing, this just overwrites with slightly older REST data
  // (harmless) — the 33ms WS ticks dominate for selected ticker.
  useEffect(() => {
    let cancelled = false;
    const fetchQuotesRest = async () => {
      try {
        const res = await fetch('/api/quotes/snapshot');
        if (!res.ok) return;
        const data: any[] = await res.json();
        if (cancelled) return;
        if (Array.isArray(data) && data.length > 0) {
          const ticks = data.filter((q: any) => q?.symbol && q?.price > 0);
          if (ticks.length > 0) {
            marketStore.applyTicks(ticks);
          }
        }
      } catch { /* REST fallback — non-fatal */ }
    };
    fetchQuotesRest(); // immediate on mount
    const t = setInterval(fetchQuotesRest, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // ── Fyers status poll (every 60s) ────────────────────────────────────────
  useEffect(() => {
    const checkFyers = async () => {
      try {
        const res = await fetch('/api/fyers/status');
        const d = await res.json();
        setFyersAuth(d?.authenticated ?? false);
      } catch { setFyersAuth(false); }
    };
    checkFyers();
    const t = setInterval(checkFyers, 60_000);
    return () => clearInterval(t);
  }, []);

  // ── Background prefetch: warm the client cache before user clicks panels ──
  // Fires 3 s after app start so the WS connection + first render settle first.
  // Every panel that uses useApiData() will find its data already in _apiCache
  // and render without any loading spinner on first visit.
  useEffect(() => {
    const PREFETCH: Array<[string, number]> = [
      ['/api/earnings?days_ahead=90&days_back=90',         300_000],
      ['/api/fii-dii-enhanced?days=60',                    60_000],
      ['/api/fii-dii/sector-flows?weeks=4',               300_000],
      ['/api/sector-rotation?horizon=1D',                   60_000],
      ['/api/crypto/top?limit=20',                          60_000],
      ['/api/crypto/news?limit=20',                        120_000],
      ['/api/macro',                                       300_000],
      ['/api/market-breadth',                               60_000],
      ['/api/volume-shockers',                              60_000],
      ['/api/global-markets',                              120_000],
    ];
    const t = setTimeout(() => {
      PREFETCH.forEach(([url, ttl]) => prefetchApi(url, ttl).catch(() => {}));
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  // ── Worker message handler ───────────────────────────────────────────────
  // NOTE: tick_update, quotes, indices are handled by useMarketWorker directly
  // (they go into marketStore). This handler only receives non-price messages
  // PLUS tick_update forwarded so we can track lastTick for the selected ticker.
  const handleMessage = useCallback((msg: any) => {
    const { type, data, payload } = msg;
    const d = data ?? payload;

    // Fyers index raw symbols → display names (also handled in store for index tiles)
    const FYERS_IDX_TO_NAME: Record<string, string> = {
      'NIFTY50': 'NIFTY 50', 'NIFTYBANK': 'NIFTY BANK', 'INDIAVIX': 'INDIA VIX',
      'CNXIT': 'NIFTY IT', 'NIFTYMIDCAP100': 'NIFTY MIDCAP 100', 'SENSEX': 'SENSEX',
      'CNXPHARMA': 'NIFTY PHARMA', 'CNXAUTO': 'NIFTY AUTO', 'CNXMETAL': 'NIFTY METAL',
      'CNXFMCG': 'NIFTY FMCG', 'CNXENERGY': 'NIFTY ENERGY', 'NIFTYREALTY': 'NIFTY REALTY',
    };

    switch (type) {
      // tick_update is forwarded from Worker so we can catch lastTick for selected ticker
      // (price data itself already stored by useMarketWorker into marketStore)
      case 'tick_update': {
        const ticks: any[] = Array.isArray(d) ? d : [d];
        ticks.forEach(t => {
          if (!t?.symbol) return;
          // Update index tiles via store when an index tick arrives
          const idxName = FYERS_IDX_TO_NAME[t.symbol];
          if (idxName && t.price > 0) {
            marketStore.patchIndex(idxName, {
              value:      t.price,
              change:     t.change     ?? 0,
              change_pct: t.change_pct ?? 0,
            });
          }
          // Track last tick for the header quote display
          if (t.symbol === selectedTickerRef.current) {
            setLastTick({ symbol: t.symbol, price: t.price, volume: t.volume });
          }
        });
        break;
      }
      // indices: also update store (belt-and-suspenders with useMarketWorker)
      case 'indices':
        if (Array.isArray(d)) marketStore.setIndicesArray(d);
        break;
      // news/filing/sentiment/macro/technicals/shockers/global/hedgefund
      // are now dispatched directly to isolated stores inside useMarketWorker.
      // Terminal only receives them for lastTick tracking and regime display.
      case 'news':
      case 'filing':
        // Already pushed to store by useMarketWorker — nothing to do here
        break;
      case 'sentiment_update':
        // Store already updated by useMarketWorker. Terminal re-reads via useSentiment().
        break;
      case 'fyers_auth':
        setFyersAuth(msg.authenticated === true || d?.authenticated === true);
        break;
      case 'connected':
        setWsConnected(true);
        break;
      default:
        break;
    }
  }, []);

  // ── Bloomberg Web Worker WS (replaces useWebSocket) ─────────────────────
  // Worker handles: connect, JSON parse, tick batching, compact protocol
  // marketStore updated directly in Worker bridge (no React setState for prices)
  const { connected, send } = useMarketWorker({ onMessage: handleMessage });

  useEffect(() => {
    setWsConnected(connected);
    titleBarCtxRef.current.setConnected(connected);
    // titleBarCtxRef is a ref — stable by definition, intentionally omitted from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // ── Push selected ticker live price to Chromium title bar ────────────────
  useEffect(() => {
    if (selectedQuote?.price) {
      titleBarCtxRef.current.setTicker(selectedTicker, selectedQuote.price, selectedQuote.change_pct ?? 0);
    }
    // titleBarCtxRef is a ref — intentionally omitted from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuote, selectedTicker]);

  // ── Immediate quote refresh when ticker changes or WS reconnects ───────────
  // Sends get_quote → backend fetches via Fyers (real-time) or yfinance (fallback),
  // replies as tick_update which handleMessage merges into quotes state.
  // Also subscribes the ticker to the Fyers live WS feed for future ms-ticks.
  useEffect(() => {
    if (selectedTicker && connected) {
      send({ type: 'get_quote',  symbol: selectedTicker });
      send({ type: 'subscribe',  symbols: [selectedTicker] });
    }
  }, [selectedTicker, connected, send]);


  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleSelectTicker = useCallback((sym: string) => {
    selectedTickerRef.current = sym;
    setSelectedTicker(sym);
    setActiveView('chart');
    setActiveSection('MKTS');
    eventBus.emit('TICKER_CHANGE', { ticker: sym, source: 'SIDEBAR' });
  }, []);

  const handleSectionChange = useCallback((s: Section) => {
    setActiveSection(s);
    // Navigate to first item of section that isn't already visible
    const firstId = SIDEBAR[s].items[0].id;
    setActiveView(firstId);
  }, []);

  const handleViewChange = useCallback((id: string) => {
    // deep-dive is a modal overlay, not a panel switch
    if (id === 'deep-dive') { setDeepDiveOpen(true); return; }
    setActiveView(id);
    // Determine which section owns this view
    for (const [s, sec] of Object.entries(SIDEBAR)) {
      if (sec.items.some(i => i.id === id)) {
        setActiveSection(s as Section);
        break;
      }
    }
  }, []);

  // Bloomberg CLI navigation — called by CommandBar
  const handleCommandNavigate = useCallback((view: string) => {
    handleViewChange(view);
  }, [handleViewChange]);

  // MnemonicCLI execution — routes to internal panel or mounts a remote MFE
  const handleMnemonicExec = useCallback((mnemonic: string, ticker?: string) => {
    const entry = resolve(mnemonic);
    if (!entry) return;
    setActiveMnemonic(mnemonic);
    if (ticker) {
      selectedTickerRef.current = ticker;
      setSelectedTicker(ticker);
    }
    if (entry.internalRoute) {
      // Internal panel — just switch the view
      setActiveMfeKey('');
      handleViewChange(entry.internalRoute);
    } else {
      // Remote MFE — switch to the special 'mfe' view and store the key
      setActiveMfeKey(mnemonic);
      setActiveView('mfe');
    }
    eventBus.emit('PANEL_FOCUS', { mnemonic });
  }, [handleViewChange]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    const allItems = Object.values(SIDEBAR).flatMap(s => s.items);
    const handler = (e: KeyboardEvent) => {
      // Ctrl+/ → open Deep Dive search overlay (works from anywhere)
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setDeepDiveOpen(v => !v);
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      for (const item of allItems) {
        if (item.kbd && e.key === item.kbd && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          handleViewChange(item.id);
          break;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleViewChange]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-primary)' }}>

      {/* ── Header (36px) ──────────────────────────────────────────────── */}
      <Header
        selectedTicker={selectedTicker}
        selectedQuote={selectedQuote}
        sentiment={sentiment}
        wsConnected={wsConnected}
        fyersAuth={fyersAuth}
        onSelectTicker={handleSelectTicker}
        onNavigate={handleCommandNavigate}
      />

      {/* ── Bloomberg CLI Command Bar (overlay, activated by ` key) ──── */}
      <CommandBar
        selectedTicker={selectedTicker}
        onSelectTicker={handleSelectTicker}
        onNavigate={handleCommandNavigate}
      />

      {/* ── Bloomberg Mnemonic CLI — always-visible command input (32px) ─ */}
      <MnemonicCLI
        activeTicker={selectedTicker}
        activeMnemonic={activeMnemonic}
        onMnemonicExec={handleMnemonicExec}
        onTickerChange={(sym) => {
          selectedTickerRef.current = sym;
          setSelectedTicker(sym);
          eventBus.emit('TICKER_CHANGE', { ticker: sym, source: 'CLI' });
        }}
      />

      {/* ── Ticker marquee (22px) ────────────────────────────────────── */}
      <TickerBar />

      {/* ── Body: Sidebar + Main ─────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        <Sidebar
          activeSection={activeSection}
          activeView={activeView}
          selectedTicker={selectedTicker}
          selectedQuote={selectedQuote}
          onSectionChange={handleSectionChange}
          onViewChange={handleViewChange}
        />

        <div className="bti-main">
          <Suspense fallback={<PanelSkeleton />}>
            <PanelRouter
              activeView={activeView}
              sentiment={sentiment}
              liveNews={liveNews}
              selectedTicker={selectedTicker}
              selectedQuote={selectedQuote}
              selectedTechnicals={selectedTechnicals}
              tickerNewsItems={tickerNewsItems}
              hedgeFundSignal={hedgeFundSignal}
              xgbProba={xgbProba}
              lastTick={lastTick}
              send={send}
              onSelectTicker={handleSelectTicker}
              onNavigate={handleCommandNavigate}
              activeMfeKey={activeMfeKey}
              onMnemonicExec={handleMnemonicExec}
            />
          </Suspense>
        </div>
      </div>

      <AlertsToastContainer />

      {/* ── Stock Deep Dive overlay (Ctrl+/ or sidebar click) ─────────── */}
      <Suspense fallback={null}>
        <StockDeepDive
          isOpen={deepDiveOpen}
          onClose={() => setDeepDiveOpen(false)}
          initialSymbol={selectedTicker}
          onNavigate={(view, ticker) => {
            handleSelectTicker(ticker);
            handleViewChange(view);
            setDeepDiveOpen(false);
          }}
        />
      </Suspense>
    </div>
  );
};

// ─── Header (memoized — re-renders only when ticker/quote/ws changes) ────────
interface HeaderProps {
  selectedTicker: string;
  selectedQuote: Quote | null;
  sentiment: MarketSentiment | null;
  wsConnected: boolean;
  fyersAuth: boolean | null;
  onSelectTicker: (sym: string) => void;
  onNavigate: (view: string) => void;
}

const Header = memo<HeaderProps>(({ selectedTicker, selectedQuote, sentiment, wsConnected, fyersAuth, onSelectTicker, onNavigate }) => {
  return (
    <div style={{
      background: '#050505',
      borderBottom: '1px solid #333',
      padding: '0 10px',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexShrink: 0,
      height: 38,
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span style={{ color: 'var(--amber)', fontWeight: 900, fontSize: 16, letterSpacing: 3 }}>FD</span>
        <span style={{ color: '#333', fontSize: 10, letterSpacing: 0.5 }}>FINANCIAL DASHBOARD</span>
      </div>

      <div style={{ width: 1, height: 20, background: '#2a2a2a', flexShrink: 0 }} />

      {/* Ticker search */}
      <TickerSearch onSelect={(sym) => onSelectTicker(sym)} />

      {/* Live quote display */}
      {selectedTicker && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', borderLeft: '1px solid #2a2a2a', flexShrink: 0 }}>
          <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 13 }}>{selectedTicker}</span>
          {selectedQuote && (
            <>
              <span style={{ color: '#e8e8e0', fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                ₹{selectedQuote.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span style={{
                color: selectedQuote.change_pct >= 0 ? 'var(--green)' : 'var(--red)',
                fontSize: 12, fontWeight: 700,
              }}>
                {selectedQuote.change_pct >= 0 ? '▲' : '▼'}{Math.abs(selectedQuote.change_pct).toFixed(2)}%
              </span>
              <span style={{ color: '#555', fontSize: 10 }}>
                H:{selectedQuote.high?.toFixed(0)} L:{selectedQuote.low?.toFixed(0)}
              </span>
            </>
          )}
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* Regime */}
      {sentiment?.regime && (
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 7px',
          color: sentiment.regime === 'RISK_ON' ? 'var(--green)' : sentiment.regime === 'RISK_OFF' ? 'var(--red)' : 'var(--amber)',
          border: `1px solid ${sentiment.regime === 'RISK_ON' ? 'var(--green-dim)' : sentiment.regime === 'RISK_OFF' ? 'var(--red-dim)' : 'var(--amber-dim)'}`,
          background: sentiment.regime === 'RISK_ON' ? 'rgba(0,200,83,0.05)' : sentiment.regime === 'RISK_OFF' ? 'rgba(255,61,0,0.05)' : 'rgba(255,149,0,0.05)',
        }}>
          {sentiment.regime}
        </span>
      )}

      {/* Fyers status — orange reconnect button when offline */}
      {fyersAuth === false && (
        <a
          href="http://127.0.0.1:8000/api/fyers/login"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 9, fontWeight: 700, padding: '2px 7px', textDecoration: 'none',
            color: 'var(--amber)', border: '1px solid var(--amber-dim)',
            background: 'rgba(255,149,0,0.08)', borderRadius: 2, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 3,
          }}
          title="Fyers token expired — click to re-authenticate for real-time ticks"
        >
          ⚡ FYERS OFFLINE — RECONNECT
        </a>
      )}
      {fyersAuth === true && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span className="status-dot ok" />
          <span style={{ fontSize: 9, color: 'var(--green)' }}>FYERS</span>
        </div>
      )}

      {/* WS status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span className={`status-dot ${wsConnected ? 'ok' : 'dead'}`} />
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{wsConnected ? 'LIVE' : 'OFFLINE'}</span>
      </div>

      <Clock />
    </div>
  );
});

// ─── Panel Router ────────────────────────────────────────────────────────────
// Panels that need live non-price data subscribe to liveDataStore directly.
// PanelRouter only passes what cannot be obtained from a store:
//   • activeView / selectedTicker / selectedQuote — UI state
//   • quotes / indices — from marketStore (already via store hooks in sub-panels)
//   • send — WS send function
//   • event callbacks
interface PanelRouterProps {
  activeView: string;
  sentiment: MarketSentiment | null;
  liveNews: NewsItem[];
  selectedTicker: string;
  selectedQuote: Quote | null;
  selectedTechnicals: TechnicalSignal | null;
  tickerNewsItems: NewsItem[];
  hedgeFundSignal?: string;
  xgbProba?: number;
  lastTick: any;
  send: (data: any) => void;
  onSelectTicker: (sym: string) => void;
  onNavigate: (view: string) => void;
  /** Active remote MFE key (registry mnemonic), empty string = no remote MFE */
  activeMfeKey: string;
  onMnemonicExec: (mnemonic: string, ticker?: string) => void;
}

const PanelRouter = memo<PanelRouterProps>((props) => {
  const {
    activeView, sentiment, liveNews, selectedTicker,
    selectedQuote, selectedTechnicals, tickerNewsItems, hedgeFundSignal, xgbProba,
    lastTick, send, onSelectTicker, onNavigate, activeMfeKey, onMnemonicExec,
  } = props;

  // Panels that need all quotes/indices subscribe here — NOT in Terminal root.
  // PanelRouter re-renders when activeView changes; each panel only mounts while active.
  const quotes  = useAllQuotes();
  const indices = useAllIndices();

  const v = activeView;

  return (
    <div style={{ height: '100%', overflow: 'hidden' }}>

      {/* DASHBOARD */}
      {v === 'dashboard' && (
        <DashboardView
          quotes={quotes}
          indices={indices}
          sentiment={sentiment}
          liveNews={liveNews}
          onSelectTicker={onSelectTicker}
        />
      )}


      {/* CHART — 2/3 chart + 1/3 technicals/news */}
      {v === 'chart' && (
        <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gridTemplateRows: '3fr 1fr', height: '100%', gap: 1 }}>
          <div style={{ gridRow: '1 / 3' }}>
            <Chart symbol={selectedTicker} onSendWS={send} technicals={selectedTechnicals} lastTick={lastTick} />
          </div>
          <TechnicalIndicators symbol={selectedTicker} data={selectedTechnicals} price={selectedQuote?.price} />
          <NewsPanel ticker={selectedTicker} liveItems={tickerNewsItems} />
        </div>
      )}

      {v === 'news'         && <NewsPanel ticker={undefined} liveItems={liveNews} />}
      {v === 'filings'      && <FilingsPanel symbol={undefined} />}
      {v === 'fundamentals' && <Fundamentals symbol={selectedTicker} />}
      {v === 'earnings'     && <EarningsCalendar />}
      {v === 'options'      && <OptionsChain symbol={selectedTicker} />}
      {v === 'insider'      && <InsiderActivity />}
      {v === 'macro'        && <MacroPanel />}
      {v === 'sector'       && <SectorHeatmap onSelectTicker={onSelectTicker} />}
      {v === 'global'       && <GlobalMarketsPanel />}
      {v === 'global-news'  && <NewsPanel category="global" />}
      {v === 'screener'     && <Screener onSelectTicker={onSelectTicker} />}

      {/* ── Bloomberg New Panels ─────────────────────────────────────── */}
      {v === 'peers'        && <PeerComparisonPanel symbol={selectedTicker} onSelectTicker={onSelectTicker} />}
      {v === 'analyst'      && <AnalystEstimatesPanel symbol={selectedTicker} />}
      {v === 'company-overview' && <CompanyOverview symbol={selectedTicker} onNavigate={onNavigate} />}
      {v === 'concall'      && <ConcallPanel symbol={selectedTicker} />}
      {v === 'shareholding' && <ShareholdingPanel symbol={selectedTicker} />}
      {v === 'corp-actions' && <CorporateActionsPanel symbol={selectedTicker} />}
      {v === 'block-deals'  && <BlockBulkDealsPanel onSelectTicker={onSelectTicker} />}
      {v === 'fii-dii'      && <FIIDIIPanel />}
      {v === 'sector-flow'  && <SectorMoneyFlowPanel />}
      {v === 'breadth'      && <MarketBreadthPanel sentiment={sentiment} indices={indices} />}
      {v === 'yield-curve'  && <YieldCurvePanel />}
      {v === 'dcf'          && <DCFValuationPanel symbol={selectedTicker} />}
      {v === 'delivery'     && <DeliveryVolumePanel symbol={selectedTicker} />}

      {/* ── Premium Bloomberg Panels ──────────────────────────────────── */}
      {v === 'crypto'     && <CryptoDashboard />}
      {v === 'fx-matrix'  && <FXMatrix />}
      {v === 'esg'        && <ESGPanel symbol={selectedTicker} />}
      {v === 'wacc'       && <WACCCalculator symbol={selectedTicker} />}
      {v === 'splc'       && <SupplyChainPanel symbol={selectedTicker} onSelectTicker={onSelectTicker} />}

      {/* ── New Bloomberg Parity Panels ───────────────────────────────── */}
      {v === 'wirp'        && <RateHikeProbabilityPanel ticker={selectedTicker} />}
      {v === 'beta'        && <BetaAnalysisPanel ticker={selectedTicker} />}
      {v === 'social'      && <SocialSentimentPanel ticker={selectedTicker} />}
      {v === 'tradereplay' && <TradeReplayPanel ticker={selectedTicker} />}
      {v === 'ee'          && <EarningsEstimatorPanel ticker={selectedTicker} />}
      {v === 'mna'         && <MnATrackerPanel ticker={selectedTicker} />}

      {/* ANALYTICS */}
      {v === 'hf'        && <HedgeFundPanel />}
      {v === 'technicals' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: '100%', gap: 1 }}>
          <TechnicalIndicators symbol={selectedTicker} data={selectedTechnicals} price={selectedQuote?.price} />
          <Chart symbol={selectedTicker} onSendWS={send} technicals={selectedTechnicals} lastTick={lastTick} />
        </div>
      )}
      {v === 'volume'    && <VolumeShockers onSelectTicker={onSelectTicker} />}
      {v === 'backtest'  && <BacktestPanel />}
      {v === 'ivsurf'    && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', height: '100%', gap: 1 }}>
          <IVSurface symbol={selectedTicker || 'NIFTY'} spot={selectedQuote?.price} />
          <OptionsChain symbol={selectedTicker} />
        </div>
      )}
      {v === 'anomaly'   && <AnomalyPanel onSelectSymbol={onSelectTicker} />}
      {v === 'portfolio' && <Portfolio onSelectTicker={onSelectTicker} />}
      {v === 'alerts'    && <PriceAlerts onSelectTicker={onSelectTicker} />}
      {v === 'watchlist' && <Watchlist onSelectTicker={onSelectTicker} />}
      {v === 'calendar'  && <EconomicCalendar />}

      {/* ── Remote MFE Panel (loaded by MnemonicCLI) ─────────────────── */}
      {v === 'mfe' && activeMfeKey && (
        <MFEMount
          mnemonic={activeMfeKey}
          ticker={selectedTicker}
          apiBase="http://localhost:8000"
          onTickerChange={onSelectTicker}
          onNavigate={(mnemonic, ticker) => onMnemonicExec(mnemonic, ticker)}
        />
      )}

      {/* AI TOOLS */}
      {v === 'copilot' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', height: '100%', gap: 1 }}>
          <AICopilot
            ticker={selectedTicker}
            tickerData={selectedQuote ? {
              price: selectedQuote.price,
              signal: hedgeFundSignal,
              rsi: selectedTechnicals?.rsi14,
              xgb_proba_up: xgbProba,
              sentiment: sentiment?.regime,
            } : undefined}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <TechnicalIndicators symbol={selectedTicker} data={selectedTechnicals} price={selectedQuote?.price} />
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <NewsPanel ticker={selectedTicker} liveItems={tickerNewsItems} />
            </div>
          </div>
        </div>
      )}
      {v === 'earnings_pred' && <EarningsAIPanel onSelectTicker={onSelectTicker} />}
      {v === 'guardian'      && <GuardianStatus />}
    </div>
  );
});

// ─── Dashboard View ───────────────────────────────────────────────────────────
interface DashboardProps {
  quotes: Record<string, Quote>;
  indices: IndexData[];
  sentiment: MarketSentiment | null;
  liveNews: NewsItem[];
  onSelectTicker: (sym: string) => void;
}

// ── Index constituent lists (mirrors nse_data.py INDEX_MAP) ──────────────────
// Used for client-side live gainers/losers computation from quotes state.
const INDEX_CONSTITUENTS: Record<string, string[]> = {
  NIFTY50: [
    'RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','HINDUNILVR','SBIN','KOTAKBANK',
    'BHARTIARTL','ITC','LT','AXISBANK','ASIANPAINT','HCLTECH','TITAN','BAJFINANCE',
    'WIPRO','NTPC','NESTLEIND','SUNPHARMA','ULTRACEMCO','JSWSTEEL','POWERGRID','M&M',
    'INDUSINDBK','BAJAJFINSV','TATAMOTORS','TECHM','ADANIENT','DRREDDY','COALINDIA',
    'TATASTEEL','MARUTI','ONGC','HDFCLIFE','SBILIFE','BPCL','EICHERMOT','CIPLA',
    'GRASIM','APOLLOHOSP','DIVISLAB','HEROMOTOCO','HINDALCO','TATACONSUM',
    'BAJAJ-AUTO','ADANIPORTS','BRITANNIA','SHRIRAMFIN','LTIM',
  ],
  BANKNIFTY:   ['HDFCBANK','ICICIBANK','KOTAKBANK','AXISBANK','SBIN','INDUSINDBK','AUBANK','BANDHANBNK','FEDERALBNK','IDFCFIRSTB','PNB','BANKBARODA'],
  NIFTYIT:     ['TCS','INFY','HCLTECH','WIPRO','TECHM','LTIM','MPHASIS','COFORGE','PERSISTENT','OFSS'],
  NIFTYPHARMA: ['SUNPHARMA','DRREDDY','CIPLA','DIVISLAB','APOLLOHOSP','TORNTPHARM','BIOCON','ALKEM','IPCALAB','AUROPHARMA'],
  NIFTYFMCG:   ['HINDUNILVR','ITC','NESTLEIND','BRITANNIA','DABUR','MARICO','COLPAL','GODREJCP','TATACONSUM','MCDOWELL-N'],
  NIFTYAUTO:   ['MARUTI','TATAMOTORS','M&M','BAJAJ-AUTO','HEROMOTOCO','EICHERMOT','TVSMOTOR','ASHOKLEY','BALKRISIND','MOTHERSON'],
  NIFTYMETAL:  ['TATASTEEL','JSWSTEEL','HINDALCO','VEDL','NMDC','SAIL','HINDCOPPER','RATNAMANI','NATIONALUM','COALINDIA'],
  NIFTYENERGY: ['RELIANCE','ONGC','BPCL','GAIL','IOC','TATAPOWER','NTPC','POWERGRID','NHPC','ADANIGREEN'],
  NIFTYREALTY: ['DLF','GODREJPROP','PRESTIGE','OBEROIRLTY','PHOENIXLTD','SOBHA','BRIGADE','NYKAA','MACROTECH','SUNTECK'],
};

// Index tabs shown in the Gainers/Losers section
const GL_INDEX_TABS: Array<{ key: string; label: string; shortLabel: string }> = [
  { key: 'NIFTY50',     label: 'NIFTY 50',  shortLabel: 'N50'   },
  { key: 'BANKNIFTY',   label: 'BANK',      shortLabel: 'BANK'  },
  { key: 'NIFTYIT',     label: 'IT',        shortLabel: 'IT'    },
  { key: 'NIFTYPHARMA', label: 'PHARMA',    shortLabel: 'PHR'   },
  { key: 'NIFTYFMCG',   label: 'FMCG',      shortLabel: 'FMCG'  },
  { key: 'NIFTYAUTO',   label: 'AUTO',      shortLabel: 'AUTO'  },
  { key: 'NIFTYMETAL',  label: 'METAL',     shortLabel: 'MET'   },
  { key: 'NIFTYENERGY', label: 'ENERGY',    shortLabel: 'ENRG'  },
  { key: 'ALL',         label: 'ALL NSE',   shortLabel: 'ALL'   },
];

// Map index tile names → GL_INDEX_TABS key for click-to-filter
const INDEX_NAME_TO_KEY: Record<string, string> = {
  'NIFTY 50':       'NIFTY50',
  'NIFTY BANK':     'BANKNIFTY',
  'NIFTY IT':       'NIFTYIT',
  'NIFTY PHARMA':   'NIFTYPHARMA',
  'NIFTY FMCG':     'NIFTYFMCG',
  'NIFTY AUTO':     'NIFTYAUTO',
  'NIFTY METAL':    'NIFTYMETAL',
  'NIFTY ENERGY':   'NIFTYENERGY',
};

const GainersLosersPanel = memo<{
  selectedIndex: string;
  onIndexChange: (k: string) => void;
  onSelect: (s: string) => void;
  quotes: Record<string, Quote>;
}>(
  ({ selectedIndex, onIndexChange, onSelect, quotes }) => {
    // REST API: used as seed + for ALL index (which covers 4500+ stocks we don't have client-side)
    // Refresh every 60s — the REST data is not the primary source anymore for index-specific views.
    const { data: apiGl, loading } = useApiData<{ gainers: any[]; losers: any[] }>(
      `/api/gainers-losers?index=${selectedIndex}`,
      60_000,   // REST refresh every 60s (background seed)
      30_000,   // client cache 30s
    );

    // ── Live client-side computation from quotes state ───────────────────────
    // For named indices (NIFTY50, BANKNIFTY etc.) compute directly from live quotes.
    // This gives sub-100ms updates on every Fyers WS tick.
    // For ALL: fall back to REST (market sweep covers 4500+ stocks).
    const { gainers, losers } = useMemo(() => {
      const constituents = INDEX_CONSTITUENTS[selectedIndex];
      if (!constituents) {
        // ALL or unknown index → use REST data (market sweep)
        return { gainers: apiGl?.gainers ?? [], losers: apiGl?.losers ?? [] };
      }

      const rows = constituents.flatMap(sym => {
        const q = quotes[sym];
        if (!q?.price) return [];
        return [{
          symbol:     sym,
          name:       (q as any).name || sym,
          ltp:        q.price,
          change_pct: q.change_pct ?? 0,
          volume:     (q as any).volume ?? 0,
        }];
      });

      // If live quotes are sparse (Fyers not yet auth'd), fall back to REST seed
      if (rows.length < 5) {
        return { gainers: apiGl?.gainers ?? [], losers: apiGl?.losers ?? [] };
      }

      return {
        gainers: rows.filter(r => r.change_pct > 0)
          .sort((a, b) => b.change_pct - a.change_pct).slice(0, 15),
        losers: rows.filter(r => r.change_pct < 0)
          .sort((a, b) => a.change_pct - b.change_pct).slice(0, 15),
      };
    }, [quotes, selectedIndex, apiGl]);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {/* Index selector tab strip */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 2,
          padding: '3px 6px', background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', marginRight: 4, letterSpacing: '0.08em' }}>INDEX:</span>
          {GL_INDEX_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => onIndexChange(tab.key)}
              style={{
                padding: '1px 7px',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.05em',
                background:  selectedIndex === tab.key ? 'var(--amber)' : 'transparent',
                color:       selectedIndex === tab.key ? '#000'         : 'var(--text-muted)',
                border: `1px solid ${selectedIndex === tab.key ? 'var(--amber)' : 'var(--border)'}`,
                borderRadius: 2,
                cursor: 'pointer',
                transition: 'all 0.12s',
              }}
            >
              {tab.shortLabel}
            </button>
          ))}
          {loading && <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 4 }}>⟳</span>}
        </div>

        {/* Gainers + Losers side-by-side */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden', gap: 1 }}>
          <CompactTable
            title={`▲ GAINERS · ${GL_INDEX_TABS.find(t => t.key === selectedIndex)?.label ?? selectedIndex}`}
            rows={gainers}
            color="var(--green)"
            onSelect={onSelect}
          />
          <CompactTable
            title={`▼ LOSERS · ${GL_INDEX_TABS.find(t => t.key === selectedIndex)?.label ?? selectedIndex}`}
            rows={losers}
            color="var(--red)"
            onSelect={onSelect}
          />
        </div>
      </div>
    );
  },
);

const DashboardView = memo<DashboardProps>(({
  quotes, indices, sentiment, liveNews, onSelectTicker,
}) => {
  const { data: mostActive } = useApiData<any[]>('/api/most-active', 30000);
  // Read directly from isolated stores (no prop drilling needed)
  const liveFilings  = useLiveFilings();
  const liveShockers = useVolumeShockers();
  const [glIndex, setGlIndex] = useState('NIFTY50');

  const KEY_INDICES = ['NIFTY 50', 'NIFTY BANK', 'SENSEX', 'INDIA VIX', 'NIFTY IT', 'NIFTY MIDCAP 100'];
  const keyIndices = useMemo(() => {
    const result: IndexData[] = [];
    KEY_INDICES.forEach(k => {
      const found = indices.find(i => i.name === k || (i.name ?? '').includes(k.split(' ').pop()!));
      if (found) result.push(found);
    });
    return result.slice(0, 6);
  }, [indices]);

  // Click on an index tile → filters gainers/losers to that index
  const handleIndexTileClick = useCallback((idxName: string) => {
    const key = INDEX_NAME_TO_KEY[idxName];
    if (key) setGlIndex(key);
  }, []);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '180px 1fr 1fr 1fr 260px',
      gridTemplateRows: 'auto 1fr 1fr',
      height: '100%',
      gap: 1,
      overflow: 'hidden',
    }}>

      {/* Row 1: Index tiles (cols 1-4, clickable → filter G/L) + Sentiment tile (col 5) */}
      <div style={{ gridColumn: '1 / 5', gridRow: 1, display: 'flex', gap: 1, height: 56 }}>
        {keyIndices.map(idx => {
          const mapped = INDEX_NAME_TO_KEY[idx.name];
          const isActive = mapped && glIndex === mapped;
          return (
            <div
              key={idx.name}
              className="idx-tile"
              onClick={() => handleIndexTileClick(idx.name)}
              style={{
                cursor: mapped ? 'pointer' : 'default',
                outline: isActive ? '1px solid var(--amber)' : undefined,
                flex: 1,
              }}
            >
              <div className="idx-tile-name" style={{ color: isActive ? 'var(--amber)' : undefined }}>
                {idx.name}
              </div>
              <div className="idx-tile-value">
                {idx.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </div>
              <div className="idx-tile-chg" style={{ color: idx.change_pct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {idx.change_pct >= 0 ? '▲' : '▼'}{Math.abs(idx.change_pct).toFixed(2)}%
                <span style={{ color: 'var(--text-muted)', fontSize: 9, marginLeft: 4 }}>
                  {idx.change >= 0 ? '+' : ''}{idx.change.toFixed(0)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Col 5, Row 1: Sentiment tile */}
      <div style={{ gridColumn: 5, gridRow: 1, height: 56 }}>
        <SentimentTile sentiment={sentiment} />
      </div>

      {/* Col 1, Rows 2-3: Watchlist */}
      <div style={{ gridRow: '2 / 4', gridColumn: 1, overflow: 'hidden' }}>
        <Suspense fallback={<PanelSkeleton label="Watchlist" />}>
          <Watchlist onSelectTicker={onSelectTicker} />
        </Suspense>
      </div>

      {/* Cols 2-3, Row 2: Gainers + Losers with index selector */}
      <div style={{ gridColumn: '2 / 4', gridRow: 2, overflow: 'hidden' }}>
        <GainersLosersPanel
          selectedIndex={glIndex}
          onIndexChange={setGlIndex}
          onSelect={onSelectTicker}
          quotes={quotes}
        />
      </div>

      {/* Col 4, Row 2: Volume Shockers */}
      <div style={{ gridColumn: 4, gridRow: 2, overflow: 'hidden' }}>
        <Suspense fallback={<PanelSkeleton label="Volume" />}>
          <VolumeShockers onSelectTicker={onSelectTicker} liveShockers={liveShockers} />
        </Suspense>
      </div>

      {/* Col 5, Rows 2-3: News */}
      <div style={{ gridRow: '2 / 4', gridColumn: 5, overflow: 'hidden' }}>
        <Suspense fallback={<PanelSkeleton label="News" />}>
          <NewsPanel liveItems={liveNews} />
        </Suspense>
      </div>

      {/* Col 2, Row 3: Most Active */}
      <div style={{ gridColumn: 2, gridRow: 3, overflow: 'hidden' }}>
        <MostActiveTable rows={mostActive ?? []} onSelect={onSelectTicker} />
      </div>

      {/* Col 3, Row 3: Filings */}
      <div style={{ gridColumn: 3, gridRow: 3, overflow: 'hidden' }}>
        <Suspense fallback={<PanelSkeleton label="Filings" />}>
          <FilingsPanel liveItems={liveFilings} />
        </Suspense>
      </div>

      {/* Col 4, Row 3: Sentiment detail */}
      <div style={{ gridColumn: 4, gridRow: 3, overflow: 'hidden' }}>
        <SentimentDetail sentiment={sentiment} />
      </div>
    </div>
  );
});

// ── Dashboard sub-components ──────────────────────────────────────────────────
const SentimentTile = memo<{ sentiment: MarketSentiment | null }>(({ sentiment }) => (
  <div className="metric-box" style={{ height: '100%', padding: '6px 10px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
    <div className="metric-label">MARKET REGIME</div>
    <div style={{
      fontSize: 13, fontWeight: 700,
      color: sentiment?.regime === 'RISK_ON' ? 'var(--green)' : sentiment?.regime === 'RISK_OFF' ? 'var(--red)' : 'var(--amber)',
    }}>
      {sentiment?.regime ?? '…'}
    </div>
    <div style={{ display: 'flex', gap: 8, fontSize: 9 }}>
      <span style={{ color: 'var(--green)' }}>A:{sentiment?.advance_decline?.advances ?? 0}</span>
      <span style={{ color: 'var(--red)' }}>D:{sentiment?.advance_decline?.declines ?? 0}</span>
      <span style={{ color: 'var(--amber)' }}>VIX:{sentiment?.india_vix?.toFixed(1) ?? '—'}</span>
    </div>
  </div>
));

const CompactTable = memo<{ title: string; rows: any[]; color: string; onSelect: (s: string) => void }>(
  ({ title, rows, color, onSelect }) => (
    <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-header"><span className="panel-title" style={{ color, fontSize: 10 }}>{title}</span></div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {rows.length === 0 ? (
          <div style={{ padding: '16px 8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 10 }}>
            Loading market data…
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>SYMBOL</th>
                <th style={{ textAlign: 'right' }}>LTP</th>
                <th style={{ textAlign: 'right' }}>CHG%</th>
                <th style={{ textAlign: 'right', fontSize: 8 }}>VOL</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 15).map((g: any, i: number) => {
                const chgPct = g.change_pct ?? g.pChange ?? 0;
                const vol    = g.volume ?? g.totalTradedVolume ?? 0;
                const volFmt = vol >= 1e7 ? `${(vol/1e7).toFixed(1)}Cr` : vol >= 1e5 ? `${(vol/1e5).toFixed(0)}L` : vol > 0 ? `${(vol/1e3).toFixed(0)}K` : '—';
                return (
                  <tr key={i} onClick={() => onSelect(g.symbol)} style={{ cursor: 'pointer' }}>
                    <td style={{ color: 'var(--amber)', fontWeight: 700 }}>{g.symbol}</td>
                    <td style={{ textAlign: 'right' }}>{(g.ltp || g.price || 0).toFixed(2)}</td>
                    <td style={{ textAlign: 'right', color, fontWeight: 700 }}>
                      {chgPct >= 0 ? '+' : ''}{chgPct.toFixed(2)}%
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 9 }}>{volFmt}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  ),
);

const MostActiveTable = memo<{ rows: any[]; onSelect: (s: string) => void }>(({ rows, onSelect }) => (
  <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div className="panel-header"><span className="panel-title">⚡ MOST ACTIVE</span></div>
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <table>
        <thead><tr><th>SYMBOL</th><th style={{ textAlign: 'right' }}>LTP</th><th style={{ textAlign: 'right' }}>CHG%</th><th style={{ textAlign: 'right' }}>VOL</th></tr></thead>
        <tbody>
          {rows.slice(0, 12).map((g: any, i: number) => (
            <tr key={i} onClick={() => onSelect(g.symbol)}>
              <td style={{ color: 'var(--amber)', fontWeight: 700 }}>{g.symbol}</td>
              <td style={{ textAlign: 'right' }}>{(g.ltp || 0).toFixed(2)}</td>
              <td style={{ textAlign: 'right', color: (g.change_pct || 0) >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                {(g.change_pct || 0) >= 0 ? '+' : ''}{(g.change_pct || 0).toFixed(2)}%
              </td>
              <td style={{ textAlign: 'right', color: 'var(--cyan)', fontSize: 10 }}>
                {g.volume >= 1e7 ? `${(g.volume / 1e7).toFixed(1)}Cr` : g.volume >= 1e5 ? `${(g.volume / 1e5).toFixed(1)}L` : (g.volume || 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
));

const SentimentDetail = memo<{ sentiment: MarketSentiment | null }>(({ sentiment }) => {
  if (!sentiment) return <div className="panel"><div className="panel-header"><span className="panel-title">Sentiment</span></div></div>;
  const score = sentiment.bull_bear_score;
  return (
    <div className="panel" style={{ height: '100%' }}>
      <div className="panel-header"><span className="panel-title">📊 SENTIMENT</span></div>
      <div style={{ padding: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div className="metric-box">
          <div className="metric-label">Bull/Bear Score</div>
          <div className="metric-value" style={{ color: score >= 0 ? 'var(--green)' : 'var(--red)', fontSize: 18 }}>
            {(score * 100).toFixed(0)}
          </div>
        </div>
        <div className="metric-box">
          <div className="metric-label">India VIX</div>
          <div className="metric-value" style={{ fontSize: 18 }}>{sentiment.india_vix?.toFixed(1) ?? '—'}</div>
        </div>
        <div className="metric-box">
          <div className="metric-label">Advances</div>
          <div className="metric-value" style={{ color: 'var(--green)', fontSize: 16 }}>{sentiment.advance_decline?.advances ?? 0}</div>
        </div>
        <div className="metric-box">
          <div className="metric-label">Declines</div>
          <div className="metric-value" style={{ color: 'var(--red)', fontSize: 16 }}>{sentiment.advance_decline?.declines ?? 0}</div>
        </div>
      </div>
      {sentiment.signals?.slice(0, 4).map((s: string, i: number) => (
        <div key={i} style={{ fontSize: 9, color: 'var(--text-muted)', padding: '0 8px 2px' }}>• {s}</div>
      ))}
    </div>
  );
});
