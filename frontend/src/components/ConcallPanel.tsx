/**
 * Concall & Earnings Panel — Earnings call schedule, upcoming results,
 * key metrics post-results, and surprise analysis.
 * Bloomberg equivalent: EVTS / EE
 */

import React, { useState } from 'react';
import { useApiData } from '../hooks/useApi';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, CartesianGrid, ReferenceLine,
} from 'recharts';

interface Props {
  symbol?: string;
  onSelectTicker?: (sym: string) => void;
}

function fmt(v?: number | null, d = 2): string {
  if (v == null) return '—';
  return (v > 0 ? '+' : '') + v.toFixed(d) + '%';
}
function fmtDate(s?: string | null): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
  } catch { return s; }
}

const TT = { background: '#141414', border: '1px solid #333', fontSize: 10 };

type Tab = 'upcoming' | 'recent' | 'calendar' | 'impact';

const IMPACT_COLORS: Record<string, string> = {
  HIGH: 'var(--red)', MEDIUM: 'var(--amber)', LOW: 'var(--green)',
};

export const ConcallPanel: React.FC<Props> = ({ symbol, onSelectTicker }) => {
  const [tab, setTab] = useState<Tab>('upcoming');
  const [view, setView] = useState<'all' | 'ticker'>(!symbol ? 'all' : 'ticker');

  const endpoint = view === 'ticker' && symbol
    ? `/api/earnings?symbol=${symbol}&days_ahead=90&days_back=90`
    : '/api/earnings?days_ahead=45&days_back=0';

  const recentEndpoint = view === 'ticker' && symbol
    ? `/api/earnings?symbol=${symbol}&days_ahead=0&days_back=180`
    : '/api/earnings?days_ahead=0&days_back=30';

  const { data: upcomingData, loading: loadUp } = useApiData<any[]>(endpoint, 120000);
  const { data: recentData, loading: loadRec } = useApiData<any[]>(recentEndpoint, 120000);

  const upcoming = (upcomingData || []).filter(e => e.status === 'upcoming');
  const recent = recentData || [];

  // Calendar grouped by week
  const today = new Date();
  const groupByWeek = (items: any[]) => {
    const groups: Record<string, any[]> = {};
    items.forEach(e => {
      const d = new Date(e.result_date);
      const diffDays = Math.floor((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const week = diffDays < 7 ? 'This Week' : diffDays < 14 ? 'Next Week' : 'Later';
      if (!groups[week]) groups[week] = [];
      groups[week].push(e);
    });
    return groups;
  };

  const calendarGroups = groupByWeek(upcoming);

  // Recent earnings surprise chart
  const surpriseChart = recent
    .filter(e => e.eps_surprise_pct != null || e.revenue_surprise_pct != null)
    .slice(0, 12)
    .map(e => ({
      symbol: e.symbol,
      epsSurprise: e.eps_surprise_pct,
      revSurprise: e.revenue_surprise_pct,
      date: e.result_date?.substring(5),
    }));

  const loading = loadUp || loadRec;

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="panel-title">EARNINGS & CONCALL — EVTS</span>
        {symbol && <span style={{ fontSize: 10, color: 'var(--amber)', marginLeft: 8 }}>{symbol}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {symbol && (
            <>
              <button className={`nav-tab${view === 'ticker' ? ' active' : ''}`} onClick={() => setView('ticker')} style={{ fontSize: 9, padding: '1px 6px' }}>
                {symbol}
              </button>
              <button className={`nav-tab${view === 'all' ? ' active' : ''}`} onClick={() => setView('all')} style={{ fontSize: 9, padding: '1px 6px' }}>
                ALL
              </button>
            </>
          )}
          {loading && <span className="spinner" />}
        </div>
      </div>

      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', background: '#111', borderBottom: '1px solid #222', flexShrink: 0 }}>
        {[
          { label: 'Upcoming 45D', value: upcoming.length, color: 'var(--amber)' },
          { label: 'This Week', value: calendarGroups['This Week']?.length || 0, color: 'var(--green)' },
          { label: 'With Concall', value: upcoming.filter(e => e.concall_date).length, color: '#4fc3f7' },
          { label: 'Recent Results', value: recent.length, color: 'var(--text-primary)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ padding: '6px 10px', textAlign: 'center', borderRight: '1px solid #1a1a1a' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 1, background: 'var(--bg-secondary)', padding: '2px 4px', borderBottom: '1px solid #222', flexShrink: 0 }}>
        {([
          { id: 'upcoming',  label: `UPCOMING (${upcoming.length})` },
          { id: 'recent',    label: `RECENT (${recent.length})` },
          { id: 'calendar',  label: 'CALENDAR' },
          { id: 'impact',    label: 'IMPACT' },
        ] as { id: Tab; label: string }[]).map(t => (
          <button key={t.id} className={`nav-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="panel-body" style={{ flex: 1, overflowY: 'auto', padding: 10 }}>

        {/* ── UPCOMING EARNINGS ─────────────────────────────────────── */}
        {tab === 'upcoming' && (
          <div>
            {upcoming.length === 0 ? (
              <div style={{ color: '#555', textAlign: 'center', padding: 24 }}>
                {loading ? 'Loading...' : 'No upcoming earnings in the next 45 days.'}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr>
                    {['Result Date', 'Symbol', 'Company', 'Quarter', 'Concall', 'Concall Time'].map(h => (
                      <th key={h} style={{ textAlign: h === 'Symbol' || h === 'Quarter' || h === 'Result Date' ? 'left' : 'left', color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid #222', fontSize: 9 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((e: any, i: number) => {
                    const daysLeft = Math.ceil((new Date(e.result_date).getTime() - Date.now()) / 86400000);
                    const isClose = daysLeft <= 3;
                    const hasConcall = e.concall_date;
                    return (
                      <tr
                        key={i}
                        style={{ borderBottom: '1px solid #111', cursor: 'pointer' }}
                        onClick={() => onSelectTicker && onSelectTicker(e.symbol)}
                      >
                        <td style={{ padding: '5px 8px' }}>
                          <div style={{ color: isClose ? 'var(--amber)' : '#888', fontWeight: isClose ? 700 : 400 }}>
                            {fmtDate(e.result_date)}
                          </div>
                          {daysLeft >= 0 && (
                            <div style={{ fontSize: 8, color: isClose ? 'var(--amber)' : '#555' }}>
                              {daysLeft === 0 ? 'TODAY' : `in ${daysLeft}d`}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '5px 8px', color: 'var(--amber)', fontWeight: 700 }}>{e.symbol}</td>
                        <td style={{ padding: '5px 8px', color: '#aaa', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.company_name}
                        </td>
                        <td style={{ padding: '5px 8px', color: '#666' }}>{e.quarter}</td>
                        <td style={{ padding: '5px 8px' }}>
                          {hasConcall ? (
                            <span style={{ color: '#4fc3f7', fontSize: 9, fontWeight: 700 }}>
                              📞 {fmtDate(e.concall_date)}
                            </span>
                          ) : (
                            <span style={{ color: '#333', fontSize: 9 }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '5px 8px', color: '#666', fontSize: 9 }}>
                          {e.concall_time || (hasConcall ? 'TBA' : '—')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── RECENT RESULTS ────────────────────────────────────────── */}
        {tab === 'recent' && (
          <div>
            {recent.length === 0 ? (
              <div style={{ color: '#555', textAlign: 'center', padding: 24 }}>
                {loading ? 'Loading...' : 'No recent results.'}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr>
                    {['Date', 'Symbol', 'Qtr', 'Rev Chg', 'PAT Chg', 'Rev Surp', 'EPS Surp', 'Status'].map(h => (
                      <th key={h} style={{ textAlign: h === 'Date' || h === 'Symbol' || h === 'Qtr' ? 'left' : 'right', color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid #222', fontSize: 9 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recent.slice(0, 40).map((e: any, i: number) => {
                    const good = (v?: number) => v != null && v > 0;
                    return (
                      <tr
                        key={i}
                        style={{ borderBottom: '1px solid #111', cursor: 'pointer' }}
                        onClick={() => onSelectTicker && onSelectTicker(e.symbol)}
                      >
                        <td style={{ padding: '4px 8px', color: '#888' }}>{fmtDate(e.result_date)}</td>
                        <td style={{ padding: '4px 8px', color: 'var(--amber)', fontWeight: 700 }}>{e.symbol}</td>
                        <td style={{ padding: '4px 8px', color: '#666' }}>{e.quarter}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: good(e.yoy_revenue_growth) ? 'var(--green)' : e.yoy_revenue_growth < 0 ? 'var(--red)' : '#555' }}>
                          {e.yoy_revenue_growth != null ? fmt(e.yoy_revenue_growth, 1) : '—'}
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: good(e.yoy_pat_growth) ? 'var(--green)' : e.yoy_pat_growth < 0 ? 'var(--red)' : '#555' }}>
                          {e.yoy_pat_growth != null ? fmt(e.yoy_pat_growth, 1) : '—'}
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: good(e.revenue_surprise_pct) ? 'var(--green)' : e.revenue_surprise_pct < 0 ? 'var(--red)' : '#555' }}>
                          {e.revenue_surprise_pct != null ? fmt(e.revenue_surprise_pct, 1) : '—'}
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: good(e.eps_surprise_pct) ? 'var(--green)' : e.eps_surprise_pct < 0 ? 'var(--red)' : '#555', fontWeight: 700 }}>
                          {e.eps_surprise_pct != null ? fmt(e.eps_surprise_pct, 1) : '—'}
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                          <span style={{
                            fontSize: 8, padding: '1px 5px', fontWeight: 700,
                            color: good(e.eps_surprise_pct) ? 'var(--green)' : e.eps_surprise_pct < 0 ? 'var(--red)' : '#555',
                            border: `1px solid ${good(e.eps_surprise_pct) ? 'rgba(0,200,83,0.3)' : e.eps_surprise_pct < 0 ? 'rgba(255,61,0,0.3)' : '#333'}`,
                          }}>
                            {e.eps_surprise_pct != null ? (good(e.eps_surprise_pct) ? 'BEAT' : 'MISS') : 'N/A'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── CALENDAR VIEW ─────────────────────────────────────────── */}
        {tab === 'calendar' && (
          <div>
            {Object.keys(calendarGroups).length === 0 ? (
              <div style={{ color: '#555', textAlign: 'center', padding: 24 }}>No upcoming earnings loaded.</div>
            ) : (
              (['This Week', 'Next Week', 'Later'] as const).map(week => {
                const items = calendarGroups[week];
                if (!items?.length) return null;
                return (
                  <div key={week} style={{ marginBottom: 20 }}>
                    <div style={{
                      fontSize: 10, color: week === 'This Week' ? 'var(--amber)' : week === 'Next Week' ? '#4fc3f7' : 'var(--text-muted)',
                      fontWeight: 700, marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${week === 'This Week' ? 'rgba(255,149,0,0.3)' : '#1a1a1a'}`,
                    }}>
                      {week === 'This Week' ? '🔔 ' : ''}{week.toUpperCase()} — {items.length} result{items.length > 1 ? 's' : ''}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                      {items.map((e: any, i: number) => (
                        <div
                          key={i}
                          onClick={() => onSelectTicker && onSelectTicker(e.symbol)}
                          style={{
                            padding: '8px 10px', background: '#0d0d0d',
                            border: `1px solid ${e.concall_date ? 'rgba(79,195,247,0.2)' : '#1a1a1a'}`,
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 11 }}>{e.symbol}</div>
                          <div style={{ fontSize: 9, color: '#888', marginTop: 2 }}>{fmtDate(e.result_date)}</div>
                          <div style={{ fontSize: 9, color: '#555' }}>{e.quarter}</div>
                          {e.concall_date && (
                            <div style={{ fontSize: 8, color: '#4fc3f7', marginTop: 2 }}>
                              📞 {fmtDate(e.concall_date)} {e.concall_time || ''}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── EARNINGS IMPACT ANALYSIS ─────────────────────────────── */}
        {tab === 'impact' && (
          <div>
            {surpriseChart.length > 0 ? (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>
                  RECENT EARNINGS SURPRISES (EPS%)
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={surpriseChart} margin={{ top: 5, right: 10, left: -15, bottom: 50 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="#1a1a1a" />
                    <XAxis
                      dataKey="symbol"
                      tick={{ fontSize: 8, fill: '#666', angle: -45, textAnchor: 'end' } as any}
                      interval={0}
                    />
                    <YAxis tick={{ fontSize: 8, fill: '#555' }} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip contentStyle={TT} formatter={(v: any, name: string) => [`${Number(v).toFixed(1)}%`, name === 'epsSurprise' ? 'EPS Surprise' : 'Rev Surprise']} />
                    <ReferenceLine y={0} stroke="#333" />
                    <Bar dataKey="epsSurprise" name="EPS Surprise">
                      {surpriseChart.map((d: any, i: number) => (
                        <Cell key={i} fill={(d.epsSurprise || 0) >= 0 ? 'rgba(0,200,83,0.7)' : 'rgba(255,61,0,0.7)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ color: '#555', padding: 12, fontSize: 10 }}>
                Surprise data appears once earnings results are updated in the database.
              </div>
            )}

            {/* Earnings impact guide */}
            <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 12 }}>EARNINGS IMPACT FRAMEWORK</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                {
                  signal: 'STRONG BEAT',
                  conditions: 'EPS Surprise > 10% AND Revenue beat',
                  reaction: '+3% to +8% gap up typically. Higher for small/mid caps.',
                  color: 'var(--green)',
                  playbook: 'Buy pre-results with tight stop. Sell into the gap on day 2 if volume fades.',
                },
                {
                  signal: 'MILD BEAT',
                  conditions: 'EPS Surprise 2-10% OR Revenue miss',
                  reaction: '+0.5% to +3%. "Sell the news" likely on strong prior run.',
                  color: '#69f0ae',
                  playbook: 'Hold existing longs. Watch next session for follow-through signal.',
                },
                {
                  signal: 'IN-LINE',
                  conditions: 'Within ±2% of estimates',
                  reaction: '±1%. Stock reverts to pre-result trend.',
                  color: 'var(--amber)',
                  playbook: 'Technical chart takes over. Respect support/resistance.',
                },
                {
                  signal: 'MISS',
                  conditions: 'EPS Surprise < -5% OR Revenue miss > -5%',
                  reaction: '-3% to -10%. Gap down. Bounce on day 2 possible.',
                  color: 'var(--red)',
                  playbook: 'Avoid catching falling knife. Wait for stabilization before entry.',
                },
              ].map(r => (
                <div key={r.signal} style={{ padding: '10px 12px', background: '#0a0a0a', borderLeft: `3px solid ${r.color}` }}>
                  <div style={{ color: r.color, fontWeight: 700, fontSize: 11, marginBottom: 4 }}>{r.signal}</div>
                  <div style={{ fontSize: 9, color: '#888', marginBottom: 4 }}>
                    <b style={{ color: '#aaa' }}>Condition:</b> {r.conditions}
                  </div>
                  <div style={{ fontSize: 9, color: '#888', marginBottom: 4 }}>
                    <b style={{ color: '#aaa' }}>Typical reaction:</b> {r.reaction}
                  </div>
                  <div style={{ fontSize: 9, color: '#666' }}>
                    <b style={{ color: '#888' }}>Playbook:</b> {r.playbook}
                  </div>
                </div>
              ))}
            </div>

            {/* Key notes */}
            <div style={{ marginTop: 16, padding: '10px 12px', background: 'rgba(79,195,247,0.04)', border: '1px solid rgba(79,195,247,0.15)' }}>
              <div style={{ fontSize: 10, color: '#4fc3f7', fontWeight: 700, marginBottom: 6 }}>CONCALL ANALYSIS CHECKLIST</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 9, color: '#888', lineHeight: 1.7 }}>
                <div>
                  <b style={{ color: '#ccc' }}>Listen for:</b><br />
                  • Revenue guidance for next quarter<br />
                  • EBITDA margin trajectory<br />
                  • Debt reduction / capex plans<br />
                  • Promoter commentary on sector<br />
                  • Order book / pipeline visibility
                </div>
                <div>
                  <b style={{ color: '#ccc' }}>Red flags:</b><br />
                  • Management change without explanation<br />
                  • Guidance cut or withdrawn<br />
                  • Auditor qualification or delays<br />
                  • Working capital deterioration<br />
                  • Promoter pledge increase
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConcallPanel;
