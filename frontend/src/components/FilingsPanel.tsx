import React, { useState } from 'react';
import { FilingItem } from '../types';
import { useApiData } from '../hooks/useApi';
import { useLiveFilings } from '../store/liveDataStore';

interface Props {
  symbol?: string;
  liveItems?: FilingItem[];  // kept for backward compat; store preferred
}

function timeAgo(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  } catch {
    return dateStr;
  }
}

const IMPACT_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export const FilingsPanel: React.FC<Props> = ({ symbol, liveItems: propLiveItems = [] }) => {
  const [impactFilter, setImpactFilter] = useState<string>('all');
  // Prefer store (re-renders only when new filing arrives)
  const storeLiveFilings = useLiveFilings();
  const liveItems = storeLiveFilings.length > 0 ? storeLiveFilings : propLiveItems;
  const { data: storedFilings } = useApiData<FilingItem[]>(
    symbol ? `/api/filings?symbol=${symbol}&limit=100` : '/api/filings?limit=100',
    20000
  );

  const allItems = React.useMemo(() => {
    const stored = storedFilings || [];
    const combined = [...liveItems, ...stored];
    const seen = new Set<string>();
    return combined.filter(item => {
      const key = `${item.symbol}-${item.subject}-${item.filed_at}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => {
      const ia = IMPACT_ORDER[a.impact || 'LOW'] ?? 2;
      const ib = IMPACT_ORDER[b.impact || 'LOW'] ?? 2;
      if (ia !== ib) return ia - ib;
      return new Date(b.filed_at).getTime() - new Date(a.filed_at).getTime();
    });
  }, [storedFilings, liveItems]);

  const filtered = impactFilter === 'all'
    ? allItems
    : allItems.filter(f => (f.impact || 'LOW') === impactFilter.toUpperCase());

  return (
    <div className="panel" style={{ height: '100%' }}>
      <div className="panel-header">
        <span className="panel-title">
          {symbol ? `${symbol} — Filings` : 'Exchange Filings'}
        </span>
        <div className="flex gap-1 items-center">
          {['all', 'HIGH', 'MEDIUM', 'LOW'].map(f => (
            <button key={f} className={`btn ${impactFilter === f ? 'btn-amber' : ''}`}
              onClick={() => setImpactFilter(f)}
              style={{ padding: '1px 5px', fontSize: 9 }}>
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-body">
        {filtered.length === 0 ? (
          <div className="p-3 text-muted">No filings available</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Exch</th>
                <th style={{ width: '50%' }}>Subject</th>
                <th>Impact</th>
                <th>Doc</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f, i) => (
                <tr key={f.id ?? i}>
                  <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {timeAgo(f.filed_at)}
                  </td>
                  <td style={{ color: 'var(--amber)', fontWeight: 700 }}>
                    {f.symbol || '—'}
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{f.exchange}</td>
                  <td style={{ color: 'var(--text-primary)', whiteSpace: 'normal', lineHeight: 1.3 }}>
                    {f.subject}
                  </td>
                  <td>
                    <span className={`badge badge-${(f.impact || 'LOW').toLowerCase()}`}>
                      {f.impact || 'LOW'}
                    </span>
                  </td>
                  <td>
                    {f.url ? (
                      <a href={f.url} target="_blank" rel="noreferrer"
                        style={{ color: 'var(--cyan)', fontSize: 10 }}
                        onClick={e => e.stopPropagation()}>
                        PDF
                      </a>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
