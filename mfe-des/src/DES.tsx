/**
 * DES — Security Description MFE
 *
 * Bloomberg DES equivalent for Indian equities.
 * Displays: company profile, live quote, key ratios, filings summary,
 * corporate actions, shareholding, insider trades.
 *
 * Data source: BTI backend /api/* endpoints (FastAPI on port 8000).
 * Live price: subscribes to WS_TICK events on the event bus injected by the shell.
 *
 * This component is the default export loaded by the shell via Module Federation.
 * It must satisfy the MFEProps contract from bti-shell's mfe/types.ts.
 */

import React, {
  useState, useEffect, useCallback, useRef, memo,
} from 'react';

// ── MFE contract (mirror of shell's src/mfe/types.ts) ─────────────────────────
interface MFEProps {
  ticker: string;
  theme: 'dark' | 'light';
  apiBase: string;
  bus: {
    on: (type: string) => import('rxjs').Observable<any>;
    emit: (type: string, payload: unknown) => void;
    subscribe: (type: string, handler: (e: any) => void) => () => void;
  };
  onTickerChange: (ticker: string) => void;
  onNavigate: (mnemonic: string, ticker?: string) => void;
}

// ── Data shapes ────────────────────────────────────────────────────────────────
interface CompanyProfile {
  name: string;
  sector: string;
  industry: string;
  isin: string;
  description: string;
  market_cap: number;
  pe_ratio: number | null;
  roe: number | null;
  roce: number | null;
  debt_equity: number | null;
  revenue_growth: number | null;
  pat_growth: number | null;
  website: string;
  founded: string;
  employees: number;
}

interface LiveQuote {
  symbol: string;
  price: number;
  change: number;
  change_pct: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  prev_close: number;
}

interface Filing {
  id?: number;
  description: string;
  filed_at: string;
  exchange: string;
  filing_type: string;
}

interface CorporateAction {
  action_type: string;
  ex_date: string;
  record_date?: string;
  details: string;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const QuoteBar = memo(function QuoteBar({ quote, ticker }: { quote: LiveQuote | null; ticker: string }) {
  const positive = (quote?.change ?? 0) >= 0;
  return (
    <div style={s.quoteBar}>
      <span style={s.quoteTicker}>{ticker}</span>
      {quote ? (
        <>
          <span style={s.quotePrice}>₹{quote.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span style={{ ...s.quoteChange, color: positive ? '#22c55e' : '#ef4444' }}>
            {positive ? '+' : ''}{quote.change.toFixed(2)} ({positive ? '+' : ''}{quote.change_pct.toFixed(2)}%)
          </span>
          <span style={s.quoteMeta}>H: ₹{quote.high.toFixed(2)}</span>
          <span style={s.quoteMeta}>L: ₹{quote.low.toFixed(2)}</span>
          <span style={s.quoteMeta}>Vol: {(quote.volume / 1_000_000).toFixed(2)}M</span>
        </>
      ) : (
        <span style={s.quoteMeta}>Loading...</span>
      )}
      <span style={s.liveTag}>● LIVE</span>
    </div>
  );
});

const SectionHeader = memo(function SectionHeader({ label, action, onAction }: {
  label: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div style={s.sectionHeader}>
      <span style={s.sectionLabel}>{label}</span>
      {action && <button onClick={onAction} style={s.sectionAction}>{action}</button>}
    </div>
  );
});

const Ratio = memo(function Ratio({ label, value, unit = '' }: { label: string; value: string | number | null; unit?: string }) {
  const display = value === null || value === undefined ? 'N/A' : `${value}${unit}`;
  return (
    <div style={s.ratio}>
      <span style={s.ratioLabel}>{label}</span>
      <span style={s.ratioValue}>{display}</span>
    </div>
  );
});

// ── Main DES component ─────────────────────────────────────────────────────────
const DES = memo(function DES({ ticker, apiBase, bus, onTickerChange, onNavigate }: MFEProps) {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [filings, setFilings] = useState<Filing[]>([]);
  const [actions, setActions] = useState<CorporateAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'filings' | 'actions' | 'ownership'>('overview');
  const mountedRef = useRef(true);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // ── Fetch data ─────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async (sym: string) => {
    setLoading(true);
    setError(null);

    try {
      const [deepDiveRes, quoteRes, filingsRes] = await Promise.allSettled([
        fetch(`${apiBase}/api/company/deep-dive/${sym}`).then(r => r.json()),
        fetch(`${apiBase}/api/quote/${sym}`).then(r => r.json()),
        fetch(`${apiBase}/api/filings/${sym}?limit=10`).then(r => r.json()),
      ]);

      if (!mountedRef.current) return;

      if (deepDiveRes.status === 'fulfilled' && deepDiveRes.value && !deepDiveRes.value.error) {
        const d = deepDiveRes.value;
        setProfile({
          name: d.name ?? sym,
          sector: d.sector ?? 'N/A',
          industry: d.industry ?? 'N/A',
          isin: d.isin ?? 'N/A',
          description: d.description ?? d.about ?? '',
          market_cap: d.market_cap ?? 0,
          pe_ratio: d.pe_ratio ?? null,
          roe: d.roe ?? null,
          roce: d.roce ?? null,
          debt_equity: d.debt_equity ?? null,
          revenue_growth: d.revenue_growth ?? null,
          pat_growth: d.pat_growth ?? null,
          website: d.website ?? '',
          founded: d.founded ?? '',
          employees: d.employees ?? 0,
        });
        if (Array.isArray(d.corporate_actions)) {
          setActions(d.corporate_actions.slice(0, 8));
        } else if (d.corporate_actions && typeof d.corporate_actions === 'object') {
          // Some backends return an object keyed by action type — flatten to array
          const flat = Object.values(d.corporate_actions).flat().filter(Boolean) as CorporateAction[];
          setActions(flat.slice(0, 8));
        }
      }

      if (quoteRes.status === 'fulfilled' && quoteRes.value?.price) {
        setQuote(quoteRes.value);
      }

      if (filingsRes.status === 'fulfilled' && Array.isArray(filingsRes.value)) {
        setFilings(filingsRes.value.slice(0, 10));
      } else if (filingsRes.status === 'fulfilled' && Array.isArray(filingsRes.value?.filings)) {
        setFilings(filingsRes.value.filings.slice(0, 10));
      }
    } catch (err: any) {
      if (mountedRef.current) setError(err.message ?? 'Fetch failed');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { fetchAll(ticker); }, [ticker, fetchAll]);

  // ── Subscribe to live WS ticks via event bus ───────────────────────────────
  useEffect(() => {
    const unsub = bus.subscribe('WS_TICK', (ev: any) => {
      const tick = ev.payload;
      if (tick?.symbol === ticker || tick?.s === ticker) {
        setQuote(prev => prev ? {
          ...prev,
          price: tick.price ?? tick.p ?? prev.price,
          change: tick.change ?? tick.c ?? prev.change,
          change_pct: tick.changePct ?? tick.cp ?? prev.change_pct,
          volume: tick.volume ?? tick.v ?? prev.volume,
          high: tick.high ?? tick.h ?? prev.high,
          low: tick.low ?? tick.l ?? prev.low,
        } : prev);
      }
    });
    return unsub;
  }, [ticker, bus]);

  // ── Subscribe to ticker changes from other MFEs ────────────────────────────
  useEffect(() => {
    const unsub = bus.subscribe('TICKER_CHANGE', (ev: any) => {
      const newTicker = ev.payload?.ticker;
      if (newTicker && newTicker !== ticker) {
        fetchAll(newTicker);
      }
    });
    return unsub;
  }, [ticker, bus, fetchAll]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={s.root}>
        <QuoteBar quote={null} ticker={ticker} />
        <div style={s.errorBox}>
          <div style={s.errorTitle}>DATA ERROR</div>
          <div style={s.errorMsg}>{error}</div>
          <button style={s.retryBtn} onClick={() => fetchAll(ticker)}>RETRY</button>
        </div>
      </div>
    );
  }

  const tabs: Array<{ id: typeof activeTab; label: string }> = [
    { id: 'overview', label: 'OVERVIEW' },
    { id: 'filings', label: 'FILINGS' },
    { id: 'actions', label: 'CORP ACTIONS' },
    { id: 'ownership', label: 'OWNERSHIP' },
  ];

  return (
    <div style={s.root}>
      {/* ── Live quote bar ─────────────────────────────────────────────────── */}
      <QuoteBar quote={quote} ticker={ticker} />

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div style={s.tabBar}>
        {tabs.map(t => (
          <button
            key={t.id}
            style={{ ...s.tab, ...(activeTab === t.id ? s.tabActive : {}) }}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button style={s.navBtn} onClick={() => onNavigate('GP', ticker)}>GP ↗</button>
        <button style={s.navBtn} onClick={() => onNavigate('BETA', ticker)}>BETA ↗</button>
        <button style={s.navBtn} onClick={() => onNavigate('WACC', ticker)}>WACC ↗</button>
      </div>

      {/* ── Content area ──────────────────────────────────────────────────── */}
      <div style={s.content}>
        {loading && (
          <div style={s.loading}>
            <div style={s.loadingSpinner} />
            <span>FETCHING {ticker} DATA...</span>
          </div>
        )}

        {!loading && activeTab === 'overview' && profile && (
          <div style={s.overviewGrid}>
            {/* Company identity */}
            <div style={s.card}>
              <SectionHeader label="COMPANY PROFILE" />
              <div style={s.companyName}>{profile.name}</div>
              <div style={s.companyMeta}>{profile.sector} › {profile.industry}</div>
              <div style={s.companyMeta}>ISIN: {profile.isin}</div>
              {profile.website && (
                <div style={s.companyMeta}>
                  <a href={profile.website} target="_blank" rel="noreferrer" style={s.link}>
                    {profile.website}
                  </a>
                </div>
              )}
              {profile.description && (
                <div style={s.description}>{profile.description.slice(0, 400)}{profile.description.length > 400 ? '...' : ''}</div>
              )}
            </div>

            {/* Market snapshot */}
            <div style={s.card}>
              <SectionHeader label="MARKET SNAPSHOT" />
              <Ratio label="MARKET CAP" value={profile.market_cap ? `₹${(profile.market_cap / 1e7).toFixed(0)}Cr` : 'N/A'} />
              <Ratio label="P/E RATIO" value={profile.pe_ratio?.toFixed(2) ?? null} />
              <Ratio label="ROE" value={profile.roe?.toFixed(2) ?? null} unit="%" />
              <Ratio label="ROCE" value={profile.roce?.toFixed(2) ?? null} unit="%" />
              <Ratio label="DEBT/EQUITY" value={profile.debt_equity?.toFixed(2) ?? null} />
              <Ratio label="REV GROWTH" value={profile.revenue_growth?.toFixed(2) ?? null} unit="%" />
              <Ratio label="PAT GROWTH" value={profile.pat_growth?.toFixed(2) ?? null} unit="%" />
            </div>

            {/* Quick navigation */}
            <div style={s.card}>
              <SectionHeader label="RELATED FUNCTIONS" />
              {([
                ['FA', 'Fundamental Analysis'],
                ['OPT', 'Options Chain'],
                ['BETA', 'Beta Analysis'],
                ['WACC', 'WACC Calculator'],
                ['DCF', 'DCF Valuation'],
                ['EQS', 'Equity Screener'],
                ['MA', 'M&A Tracker'],
              ] as [string, string][]).map(([mn, label]) => (
                <button key={mn} style={s.relFunc} onClick={() => onNavigate(mn, ticker)}>
                  <span style={s.relFuncMn}>{mn}</span>
                  <span style={s.relFuncLabel}>{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && activeTab === 'filings' && (
          <div style={s.listSection}>
            <SectionHeader label={`RECENT FILINGS — ${ticker}`} />
            {filings.length === 0 ? (
              <div style={s.empty}>NO FILINGS AVAILABLE</div>
            ) : filings.map((f, i) => (
              <div key={i} style={s.filingRow}>
                <div style={s.filingMeta}>
                  <span style={s.filingType}>{f.filing_type}</span>
                  <span style={s.filingExchange}>{f.exchange}</span>
                  <span style={s.filingDate}>{f.filed_at?.slice(0, 10)}</span>
                </div>
                <div style={s.filingDesc}>{f.description}</div>
              </div>
            ))}
          </div>
        )}

        {!loading && activeTab === 'actions' && (
          <div style={s.listSection}>
            <SectionHeader label={`CORPORATE ACTIONS — ${ticker}`} />
            {actions.length === 0 ? (
              <div style={s.empty}>NO RECENT CORPORATE ACTIONS</div>
            ) : actions.map((a, i) => (
              <div key={i} style={s.actionRow}>
                <span style={s.actionType}>{a.action_type}</span>
                <span style={s.actionDate}>{a.ex_date}</span>
                <span style={s.actionDetails}>{a.details}</span>
              </div>
            ))}
          </div>
        )}

        {!loading && activeTab === 'ownership' && (
          <div style={s.listSection}>
            <SectionHeader label={`SHAREHOLDING — ${ticker}`} />
            <div style={s.empty}>
              OWNERSHIP DATA — navigate to CGOV for full board & promoter details
              <br />
              <button style={s.retryBtn} onClick={() => onNavigate('CGOV', ticker)}>
                OPEN CGOV ↗
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

// ── Styles ─────────────────────────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0a0a', color: '#e5e7eb', fontFamily: "'Consolas','Courier New',monospace", overflow: 'hidden' },
  quoteBar: { display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', background: '#111', borderBottom: '1px solid #1f2937', flexShrink: 0, flexWrap: 'wrap' },
  quoteTicker: { color: '#f59e0b', fontWeight: 700, fontSize: 14, letterSpacing: 1 },
  quotePrice: { color: '#e5e7eb', fontSize: 18, fontWeight: 700 },
  quoteChange: { fontSize: 12 },
  quoteMeta: { color: '#6b7280', fontSize: 11 },
  liveTag: { color: '#22c55e', fontSize: 10, letterSpacing: 1, marginLeft: 'auto' },
  tabBar: { display: 'flex', alignItems: 'center', gap: 2, padding: '4px 8px', background: '#111', borderBottom: '1px solid #1f2937', flexShrink: 0 },
  tab: { background: 'none', border: '1px solid transparent', color: '#6b7280', cursor: 'pointer', padding: '3px 10px', fontSize: 10, letterSpacing: 1, fontFamily: 'inherit' },
  tabActive: { border: '1px solid #374151', color: '#f59e0b', background: '#1f2937' },
  navBtn: { background: 'none', border: '1px solid #374151', color: '#7dd3fc', cursor: 'pointer', padding: '2px 8px', fontSize: 10, fontFamily: 'inherit', letterSpacing: 0.5 },
  content: { flex: 1, overflow: 'auto', padding: 12 },
  loading: { display: 'flex', alignItems: 'center', gap: 10, padding: 40, color: '#4b5563', fontSize: 12, letterSpacing: 1 },
  loadingSpinner: { width: 16, height: 16, border: '2px solid #1f2937', borderTop: '2px solid #f59e0b', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  overviewGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 },
  card: { background: '#111', border: '1px solid #1f2937', padding: 14 },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, borderBottom: '1px solid #1f2937', paddingBottom: 6 },
  sectionLabel: { color: '#7dd3fc', fontSize: 10, letterSpacing: 2, fontWeight: 700 },
  sectionAction: { background: 'none', border: '1px solid #374151', color: '#9ca3af', cursor: 'pointer', fontSize: 10, padding: '1px 6px', fontFamily: 'inherit' },
  companyName: { color: '#f3f4f6', fontSize: 15, fontWeight: 700, marginBottom: 4 },
  companyMeta: { color: '#6b7280', fontSize: 11, marginBottom: 3 },
  description: { color: '#9ca3af', fontSize: 11, lineHeight: 1.5, marginTop: 8 },
  link: { color: '#7dd3fc', textDecoration: 'none' },
  ratio: { display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #111' },
  ratioLabel: { color: '#6b7280', fontSize: 11 },
  ratioValue: { color: '#e5e7eb', fontSize: 11, fontWeight: 600 },
  relFunc: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '5px 0', borderBottom: '1px solid #1f2937', textAlign: 'left', fontFamily: 'inherit' },
  relFuncMn: { color: '#f59e0b', fontSize: 11, fontWeight: 700, minWidth: 44, letterSpacing: 1 },
  relFuncLabel: { color: '#6b7280', fontSize: 11 },
  listSection: { maxWidth: 900 },
  filingRow: { padding: '8px 0', borderBottom: '1px solid #1f2937' },
  filingMeta: { display: 'flex', gap: 10, marginBottom: 4 },
  filingType: { color: '#f59e0b', fontSize: 10, letterSpacing: 1 },
  filingExchange: { color: '#6b7280', fontSize: 10 },
  filingDate: { color: '#4b5563', fontSize: 10, marginLeft: 'auto' },
  filingDesc: { color: '#9ca3af', fontSize: 12, lineHeight: 1.4 },
  actionRow: { display: 'flex', gap: 12, alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid #1f2937' },
  actionType: { color: '#f59e0b', fontSize: 11, fontWeight: 700, minWidth: 80 },
  actionDate: { color: '#6b7280', fontSize: 11, minWidth: 90 },
  actionDetails: { color: '#9ca3af', fontSize: 11 },
  empty: { color: '#374151', fontSize: 12, padding: 20, textAlign: 'center', letterSpacing: 1, lineHeight: 2 },
  errorBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, gap: 12 },
  errorTitle: { color: '#ef4444', fontSize: 13, fontWeight: 700, letterSpacing: 2 },
  errorMsg: { color: '#6b7280', fontSize: 12 },
  retryBtn: { background: 'none', border: '1px solid #374151', color: '#f59e0b', cursor: 'pointer', padding: '4px 16px', fontSize: 11, letterSpacing: 1, fontFamily: 'inherit', marginTop: 8 },
};

export default DES;

export const metadata = {
  name: 'Security Description',
  mnemonic: 'DES',
  description: 'Company overview, financials, filings & corporate actions',
  version: '1.0.0',
  category: 'EQUITY' as const,
  dataSources: ['NSE', 'Screener.in', 'BSE Corporate Announcements'],
};
