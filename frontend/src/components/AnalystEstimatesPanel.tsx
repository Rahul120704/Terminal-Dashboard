/**
 * Analyst Estimates Panel — Bloomberg BEST/EE equivalent
 * Shows analyst consensus EPS/revenue estimates, target price distribution,
 * recommendation breakdown, and estimate revision trends.
 */

import React, { useState } from 'react';
import { useApiData } from '../hooks/useApi';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, Legend, LineChart, Line, CartesianGrid,
} from 'recharts';

interface Props { symbol: string; }

function fmt(v?: number | null, d = 2): string {
  if (v == null) return '—';
  return v.toFixed(d);
}
function fmtCr(v?: number | null): string {
  if (v == null) return '—';
  if (Math.abs(v) >= 1e12) return `₹${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9)  return `₹${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e7)  return `₹${(v / 1e7).toFixed(1)}Cr`;
  return `₹${v.toFixed(0)}`;
}

const TT = { background: '#141414', border: '1px solid #333', fontSize: 10 };
const RECO_COLORS: Record<string, string> = {
  strongBuy: '#00c853', buy: '#69f0ae', hold: '#ffd740', sell: '#ff6e40', strongSell: '#d50000',
};

type Tab = 'consensus' | 'estimates' | 'target' | 'revisions';

export const AnalystEstimatesPanel: React.FC<Props> = ({ symbol }) => {
  const [tab, setTab] = useState<Tab>('consensus');
  const { data, loading } = useApiData<any>(`/api/analyst-estimates/${symbol}`, 1800000);

  if (loading) return (
    <div className="panel h-full flex-center"><div className="spinner" /></div>
  );

  const info = data?.info || {};
  const reco = data?.recommendations || {};
  const eps  = data?.eps_estimates || [];
  const rev  = data?.revenue_estimates || [];
  const quarterly = data?.quarterly_earnings || [];
  const history = data?.history || [];

  // Recommendation breakdown pie data
  const pieSections = [
    { name: 'Strong Buy', key: 'strongBuy',  value: reco.strongBuy  || 0, fill: RECO_COLORS.strongBuy },
    { name: 'Buy',        key: 'buy',         value: reco.buy        || 0, fill: RECO_COLORS.buy },
    { name: 'Hold',       key: 'hold',        value: reco.hold       || 0, fill: RECO_COLORS.hold },
    { name: 'Sell',       key: 'sell',        value: reco.sell       || 0, fill: RECO_COLORS.sell },
    { name: 'Strong Sell',key: 'strongSell',  value: reco.strongSell || 0, fill: RECO_COLORS.strongSell },
  ].filter(s => s.value > 0);

  const totalAnalysts = pieSections.reduce((s, p) => s + p.value, 0);

  // Upside/downside calculation
  const currentPrice = info.current_price;
  const targetMean   = info.target_mean_price;
  const upside       = currentPrice && targetMean ? ((targetMean - currentPrice) / currentPrice) * 100 : null;

  const recoLabel: Record<string, string> = {
    strongbuy: 'STRONG BUY', buy: 'BUY', hold: 'HOLD', sell: 'SELL', strongsell: 'STRONG SELL',
  };
  const recoColor: Record<string, string> = {
    strongbuy: 'var(--green)', buy: '#69f0ae', hold: 'var(--amber)', sell: '#ff6e40', strongsell: 'var(--red)',
  };
  const consensusKey = (info.recommendation || '').toLowerCase().replace(' ', '');
  const consensusColor = recoColor[consensusKey] || 'var(--text-primary)';
  const consensusLabel = recoLabel[consensusKey] || (info.recommendation || '').toUpperCase();

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="panel-title">ANALYST ESTIMATES — {symbol}</span>
        <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-muted)' }}>
          Bloomberg BEST
        </span>
        {consensusLabel && (
          <span style={{
            marginLeft: 10, fontSize: 10, fontWeight: 700, color: consensusColor,
            border: `1px solid ${consensusColor}44`, padding: '1px 8px', background: `${consensusColor}11`,
          }}>
            {consensusLabel}
          </span>
        )}
      </div>

      {/* Summary strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
        background: '#111', borderBottom: '1px solid #222', flexShrink: 0,
      }}>
        {[
          { label: 'Target (Mean)', value: targetMean ? `₹${targetMean.toFixed(0)}` : '—', color: 'var(--amber)' },
          { label: 'Target (High)', value: info.target_high_price ? `₹${info.target_high_price.toFixed(0)}` : '—', color: 'var(--green)' },
          { label: 'Target (Low)',  value: info.target_low_price  ? `₹${info.target_low_price.toFixed(0)}`  : '—', color: 'var(--red)' },
          { label: 'Upside/Down',  value: upside != null ? `${upside > 0 ? '+' : ''}${upside.toFixed(1)}%` : '—', color: upside != null ? (upside > 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)' },
          { label: '# Analysts',   value: totalAnalysts || info.number_of_analyst_opinions || '—', color: 'var(--text-primary)' },
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
          { id: 'consensus', label: 'CONSENSUS' },
          { id: 'estimates', label: 'ESTIMATES' },
          { id: 'target',    label: 'PRICE TARGET' },
          { id: 'revisions', label: 'HISTORY' },
        ] as { id: Tab; label: string }[]).map(t => (
          <button key={t.id} className={`nav-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="panel-body" style={{ flex: 1, overflowY: 'auto', padding: 10 }}>

        {/* ── CONSENSUS TAB ─────────────────────────────────────────── */}
        {tab === 'consensus' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Recommendation Pie */}
            <div>
              <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>ANALYST RATING DISTRIBUTION</div>
              {pieSections.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieSections} cx="50%" cy="50%" outerRadius={80}
                      dataKey="value" nameKey="name" label={({ name, value }) => `${name}: ${value}`}
                      labelLine={{ stroke: '#555', strokeWidth: 1 }}
                    >
                      {pieSections.map((s, i) => (
                        <Cell key={i} fill={s.fill} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TT} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ color: '#555', padding: 20, textAlign: 'center' }}>No analyst ratings available</div>
              )}
              {/* Breakdown */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {pieSections.map(s => (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: s.fill, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 10, color: '#aaa' }}>{s.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: s.fill }}>{s.value}</span>
                    <span style={{ fontSize: 9, color: '#555' }}>({totalAnalysts > 0 ? Math.round((s.value / totalAnalysts) * 100) : 0}%)</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Key metrics */}
            <div>
              <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>KEY ANALYST METRICS</div>
              {[
                { label: 'Consensus Rating', value: consensusLabel, color: consensusColor },
                { label: 'Current Price', value: currentPrice ? `₹${currentPrice.toFixed(2)}` : '—', color: 'var(--text-primary)' },
                { label: 'Mean Price Target', value: targetMean ? `₹${targetMean.toFixed(2)}` : '—', color: 'var(--amber)' },
                { label: 'Upside Potential', value: upside != null ? `${upside > 0 ? '+' : ''}${upside.toFixed(2)}%` : '—', color: upside != null ? (upside > 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)' },
                { label: 'Target Range', value: info.target_low_price && info.target_high_price ? `₹${info.target_low_price.toFixed(0)} – ₹${info.target_high_price.toFixed(0)}` : '—', color: 'var(--text-secondary)' },
                { label: 'Total Analysts', value: totalAnalysts || info.number_of_analyst_opinions || '—', color: 'var(--text-primary)' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #111' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color }}>{value}</span>
                </div>
              ))}

              {/* Upside bar */}
              {upside != null && (
                <div style={{ marginTop: 16, padding: '10px 12px', background: upside > 0 ? 'rgba(0,200,83,0.06)' : 'rgba(255,61,0,0.06)', border: `1px solid ${upside > 0 ? 'rgba(0,200,83,0.2)' : 'rgba(255,61,0,0.2)'}` }}>
                  <div style={{ fontSize: 10, color: upside > 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700, marginBottom: 4 }}>
                    {upside > 20 ? '🟢 SIGNIFICANT UPSIDE' : upside > 0 ? '🟡 MODERATE UPSIDE' : upside > -10 ? '🟡 SLIGHT DOWNSIDE' : '🔴 SIGNIFICANT DOWNSIDE'}
                  </div>
                  <div style={{ fontSize: 9, color: '#888' }}>
                    Analysts see {Math.abs(upside).toFixed(1)}% {upside > 0 ? 'upside' : 'downside'} from ₹{currentPrice?.toFixed(0)} to consensus target ₹{targetMean?.toFixed(0)}.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── ESTIMATES TAB ─────────────────────────────────────────── */}
        {tab === 'estimates' && (
          <div>
            {/* EPS Estimates */}
            {eps.length > 0 && (
              <>
                <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>EPS ESTIMATES</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, marginBottom: 16 }}>
                  <thead>
                    <tr>
                      {['Period', 'Avg Est.', 'Low', 'High', '# Analysts', 'Growth'].map(h => (
                        <th key={h} style={{ textAlign: h === 'Period' ? 'left' : 'right', color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid #222', fontSize: 9 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {eps.map((e: any, i: number) => (
                      <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                        <td style={{ padding: '5px 8px', color: 'var(--cyan)', fontWeight: 700 }}>{e.period}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: '#e8e8e0', fontWeight: 700 }}>{fmt(e.avg)}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--red)' }}>{fmt(e.low)}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--green)' }}>{fmt(e.high)}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: '#888' }}>{e.count || '—'}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: e.growth != null ? (e.growth > 0 ? 'var(--green)' : 'var(--red)') : '#555' }}>
                          {e.growth != null ? `${e.growth > 0 ? '+' : ''}${e.growth.toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {/* Revenue Estimates */}
            {rev.length > 0 && (
              <>
                <div style={{ fontSize: 10, color: '#4fc3f7', fontWeight: 700, marginBottom: 8 }}>REVENUE ESTIMATES</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, marginBottom: 16 }}>
                  <thead>
                    <tr>
                      {['Period', 'Avg Est.', 'Low', 'High', '# Analysts', 'Growth'].map(h => (
                        <th key={h} style={{ textAlign: h === 'Period' ? 'left' : 'right', color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid #222', fontSize: 9 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rev.map((e: any, i: number) => (
                      <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                        <td style={{ padding: '5px 8px', color: 'var(--cyan)', fontWeight: 700 }}>{e.period}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: '#e8e8e0', fontWeight: 700 }}>{fmtCr(e.avg)}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--red)' }}>{fmtCr(e.low)}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--green)' }}>{fmtCr(e.high)}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: '#888' }}>{e.count || '—'}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: e.growth != null ? (e.growth > 0 ? 'var(--green)' : 'var(--red)') : '#555' }}>
                          {e.growth != null ? `${e.growth > 0 ? '+' : ''}${e.growth.toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {/* Quarterly EPS actuals */}
            {quarterly.length > 0 && (
              <>
                <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>QUARTERLY EPS — ACTUALS vs ESTIMATES</div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={quarterly} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="#1a1a1a" />
                    <XAxis dataKey="quarter" tick={{ fontSize: 8, fill: '#555' }} />
                    <YAxis tick={{ fontSize: 8, fill: '#555' }} />
                    <Tooltip contentStyle={TT} />
                    <Bar dataKey="estimate" name="Est." fill="rgba(255,149,0,0.4)" />
                    <Bar dataKey="actual" name="Actual">
                      {quarterly.map((q: any, i: number) => (
                        <Cell key={i} fill={(q.actual || 0) >= (q.estimate || 0) ? 'rgba(0,200,83,0.8)' : 'rgba(255,61,0,0.8)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, marginTop: 8 }}>
                  <thead>
                    <tr>
                      {['Quarter', 'Estimate', 'Actual', 'Surprise', 'Surprise %'].map(h => (
                        <th key={h} style={{ textAlign: h === 'Quarter' ? 'left' : 'right', color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid #222', fontSize: 9 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {quarterly.map((q: any, i: number) => {
                      const surprise = q.actual != null && q.estimate != null ? q.actual - q.estimate : null;
                      const surprisePct = surprise != null && q.estimate ? (surprise / Math.abs(q.estimate)) * 100 : null;
                      const isPositive = surprise != null && surprise >= 0;
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                          <td style={{ padding: '5px 8px', color: '#888' }}>{q.quarter}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: '#aaa' }}>{fmt(q.estimate)}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700, color: '#e8e8e0' }}>{fmt(q.actual)}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: isPositive ? 'var(--green)' : 'var(--red)' }}>
                            {surprise != null ? `${isPositive ? '+' : ''}${surprise.toFixed(2)}` : '—'}
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700, color: isPositive ? 'var(--green)' : 'var(--red)' }}>
                            {surprisePct != null ? `${isPositive ? '+' : ''}${surprisePct.toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}

            {eps.length === 0 && rev.length === 0 && quarterly.length === 0 && (
              <div style={{ color: '#555', textAlign: 'center', padding: 24 }}>
                No analyst estimates available for {symbol}
              </div>
            )}
          </div>
        )}

        {/* ── PRICE TARGET ─────────────────────────────────────────── */}
        {tab === 'target' && (
          <div>
            {/* Target range visualization */}
            {currentPrice && targetMean && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 12 }}>ANALYST PRICE TARGET RANGE</div>
                <div style={{ position: 'relative', height: 60, background: '#0d0d0d', border: '1px solid #222', borderRadius: 4, marginBottom: 12 }}>
                  {(() => {
                    const lo = info.target_low_price || currentPrice * 0.8;
                    const hi = info.target_high_price || currentPrice * 1.3;
                    const range = hi - lo;
                    const currentPct = Math.max(0, Math.min(100, ((currentPrice - lo) / range) * 100));
                    const meanPct = Math.max(0, Math.min(100, ((targetMean - lo) / range) * 100));
                    return (
                      <>
                        {/* Green fill from low to high */}
                        <div style={{ position: 'absolute', left: '5%', right: '5%', top: '40%', height: 4, background: 'rgba(0,200,83,0.2)', borderRadius: 2 }} />
                        {/* Current price marker */}
                        <div style={{ position: 'absolute', left: `${5 + currentPct * 0.9}%`, top: '20%', bottom: '20%', width: 2, background: 'var(--amber)' }}>
                          <div style={{ position: 'absolute', bottom: '-16px', left: '-20px', fontSize: 8, color: 'var(--amber)', whiteSpace: 'nowrap' }}>
                            CMP ₹{currentPrice.toFixed(0)}
                          </div>
                        </div>
                        {/* Target mean marker */}
                        <div style={{ position: 'absolute', left: `${5 + meanPct * 0.9}%`, top: '15%', bottom: '15%', width: 2, background: 'var(--green)' }}>
                          <div style={{ position: 'absolute', bottom: '-16px', left: '-20px', fontSize: 8, color: 'var(--green)', whiteSpace: 'nowrap' }}>
                            PT ₹{targetMean.toFixed(0)}
                          </div>
                        </div>
                        {/* Low label */}
                        <div style={{ position: 'absolute', left: '3%', top: '8px', fontSize: 8, color: 'var(--red)' }}>
                          ₹{lo.toFixed(0)}
                        </div>
                        {/* High label */}
                        <div style={{ position: 'absolute', right: '3%', top: '8px', fontSize: 8, color: 'var(--green)' }}>
                          ₹{hi.toFixed(0)}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Target history */}
            {history.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>PRICE TARGET HISTORY</div>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={history} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="#1a1a1a" />
                    <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#555' }} tickFormatter={(d: string) => d?.substring(5)} />
                    <YAxis tick={{ fontSize: 8, fill: '#555' }} tickFormatter={(v: number) => `₹${v.toFixed(0)}`} />
                    <Tooltip contentStyle={TT} formatter={(v: any) => [`₹${Number(v).toFixed(2)}`, '']} />
                    <Line type="monotone" dataKey="to_grade_target" stroke="#ff9500" strokeWidth={2} dot={{ r: 3, fill: '#ff9500' }} name="Target" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Recent upgrades/downgrades */}
            {history.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>RECENT UPGRADES / DOWNGRADES</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                  <thead>
                    <tr>
                      {['Date', 'Firm', 'From', 'To', 'Action', 'Price Target'].map(h => (
                        <th key={h} style={{ textAlign: h === 'Date' || h === 'Firm' ? 'left' : 'right', color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid #222', fontSize: 9 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.slice(0, 20).map((h: any, i: number) => {
                      const action = (h.action || '').toLowerCase();
                      const actionColor = action.includes('upgrade') ? 'var(--green)' : action.includes('downgrade') ? 'var(--red)' : 'var(--amber)';
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                          <td style={{ padding: '4px 8px', color: '#888' }}>{h.date?.substring(0, 10)}</td>
                          <td style={{ padding: '4px 8px', color: '#aaa', maxWidth: 120 }}>{h.firm}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', color: '#666' }}>{h.from_grade}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--amber)', fontWeight: 700 }}>{h.to_grade}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', color: actionColor, fontWeight: 700 }}>{h.action}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--amber)' }}>
                            {h.to_grade_target ? `₹${h.to_grade_target.toFixed(0)}` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── REVISIONS HISTORY ─────────────────────────────────────── */}
        {tab === 'revisions' && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>QUARTERLY EARNINGS HISTORY</div>
            {quarterly.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={quarterly} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="#1a1a1a" />
                    <XAxis dataKey="quarter" tick={{ fontSize: 8, fill: '#555' }} />
                    <YAxis tick={{ fontSize: 8, fill: '#555' }} />
                    <Tooltip contentStyle={TT} />
                    <Bar dataKey="actual" name="EPS Actual">
                      {quarterly.map((q: any, i: number) => (
                        <Cell key={i} fill={(q.actual || 0) > 0 ? 'rgba(0,200,83,0.7)' : 'rgba(255,61,0,0.7)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ fontSize: 10, color: '#4fc3f7', fontWeight: 700, margin: '16px 0 8px' }}>BEAT/MISS ANALYSIS</div>
                <div style={{ display: 'flex', gap: 16, fontSize: 9, color: '#888', marginBottom: 12 }}>
                  {(() => {
                    const beats = quarterly.filter((q: any) => q.actual != null && q.estimate != null && q.actual >= q.estimate).length;
                    const misses = quarterly.filter((q: any) => q.actual != null && q.estimate != null && q.actual < q.estimate).length;
                    return (
                      <>
                        <div>
                          <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 13 }}>{beats}</span>
                          <span style={{ color: '#555' }}> Beat</span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--red)', fontWeight: 700, fontSize: 13 }}>{misses}</span>
                          <span style={{ color: '#555' }}> Miss</span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 13 }}>
                            {quarterly.length > 0 ? Math.round((beats / quarterly.length) * 100) : 0}%
                          </span>
                          <span style={{ color: '#555' }}> Beat Rate</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </>
            ) : (
              <div style={{ color: '#555', textAlign: 'center', padding: 24 }}>No quarterly history available</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalystEstimatesPanel;
