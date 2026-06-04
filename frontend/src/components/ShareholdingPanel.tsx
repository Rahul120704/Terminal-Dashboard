/**
 * Shareholding Pattern Panel — Promoter/FII/DII/Public breakdown
 * Includes: pie chart, trend chart, pledge %, institutional holders
 */

import React, { useState } from 'react';
import { useApiData } from '../hooks/useApi';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Legend,
  BarChart, Bar,
} from 'recharts';

interface Props { symbol: string; }

const COLORS = {
  promoter: '#ff9500',
  fii: '#4fc3f7',
  dii: '#a78bfa',
  public: '#6ee7b7',
  pledge: '#ff3d00',
};

function pct(v?: number | null): string {
  if (v == null) return '—';
  return `${Number(v).toFixed(2)}%`;
}

function fmt(v?: number | null, d = 2): string {
  if (v == null) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
}

const RADIAN = Math.PI / 180;
const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }: any) => {
  if (percent < 0.05) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={700}>
      {`${(percent * 100).toFixed(1)}%`}
    </text>
  );
};

type Tab = 'overview' | 'trend' | 'holders';

export const ShareholdingPanel: React.FC<Props> = ({ symbol }) => {
  const [tab, setTab] = useState<Tab>('overview');
  const { data, loading } = useApiData<any>(`/api/shareholding/${symbol}`, 7200000);

  if (loading) return (
    <div className="panel h-full flex-center">
      <div className="spinner" />
    </div>
  );

  if (!data || !data.latest) return (
    <div className="panel h-full" style={{ padding: 16, color: 'var(--text-muted)', fontSize: 11 }}>
      No shareholding data available for {symbol}
    </div>
  );

  const latest = data.latest || {};
  const history: any[] = data.history || [];
  const holders: any[] = data.institutional_holders || [];

  const pieData = [
    { name: 'Promoter', value: parseFloat(latest.promoter) || 0, color: COLORS.promoter },
    { name: 'FII/FPI', value: parseFloat(latest.fii) || 0, color: COLORS.fii },
    { name: 'DII/MF', value: parseFloat(latest.dii) || 0, color: COLORS.dii },
    { name: 'Public', value: parseFloat(latest.public) || 0, color: COLORS.public },
  ].filter(d => d.value > 0);

  const trendData = [...history].reverse().map(h => ({
    date: h.date?.substring(0, 7) || '',
    Promoter: parseFloat(h.promoter) || null,
    FII: parseFloat(h.fii) || null,
    DII: parseFloat(h.dii) || null,
    Public: parseFloat(h.public) || null,
  }));

  const pledgePct = parseFloat(latest.pledge_pct);

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="panel-title">OWN — SHAREHOLDING PATTERN</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 6 }}>{symbol}</span>
        {data.source && (
          <span style={{ marginLeft: 'auto', fontSize: 9, color: '#555' }}>src: {data.source}</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 1, background: 'var(--bg-secondary)', padding: '2px 4px', borderBottom: '1px solid #222', flexShrink: 0 }}>
        {(['overview', 'trend', 'holders'] as Tab[]).map(t => (
          <button key={t} className={`nav-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="panel-body" style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {tab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16 }}>
            {/* Pie chart */}
            <div>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%" cy="50%"
                    outerRadius={80}
                    labelLine={false}
                    label={renderCustomizedLabel}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val: any) => [`${Number(val).toFixed(2)}%`, '']}
                    contentStyle={{ background: '#141414', border: '1px solid #333', fontSize: 11 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Legend */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                {pieData.map(d => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: 'var(--text-secondary)', flex: 1 }}>{d.name}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: d.color }}>{pct(d.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Details */}
            <div>
              <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>CURRENT HOLDING BREAKDOWN</div>

              {/* Promoter */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 10, color: COLORS.promoter, fontWeight: 700 }}>PROMOTER</span>
                  <span style={{ fontSize: 13, fontWeight: 900, color: COLORS.promoter }}>{pct(latest.promoter)}</span>
                </div>
                <div style={{ background: '#222', borderRadius: 2, height: 5 }}>
                  <div style={{ width: `${Math.min(parseFloat(latest.promoter) || 0, 100)}%`, background: COLORS.promoter, height: '100%', borderRadius: 2 }} />
                </div>
                {pledgePct > 0 && (
                  <div style={{ fontSize: 9, color: 'var(--red)', marginTop: 3 }}>
                    ⚠ Pledged: {pct(pledgePct)} of promoter holding
                  </div>
                )}
              </div>

              {/* FII */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 10, color: COLORS.fii, fontWeight: 700 }}>FII / FPI</span>
                  <span style={{ fontSize: 13, fontWeight: 900, color: COLORS.fii }}>{pct(latest.fii)}</span>
                </div>
                <div style={{ background: '#222', borderRadius: 2, height: 5 }}>
                  <div style={{ width: `${Math.min(parseFloat(latest.fii) || 0, 100)}%`, background: COLORS.fii, height: '100%', borderRadius: 2 }} />
                </div>
              </div>

              {/* DII */}
              {latest.dii != null && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: COLORS.dii, fontWeight: 700 }}>DII / MF</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: COLORS.dii }}>{pct(latest.dii)}</span>
                  </div>
                  <div style={{ background: '#222', borderRadius: 2, height: 5 }}>
                    <div style={{ width: `${Math.min(parseFloat(latest.dii) || 0, 100)}%`, background: COLORS.dii, height: '100%', borderRadius: 2 }} />
                  </div>
                </div>
              )}

              {/* Public */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 10, color: COLORS.public, fontWeight: 700 }}>PUBLIC / RETAIL</span>
                  <span style={{ fontSize: 13, fontWeight: 900, color: COLORS.public }}>{pct(latest.public)}</span>
                </div>
                <div style={{ background: '#222', borderRadius: 2, height: 5 }}>
                  <div style={{ width: `${Math.min(parseFloat(latest.public) || 0, 100)}%`, background: COLORS.public, height: '100%', borderRadius: 2 }} />
                </div>
              </div>

              {/* Pledge warning */}
              {pledgePct > 20 && (
                <div style={{
                  background: 'rgba(255,61,0,0.1)', border: '1px solid rgba(255,61,0,0.3)',
                  padding: '6px 10px', borderRadius: 2, marginTop: 10,
                }}>
                  <div style={{ color: 'var(--red)', fontSize: 10, fontWeight: 700 }}>
                    ⚠ HIGH PROMOTER PLEDGE: {pct(pledgePct)}
                  </div>
                  <div style={{ color: '#aaa', fontSize: 9, marginTop: 3 }}>
                    High pledge ratio is a risk indicator — forced selling possible if price falls
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'trend' && trendData.length > 0 && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>
              SHAREHOLDING TREND — QUARTERLY
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#666' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: '#666' }} unit="%" />
                <Tooltip
                  formatter={(val: any, name: string) => [`${Number(val).toFixed(2)}%`, name]}
                  contentStyle={{ background: '#141414', border: '1px solid #333', fontSize: 10 }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="Promoter" stroke={COLORS.promoter} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="FII" stroke={COLORS.fii} strokeWidth={2} dot={false} />
                {trendData.some(d => d.DII != null) && (
                  <Line type="monotone" dataKey="DII" stroke={COLORS.dii} strokeWidth={2} dot={false} />
                )}
                <Line type="monotone" dataKey="Public" stroke={COLORS.public} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {tab === 'trend' && trendData.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 11, padding: 20 }}>
            Historical shareholding trend not available. NSE API may not have quarterly history.
          </div>
        )}

        {tab === 'holders' && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>
              TOP INSTITUTIONAL HOLDERS
            </div>
            {holders.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Holder data not available</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr>
                    {['Institution', '% Held', 'Shares'].map(h => (
                      <th key={h} style={{ textAlign: 'left', color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid #222', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {holders.map((h: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid #151515' }}>
                      <td style={{ padding: '5px 8px', color: '#e8e8e0' }}>{h.institution}</td>
                      <td style={{ padding: '5px 8px', color: COLORS.fii, fontWeight: 700 }}>
                        {h.pct_held != null ? `${h.pct_held.toFixed(3)}%` : '—'}
                      </td>
                      <td style={{ padding: '5px 8px', color: 'var(--text-secondary)' }}>
                        {h.shares ? (h.shares / 1e5).toFixed(2) + 'L' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ShareholdingPanel;
