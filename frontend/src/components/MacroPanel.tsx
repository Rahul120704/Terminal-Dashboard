/**
 * Macro Dashboard — Bloomberg MACRO equivalent
 * Tabs: GLOBAL MARKETS, ECONOMIC INDICATORS, FII/DII FLOWS, YIELD CURVE SNAPSHOT
 * Uses REST API as primary source + WebSocket data as enhancement overlay.
 */

import React, { useState } from 'react';
import { MacroDashboard } from '../types';
import { useApiData } from '../hooks/useApi';
import { useMacroDash, useSentiment } from '../store/liveDataStore';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, ReferenceLine, LineChart, Line, CartesianGrid,
} from 'recharts';

interface Props { data?: MacroDashboard; }   // kept for backward compat; store takes precedence

function fmt(v?: number | null, d = 2): string {
  if (v == null) return '—';
  return v.toFixed(d);
}
function fmtCr(v: number): string {
  if (Math.abs(v) >= 1e4) return `₹${(v / 1e4).toFixed(0)}K Cr`;
  return `₹${v.toFixed(0)} Cr`;
}
function fmtLarge(v?: number | null): string {
  if (v == null) return '—';
  if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9)  return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6)  return `${(v / 1e6).toFixed(2)}M`;
  return v.toFixed(2);
}

const TT_STYLE = { background: '#141414', border: '1px solid #333', fontSize: 10 };

type Tab = 'global' | 'indicators' | 'fii' | 'yields' | 'regimes';

// ── Colored badge ────────────────────────────────────────────────────────────
const ChangeBadge: React.FC<{ value?: number | null; unit?: string }> = ({ value, unit = '%' }) => {
  if (value == null) return <span style={{ color: '#555' }}>—</span>;
  const color = value > 0 ? 'var(--green)' : value < 0 ? 'var(--red)' : 'var(--text-muted)';
  return (
    <span style={{ color, fontWeight: 700 }}>
      {value > 0 ? '+' : ''}{value.toFixed(2)}{unit}
    </span>
  );
};

export const MacroPanel: React.FC<Props> = ({ data: propData }) => {
  const [tab, setTab] = useState<Tab>('global');
  // Store takes priority — re-renders only when macro/sentiment data changes, not on price ticks
  const storeData   = useMacroDash();
  const sentData    = useSentiment();
  // Merge: macro store for indicators/flows, sentiment store for regime/vix/score
  const wsData = storeData
    ? {
        ...storeData,
        regime:          sentData?.regime          ?? storeData.regime,
        india_vix:       sentData?.india_vix       ?? storeData.india_vix,
        bull_bear_score: sentData?.bull_bear_score ?? storeData.bull_bear_score,
      }
    : propData
    ? {
        ...propData,
        regime:          sentData?.regime,
        india_vix:       sentData?.india_vix,
        bull_bear_score: sentData?.bull_bear_score,
      }
    : sentData
    ? { indicators: [], fii_dii_flows: [], market_prices: {}, updated_at: '',
        regime: sentData.regime, india_vix: sentData.india_vix,
        bull_bear_score: sentData.bull_bear_score }
    : undefined;

  // REST API sources — always available, no WebSocket dependency
  const { data: econIndicators } = useApiData<any>('/api/economic-indicators', 300000);
  const { data: fiiData }        = useApiData<any>('/api/fii-dii-enhanced?days=30', 600000);
  const { data: yieldData }      = useApiData<any>('/api/yield-curve', 1800000);

  // Merge: prefer WebSocket live data when available
  const marketPrices = wsData?.market_prices
    ? Object.entries(wsData.market_prices).map(([sym, d]: [string, any]) => ({ sym, ...d })).sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))
    : (econIndicators?.indicators || []);

  const fiiFlows = fiiData?.data
    ? [...fiiData.data].reverse().slice(0, 20)
    : (wsData?.fii_dii_flows || []).slice(0, 20).reverse();

  const indicators = wsData?.indicators?.filter((i: any) => i.value != null) || [];

  const yields = yieldData?.yields || {};
  const yieldTenors = ['US 3M', 'US 5Y', 'US 10Y', 'US 30Y'];

  const TABS: { id: Tab; label: string }[] = [
    { id: 'global',     label: 'GLOBAL' },
    { id: 'indicators', label: 'ECON' },
    { id: 'fii',        label: 'FII/DII' },
    { id: 'yields',     label: 'YIELDS' },
    { id: 'regimes',    label: 'REGIMES' },
  ];

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div className="panel-header">
        <span className="panel-title">MACRO — GLOBAL MACRO DASHBOARD</span>
        {wsData && <span style={{ fontSize: 9, color: 'var(--green)', marginLeft: 8 }}>● LIVE</span>}
      </div>

      {/* Regime strip */}
      {wsData?.regime && (
        <div style={{
          display: 'flex', gap: 16, padding: '4px 10px',
          background: '#080808', borderBottom: '1px solid #1a1a1a', flexShrink: 0,
        }}>
          <div>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>REGIME </span>
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: wsData.regime === 'RISK_ON' ? 'var(--green)' : wsData.regime === 'RISK_OFF' ? 'var(--red)' : 'var(--amber)',
            }}>{wsData.regime}</span>
          </div>
          {wsData.india_vix != null && (
            <div>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>VIX </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: wsData.india_vix > 20 ? 'var(--red)' : 'var(--amber)' }}>
                {wsData.india_vix.toFixed(2)}
              </span>
            </div>
          )}
          {wsData.bull_bear_score != null && (
            <div>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>BULL/BEAR </span>
              <span style={{
                fontSize: 11, fontWeight: 700,
                color: wsData.bull_bear_score > 0 ? 'var(--green)' : 'var(--red)',
              }}>{(wsData.bull_bear_score * 100).toFixed(0)}</span>
            </div>
          )}
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 1, background: 'var(--bg-secondary)', padding: '2px 4px', borderBottom: '1px solid #222', flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t.id} className={`nav-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="panel-body" style={{ flex: 1, overflowY: 'auto', padding: 10 }}>

        {/* ── GLOBAL MARKETS ──────────────────────────────────────── */}
        {tab === 'global' && (
          <div>
            {/* Market tiles */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 12 }}>
              {(marketPrices as any[]).slice(0, 8).map((p: any, i: number) => (
                <div key={i} style={{ padding: '8px 10px', background: '#111', border: '1px solid #1a1a1a' }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{p.name || p.ticker}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                    {fmtLarge(p.value)}
                  </div>
                  <ChangeBadge value={p.change_pct} />
                </div>
              ))}
            </div>

            {/* Full table */}
            <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>ALL MARKETS</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
              <thead>
                <tr>
                  {['Instrument', 'Value', 'Change %'].map(h => (
                    <th key={h} style={{ textAlign: h === 'Instrument' ? 'left' : 'right', color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid #222', fontSize: 9 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(marketPrices as any[]).map((p: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                    <td style={{ padding: '5px 8px', color: 'var(--amber)', fontWeight: 700 }}>{p.name || p.ticker}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: '#e8e8e0' }}>{fmtLarge(p.value)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                      <ChangeBadge value={p.change_pct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Interpretation */}
            <div style={{ marginTop: 16, padding: '10px 12px', background: 'var(--bg-secondary)', border: '1px solid #222' }}>
              <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 6 }}>MARKET REGIME INTERPRETATION</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 9, color: '#888', lineHeight: 1.6 }}>
                <div>
                  <b style={{ color: '#e8e8e0' }}>VIX {'<'} 15</b> — Low volatility, risk-on. Favorable for equity markets.<br />
                  <b style={{ color: '#e8e8e0' }}>VIX 15–25</b> — Moderate. Mixed signals. Stock-picking environment.<br />
                  <b style={{ color: '#e8e8e0' }}>VIX {'>'} 25</b> — Fear mode. Defensive positioning advised.
                </div>
                <div>
                  <b style={{ color: '#e8e8e0' }}>DXY Rising</b> — USD strength → EM outflows → INR pressure.<br />
                  <b style={{ color: '#e8e8e0' }}>Crude Rising</b> — OMC margins squeezed, CAD worsens.<br />
                  <b style={{ color: '#e8e8e0' }}>Gold Rising</b> — Uncertainty hedge, safety bid.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── ECONOMIC INDICATORS ─────────────────────────────────── */}
        {tab === 'indicators' && (
          <div>
            {/* WebSocket economic indicators */}
            {indicators.length > 0 ? (
              <>
                <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>LIVE MACRO INDICATORS</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, marginBottom: 16 }}>
                  <thead>
                    <tr>
                      {['Indicator', 'Value', 'Unit', 'Period', 'Source'].map(h => (
                        <th key={h} style={{ textAlign: h === 'Indicator' ? 'left' : 'right', color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid #222', fontSize: 9 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {indicators.map((ind: any, i: number) => (
                      <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                        <td style={{ padding: '5px 8px', color: 'var(--amber)' }}>{ind.indicator}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700, color: '#e8e8e0' }}>{fmt(ind.value)}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: '#666' }}>{ind.unit}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: '#888' }}>{ind.period}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: '#555', fontSize: 9 }}>{ind.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <div style={{ color: '#555', fontSize: 11, marginBottom: 16 }}>
                Economic indicators will appear via WebSocket after market-hours macro update.
              </div>
            )}

            {/* Key macro context cards */}
            <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>KEY INDIA MACRO CONTEXT</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[
                { label: 'RBI Repo Rate', value: '6.25%', note: 'Policy rate — Apr 2025 cut', color: 'var(--amber)' },
                { label: 'India CPI', value: '~4.0%', note: 'Within 4% RBI target band', color: 'var(--green)' },
                { label: 'India GDP Growth', value: '~6.5%', note: 'FY25E. Strong domestic demand', color: 'var(--green)' },
                { label: 'Current Account', value: '-1.5% GDP', note: 'Manageable deficit', color: 'var(--amber)' },
                { label: 'Forex Reserves', value: '$685B+', note: 'Near all-time high', color: 'var(--green)' },
                { label: 'GST Collections', value: '₹1.8L Cr+', note: 'Monthly, robust expansion', color: 'var(--green)' },
              ].map(({ label, value, note, color }) => (
                <div key={label} style={{ padding: '8px 10px', background: '#111', border: '1px solid #1a1a1a' }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color, marginBottom: 2 }}>{value}</div>
                  <div style={{ fontSize: 9, color: '#555', lineHeight: 1.4 }}>{note}</div>
                </div>
              ))}
            </div>

            {/* US Macro */}
            <div style={{ fontSize: 10, color: '#4fc3f7', fontWeight: 700, margin: '16px 0 8px' }}>US MACRO CONTEXT</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[
                { label: 'Fed Funds Rate', value: '5.25-5.50%', note: 'Pause mode, watching data', color: 'var(--amber)' },
                { label: 'US CPI', value: '~3.3%', note: 'Above 2% Fed target', color: 'var(--red)' },
                { label: 'US GDP', value: '~2.8%', note: 'Resilient despite tight policy', color: 'var(--green)' },
                { label: '10Y UST', value: yields['US 10Y']?.current ? `${yields['US 10Y'].current.toFixed(3)}%` : '—', note: '10Y Treasury yield (live)', color: 'var(--amber)' },
                { label: '3M UST', value: yields['US 3M']?.current ? `${yields['US 3M'].current.toFixed(3)}%` : '—', note: '3M Treasury yield (live)', color: 'var(--text-primary)' },
                { label: '10Y-3M Spread', value: yieldData?.spread_10y_3m != null ? `${yieldData.spread_10y_3m > 0 ? '+' : ''}${yieldData.spread_10y_3m.toFixed(3)}%` : '—', note: yieldData?.inverted ? '⚠ INVERTED' : 'Normal curve', color: yieldData?.inverted ? 'var(--red)' : 'var(--green)' },
              ].map(({ label, value, note, color }) => (
                <div key={label} style={{ padding: '8px 10px', background: '#111', border: '1px solid #1a1a1a' }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color, marginBottom: 2 }}>{value}</div>
                  <div style={{ fontSize: 9, color: '#555', lineHeight: 1.4 }}>{note}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── FII/DII ─────────────────────────────────────────────── */}
        {tab === 'fii' && (
          <div>
            {/* Summary row */}
            {fiiData && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 12 }}>
                {[
                  { label: 'FII 20D', value: fiiData.fii_20d_total != null ? fmtCr(fiiData.fii_20d_total) : '—', color: (fiiData.fii_20d_total || 0) >= 0 ? 'var(--green)' : 'var(--red)' },
                  { label: 'DII 20D', value: fiiData.dii_20d_total != null ? fmtCr(fiiData.dii_20d_total) : '—', color: (fiiData.dii_20d_total || 0) >= 0 ? 'var(--cyan)' : 'var(--amber)' },
                  { label: 'FII Cum.', value: fiiData.fii_cumulative != null ? fmtCr(fiiData.fii_cumulative) : '—', color: (fiiData.fii_cumulative || 0) >= 0 ? 'var(--green)' : 'var(--red)' },
                  { label: 'DII Cum.', value: fiiData.dii_cumulative != null ? fmtCr(fiiData.dii_cumulative) : '—', color: (fiiData.dii_cumulative || 0) >= 0 ? 'var(--cyan)' : 'var(--amber)' },
                  { label: 'Sentiment', value: fiiData.net_sentiment || '—', color: fiiData.net_sentiment === 'BUYING' ? 'var(--green)' : fiiData.net_sentiment === 'SELLING' ? 'var(--red)' : 'var(--amber)' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ padding: '8px 10px', background: '#111', border: '1px solid #1a1a1a', textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{label}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color }}>{value}</div>
                  </div>
                ))}
              </div>
            )}

            {fiiFlows.length > 0 && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={fiiFlows} margin={{ top: 0, right: 0, left: -15, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke="#1a1a1a" />
                      <XAxis dataKey="date" tick={{ fill: '#555', fontSize: 8 }} tickFormatter={(d: string) => d?.slice(5) || d} />
                      <YAxis tick={{ fill: '#555', fontSize: 8 }} />
                      <Tooltip contentStyle={TT_STYLE} formatter={(v: any, n: string) => [fmtCr(v), n]} />
                      <ReferenceLine y={0} stroke="#333" />
                      <Bar dataKey="fii_net" name="FII Net">
                        {fiiFlows.map((f: any, i: number) => (
                          <Cell key={i} fill={(f.fii_net || 0) >= 0 ? 'rgba(0,200,83,0.7)' : 'rgba(255,61,0,0.7)'} />
                        ))}
                      </Bar>
                      <Bar dataKey="dii_net" name="DII Net">
                        {fiiFlows.map((f: any, i: number) => (
                          <Cell key={i} fill={(f.dii_net || 0) >= 0 ? 'rgba(79,195,247,0.7)' : 'rgba(255,149,0,0.7)'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                  <thead>
                    <tr>
                      {['Date', 'FII Buy', 'FII Sell', 'FII Net', 'DII Net'].map(h => (
                        <th key={h} style={{ textAlign: h === 'Date' ? 'left' : 'right', color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid #222', fontSize: 9 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...fiiFlows].reverse().slice(0, 15).map((f: any, i: number) => (
                      <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                        <td style={{ padding: '4px 8px', color: '#888' }}>{f.date}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--green)' }}>{fmtCr(f.fii_buy || 0)}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--red)' }}>{fmtCr(f.fii_sell || 0)}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, color: (f.fii_net || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {(f.fii_net || 0) >= 0 ? '+' : ''}{fmtCr(f.fii_net || 0)}
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, color: (f.dii_net || 0) >= 0 ? 'var(--cyan)' : 'var(--amber)' }}>
                          {(f.dii_net || 0) >= 0 ? '+' : ''}{fmtCr(f.dii_net || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {!fiiData && fiiFlows.length === 0 && (
              <div style={{ color: '#555', padding: 16, textAlign: 'center' }}>
                FII/DII data loading...
              </div>
            )}
          </div>
        )}

        {/* ── YIELD CURVE SNAPSHOT ─────────────────────────────────── */}
        {tab === 'yields' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
              {yieldTenors.map(t => {
                const y = yields[t];
                return (
                  <div key={t} style={{ padding: '10px', background: '#111', border: '1px solid #1a1a1a', textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{t}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--amber)', fontFamily: 'monospace' }}>
                      {y?.current != null ? `${y.current.toFixed(3)}%` : '—'}
                    </div>
                    {y?.['1w_change'] != null && (
                      <div style={{ fontSize: 9 }}>
                        <ChangeBadge value={y['1w_change']} unit="% 1W" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {yieldData?.spread_10y_3m != null && (
              <div style={{
                padding: '10px 16px', marginBottom: 16,
                background: yieldData.inverted ? 'rgba(255,61,0,0.06)' : 'rgba(0,200,83,0.04)',
                border: `1px solid ${yieldData.inverted ? 'rgba(255,61,0,0.2)' : 'rgba(0,200,83,0.2)'}`,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: yieldData.inverted ? 'var(--red)' : 'var(--green)' }}>
                  {yieldData.inversion_signal || (yieldData.inverted ? 'CURVE INVERTED' : 'NORMAL CURVE')}
                </div>
                <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
                  10Y−3M Spread: <b style={{ color: yieldData.spread_10y_3m < 0 ? 'var(--red)' : 'var(--green)' }}>
                    {yieldData.spread_10y_3m > 0 ? '+' : ''}{yieldData.spread_10y_3m.toFixed(3)}%
                  </b>
                  {' '}· {yieldData.inverted ? 'Recession probability elevated (12-18M lag historically).' : 'Healthy growth expectations.'}
                </div>
              </div>
            )}

            {/* 90D 10Y chart */}
            {yieldData?.history?.['US 10Y']?.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>US 10Y YIELD — 90 DAY</div>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={yieldData.history['US 10Y'].slice(-90)} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                    <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#555' }} tickFormatter={(v: string) => v?.substring(5)} interval={14} />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 8, fill: '#555' }} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip contentStyle={TT_STYLE} formatter={(v: any) => [`${Number(v).toFixed(3)}%`, '10Y Yield']} />
                    <Line type="monotone" dataKey="yield" stroke="#ff9500" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ── MARKET REGIMES ────────────────────────────────────────── */}
        {tab === 'regimes' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Current regime */}
            <div>
              <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 12 }}>MARKET REGIME FRAMEWORK</div>
              {[
                {
                  regime: 'RISK_ON',
                  color: 'var(--green)',
                  conditions: 'VIX < 18, FII net buying, strong breadth, bull>bear',
                  playbook: 'Overweight equities, cyclicals, small-caps. Reduce gold/bonds.',
                  indicators: ['Rising: equities, crude (mod.), EM currencies', 'Falling: gold, VIX, bonds'],
                },
                {
                  regime: 'NEUTRAL',
                  color: 'var(--amber)',
                  conditions: 'VIX 18–25, mixed FII flows, sideways breadth',
                  playbook: 'Balanced allocation. Stock-specific. Avoid leverage.',
                  indicators: ['Sideways markets, rotational moves', 'Wait for clearer signals'],
                },
                {
                  regime: 'RISK_OFF',
                  color: 'var(--red)',
                  conditions: 'VIX > 25, FII selling, defensive rotation, bear > bull',
                  playbook: 'Reduce equities. Shift to gold, defensives, T-bills.',
                  indicators: ['Rising: gold, bonds, USD, VIX', 'Falling: equities, crude, EM FX'],
                },
              ].map(r => (
                <div key={r.regime} style={{
                  padding: '10px 12px', marginBottom: 8,
                  background: '#0a0a0a', borderLeft: `3px solid ${r.color}`, borderBottom: '1px solid #111',
                }}>
                  <div style={{ color: r.color, fontWeight: 700, fontSize: 11, marginBottom: 4 }}>{r.regime}</div>
                  <div style={{ fontSize: 9, color: '#888', marginBottom: 4 }}><b style={{ color: '#aaa' }}>Trigger:</b> {r.conditions}</div>
                  <div style={{ fontSize: 9, color: '#888', marginBottom: 4 }}><b style={{ color: '#aaa' }}>Playbook:</b> {r.playbook}</div>
                  {r.indicators.map((s, i) => <div key={i} style={{ fontSize: 9, color: '#555' }}>• {s}</div>)}
                </div>
              ))}
            </div>

            {/* Sector rotation */}
            <div>
              <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 12 }}>SECTOR ROTATION MODEL</div>
              <div style={{ fontSize: 9, color: '#666', marginBottom: 10, lineHeight: 1.6 }}>
                Market cycles drive sector performance. Use this to position ahead of rotation.
              </div>
              {[
                { phase: 'EARLY EXPANSION', sectors: 'Financials, Consumer Discretionary, IT', color: 'var(--green)' },
                { phase: 'LATE EXPANSION',  sectors: 'Energy, Materials, Industrials',        color: 'var(--amber)' },
                { phase: 'CONTRACTION',     sectors: 'Healthcare, FMCG, Utilities',           color: 'var(--red)' },
                { phase: 'RECOVERY',        sectors: 'Real Estate, Consumer Staples, IT',     color: '#4fc3f7' },
              ].map(r => (
                <div key={r.phase} style={{ padding: '8px 10px', marginBottom: 6, background: '#0d0d0d', border: '1px solid #1a1a1a' }}>
                  <div style={{ fontSize: 9, color: r.color, fontWeight: 700, marginBottom: 3 }}>{r.phase}</div>
                  <div style={{ fontSize: 9, color: '#888' }}>{r.sectors}</div>
                </div>
              ))}

              <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, margin: '12px 0 8px' }}>RBI RATE CYCLE IMPACT</div>
              {[
                { action: 'RATE CUT', beneficiary: 'Real Estate, NBFCs, Auto, Consumer', hurt: 'Banks (NIM initially)', color: 'var(--green)' },
                { action: 'RATE HIKE', beneficiary: 'Banks (NIM expands), FDs attractive', hurt: 'Real Estate, NBFCs, High-Debt cos.', color: 'var(--red)' },
                { action: 'PAUSE', beneficiary: 'Broad market, quality growth', hurt: 'Rate-sensitive (uncertainty)', color: 'var(--amber)' },
              ].map(r => (
                <div key={r.action} style={{ padding: '8px 10px', marginBottom: 6, background: '#0d0d0d', border: `1px solid ${r.color}22` }}>
                  <div style={{ fontSize: 9, color: r.color, fontWeight: 700 }}>RBI {r.action}</div>
                  <div style={{ fontSize: 9, color: '#777' }}>✓ {r.beneficiary}</div>
                  <div style={{ fontSize: 9, color: '#555' }}>✗ {r.hurt}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MacroPanel;
