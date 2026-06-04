/**
 * Block & Bulk Deals Panel — Large institutional trades
 * Block deals: >5 Lakh shares or >5 Cr value on BSE/NSE block window
 * Bulk deals: >0.5% of equity in a single trade
 */

import React, { useState } from 'react';
import { useApiData } from '../hooks/useApi';

interface Props {
  onSelectTicker?: (sym: string) => void;
}

function fmtCr(v?: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  return `₹${v.toFixed(0)}`;
}

function fmt(v?: number | null, d = 2): string {
  if (v == null) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
}

type Tab = 'block' | 'bulk';

export const BlockBulkDealsPanel: React.FC<Props> = ({ onSelectTicker }) => {
  const [tab, setTab] = useState<Tab>('block');
  const [days, setDays] = useState(7);
  const [filter, setFilter] = useState('');

  const { data, loading } = useApiData<any>(`/api/block-deals?days=${days}`, 300000);

  if (loading) return (
    <div className="panel h-full flex-center"><div className="spinner" /></div>
  );

  const blocks: any[] = (data?.block_deals || []).filter((d: any) =>
    !filter || d.symbol?.toLowerCase().includes(filter.toLowerCase()) ||
    d.client_name?.toLowerCase().includes(filter.toLowerCase())
  );
  const bulks: any[] = (data?.bulk_deals || []).filter((d: any) =>
    !filter || d.symbol?.toLowerCase().includes(filter.toLowerCase()) ||
    d.client_name?.toLowerCase().includes(filter.toLowerCase())
  );

  const current = tab === 'block' ? blocks : bulks;

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="panel-title">BLOCK / BULK DEALS</span>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
          {[3, 7, 15, 30].map(d => (
            <button key={d} className={`nav-tab${days === d ? ' active' : ''}`} onClick={() => setDays(d)} style={{ padding: '1px 5px', fontSize: 9 }}>
              {d}D
            </button>
          ))}
        </div>
      </div>

      {/* Tab + filter row */}
      <div style={{ display: 'flex', gap: 1, background: 'var(--bg-secondary)', padding: '2px 4px', borderBottom: '1px solid #222', flexShrink: 0, alignItems: 'center' }}>
        {(['block', 'bulk'] as Tab[]).map(t => (
          <button key={t} className={`nav-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t.toUpperCase()} DEALS
            <span style={{ marginLeft: 4, fontSize: 9, color: '#555' }}>
              ({t === 'block' ? blocks.length : bulks.length})
            </span>
          </button>
        ))}
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter by symbol / client…"
          style={{
            marginLeft: 'auto', background: '#111', border: '1px solid #333', color: '#e8e8e0',
            padding: '2px 8px', fontSize: 10, borderRadius: 2, outline: 'none', width: 180,
          }}
        />
      </div>

      {/* Info strip */}
      <div style={{
        background: 'rgba(255,149,0,0.05)', padding: '4px 10px',
        borderBottom: '1px solid #1a1a1a', fontSize: 9, color: '#666', flexShrink: 0,
      }}>
        {tab === 'block'
          ? 'Block Deals: Trades > 5 Lakh shares or ₹5 Cr value in NSE/BSE block window (9:15–9:50 AM)'
          : 'Bulk Deals: Single transactions > 0.5% of total equity of the company'}
      </div>

      <div className="panel-body" style={{ flex: 1, overflowY: 'auto' }}>
        {current.length === 0 ? (
          <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 11, textAlign: 'center' }}>
            No {tab} deals found in the last {days} days
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#0d0d0d' }}>
              <tr>
                {['Date', 'Symbol', 'Client / Party', 'Buy/Sell', 'Qty (Shares)', 'Price', 'Value'].map(h => (
                  <th key={h} style={{
                    textAlign: h === 'Qty (Shares)' || h === 'Price' || h === 'Value' ? 'right' : 'left',
                    color: 'var(--text-muted)', padding: '5px 8px',
                    borderBottom: '1px solid #222', fontWeight: 600, fontSize: 9,
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {current.map((d: any, i: number) => {
                const isBuy = (d.buy_sell || '').toUpperCase().includes('BUY') || (d.transaction_type || '').toUpperCase().includes('BUY');
                const qty = d.qty || d.quantity || d.shares || 0;
                const price = d.price || d.trade_price || 0;
                const value = (d.value) || (qty * price);

                return (
                  <tr key={i} style={{ borderBottom: '1px solid #111', cursor: 'pointer' }}
                    onClick={() => d.symbol && onSelectTicker?.(d.symbol.replace('.NS', '').replace('.BO', ''))}
                    onMouseEnter={e => (e.currentTarget.style.background = '#0f0f0f')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <td style={{ padding: '5px 8px', color: '#666' }}>{d.date || d.deal_date || '—'}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--amber)', fontWeight: 700 }}>
                      {(d.symbol || '').replace('.NS', '').replace('.BO', '')}
                    </td>
                    <td style={{ padding: '5px 8px', color: '#e8e8e0', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.client_name || d.entity_name || d.party_name || '—'}
                    </td>
                    <td style={{ padding: '5px 8px', color: isBuy ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                      {isBuy ? 'BUY' : 'SELL'}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                      {qty ? (qty / 1e5).toFixed(2) + 'L' : '—'}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: '#e8e8e0' }}>
                      ₹{fmt(price)}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--amber)', fontWeight: 700 }}>
                      {value ? fmtCr(value) : '—'}
                    </td>
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

export default BlockBulkDealsPanel;
