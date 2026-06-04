/**
 * Bloomberg RV — Peer / Relative Value Comparison Panel
 * Shows the selected stock vs sector peers across key valuation multiples
 */

import React, { useState } from 'react';
import { useApiData } from '../hooks/useApi';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Legend, Cell,
} from 'recharts';

interface Props {
  symbol: string;
  onSelectTicker?: (sym: string) => void;
}

function fmt(v?: number | null, d = 2): string {
  if (v == null || v === 0) return '—';
  return Number(v).toFixed(d);
}

function fmtPct(v?: number | null): string {
  if (v == null) return '—';
  return `${(Number(v) * 100).toFixed(1)}%`;
}

function fmtCr(v?: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `₹${(v / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `₹${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`;
  return `₹${v.toFixed(0)}`;
}

type Tab = 'table' | 'charts' | 'radar';

const METRICS = [
  { key: 'pe_ratio',       label: 'P/E',            lower_better: true,  fmt: (v: number) => fmt(v, 1) },
  { key: 'pb_ratio',       label: 'P/B',            lower_better: true,  fmt: (v: number) => fmt(v, 1) },
  { key: 'ev_ebitda',      label: 'EV/EBITDA',      lower_better: true,  fmt: (v: number) => fmt(v, 1) },
  { key: 'ps_ratio',       label: 'P/S',            lower_better: true,  fmt: (v: number) => fmt(v, 2) },
  { key: 'roe',            label: 'ROE',            lower_better: false, fmt: fmtPct },
  { key: 'roa',            label: 'ROA',            lower_better: false, fmt: fmtPct },
  { key: 'profit_margins', label: 'Net Margin',     lower_better: false, fmt: fmtPct },
  { key: 'revenue_growth', label: 'Rev Growth',     lower_better: false, fmt: fmtPct },
  { key: 'debt_to_equity', label: 'D/E',            lower_better: true,  fmt: (v: number) => fmt(v, 2) },
  { key: 'dividend_yield', label: 'Div Yield',      lower_better: false, fmt: fmtPct },
  { key: 'beta',           label: 'Beta',           lower_better: null,  fmt: (v: number) => fmt(v, 2) },
  { key: 'market_cap',     label: 'Market Cap',     lower_better: null,  fmt: fmtCr },
];

function getVsColor(val: number | null, median: number | null, lowerBetter: boolean | null): string {
  if (val == null || median == null || lowerBetter === null) return 'var(--text-primary)';
  if (lowerBetter) return val < median ? 'var(--green)' : val > median * 1.3 ? 'var(--red)' : 'var(--amber)';
  return val > median ? 'var(--green)' : val < median * 0.7 ? 'var(--red)' : 'var(--amber)';
}

export const PeerComparisonPanel: React.FC<Props> = ({ symbol, onSelectTicker }) => {
  const [tab, setTab] = useState<Tab>('table');
  const [chartMetric, setChartMetric] = useState('pe_ratio');

  const { data, loading } = useApiData<any>(`/api/peers/${symbol}`, 3600000);

  if (loading) return (
    <div className="panel h-full flex-center">
      <div className="spinner" />
      <span style={{ marginLeft: 10, color: 'var(--text-muted)', fontSize: 11 }}>Loading peer data…</span>
    </div>
  );

  if (!data?.target) return (
    <div className="panel h-full" style={{ padding: 16, color: 'var(--text-muted)', fontSize: 11 }}>
      No peer data available for {symbol}
    </div>
  );

  const { target, peers, sector_medians } = data;
  const allCompanies = [{ ...target, isTarget: true }, ...(peers || [])];

  // Build bar chart data for selected metric
  const barData = allCompanies
    .map(c => ({
      name: c.symbol?.replace('.NS', ''),
      value: c[chartMetric],
      isTarget: c.isTarget,
    }))
    .filter(d => d.value != null)
    .sort((a, b) => (b.value || 0) - (a.value || 0));

  // Radar chart data — normalize to 0-100 scale relative to peers
  const radarKeys = ['pe_ratio', 'roe', 'profit_margins', 'revenue_growth', 'debt_to_equity'];
  const radarData = radarKeys.map(key => {
    const vals = allCompanies.map(c => c[key]).filter(v => v != null) as number[];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const normalize = (v: number | null) => v == null ? 0 : ((v - min) / range) * 100;

    const m = METRICS.find(m => m.key === key);
    const lowerBetter = m?.lower_better;
    return {
      metric: m?.label || key,
      target: lowerBetter === true
        ? 100 - normalize(target[key])   // invert: lower raw = higher score
        : normalize(target[key]),
      median: 50, // sector median always 50
    };
  });

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="panel-title">RV — RELATIVE VALUE</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 6 }}>
          {symbol} vs {peers?.length || 0} sector peers
        </span>
        {target.sector && (
          <span style={{
            marginLeft: 8, fontSize: 9, padding: '1px 6px',
            background: 'rgba(79,195,247,0.1)', color: '#4fc3f7',
            border: '1px solid rgba(79,195,247,0.2)', borderRadius: 2,
          }}>
            {target.sector}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 1, background: 'var(--bg-secondary)', padding: '2px 4px', borderBottom: '1px solid #222', flexShrink: 0, alignItems: 'center' }}>
        {(['table', 'charts', 'radar'] as Tab[]).map(t => (
          <button key={t} className={`nav-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
        {tab === 'charts' && (
          <select
            value={chartMetric}
            onChange={e => setChartMetric(e.target.value)}
            style={{
              marginLeft: 'auto', background: '#111', border: '1px solid #333',
              color: '#e8e8e0', padding: '2px 6px', fontSize: 10, borderRadius: 2,
            }}
          >
            {METRICS.map(m => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        )}
      </div>

      <div className="panel-body" style={{ flex: 1, overflowY: 'auto', padding: tab === 'table' ? 0 : 10 }}>

        {/* TABLE VIEW */}
        {tab === 'table' && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#0d0d0d', zIndex: 1 }}>
              <tr>
                <th style={{ textAlign: 'left', color: 'var(--text-muted)', padding: '5px 8px', borderBottom: '1px solid #222', fontSize: 9, minWidth: 80 }}>Symbol</th>
                {METRICS.slice(0, 8).map(m => (
                  <th key={m.key} style={{ textAlign: 'right', color: 'var(--text-muted)', padding: '5px 6px', borderBottom: '1px solid #222', fontSize: 9, whiteSpace: 'nowrap' }}>
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Sector median row */}
              {sector_medians && (
                <tr style={{ borderBottom: '1px solid #1a1a1a', background: 'rgba(255,149,0,0.03)' }}>
                  <td style={{ padding: '4px 8px', color: 'var(--amber)', fontSize: 9, fontWeight: 700 }}>SECTOR MED</td>
                  {METRICS.slice(0, 8).map(m => (
                    <td key={m.key} style={{ padding: '4px 6px', textAlign: 'right', color: '#666', fontSize: 9 }}>
                      {m.fmt(sector_medians[m.key])}
                    </td>
                  ))}
                </tr>
              )}
              {allCompanies.map((c, i) => (
                <tr
                  key={i}
                  style={{
                    borderBottom: '1px solid #111',
                    background: c.isTarget ? 'rgba(255,149,0,0.05)' : '',
                    cursor: 'pointer',
                  }}
                  onClick={() => !c.isTarget && c.symbol && onSelectTicker?.(c.symbol.replace('.NS', ''))}
                  onMouseEnter={e => !c.isTarget && (e.currentTarget.style.background = '#0f0f0f')}
                  onMouseLeave={e => (e.currentTarget.style.background = c.isTarget ? 'rgba(255,149,0,0.05)' : '')}
                >
                  <td style={{ padding: '5px 8px' }}>
                    <div style={{ color: c.isTarget ? 'var(--amber)' : '#e8e8e0', fontWeight: c.isTarget ? 900 : 500, fontSize: 10 }}>
                      {(c.symbol || '').replace('.NS', '')}
                      {c.isTarget && <span style={{ fontSize: 8, marginLeft: 4, color: 'var(--amber)' }}>★</span>}
                    </div>
                    <div style={{ color: '#555', fontSize: 8, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.name}
                    </div>
                  </td>
                  {METRICS.slice(0, 8).map(m => {
                    const val = c[m.key];
                    const median = sector_medians?.[m.key];
                    const color = c.isTarget ? getVsColor(val, median, m.lower_better) : 'var(--text-secondary)';
                    return (
                      <td key={m.key} style={{ padding: '5px 6px', textAlign: 'right', color, fontSize: 10, fontWeight: c.isTarget ? 700 : 400 }}>
                        {m.fmt(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* CHARTS VIEW */}
        {tab === 'charts' && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>
              {METRICS.find(m => m.key === chartMetric)?.label} — {symbol} vs Peers
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={barData} margin={{ top: 5, right: 10, left: -10, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 8, fill: '#666' }}
                  angle={-45}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fontSize: 8, fill: '#666' }} />
                <Tooltip
                  contentStyle={{ background: '#141414', border: '1px solid #333', fontSize: 10 }}
                  formatter={(v: any) => [METRICS.find(m => m.key === chartMetric)?.fmt(v) || v, '']}
                />
                <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                  {barData.map((d, i) => (
                    <Cell key={i} fill={d.isTarget ? '#ff9500' : '#4fc3f7'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>ALL METRICS SUMMARY</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {METRICS.map(m => {
                  const val = target[m.key];
                  const median = sector_medians?.[m.key];
                  const color = getVsColor(val, median, m.lower_better);
                  return (
                    <div key={m.key} style={{
                      background: 'var(--bg-secondary)', border: '1px solid #1a1a1a',
                      padding: '6px 8px', borderRadius: 2,
                    }}>
                      <div style={{ color: '#555', fontSize: 9 }}>{m.label}</div>
                      <div style={{ color, fontSize: 13, fontWeight: 700, marginTop: 2 }}>
                        {m.fmt(val)}
                      </div>
                      {median && (
                        <div style={{ fontSize: 8, color: '#444', marginTop: 1 }}>
                          Sect: {m.fmt(median)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* RADAR VIEW */}
        {tab === 'radar' && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>
              Competitive Positioning Radar — Score relative to peers (higher = better)
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                <PolarGrid stroke="#222" />
                <PolarAngleAxis dataKey="metric" tick={{ fill: '#888', fontSize: 9 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#555', fontSize: 8 }} />
                <Radar name={symbol} dataKey="target" stroke="#ff9500" fill="#ff9500" fillOpacity={0.2} strokeWidth={2} />
                <Radar name="Sector Median" dataKey="median" stroke="#4fc3f7" fill="#4fc3f7" fillOpacity={0.05} strokeWidth={1} strokeDasharray="4 4" />
                <Tooltip contentStyle={{ background: '#141414', border: '1px solid #333', fontSize: 10 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </RadarChart>
            </ResponsiveContainer>

            <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(255,149,0,0.05)', border: '1px solid rgba(255,149,0,0.15)' }}>
              <div style={{ fontSize: 9, color: '#666' }}>
                Radar score = relative ranking vs all sector peers (0=worst, 100=best). Valuation metrics (P/E, D/E) inverted so higher = cheaper/safer.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PeerComparisonPanel;
