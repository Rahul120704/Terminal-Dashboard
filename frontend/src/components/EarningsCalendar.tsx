import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useApiData, apiFetch } from '../hooks/useApi';

interface EarningsItem {
  symbol: string;
  company_name?: string;
  result_date: string;
  quarter?: string;
  result_type?: string;
  revenue_actual?: number;
  eps_actual?: number;
  revenue_surprise_pct?: number;
  eps_surprise_pct?: number;
  yoy_revenue_growth?: number;
  yoy_pat_growth?: number;
  status?: string;
  concall_date?: string;
  concall_time?: string;
}

type Tab = 'upcoming' | 'today' | 'recent';

const TODAY = new Date().toISOString().slice(0, 10);

function fmt(v?: number | null, d = 1): string {
  if (v == null || isNaN(Number(v))) return '—';
  return Number(v).toFixed(d);
}
function pctColor(v?: number | null): string {
  if (v == null) return 'var(--text-muted)';
  return Number(v) >= 0 ? 'var(--green)' : 'var(--red)';
}
function surpriseColor(v?: number | null): string {
  if (v == null) return 'var(--text-muted)';
  const n = Number(v);
  if (n > 5) return 'var(--green)';
  if (n < -5) return 'var(--red)';
  return 'var(--amber)';
}
function fmtDate(s: string): string {
  try { return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }); }
  catch { return s; }
}
function daysUntil(s: string): string {
  const d = Math.ceil((new Date(s).getTime() - Date.now()) / 86400000);
  if (d === 0) return 'TODAY';
  if (d === 1) return 'TOMORROW';
  if (d < 0) return `${Math.abs(d)}d ago`;
  return `in ${d}d`;
}

export const EarningsCalendar: React.FC = () => {
  const [tab, setTab] = useState<Tab>('upcoming');
  const [search, setSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<EarningsItem[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Wide range fetch — 90 days ahead + 90 days back — filter client-side
  const { data: allEarnings, loading, refetch } = useApiData<EarningsItem[]>(
    '/api/earnings?days_ahead=90&days_back=90',
    300_000, // refresh every 5 min
    300_000,
  );

  const items = allEarnings || [];

  const upcoming = useMemo(() =>
    items
      .filter(e => e.result_date >= TODAY && e.result_date !== TODAY)
      .sort((a, b) => a.result_date.localeCompare(b.result_date)),
    [items]);

  const today = useMemo(() =>
    items.filter(e => e.result_date === TODAY),
    [items]);

  const recent = useMemo(() =>
    items
      .filter(e => e.result_date < TODAY)
      .sort((a, b) => b.result_date.localeCompare(a.result_date)),
    [items]);

  // Debounced symbol search
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      const data = await apiFetch<EarningsItem[]>(
        `/api/earnings?days_ahead=365&days_back=365&symbol=${searchQuery.trim().toUpperCase()}`
      );
      setSearchResults(data || []);
      setSearchLoading(false);
    }, 350);
  }, [searchQuery]);

  const handleSearchInput = (v: string) => {
    setSearch(v);
    setSearchQuery(v);
  };

  const display = searchResults !== null
    ? searchResults
    : tab === 'upcoming' ? upcoming
    : tab === 'today'    ? today
    : recent;

  const noData = !loading && !searchLoading && display.length === 0;

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ flexDirection: 'column', height: 'auto', padding: '6px 8px', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span className="panel-title">EARNINGS CALENDAR</span>
          <button
            onClick={refetch}
            style={{ fontSize: 9, padding: '1px 6px', background: 'transparent', border: '1px solid #333', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 2 }}
          >↻ REFRESH</button>
        </div>

        {/* Search bar */}
        <div style={{ position: 'relative', width: '100%' }}>
          <input
            value={search}
            onChange={e => handleSearchInput(e.target.value)}
            placeholder="Search symbol…  e.g. RELIANCE, TCS, INFY"
            style={{
              width: '100%', background: '#0d0d0d', border: '1px solid #2a2a1f',
              color: '#e8e8e0', padding: '4px 28px 4px 8px', fontSize: 10,
              fontFamily: 'Consolas, monospace', outline: 'none', boxSizing: 'border-box',
            }}
          />
          {(search || searchLoading) && (
            <span
              onClick={() => { setSearch(''); setSearchQuery(''); setSearchResults(null); }}
              style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12 }}>
              {searchLoading ? '…' : '✕'}
            </span>
          )}
        </div>

        {/* Tabs — hidden during search */}
        {searchResults === null && (
          <div style={{ display: 'flex', gap: 4 }}>
            {([
              { id: 'upcoming' as Tab, label: 'UPCOMING', count: upcoming.length },
              { id: 'today'    as Tab, label: 'TODAY',    count: today.length },
              { id: 'recent'   as Tab, label: 'RECENT',   count: recent.length },
            ]).map(({ id, label, count }) => (
              <button
                key={id}
                className={`btn ${tab === id ? 'btn-amber' : ''}`}
                onClick={() => setTab(id)}
                style={{ padding: '2px 8px', fontSize: 9, position: 'relative' }}
              >
                {label}
                {count > 0 && (
                  <span style={{
                    marginLeft: 4, background: tab === id ? '#0a0a0a' : '#222',
                    color: tab === id ? 'var(--amber)' : 'var(--text-muted)',
                    borderRadius: 10, padding: '0 5px', fontSize: 8,
                  }}>{count}</span>
                )}
              </button>
            ))}
            {(loading) && <span className="spinner" style={{ marginLeft: 4 }} />}
          </div>
        )}
        {searchResults !== null && (
          <div style={{ fontSize: 9, color: 'var(--amber)' }}>
            {searchLoading ? 'Searching…' : `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''} for "${searchQuery.toUpperCase()}"`}
          </div>
        )}
      </div>

      <div className="panel-body" style={{ flex: 1, overflow: 'auto', padding: 0 }}>
        {noData ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
            {searchResults !== null
              ? <><div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 8 }}>No earnings found for "{searchQuery.toUpperCase()}"</div><div style={{ fontSize: 10 }}>Try a different symbol or check the NSE ticker format</div></>
              : tab === 'today'
              ? <><div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 8 }}>No earnings announcements today</div><div style={{ fontSize: 10 }}>Check UPCOMING or RECENT tabs</div></>
              : <><div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 8 }}>No earnings data</div><div style={{ fontSize: 10 }}>Data updates every hour from NSE board meetings. Click ↻ REFRESH to fetch now.</div></>
            }
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#111', zIndex: 1 }}>
              <tr>
                <th style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid #222', whiteSpace: 'nowrap' }}>DATE</th>
                <th style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid #222' }}>SYMBOL</th>
                <th style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid #222' }}>COMPANY</th>
                <th style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid #222' }}>QTR</th>
                {(tab === 'recent' || searchResults !== null) && <>
                  <th style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid #222', whiteSpace: 'nowrap' }}>REV SURP</th>
                  <th style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid #222', whiteSpace: 'nowrap' }}>EPS SURP</th>
                  <th style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid #222', whiteSpace: 'nowrap' }}>YoY REV</th>
                  <th style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid #222', whiteSpace: 'nowrap' }}>YoY PAT</th>
                </>}
                {(tab === 'upcoming' || tab === 'today') && <>
                  <th style={{ padding: '4px 8px', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid #222' }}>WHEN</th>
                  <th style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid #222' }}>CONCALL</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {display.map((e, i) => {
                const isToday = e.result_date === TODAY;
                return (
                  <tr key={`${e.symbol}-${i}`} style={{ borderBottom: '1px solid #111', background: isToday ? 'rgba(255,149,0,0.05)' : undefined }}>
                    <td style={{ padding: '5px 8px', color: isToday ? 'var(--amber)' : 'var(--cyan)', whiteSpace: 'nowrap', fontWeight: isToday ? 700 : 400 }}>
                      {fmtDate(e.result_date)}
                    </td>
                    <td style={{ padding: '5px 8px', color: 'var(--amber)', fontWeight: 700 }}>{e.symbol}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--text-secondary)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.company_name || '—'}
                    </td>
                    <td style={{ padding: '5px 8px', color: 'var(--text-muted)' }}>{e.quarter || '—'}</td>

                    {(tab === 'recent' || searchResults !== null) && <>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: surpriseColor(e.revenue_surprise_pct), fontVariantNumeric: 'tabular-nums' }}>
                        {e.revenue_surprise_pct != null ? `${e.revenue_surprise_pct > 0 ? '+' : ''}${fmt(e.revenue_surprise_pct)}%` : '—'}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: surpriseColor(e.eps_surprise_pct), fontVariantNumeric: 'tabular-nums' }}>
                        {e.eps_surprise_pct != null ? `${e.eps_surprise_pct > 0 ? '+' : ''}${fmt(e.eps_surprise_pct)}%` : '—'}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: pctColor(e.yoy_revenue_growth), fontVariantNumeric: 'tabular-nums' }}>
                        {e.yoy_revenue_growth != null ? `${e.yoy_revenue_growth > 0 ? '+' : ''}${fmt(e.yoy_revenue_growth)}%` : '—'}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: pctColor(e.yoy_pat_growth), fontVariantNumeric: 'tabular-nums' }}>
                        {e.yoy_pat_growth != null ? `${e.yoy_pat_growth > 0 ? '+' : ''}${fmt(e.yoy_pat_growth)}%` : '—'}
                      </td>
                    </>}

                    {(tab === 'upcoming' || tab === 'today') && <>
                      <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 2,
                          background: isToday ? 'rgba(255,149,0,0.2)' : 'rgba(0,150,255,0.1)',
                          color: isToday ? 'var(--amber)' : 'var(--cyan)',
                          border: `1px solid ${isToday ? 'rgba(255,149,0,0.4)' : 'rgba(0,150,255,0.3)'}`,
                        }}>
                          {daysUntil(e.result_date)}
                        </span>
                      </td>
                      <td style={{ padding: '5px 8px', color: 'var(--text-muted)', fontSize: 9 }}>
                        {e.concall_date ? `${e.concall_date}${e.concall_time ? ` ${e.concall_time}` : ''}` : '—'}
                      </td>
                    </>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
