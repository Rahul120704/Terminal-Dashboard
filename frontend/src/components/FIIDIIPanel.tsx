/**
 * FII/DII Flows Panel — Foreign & Domestic institutional flows
 * Shows daily flows, cumulative, and trend analysis
 */

import React, { useState } from 'react';
import { useApiData } from '../hooks/useApi';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, ReferenceLine, Legend, ComposedChart, Area,
} from 'recharts';

const CHART_TOOLTIP = { background: '#141414', border: '1px solid #333', fontSize: 10 };

function fmtCr(v?: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(0)}L Cr`;
  if (abs >= 100) return `₹${v.toFixed(0)} Cr`;
  return `₹${v.toFixed(2)} Cr`;
}

type Tab = 'daily' | 'cumulative' | 'sectors' | 'summary';

export const FIIDIIPanel: React.FC = () => {
  const [tab, setTab] = useState<Tab>('daily');
  const [days, setDays] = useState(60);
  const [sectorWeeks, setSectorWeeks] = useState(4);
  // Refresh every 60s (was 300s) — FII/DII updates throughout trading day
  const { data, loading, refetch } = useApiData<any>(`/api/fii-dii-enhanced?days=${days}`, 60_000, 60_000);
  // Sector flows: prefetch immediately (not on-tab-click) and refresh every 5 min (was 1 hour)
  const { data: sectorData } = useApiData<any>(
    `/api/fii-dii/sector-flows?weeks=${sectorWeeks}`,
    300_000,
    300_000,
  );

  const flows: any[] = data?.data || [];
  const summary = data?.summary || {};
  const noData = !loading && flows.length === 0;

  // Last 30 days for chart
  const chartData = flows.slice(-30).map(d => ({
    date: d.date?.substring(5), // MM-DD
    FII: d.fii_net != null ? parseFloat(d.fii_net).toFixed(0) : 0,
    DII: d.dii_net != null ? parseFloat(d.dii_net).toFixed(0) : 0,
    FIICum: d.fii_cumulative,
    DIICum: d.dii_cumulative,
  }));

  const netSentiment = summary.net_sentiment;
  const sentColor = netSentiment === 'BUYING' ? 'var(--green)' : 'var(--red)';

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="panel-title">FII/DII — INSTITUTIONAL FLOWS</span>
        {loading && <span className="spinner" style={{ marginLeft: 8 }} />}
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
          {[30, 60, 90].map(d => (
            <button key={d} className={`nav-tab${days === d ? ' active' : ''}`} onClick={() => setDays(d)} style={{ padding: '1px 6px', fontSize: 9 }}>
              {d}D
            </button>
          ))}
        </div>
      </div>

      {/* Summary strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1,
        background: '#111', borderBottom: '1px solid #222', flexShrink: 0,
      }}>
        {[
          { label: 'FII 20D', value: fmtCr(summary.fii_20d_total), color: summary.fii_20d_total >= 0 ? 'var(--green)' : 'var(--red)' },
          { label: 'DII 20D', value: fmtCr(summary.dii_20d_total), color: summary.dii_20d_total >= 0 ? 'var(--green)' : 'var(--red)' },
          { label: 'FII Cumulative', value: fmtCr(summary.fii_cumulative), color: summary.fii_cumulative >= 0 ? 'var(--green)' : 'var(--red)' },
          { label: 'DII Cumulative', value: fmtCr(summary.dii_cumulative), color: 'var(--green)' },
          { label: 'FII Buy Days', value: `${summary.fii_buy_days_20d}/${summary.fii_buy_days_20d + summary.fii_sell_days_20d}`, color: 'var(--amber)' },
          { label: 'Sentiment', value: netSentiment || '—', color: sentColor },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ padding: '5px 8px', background: 'var(--bg-secondary)', textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{label}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 1, background: 'var(--bg-secondary)', padding: '2px 4px', borderBottom: '1px solid #222', flexShrink: 0 }}>
        {(['daily', 'cumulative', 'sectors', 'summary'] as Tab[]).map(t => (
          <button key={t} className={`nav-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t === 'sectors' ? '🏭 SECTORS' : t.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="panel-body" style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {tab === 'daily' && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>
              Daily Net FII/DII Flows (₹ Crores) — Last 30 Trading Days
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#555' }} />
                <YAxis tick={{ fontSize: 8, fill: '#555' }} />
                <Tooltip
                  formatter={(val: any, name: string) => [`₹${Number(val).toLocaleString('en-IN')} Cr`, name]}
                  contentStyle={CHART_TOOLTIP}
                />
                <ReferenceLine y={0} stroke="#444" />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="FII" fill="#4fc3f7" name="FII Net"
                  label={false}
                  radius={[2, 2, 0, 0]}
                />
                <Bar dataKey="DII" fill="#a78bfa" name="DII Net"
                  label={false}
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>

            {/* Table */}
            <div style={{ marginTop: 12, fontSize: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Date', 'FII Buy', 'FII Sell', 'FII Net', 'DII Buy', 'DII Sell', 'DII Net'].map(h => (
                      <th key={h} style={{ textAlign: 'right', color: 'var(--text-muted)', padding: '3px 6px', borderBottom: '1px solid #222', fontWeight: 600, fontSize: 9 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {flows.slice(-15).reverse().map((r: any, i: number) => {
                    const fiiNet = parseFloat(r.fii_net) || 0;
                    const diiNet = parseFloat(r.dii_net) || 0;
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                        <td style={{ padding: '3px 6px', color: '#aaa' }}>{r.date}</td>
                        <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--green)' }}>{r.fii_buy ? parseFloat(r.fii_buy).toFixed(0) : '—'}</td>
                        <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--red)' }}>{r.fii_sell ? parseFloat(r.fii_sell).toFixed(0) : '—'}</td>
                        <td style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 700, color: fiiNet >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {fiiNet >= 0 ? '+' : ''}{fiiNet.toFixed(0)}
                        </td>
                        <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--green)' }}>{r.dii_buy ? parseFloat(r.dii_buy).toFixed(0) : '—'}</td>
                        <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--red)' }}>{r.dii_sell ? parseFloat(r.dii_sell).toFixed(0) : '—'}</td>
                        <td style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 700, color: diiNet >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {diiNet >= 0 ? '+' : ''}{diiNet.toFixed(0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'cumulative' && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>
              Cumulative FII/DII Net Flows — ₹ Crores
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#555' }} />
                <YAxis tick={{ fontSize: 8, fill: '#555' }} />
                <Tooltip
                  formatter={(val: any, name: string) => [`₹${Number(val).toLocaleString('en-IN')} Cr`, name]}
                  contentStyle={CHART_TOOLTIP}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <ReferenceLine y={0} stroke="#444" />
                <Area type="monotone" dataKey="FIICum" fill="#4fc3f788" stroke="#4fc3f7" strokeWidth={2} name="FII Cumulative" dot={false} />
                <Area type="monotone" dataKey="DIICum" fill="#a78bfa88" stroke="#a78bfa" strokeWidth={2} name="DII Cumulative" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── SECTOR FLOWS ───────────────────────────────────────────── */}
        {tab === 'sectors' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700 }}>
                FII SECTOR MONEY FLOW — Weekly ₹ Crores
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[2, 4, 8, 12].map(w => (
                  <button key={w} className={`nav-tab${sectorWeeks === w ? ' active' : ''}`}
                    onClick={() => setSectorWeeks(w)} style={{ padding: '1px 6px', fontSize: 9 }}>
                    {w}W
                  </button>
                ))}
              </div>
            </div>

            {!sectorData ? (
              <div style={{ textAlign: 'center', color: '#555', padding: 20 }}>
                <div className="spinner" style={{ margin: '0 auto 8px' }} />
                Loading sector flows…
              </div>
            ) : (
              <>
                {/* Sector totals ranking */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 9, color: '#666', marginBottom: 6 }}>CUMULATIVE FII FLOW BY SECTOR ({sectorWeeks} WEEKS)</div>
                  {(sectorData.sector_totals || []).map((s: any, i: number) => {
                    const maxAbs = Math.max(...(sectorData.sector_totals || []).map((x: any) => Math.abs(x.total_fii)), 1);
                    const pct = Math.abs(s.total_fii) / maxAbs * 100;
                    return (
                      <div key={i} style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2, fontSize: 10 }}>
                          <span style={{ color: '#aaa', minWidth: 90 }}>{s.sector}</span>
                          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ fontSize: 8, fontWeight: 700, padding: '0 3px',
                              color: s.signal === 'BUYING' ? 'var(--green)' : 'var(--red)',
                              border: `1px solid ${s.signal === 'BUYING' ? 'rgba(0,200,83,0.3)' : 'rgba(255,61,0,0.3)'}`,
                            }}>
                              {s.signal}
                            </span>
                            <span style={{ color: s.total_fii >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                              {s.total_fii >= 0 ? '+' : ''}{fmtCr(s.total_fii)}
                            </span>
                          </span>
                        </div>
                        <div style={{ height: 5, background: '#111', borderRadius: 2 }}>
                          <div style={{
                            width: `${pct}%`, height: '100%', borderRadius: 2,
                            background: s.total_fii >= 0 ? 'rgba(0,200,83,0.7)' : 'rgba(255,61,0,0.7)',
                            transition: 'width 0.5s',
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Weekly sector chart */}
                {(() => {
                  const weeks = [...new Set((sectorData.data || []).map((d: any) => d.week))].sort();
                  const sectors = [...new Set((sectorData.data || []).map((d: any) => d.sector))];
                  // Pivot: week → sector → fii_net
                  const pivot: any[] = weeks.map(w => {
                    const row: any = { week: (w as string).slice(5) };
                    sectors.forEach(s => {
                      const match = (sectorData.data || []).find((d: any) => d.week === w && d.sector === s);
                      row[s as string] = match ? Math.round(match.fii_net) : 0;
                    });
                    return row;
                  });
                  const COLORS = ['#4fc3f7','#a78bfa','#ff9500','#00c853','#ff3d00','#69f0ae','#ffcc80','#80cbc4','#ef9a9a','#ce93d8'];
                  return (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={pivot} margin={{ top: 5, right: 5, left: 0, bottom: 25 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                        <XAxis dataKey="week" tick={{ fontSize: 8, fill: '#555' }} angle={-30} textAnchor="end" />
                        <YAxis tick={{ fontSize: 8, fill: '#555' }} />
                        <Tooltip
                          formatter={(val: any, name: string) => [`₹${Number(val).toLocaleString('en-IN')} Cr`, name]}
                          contentStyle={CHART_TOOLTIP}
                        />
                        <Legend wrapperStyle={{ fontSize: 8 }} />
                        <ReferenceLine y={0} stroke="#444" />
                        {sectors.slice(0, 8).map((s, i) => (
                          <Bar key={s as string} dataKey={s as string} stackId="a" fill={COLORS[i % COLORS.length]} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  );
                })()}

                <div style={{ fontSize: 9, color: '#444', marginTop: 8, fontStyle: 'italic' }}>
                  {sectorData.source === 'derived'
                    ? '* Sector allocation derived from aggregate FII flows weighted by index market-cap share'
                    : 'Source: NSDL sector-wise FPI data'}
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'summary' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 10, color: '#4fc3f7', fontWeight: 700, marginBottom: 8 }}>FII / FOREIGN PORTFOLIO INVESTORS</div>
              <div style={{ padding: '8px 12px', background: 'rgba(79,195,247,0.06)', border: '1px solid rgba(79,195,247,0.2)', marginBottom: 10 }}>
                <div style={{ color: '#4fc3f7', fontSize: 18, fontWeight: 900 }}>
                  {summary.fii_20d_total >= 0 ? '+' : ''}{fmtCr(summary.fii_20d_total)}
                </div>
                <div style={{ color: '#555', fontSize: 9 }}>Net last 20 trading days</div>
              </div>
              <div style={{ fontSize: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #1a1a1a' }}>
                  <span style={{ color: '#666' }}>Buy Days (20D)</span>
                  <span style={{ color: 'var(--green)' }}>{summary.fii_buy_days_20d}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #1a1a1a' }}>
                  <span style={{ color: '#666' }}>Sell Days (20D)</span>
                  <span style={{ color: 'var(--red)' }}>{summary.fii_sell_days_20d}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #1a1a1a' }}>
                  <span style={{ color: '#666' }}>Period Cumulative</span>
                  <span style={{ color: summary.fii_cumulative >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                    {fmtCr(summary.fii_cumulative)}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 10, color: '#a78bfa', fontWeight: 700, marginBottom: 8 }}>DII / DOMESTIC INSTITUTIONAL INVESTORS</div>
              <div style={{ padding: '8px 12px', background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)', marginBottom: 10 }}>
                <div style={{ color: '#a78bfa', fontSize: 18, fontWeight: 900 }}>
                  {summary.dii_20d_total >= 0 ? '+' : ''}{fmtCr(summary.dii_20d_total)}
                </div>
                <div style={{ color: '#555', fontSize: 9 }}>Net last 20 trading days</div>
              </div>
              <div style={{ fontSize: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #1a1a1a' }}>
                  <span style={{ color: '#666' }}>Total Days</span>
                  <span style={{ color: 'var(--text-primary)' }}>{summary.total_days}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #1a1a1a' }}>
                  <span style={{ color: '#666' }}>DII Cumulative</span>
                  <span style={{ color: 'var(--green)', fontWeight: 700 }}>{fmtCr(summary.dii_cumulative)}</span>
                </div>
              </div>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{
                padding: '10px 16px',
                background: netSentiment === 'BUYING' ? 'rgba(0,200,83,0.08)' : 'rgba(255,61,0,0.08)',
                border: `1px solid ${netSentiment === 'BUYING' ? 'rgba(0,200,83,0.2)' : 'rgba(255,61,0,0.2)'}`,
              }}>
                <div style={{ color: sentColor, fontSize: 13, fontWeight: 700 }}>
                  FII NET: {netSentiment}
                </div>
                <div style={{ color: '#aaa', fontSize: 10, marginTop: 4 }}>
                  Foreign investors have been net {netSentiment?.toLowerCase()} equities over the last 20 trading sessions.
                  DII flows {summary.dii_cumulative >= 0 ? 'supportive' : 'also negative'}.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FIIDIIPanel;
