/**
 * Corporate Actions Panel — Dividends, Splits, Bonuses, Buy-backs
 */

import React, { useState } from 'react';
import { useApiData } from '../hooks/useApi';

interface Props { symbol: string; }

type Tab = 'dividends' | 'splits' | 'nse_actions';

const BADGE_COLORS: Record<string, string> = {
  dividend: '#00cc66',
  split: '#4fc3f7',
  bonus: '#ff9500',
  buyback: '#a78bfa',
  'rights issue': '#ff6b35',
};

function getBadgeColor(purpose?: string): string {
  const p = (purpose ?? '').toLowerCase();
  for (const [key, color] of Object.entries(BADGE_COLORS)) {
    if (p.includes(key)) return color;
  }
  return '#888';
}

export const CorporateActionsPanel: React.FC<Props> = ({ symbol }) => {
  const [tab, setTab] = useState<Tab>('dividends');
  const { data, loading } = useApiData<any>(`/api/corporate-actions/${symbol}`, 7200000);

  if (loading) return (
    <div className="panel h-full flex-center"><div className="spinner" /></div>
  );

  if (!data) return (
    <div className="panel h-full" style={{ padding: 16, color: 'var(--text-muted)', fontSize: 11 }}>
      No corporate actions data for {symbol}
    </div>
  );

  const divs: any[] = data.dividends || [];
  const splits: any[] = data.splits || [];
  const nseActions: any[] = data.nse_actions || [];

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="panel-title">DDIS — CORPORATE ACTIONS</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 6 }}>{symbol}</span>
      </div>

      <div style={{ display: 'flex', gap: 1, background: 'var(--bg-secondary)', padding: '2px 4px', borderBottom: '1px solid #222', flexShrink: 0 }}>
        {([
          ['dividends', `DIVIDENDS (${divs.length})`],
          ['splits', `SPLITS/BONUS (${splits.length})`],
          ['nse_actions', `NSE ACTIONS (${nseActions.length})`],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} className={`nav-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      <div className="panel-body" style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {tab === 'dividends' && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>
              DIVIDEND HISTORY (yfinance)
            </div>
            {divs.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No dividend history available</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr>
                    {['Ex-Date', 'Amount (₹)', 'Type'].map(h => (
                      <th key={h} style={{ textAlign: h === 'Amount (₹)' ? 'right' : 'left', color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid #222', fontWeight: 600, fontSize: 9 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...divs].reverse().map((d: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                      <td style={{ padding: '5px 8px', color: '#aaa' }}>{d.date}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--green)', fontWeight: 700 }}>
                        ₹{typeof d.amount === 'number' ? d.amount.toFixed(4) : d.amount}
                      </td>
                      <td style={{ padding: '5px 8px' }}>
                        <span style={{
                          fontSize: 9, padding: '1px 5px',
                          background: 'rgba(0,204,102,0.1)', color: 'var(--green)',
                          border: '1px solid rgba(0,204,102,0.2)', borderRadius: 2,
                        }}>
                          {d.type || 'Dividend'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'splits' && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>STOCK SPLITS & BONUSES</div>
            {splits.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No split/bonus history available</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr>
                    {['Date', 'Ratio', 'Type'].map(h => (
                      <th key={h} style={{ textAlign: 'left', color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid #222', fontWeight: 600, fontSize: 9 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {splits.map((s: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                      <td style={{ padding: '5px 8px', color: '#aaa' }}>{s.date}</td>
                      <td style={{ padding: '5px 8px', color: '#4fc3f7', fontWeight: 700 }}>{s.ratio}</td>
                      <td style={{ padding: '5px 8px' }}>
                        <span style={{
                          fontSize: 9, padding: '1px 5px',
                          background: 'rgba(79,195,247,0.1)', color: '#4fc3f7',
                          border: '1px solid rgba(79,195,247,0.2)', borderRadius: 2,
                        }}>
                          {s.type || 'Split'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'nse_actions' && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>NSE CORPORATE ACTIONS</div>
            {nseActions.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No NSE corporate actions data (NSE API may be unavailable)</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {nseActions.map((a: any, i: number) => {
                  const purpose = a.purpose || '';
                  const color = getBadgeColor(purpose);
                  return (
                    <div key={i} style={{
                      background: 'var(--bg-secondary)', border: `1px solid ${color}22`,
                      borderLeft: `3px solid ${color}`, padding: '8px 12px', borderRadius: 2,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                        <span style={{
                          fontSize: 9, padding: '1px 6px',
                          background: `${color}22`, color, fontWeight: 700, borderRadius: 2,
                        }}>
                          {purpose.split(' ').slice(0, 3).join(' ').toUpperCase() || 'ACTION'}
                        </span>
                        <span style={{ color: '#aaa', fontSize: 10 }}>Ex-Date: <strong style={{ color: '#e8e8e0' }}>{a.ex_date || '—'}</strong></span>
                        <span style={{ color: '#aaa', fontSize: 10 }}>Record: <strong style={{ color: '#e8e8e0' }}>{a.record_date || '—'}</strong></span>
                        {a.payment_date && (
                          <span style={{ color: '#aaa', fontSize: 10 }}>Payment: <strong style={{ color: '#e8e8e0' }}>{a.payment_date}</strong></span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: '#e8e8e0' }}>{purpose}</div>
                      {a.bc_start && (
                        <div style={{ fontSize: 9, color: '#555', marginTop: 3 }}>
                          Book Closure: {a.bc_start} to {a.bc_end}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CorporateActionsPanel;
