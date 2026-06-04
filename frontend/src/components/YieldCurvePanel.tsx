/**
 * Yield Curve Panel — US Treasury + India bond yield curve
 * Shows current curve, 1M/6M/1Y ago comparisons, inversion signal
 */

import React, { useState } from 'react';
import { useApiData } from '../hooks/useApi';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';

const TENORS = ['US 3M', 'US 5Y', 'US 10Y', 'US 30Y'];
const TENOR_LABELS: Record<string, string> = {
  'US 3M': '3M', 'US 5Y': '5Y', 'US 10Y': '10Y', 'US 30Y': '30Y',
};
const TENOR_ORDER = ['US 3M', 'US 5Y', 'US 10Y', 'US 30Y'];

type Tab = 'curve' | 'history' | 'analysis';

function fmt3(v?: number | null): string {
  if (v == null) return '—';
  return `${Number(v).toFixed(3)}%`;
}

function chgColor(v?: number | null): string {
  if (v == null) return 'var(--text-primary)';
  return v > 0 ? 'var(--red)' : v < 0 ? 'var(--green)' : 'var(--text-muted)';
}

export const YieldCurvePanel: React.FC = () => {
  const [tab, setTab] = useState<Tab>('curve');
  const [histTenor, setHistTenor] = useState('US 10Y');

  const { data, loading } = useApiData<any>('/api/yield-curve', 1800000);

  if (loading) return (
    <div className="panel h-full flex-center"><div className="spinner" /></div>
  );

  const yields = data?.yields || {};
  const history = data?.history || {};
  const inverted = data?.inverted;
  const spread = data?.spread_10y_3m;

  // Current curve data for chart
  const curveData = TENOR_ORDER
    .filter(t => yields[t])
    .map(t => ({
      tenor: TENOR_LABELS[t] || t,
      yield: yields[t]?.current,
    }));

  // Historical data for selected tenor
  const histData = (history[histTenor] || []).slice(-90);

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="panel-title">GCURVE — YIELD CURVE</span>
        {inverted !== undefined && (
          <span style={{
            marginLeft: 10, fontSize: 10, fontWeight: 700,
            color: inverted ? 'var(--red)' : 'var(--green)',
            border: `1px solid ${inverted ? 'rgba(255,61,0,0.3)' : 'rgba(0,200,83,0.3)'}`,
            padding: '1px 7px', background: inverted ? 'rgba(255,61,0,0.08)' : 'rgba(0,200,83,0.08)',
          }}>
            {inverted ? '⚠ CURVE INVERTED' : '✓ NORMAL CURVE'}
          </span>
        )}
        {spread != null && (
          <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-muted)' }}>
            10Y−3M Spread: <b style={{ color: spread < 0 ? 'var(--red)' : 'var(--green)' }}>{spread > 0 ? '+' : ''}{spread?.toFixed(3)}%</b>
          </span>
        )}
      </div>

      {/* Key yields strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${TENORS.length}, 1fr)`,
        background: '#111', borderBottom: '1px solid #222', flexShrink: 0,
      }}>
        {TENORS.map(t => {
          const y = yields[t];
          if (!y) return (
            <div key={t} style={{ padding: '6px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: '#444' }}>{t}</div>
              <div style={{ fontSize: 12, color: '#555' }}>—</div>
            </div>
          );
          return (
            <div key={t} style={{ padding: '6px 10px', textAlign: 'center', borderRight: '1px solid #1a1a1a' }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{t}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--amber)', fontFamily: 'monospace' }}>
                {y.current?.toFixed(3)}%
              </div>
              <div style={{ fontSize: 9, color: chgColor(y['1w_change']) }}>
                {y['1w_change'] >= 0 ? '+' : ''}{y['1w_change']?.toFixed(3)} 1W
              </div>
            </div>
          );
        })}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 1, background: 'var(--bg-secondary)', padding: '2px 4px', borderBottom: '1px solid #222', flexShrink: 0, alignItems: 'center' }}>
        {(['curve', 'history', 'analysis'] as Tab[]).map(t => (
          <button key={t} className={`nav-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
        {tab === 'history' && (
          <select
            value={histTenor}
            onChange={e => setHistTenor(e.target.value)}
            style={{
              marginLeft: 'auto', background: '#111', border: '1px solid #333',
              color: '#e8e8e0', padding: '2px 6px', fontSize: 10, borderRadius: 2,
            }}
          >
            {TENORS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </div>

      <div className="panel-body" style={{ flex: 1, overflowY: 'auto', padding: 10 }}>

        {/* CURRENT CURVE */}
        {tab === 'curve' && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>
              US Treasury Yield Curve — Current
            </div>
            {curveData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={curveData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                  <XAxis dataKey="tenor" tick={{ fontSize: 10, fill: '#888' }} />
                  <YAxis
                    domain={['auto', 'auto']}
                    tick={{ fontSize: 9, fill: '#666' }}
                    tickFormatter={v => `${v}%`}
                  />
                  <Tooltip
                    formatter={(v: any) => [`${Number(v).toFixed(3)}%`, 'Yield']}
                    contentStyle={{ background: '#141414', border: '1px solid #333', fontSize: 10 }}
                  />
                  {spread != null && spread < 0 && (
                    <ReferenceLine y={0} stroke="#ff3d00" strokeDasharray="4 2" label={{ value: 'INVERSION', fill: '#ff3d00', fontSize: 8 }} />
                  )}
                  <Line
                    type="monotone" dataKey="yield"
                    stroke="#ff9500" strokeWidth={2}
                    dot={{ fill: '#ff9500', r: 4 }}
                    activeDot={{ r: 6, fill: '#fff' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Yield curve data unavailable</div>
            )}

            {/* Table */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>YIELD DETAILS</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr>
                    {['Tenor', 'Current', '1W Chg', '1M Chg', '6M Chg', '1Y High', '1Y Low'].map(h => (
                      <th key={h} style={{ textAlign: h === 'Tenor' ? 'left' : 'right', color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid #222', fontSize: 9 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TENORS.filter(t => yields[t]).map(t => {
                    const y = yields[t];
                    return (
                      <tr key={t} style={{ borderBottom: '1px solid #111' }}>
                        <td style={{ padding: '5px 8px', color: 'var(--amber)', fontWeight: 700 }}>{t}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: '#e8e8e0', fontWeight: 700, fontFamily: 'monospace' }}>{fmt3(y.current)}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: chgColor(y['1w_change']) }}>{y['1w_change'] >= 0 ? '+' : ''}{fmt3(y['1w_change'])}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: chgColor(y['1m_change']) }}>{y['1m_change'] >= 0 ? '+' : ''}{fmt3(y['1m_change'])}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: chgColor(y['6m_change']) }}>{y['6m_change'] >= 0 ? '+' : ''}{fmt3(y['6m_change'])}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--red)' }}>{fmt3(y['1y_high'])}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--green)' }}>{fmt3(y['1y_low'])}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* HISTORY */}
        {tab === 'history' && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>
              {histTenor} — 90 Day Yield History
            </div>
            {histData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={histData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 8, fill: '#555' }}
                    tickFormatter={v => v?.substring(5)}
                    interval={14}
                  />
                  <YAxis
                    domain={['auto', 'auto']}
                    tick={{ fontSize: 9, fill: '#666' }}
                    tickFormatter={v => `${v}%`}
                  />
                  <Tooltip
                    formatter={(v: any) => [`${Number(v).toFixed(3)}%`, histTenor]}
                    contentStyle={{ background: '#141414', border: '1px solid #333', fontSize: 10 }}
                  />
                  <Line type="monotone" dataKey="yield" stroke="#4fc3f7" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No historical data for {histTenor}</div>
            )}
          </div>
        )}

        {/* ANALYSIS */}
        {tab === 'analysis' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>CURVE ANALYSIS</div>

              <div style={{
                padding: '12px 16px', marginBottom: 12,
                background: inverted ? 'rgba(255,61,0,0.08)' : 'rgba(0,200,83,0.06)',
                border: `1px solid ${inverted ? 'rgba(255,61,0,0.25)' : 'rgba(0,200,83,0.2)'}`,
              }}>
                <div style={{
                  color: inverted ? 'var(--red)' : 'var(--green)',
                  fontSize: 16, fontWeight: 900, marginBottom: 6,
                }}>
                  {data?.inversion_signal || 'NORMAL'}
                </div>
                <div style={{ color: '#aaa', fontSize: 10 }}>
                  10Y−3M Spread: <b style={{ color: spread < 0 ? 'var(--red)' : 'var(--green)' }}>
                    {spread != null ? `${spread > 0 ? '+' : ''}${spread.toFixed(3)}%` : '—'}
                  </b>
                </div>
                <div style={{ color: '#666', fontSize: 9, marginTop: 6, lineHeight: 1.5 }}>
                  {inverted
                    ? 'INVERTED: Short rates > long rates. Historical recession predictor (12-18M lag).'
                    : 'NORMAL: Long rates > short rates. Healthy growth/inflation expectations.'}
                </div>
              </div>

              <div style={{ fontSize: 10, color: '#4fc3f7', fontWeight: 700, marginBottom: 8 }}>INTERPRETATION</div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                <p style={{ marginBottom: 8 }}>
                  <b style={{ color: '#e8e8e0' }}>Rising yields</b> = bond prices fall, borrowing costs rise, equities (especially growth stocks) face valuation pressure.
                </p>
                <p style={{ marginBottom: 8 }}>
                  <b style={{ color: '#e8e8e0' }}>Steep curve</b> = banks profit (borrow short, lend long), economic expansion expected.
                </p>
                <p style={{ marginBottom: 8 }}>
                  <b style={{ color: '#e8e8e0' }}>Flat/Inverted curve</b> = recession risk elevated. Watch for credit spreads widening.
                </p>
                <p>
                  <b style={{ color: '#e8e8e0' }}>India impact</b>: US yield spikes → FII outflows → INR depreciation → RBI rate pressure.
                </p>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>SECTOR IMPACT (High US Yields)</div>
              {[
                { sector: 'IT / Tech Exporters', impact: 'MIXED', note: 'USD strength boosts revenue; valuation compression' },
                { sector: 'Pharma Exporters', impact: 'POSITIVE', note: 'USD revenue benefit; limited rate sensitivity' },
                { sector: 'Real Estate', impact: 'NEGATIVE', note: 'Higher borrowing costs; compressed cap rates' },
                { sector: 'NBFCs / Fin Services', impact: 'NEGATIVE', note: 'Funding cost pressure; NIM compression risk' },
                { sector: 'FMCG / Consumer', impact: 'NEUTRAL', note: 'Domestic demand driven; limited direct impact' },
                { sector: 'Metals / Commodities', impact: 'NEGATIVE', note: 'Dollar strength suppresses commodity prices' },
                { sector: 'Capital Goods', impact: 'NEUTRAL', note: 'Infrastructure cycle domestically driven' },
                { sector: 'Oil & Gas (OMCs)', impact: 'NEGATIVE', note: 'USD crude costs rise; subsidies pressure' },
              ].map((r, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 0', borderBottom: '1px solid #1a1a1a', fontSize: 10,
                }}>
                  <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{r.sector}</span>
                  <span style={{
                    fontSize: 8, padding: '1px 5px', fontWeight: 700,
                    color: r.impact === 'POSITIVE' ? 'var(--green)' : r.impact === 'NEGATIVE' ? 'var(--red)' : 'var(--amber)',
                    border: `1px solid ${r.impact === 'POSITIVE' ? 'rgba(0,200,83,0.3)' : r.impact === 'NEGATIVE' ? 'rgba(255,61,0,0.3)' : 'rgba(255,149,0,0.3)'}`,
                    background: r.impact === 'POSITIVE' ? 'rgba(0,200,83,0.08)' : r.impact === 'NEGATIVE' ? 'rgba(255,61,0,0.08)' : 'rgba(255,149,0,0.08)',
                    flexShrink: 0, whiteSpace: 'nowrap',
                  }}>{r.impact}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default YieldCurvePanel;
