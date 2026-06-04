/**
 * Market Breadth Panel — Bloomberg MMAP/BMAP equivalent
 * Shows advance/decline, new highs/lows, volume breadth, sector breadth.
 * Critical tool for understanding market internals beyond index level.
 */

import React, { useState } from 'react';
import { useApiData } from '../hooks/useApi';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, LineChart, Line, CartesianGrid, ReferenceLine, PieChart, Pie,
} from 'recharts';

interface Props {
  sentiment?: any;  // from WebSocket
  indices?: any[];
}

const TT = { background: '#141414', border: '1px solid #333', fontSize: 10 };

function BreadthBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 10 }}>
        <span style={{ color: '#aaa' }}>{label}</span>
        <span style={{ color, fontWeight: 700 }}>{value.toLocaleString('en-IN')}</span>
      </div>
      <div style={{ height: 4, background: '#1a1a1a', borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

type Tab = 'breadth' | 'sectors' | 'extremes' | 'internals';

export const MarketBreadthPanel: React.FC<Props> = ({ sentiment, indices }) => {
  const [tab, setTab] = useState<Tab>('breadth');
  const [period, setPeriod] = useState(10);

  const { data: breadthData, loading: breadthLoading } = useApiData<any>('/api/market-breadth', 60000);
  const { data: gainersLosers } = useApiData<any>('/api/gainers-losers', 60000);
  const { data: sectorData } = useApiData<any>('/api/sector-performance', 120000);

  // REST is primary (full 4500-symbol sweep); WS overlay is additive when available
  // REST updates every 60s; WS is realtime but may lag on first connect.
  const wsAdv = sentiment?.advance_decline?.advances;
  const wsDec = sentiment?.advance_decline?.declines;
  const advances = (wsAdv != null && wsAdv > 0 ? wsAdv : null) ?? breadthData?.advances ?? 0;
  const declines = (wsDec != null && wsDec > 0 ? wsDec : null) ?? breadthData?.declines ?? 0;
  const unchanged = breadthData?.unchanged ?? 0;
  const total = advances + declines + unchanged || 1;
  const dataSource = breadthData?.source || 'loading';
  const symbolsScanned = breadthData?.symbols_scanned || 0;

  const adRatio = declines > 0 ? (advances / declines).toFixed(2) : '∞';
  const bullPct = Math.round((advances / total) * 100);

  // India VIX from WebSocket
  const vix = sentiment?.india_vix;
  const regime = sentiment?.regime || 'NEUTRAL';
  const score = sentiment?.bull_bear_score || 0;

  // Gainers/Losers data
  const gainers = gainersLosers?.gainers || [];
  const losers = gainersLosers?.losers || [];
  const mostActive = gainersLosers?.most_active || [];

  // Pie chart for breadth
  const breadthPie = [
    { name: 'Advances', value: advances, fill: 'var(--green)' },
    { name: 'Declines', value: declines, fill: 'var(--red)' },
    { name: 'Unchanged', value: unchanged || Math.max(0, 2000 - advances - declines), fill: '#333' },
  ].filter(d => d.value > 0);

  // Sectors performance
  const sectors: any[] = sectorData?.sectors || [
    { name: 'NIFTY BANK', change_pct: 0 },
    { name: 'NIFTY IT', change_pct: 0 },
    { name: 'NIFTY PHARMA', change_pct: 0 },
    { name: 'NIFTY AUTO', change_pct: 0 },
    { name: 'NIFTY FMCG', change_pct: 0 },
    { name: 'NIFTY METAL', change_pct: 0 },
    { name: 'NIFTY REALTY', change_pct: 0 },
    { name: 'NIFTY ENERGY', change_pct: 0 },
  ].filter(s => s.change_pct !== 0);

  const sortedSectors = [...sectors].sort((a, b) => b.change_pct - a.change_pct);

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="panel-title">MARKET BREADTH — BMAP</span>
        {symbolsScanned > 0 && (
          <span style={{ fontSize: 9, color: '#555', marginLeft: 6 }}>
            {symbolsScanned.toLocaleString('en-IN')} symbols
          </span>
        )}
        <span style={{
          marginLeft: 10, fontSize: 10, fontWeight: 700,
          color: regime === 'RISK_ON' ? 'var(--green)' : regime === 'RISK_OFF' ? 'var(--red)' : 'var(--amber)',
          border: `1px solid ${regime === 'RISK_ON' ? 'rgba(0,200,83,0.3)' : regime === 'RISK_OFF' ? 'rgba(255,61,0,0.3)' : 'rgba(255,149,0,0.3)'}`,
          padding: '1px 7px',
          background: regime === 'RISK_ON' ? 'rgba(0,200,83,0.08)' : regime === 'RISK_OFF' ? 'rgba(255,61,0,0.08)' : 'rgba(255,149,0,0.08)',
        }}>
          {regime}
        </span>
      </div>

      {/* Key metrics strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)',
        background: '#111', borderBottom: '1px solid #222', flexShrink: 0,
      }}>
        {[
          { label: 'Advances', value: advances.toLocaleString('en-IN'), color: 'var(--green)' },
          { label: 'Declines', value: declines.toLocaleString('en-IN'), color: 'var(--red)' },
          { label: 'A/D Ratio', value: adRatio, color: Number(adRatio) > 1 ? 'var(--green)' : 'var(--red)' },
          { label: 'Bull %', value: `${bullPct}%`, color: bullPct > 55 ? 'var(--green)' : bullPct < 45 ? 'var(--red)' : 'var(--amber)' },
          { label: 'India VIX', value: vix ? vix.toFixed(2) : '—', color: vix > 25 ? 'var(--red)' : vix > 18 ? 'var(--amber)' : 'var(--green)' },
          { label: 'B/B Score', value: score ? (score * 100).toFixed(0) : '—', color: score > 0 ? 'var(--green)' : 'var(--red)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ padding: '6px 10px', textAlign: 'center', borderRight: '1px solid #1a1a1a' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 1, background: 'var(--bg-secondary)', padding: '2px 4px', borderBottom: '1px solid #222', flexShrink: 0 }}>
        {([
          { id: 'breadth', label: 'BREADTH' },
          { id: 'sectors', label: 'SECTORS' },
          { id: 'extremes', label: 'EXTREMES' },
          { id: 'internals', label: 'INTERNALS' },
        ] as { id: Tab; label: string }[]).map(t => (
          <button key={t.id} className={`nav-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="panel-body" style={{ flex: 1, overflowY: 'auto', padding: 10 }}>

        {/* ── MARKET BREADTH ────────────────────────────────────────── */}
        {tab === 'breadth' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Breadth Pie */}
            <div>
              <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>ADVANCE / DECLINE</div>
              {advances + declines > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={breadthPie} cx="50%" cy="50%"
                      innerRadius={50} outerRadius={80}
                      dataKey="value" nameKey="name"
                    >
                      {breadthPie.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={TT} />
                  </PieChart>
                </ResponsiveContainer>
              ) : breadthLoading ? (
                <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#555' }}>
                  <div className="spinner" style={{ width: 16, height: 16 }} />
                  Loading breadth…
                </div>
              ) : (
                <div style={{ height: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#555' }}>
                  <span style={{ fontSize: 24 }}>📊</span>
                  <span style={{ fontSize: 10 }}>Market sweep in progress</span>
                  <span style={{ fontSize: 9, color: '#333' }}>Will populate after first full sweep (~5 min)</span>
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                <BreadthBar label="Advances" value={advances} max={total} color="var(--green)" />
                <BreadthBar label="Declines" value={declines} max={total} color="var(--red)" />
                <BreadthBar label="Unchanged" value={unchanged} max={total} color="#555" />
              </div>
            </div>

            {/* Breadth signals */}
            <div>
              <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>BREADTH SIGNALS</div>

              {/* A/D signal */}
              <div style={{
                padding: '10px 12px', marginBottom: 10,
                background: Number(adRatio) > 1.5 ? 'rgba(0,200,83,0.06)' : Number(adRatio) < 0.7 ? 'rgba(255,61,0,0.06)' : 'rgba(255,149,0,0.06)',
                border: `1px solid ${Number(adRatio) > 1.5 ? 'rgba(0,200,83,0.2)' : Number(adRatio) < 0.7 ? 'rgba(255,61,0,0.2)' : 'rgba(255,149,0,0.2)'}`,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: Number(adRatio) > 1.5 ? 'var(--green)' : Number(adRatio) < 0.7 ? 'var(--red)' : 'var(--amber)' }}>
                  A/D Ratio: {adRatio}
                </div>
                <div style={{ fontSize: 9, color: '#888', marginTop: 4 }}>
                  {Number(adRatio) > 2 ? 'Very strong breadth — broad rally. Sustainable.' :
                   Number(adRatio) > 1 ? 'Positive breadth — more stocks rising.' :
                   Number(adRatio) < 0.5 ? 'Weak breadth — broad selling. Caution.' :
                   'Negative breadth — mixed market.'}
                </div>
              </div>

              {/* VIX reading */}
              {vix && (
                <div style={{
                  padding: '10px 12px', marginBottom: 10,
                  background: vix > 25 ? 'rgba(255,61,0,0.06)' : vix > 18 ? 'rgba(255,149,0,0.06)' : 'rgba(0,200,83,0.04)',
                  border: `1px solid ${vix > 25 ? 'rgba(255,61,0,0.2)' : vix > 18 ? 'rgba(255,149,0,0.2)' : 'rgba(0,200,83,0.15)'}`,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: vix > 25 ? 'var(--red)' : vix > 18 ? 'var(--amber)' : 'var(--green)' }}>
                    India VIX: {vix.toFixed(2)} — {vix > 25 ? 'EXTREME FEAR' : vix > 20 ? 'FEAR' : vix > 15 ? 'MODERATE' : 'COMPLACENCY'}
                  </div>
                  <div style={{ fontSize: 9, color: '#888', marginTop: 4 }}>
                    {vix > 25 ? 'Peak fear — contrarian buy opportunity near.' :
                     vix > 20 ? 'Elevated volatility. Reduce position sizing.' :
                     vix < 12 ? 'Historically low — market may be overextended.' :
                     'Normal volatility range. Standard risk.'}
                  </div>
                </div>
              )}

              {/* Breadth interpretation guide */}
              <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, margin: '12px 0 8px' }}>BREADTH INTERPRETATION</div>
              {[
                { label: 'A/D > 2.0', signal: 'STRONG BULL', detail: 'Broad participation. Rally sustainable.', color: 'var(--green)' },
                { label: 'A/D 1.0–2.0', signal: 'MILD BULL', detail: 'More advancing. Watch for narrowing.', color: '#69f0ae' },
                { label: 'A/D 0.5–1.0', signal: 'MIXED', detail: 'Index-level gains may not be broad.', color: 'var(--amber)' },
                { label: 'A/D < 0.5', signal: 'WEAK BEAR', detail: 'Broad selling. Defensive posture.', color: 'var(--red)' },
              ].map(r => (
                <div key={r.label} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #111' }}>
                  <span style={{ fontSize: 9, color: '#666', minWidth: 65 }}>{r.label}</span>
                  <span style={{ fontSize: 9, color: r.color, fontWeight: 700, minWidth: 80 }}>{r.signal}</span>
                  <span style={{ fontSize: 9, color: '#555', flex: 1 }}>{r.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── SECTOR BREADTH ────────────────────────────────────────── */}
        {tab === 'sectors' && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 12 }}>SECTOR PERFORMANCE (NSE INDICES)</div>

            {sortedSectors.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={sortedSectors}
                    layout="vertical"
                    margin={{ top: 0, right: 50, left: 80, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="2 4" stroke="#1a1a1a" />
                    <XAxis type="number" tick={{ fontSize: 8, fill: '#555' }} tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: '#888' }} />
                    <Tooltip
                      contentStyle={TT}
                      formatter={(v: any) => [`${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(2)}%`, 'Change']}
                    />
                    <ReferenceLine x={0} stroke="#333" />
                    <Bar dataKey="change_pct" name="Change %">
                      {sortedSectors.map((s: any, i: number) => (
                        <Cell key={i} fill={(s.change_pct || 0) >= 0 ? 'rgba(0,200,83,0.7)' : 'rgba(255,61,0,0.7)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>

                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, marginTop: 10 }}>
                  <thead>
                    <tr>
                      {['Sector', 'Value', 'Change', '%Chg', 'Signal'].map(h => (
                        <th key={h} style={{ textAlign: h === 'Sector' ? 'left' : 'right', color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid #222', fontSize: 9 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSectors.map((s: any, i: number) => (
                      <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                        <td style={{ padding: '4px 8px', color: 'var(--amber)', fontWeight: 700 }}>{s.name}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: '#e8e8e0' }}>{s.value?.toLocaleString('en-IN', { maximumFractionDigits: 0 }) || '—'}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: (s.change || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {(s.change || 0) >= 0 ? '+' : ''}{(s.change || 0).toFixed(2)}
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, color: (s.change_pct || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {(s.change_pct || 0) >= 0 ? '+' : ''}{(s.change_pct || 0).toFixed(2)}%
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                          <span style={{
                            fontSize: 8, padding: '1px 5px', fontWeight: 700,
                            color: s.change_pct > 1 ? 'var(--green)' : s.change_pct < -1 ? 'var(--red)' : 'var(--amber)',
                            border: `1px solid ${s.change_pct > 1 ? 'rgba(0,200,83,0.3)' : s.change_pct < -1 ? 'rgba(255,61,0,0.3)' : 'rgba(255,149,0,0.3)'}`,
                          }}>
                            {s.change_pct > 1 ? 'BULL' : s.change_pct < -1 ? 'BEAR' : 'FLAT'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <div style={{ color: '#555', textAlign: 'center', padding: 24 }}>
                Sector data loads from WebSocket. Check Sector Heatmap panel.
              </div>
            )}
          </div>
        )}

        {/* ── EXTREMES (Top Gainers/Losers) ────────────────────────── */}
        {tab === 'extremes' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Gainers */}
            <div>
              <div style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700, marginBottom: 8 }}>TOP 15 GAINERS</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr>
                    {['Symbol', 'LTP', 'Chg%'].map(h => (
                      <th key={h} style={{ textAlign: h === 'Symbol' ? 'left' : 'right', color: 'var(--text-muted)', padding: '3px 6px', borderBottom: '1px solid #222', fontSize: 9 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gainers.slice(0, 15).map((g: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                      <td style={{ padding: '3px 6px', color: 'var(--amber)', fontWeight: 700 }}>{g.symbol}</td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', color: '#e8e8e0' }}>{(g.ltp || g.price || 0).toFixed(2)}</td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--green)', fontWeight: 700 }}>
                        +{(g.change_pct || g.pChange || 0).toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Losers */}
            <div>
              <div style={{ fontSize: 10, color: 'var(--red)', fontWeight: 700, marginBottom: 8 }}>TOP 15 LOSERS</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr>
                    {['Symbol', 'LTP', 'Chg%'].map(h => (
                      <th key={h} style={{ textAlign: h === 'Symbol' ? 'left' : 'right', color: 'var(--text-muted)', padding: '3px 6px', borderBottom: '1px solid #222', fontSize: 9 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {losers.slice(0, 15).map((g: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                      <td style={{ padding: '3px 6px', color: 'var(--amber)', fontWeight: 700 }}>{g.symbol}</td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', color: '#e8e8e0' }}>{(g.ltp || g.price || 0).toFixed(2)}</td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--red)', fontWeight: 700 }}>
                        {(g.change_pct || g.pChange || 0).toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── MARKET INTERNALS ─────────────────────────────────────── */}
        {tab === 'internals' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 12 }}>MARKET INTERNAL SIGNALS</div>
              {[
                {
                  name: 'Advance/Decline Line',
                  signal: Number(adRatio) > 1 ? 'BULLISH' : 'BEARISH',
                  detail: `${advances.toLocaleString('en-IN')} advances vs ${declines.toLocaleString('en-IN')} declines`,
                  color: Number(adRatio) > 1 ? 'var(--green)' : 'var(--red)',
                },
                {
                  name: 'India VIX Regime',
                  signal: !vix ? '—' : vix > 25 ? 'EXTREME FEAR' : vix > 20 ? 'FEAR' : vix < 12 ? 'GREED' : 'NEUTRAL',
                  detail: !vix ? 'Loading...' : `India VIX: ${vix.toFixed(2)}. ${vix > 20 ? 'Reduce risk.' : vix < 12 ? 'Market complacent.' : 'Normal range.'}`,
                  color: !vix ? '#555' : vix > 20 ? 'var(--red)' : vix < 12 ? 'var(--amber)' : 'var(--green)',
                },
                {
                  name: 'Market Regime',
                  signal: regime,
                  detail: regime === 'RISK_ON' ? 'Strong bull signal — overweight equities' : regime === 'RISK_OFF' ? 'Defensive — reduce risk' : 'Mixed signals — selective',
                  color: regime === 'RISK_ON' ? 'var(--green)' : regime === 'RISK_OFF' ? 'var(--red)' : 'var(--amber)',
                },
                {
                  name: 'Bull/Bear Score',
                  signal: score > 0.3 ? 'STRONG BULL' : score > 0 ? 'MILD BULL' : score < -0.3 ? 'STRONG BEAR' : 'MILD BEAR',
                  detail: `Score: ${(score * 100).toFixed(0)}/100 | ${score > 0 ? 'Bullish bias' : 'Bearish bias'}`,
                  color: score > 0.2 ? 'var(--green)' : score < -0.2 ? 'var(--red)' : 'var(--amber)',
                },
              ].map(r => (
                <div key={r.name} style={{ padding: '10px 12px', marginBottom: 8, background: '#0d0d0d', border: '1px solid #1a1a1a' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: '#888' }}>{r.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: r.color }}>{r.signal}</span>
                  </div>
                  <div style={{ fontSize: 9, color: '#555' }}>{r.detail}</div>
                </div>
              ))}
            </div>

            <div>
              <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 12 }}>SMART MONEY INDICATORS</div>
              <div style={{ fontSize: 9, color: '#888', marginBottom: 12, lineHeight: 1.7 }}>
                These internal indicators help confirm or diverge from price action, giving early warning signals.
              </div>
              {[
                { label: 'New 52W Highs', value: breadthData?.highs_52w || 'N/A', color: 'var(--green)' },
                { label: 'New 52W Lows', value: breadthData?.lows_52w || 'N/A', color: 'var(--red)' },
                { label: 'Stocks > 200DMA', value: breadthData?.above_200dma || 'N/A', color: 'var(--amber)' },
                { label: 'Stocks > 50DMA', value: breadthData?.above_50dma || 'N/A', color: '#4fc3f7' },
                { label: 'Put/Call Ratio (PCR)', value: breadthData?.pcr || 'N/A', color: 'var(--text-primary)' },
                { label: 'Market Cap (NSE)', value: breadthData?.market_cap_cr ? `₹${breadthData.market_cap_cr.toFixed(0)}Cr` : 'N/A', color: '#a78bfa' },
              ].map(r => (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #111' }}>
                  <span style={{ fontSize: 10, color: '#888' }}>{r.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: r.color }}>{r.value}</span>
                </div>
              ))}

              <div style={{ marginTop: 16, padding: '10px 12px', background: 'rgba(79,195,247,0.05)', border: '1px solid rgba(79,195,247,0.15)' }}>
                <div style={{ fontSize: 10, color: '#4fc3f7', fontWeight: 700, marginBottom: 4 }}>PCR INTERPRETATION</div>
                <div style={{ fontSize: 9, color: '#777', lineHeight: 1.6 }}>
                  PCR {'>'} 1.3: Extreme put buying = fear/bearish sentiment.<br />
                  PCR 0.7–1.2: Balanced/neutral positioning.<br />
                  PCR {'<'} 0.7: Aggressive call buying = overconfidence/greed.<br />
                  <b style={{ color: '#aaa' }}>Contrarian signal:</b> extreme PCR often marks turning points.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MarketBreadthPanel;
