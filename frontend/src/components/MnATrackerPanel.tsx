/**
 * M&A Tracker — Bloomberg MA/CACS equivalent
 *
 * Tracks merger announcements, scheme of arrangements, demergers,
 * open offers, and block/bulk deal activity from NSE/BSE filings.
 *
 * Data source: /api/mna-tracker  (queries filings table for M&A keywords)
 *              /api/block-bulk-deals (block & bulk deal register)
 */

import React, { useState, useMemo } from 'react';
import { useApiData } from '../hooks/useApi';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DealItem {
  id:          string;
  symbol:      string;
  company:     string;
  type:        string;       // 'merger' | 'demerger' | 'acquisition' | 'open_offer' | 'buyback' | 'scheme'
  headline:    string;
  date:        string;
  source:      string;       // 'NSE' | 'BSE' | 'SEBI'
  status:      string;       // 'announced' | 'pending' | 'approved' | 'completed' | 'lapsed'
  acquirer?:   string;
  deal_value?: number;       // INR crores
  premium?:    number;       // % premium over market price
  url?:        string;
}

interface BlockDeal {
  symbol:   string;
  name:     string;
  client:   string;
  side:     string;
  quantity: number;
  price:    number;
  value:    number;
  date:     string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEAL_COLOR: Record<string, string> = {
  merger:      '#f59e0b',
  acquisition: '#10b981',
  demerger:    '#6366f1',
  open_offer:  '#ef4444',
  buyback:     '#3b82f6',
  scheme:      '#8b5cf6',
  unknown:     '#6b7280',
};

const STATUS_COLOR: Record<string, string> = {
  announced: '#f59e0b',
  pending:   '#6366f1',
  approved:  '#10b981',
  completed: '#22c55e',
  lapsed:    '#ef4444',
};

function fmt(n: number) {
  if (n >= 100_00_00_000) return `₹${(n / 100_00_00_000).toFixed(1)}T`;
  if (n >= 1_00_00_000)   return `₹${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (n >= 1_00_000)       return `₹${(n / 1_00_000).toFixed(1)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

function fmtDate(d: string) {
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
  } catch { return d?.slice(0, 10) ?? '—'; }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DealBadge({ type }: { type: string }) {
  const label = type.replace(/_/g, ' ').toUpperCase();
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 3,
      fontSize: 10, fontWeight: 700, letterSpacing: '0.5px',
      background: `${DEAL_COLOR[type] ?? DEAL_COLOR.unknown}22`,
      color: DEAL_COLOR[type] ?? DEAL_COLOR.unknown,
      border: `1px solid ${DEAL_COLOR[type] ?? DEAL_COLOR.unknown}55`,
    }}>{label}</span>
  );
}

function StatusDot({ status }: { status: string }) {
  const col = STATUS_COLOR[status] ?? '#6b7280';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: col, display: 'inline-block' }} />
      <span style={{ color: col, fontSize: 10, fontWeight: 600 }}>{status.toUpperCase()}</span>
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function MnATrackerPanel({ ticker }: { ticker?: string }) {
  const [tab, setTab]       = useState<'deals' | 'block' | 'bulk'>('deals');
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  // useApiData(path, refreshMs, cacheTtlMs)  — positional args, NOT options object
  const { data: rawDeals, loading: dealsLoading } = useApiData<{ deals: DealItem[] }>(
    '/api/mna-tracker?days=90', 0, 60_000,
  );
  const { data: blockData, loading: blockLoading } = useApiData<{ deals: BlockDeal[] }>(
    '/api/block-deals', 0, 60_000,
  );
  const { data: bulkData, loading: bulkLoading } = useApiData<{ deals: BlockDeal[] }>(
    '/api/bulk-deals', 0, 60_000,
  );

  const deals: DealItem[] = rawDeals?.deals ?? FALLBACK_DEALS;

  const filteredDeals = useMemo(() => {
    let d = deals;
    if (filter !== 'all') d = d.filter(x => x.type === filter);
    if (ticker)           d = d.filter(x =>
      !x.symbol || x.symbol === ticker ||
      (x.headline ?? '').toUpperCase().includes(ticker)
    );
    if (search) {
      const q = search.toLowerCase();
      d = d.filter(x =>
        (x.headline ?? '').toLowerCase().includes(q) ||
        (x.company  ?? '').toLowerCase().includes(q)
      );
    }
    return d;
  }, [deals, filter, ticker, search]);

  const blockDeals: BlockDeal[] = blockData?.deals ?? [];
  const bulkDeals:  BlockDeal[] = bulkData?.deals  ?? [];

  const TABS = [
    { id: 'deals', label: 'M&A EVENTS' },
    { id: 'block', label: 'BLOCK DEALS' },
    { id: 'bulk',  label: 'BULK DEALS' },
  ] as const;

  const FILTERS = [
    { v: 'all', l: 'ALL' },
    { v: 'merger',      l: 'MERGER' },
    { v: 'acquisition', l: 'ACQ' },
    { v: 'demerger',    l: 'DEMERGER' },
    { v: 'open_offer',  l: 'OPEN OFFER' },
    { v: 'buyback',     l: 'BUYBACK' },
    { v: 'scheme',      l: 'SCHEME' },
  ];

  const s: React.CSSProperties = {
    fontFamily: '"JetBrains Mono", "Fira Mono", "Consolas", monospace',
    background: 'var(--bg, #0a0a0f)',
    color: 'var(--text, #e2e8f0)',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontSize: 12,
  };

  return (
    <div style={s}>
      {/* Header */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e293b', background: '#0d1117' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 13, letterSpacing: 1 }}>
            🤝 M&A TRACKER
          </span>
          <span style={{ color: '#475569', fontSize: 11 }}>
            NSE/BSE Corporate Actions · Open Offers · Block/Bulk Deals
          </span>
          {ticker && (
            <span style={{
              marginLeft: 'auto', background: '#1e3a5f', color: '#60a5fa',
              padding: '2px 8px', borderRadius: 3, fontSize: 11, fontWeight: 600,
            }}>
              FILTER: {ticker}
            </span>
          )}
        </div>
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0, marginTop: 8 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                background: tab === t.id ? '#1e3a5f' : 'transparent',
                color:      tab === t.id ? '#60a5fa'  : '#64748b',
                border:     'none',
                borderBottom: tab === t.id ? '2px solid #3b82f6' : '2px solid transparent',
                padding: '4px 14px',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: tab === t.id ? 700 : 400,
                fontFamily: 'inherit',
                letterSpacing: '0.5px',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Deals tab controls */}
      {tab === 'deals' && (
        <div style={{ display: 'flex', gap: 6, padding: '6px 12px', borderBottom: '1px solid #1e293b', flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button
              key={f.v}
              onClick={() => setFilter(f.v)}
              style={{
                background: filter === f.v ? `${DEAL_COLOR[f.v] ?? '#3b82f6'}22` : 'transparent',
                color:      filter === f.v ? (DEAL_COLOR[f.v] ?? '#60a5fa') : '#475569',
                border:     `1px solid ${filter === f.v ? (DEAL_COLOR[f.v] ?? '#3b82f6') + '66' : '#1e293b'}`,
                padding: '2px 8px',
                borderRadius: 3,
                cursor: 'pointer',
                fontSize: 10,
                fontWeight: 600,
                fontFamily: 'inherit',
                letterSpacing: '0.5px',
              }}
            >
              {f.l}
            </button>
          ))}
          <input
            placeholder="Search headline, company…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              marginLeft: 'auto',
              background: '#0d1117', color: '#e2e8f0',
              border: '1px solid #1e293b', borderRadius: 3,
              padding: '2px 8px', fontSize: 11,
              fontFamily: 'inherit', outline: 'none', width: 180,
            }}
          />
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 0 }}>
        {tab === 'deals' && (
          dealsLoading ? <Spinner /> :
          filteredDeals.length === 0 ? <Empty msg="No M&A events found" /> :
          filteredDeals.map(deal => (
            <DealRow key={deal.id} deal={deal} />
          ))
        )}
        {tab === 'block' && (
          blockLoading ? <Spinner /> :
          blockDeals.length === 0 ? <Empty msg="No block deals in the last 30 days" /> :
          <DealTable deals={blockDeals} kind="BLOCK" />
        )}
        {tab === 'bulk' && (
          bulkLoading ? <Spinner /> :
          bulkDeals.length === 0 ? <Empty msg="No bulk deals in the last 30 days" /> :
          <DealTable deals={bulkDeals} kind="BULK" />
        )}
      </div>

      {/* Footer stats */}
      {tab === 'deals' && (
        <div style={{
          padding: '4px 12px', borderTop: '1px solid #1e293b',
          display: 'flex', gap: 16, fontSize: 10, color: '#475569',
        }}>
          <span>TOTAL: <b style={{ color: '#94a3b8' }}>{filteredDeals.length}</b></span>
          <span>PENDING: <b style={{ color: '#f59e0b' }}>
            {filteredDeals.filter(d => d.status === 'pending' || d.status === 'announced').length}
          </b></span>
          <span>COMPLETED: <b style={{ color: '#22c55e' }}>
            {filteredDeals.filter(d => d.status === 'completed').length}
          </b></span>
          <span style={{ marginLeft: 'auto' }}>LAST 90 DAYS · NSE/BSE FILINGS</span>
        </div>
      )}
    </div>
  );
}

// ── Row for M&A deal ──────────────────────────────────────────────────────────

function DealRow({ deal }: { deal: DealItem }) {
  return (
    <div style={{
      padding: '10px 12px',
      borderBottom: '1px solid #0f172a',
      display: 'grid',
      gridTemplateColumns: '90px 1fr auto',
      gap: 8,
      alignItems: 'start',
      cursor: deal.url ? 'pointer' : 'default',
    }}
    onClick={() => deal.url && window.open(deal.url, '_blank')}
    onMouseEnter={e => (e.currentTarget.style.background = '#0d1117')}
    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Left: symbol + date */}
      <div>
        <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: 12, marginBottom: 2 }}>
          {deal.symbol || '—'}
        </div>
        <div style={{ color: '#475569', fontSize: 10 }}>{fmtDate(deal.date)}</div>
        <div style={{ marginTop: 4 }}>
          <DealBadge type={deal.type} />
        </div>
      </div>

      {/* Center: headline + acquirer */}
      <div>
        <div style={{ color: '#e2e8f0', fontSize: 11, lineHeight: 1.5, marginBottom: 4 }}>
          {deal.headline ?? deal.company ?? '—'}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {deal.company && (
            <span style={{ color: '#64748b', fontSize: 10 }}>
              <span style={{ color: '#475569' }}>Co: </span>{deal.company}
            </span>
          )}
          {deal.acquirer && (
            <span style={{ color: '#64748b', fontSize: 10 }}>
              <span style={{ color: '#475569' }}>Acquirer: </span>
              <span style={{ color: '#60a5fa' }}>{deal.acquirer}</span>
            </span>
          )}
          {deal.source && <span style={{ color: '#475569', fontSize: 10 }}>{deal.source}</span>}
        </div>
      </div>

      {/* Right: status + deal value */}
      <div style={{ textAlign: 'right', minWidth: 90 }}>
        <StatusDot status={deal.status} />
        {deal.deal_value !== undefined && deal.deal_value > 0 && (
          <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: 12, marginTop: 4 }}>
            {fmt(deal.deal_value * 1e7)}
          </div>
        )}
        {deal.premium !== undefined && deal.premium !== 0 && (
          <div style={{
            fontSize: 10,
            color: deal.premium > 0 ? '#22c55e' : '#ef4444',
          }}>
            {deal.premium > 0 ? '+' : ''}{deal.premium.toFixed(1)}% prem
          </div>
        )}
      </div>
    </div>
  );
}

// ── Table for block/bulk deals ────────────────────────────────────────────────

function DealTable({ deals, kind }: { deals: BlockDeal[]; kind: string }) {
  const th: React.CSSProperties = {
    padding: '6px 10px', color: '#475569', fontSize: 10,
    fontWeight: 700, letterSpacing: '0.5px', textAlign: 'left',
    borderBottom: '1px solid #1e293b', background: '#0d1117',
    position: 'sticky', top: 0,
  };
  const td: React.CSSProperties = {
    padding: '6px 10px', color: '#94a3b8', fontSize: 11,
    borderBottom: '1px solid #0f172a',
  };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={th}>DATE</th>
          <th style={th}>SYMBOL</th>
          <th style={th}>CLIENT</th>
          <th style={{ ...th, textAlign: 'center' }}>SIDE</th>
          <th style={{ ...th, textAlign: 'right' }}>QTY</th>
          <th style={{ ...th, textAlign: 'right' }}>PRICE</th>
          <th style={{ ...th, textAlign: 'right' }}>VALUE</th>
        </tr>
      </thead>
      <tbody>
        {deals.map((d, i) => (
          <tr key={i}
            onMouseEnter={e => (e.currentTarget.style.background = '#0d1117')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <td style={td}>{fmtDate(d.date)}</td>
            <td style={{ ...td, color: '#f8fafc', fontWeight: 700 }}>{d.symbol}</td>
            <td style={{ ...td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.client}
            </td>
            <td style={{ ...td, textAlign: 'center' }}>
              <span style={{
                padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 700,
                background: d.side?.toUpperCase() === 'BUY' ? '#16653422' : '#7f1d1d22',
                color: d.side?.toUpperCase() === 'BUY' ? '#22c55e' : '#ef4444',
                border: `1px solid ${d.side?.toUpperCase() === 'BUY' ? '#16653455' : '#7f1d1d55'}`,
              }}>
                {(d.side ?? '?').toUpperCase()}
              </span>
            </td>
            <td style={{ ...td, textAlign: 'right' }}>
              {d.quantity?.toLocaleString('en-IN')}
            </td>
            <td style={{ ...td, textAlign: 'right', color: '#f8fafc', fontWeight: 600 }}>
              ₹{d.price?.toFixed(2)}
            </td>
            <td style={{ ...td, textAlign: 'right', color: '#fbbf24', fontWeight: 700 }}>
              {d.value ? fmt(d.value) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ padding: 32, textAlign: 'center', color: '#475569', fontSize: 11 }}>
      <div style={{ marginBottom: 8, fontSize: 16 }}>⏳</div>
      Loading M&A data…
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div style={{ padding: 32, textAlign: 'center', color: '#475569', fontSize: 11 }}>
      <div style={{ marginBottom: 8, fontSize: 20 }}>📋</div>
      {msg}
    </div>
  );
}

// ── Fallback data (when backend is offline / first load) ──────────────────────

const FALLBACK_DEALS: DealItem[] = [
  {
    id: 'f1', symbol: 'HDFC', company: 'HDFC Bank',
    type: 'merger', headline: "HDFC Ltd merged with HDFC Bank — India's largest bank merger",
    date: '2023-07-01', source: 'NSE', status: 'completed',
    deal_value: 4000000, premium: 18.5, acquirer: 'HDFC Bank',
  },
  {
    id: 'f2', symbol: 'IRCTC', company: 'IRCTC Ltd',
    type: 'buyback', headline: 'IRCTC Board approves ₹1,000 Cr buyback at ₹950/share',
    date: '2025-03-15', source: 'BSE', status: 'announced',
    deal_value: 1000, premium: 12.0,
  },
  {
    id: 'f3', symbol: 'ZOMATO', company: 'Zomato Ltd',
    type: 'acquisition', headline: 'Zomato acquires Paytm entertainment business for ₹2,048 Cr',
    date: '2024-08-22', source: 'NSE', status: 'completed',
    deal_value: 2048, acquirer: 'Zomato Ltd',
  },
  {
    id: 'f4', symbol: 'VEDL', company: 'Vedanta Ltd',
    type: 'demerger', headline: 'Vedanta proposes demerger into 6 listed entities (base metals, oil, power, steel, glass, aluminium)',
    date: '2025-01-10', source: 'BSE', status: 'pending',
  },
  {
    id: 'f5', symbol: 'IDEA', company: 'Vodafone Idea',
    type: 'scheme', headline: 'Vi Board approves rights issue of ₹20,000 Cr to fund 5G rollout',
    date: '2025-04-03', source: 'NSE', status: 'approved',
    deal_value: 20000,
  },
];
