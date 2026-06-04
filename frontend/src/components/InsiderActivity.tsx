import React from 'react';
import { InsiderTrade } from '../types';
import { useApiData } from '../hooks/useApi';

interface Props { symbol?: string; }

function fmtVal(v: number): string {
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  return `₹${v.toFixed(0)}`;
}

export const InsiderActivity: React.FC<Props> = ({ symbol }) => {
  const { data: trades, loading } = useApiData<InsiderTrade[]>(
    symbol ? `/api/insider-trades?symbol=${symbol}&days=30` : '/api/insider-trades?days=30',
    120000
  );
  const { data: deals } = useApiData<{ block_deals: any[]; bulk_deals: any[] }>('/api/block-deals', 120000);

  const items = trades || [];
  const blocks = deals?.block_deals || [];
  const bulks = deals?.bulk_deals || [];

  return (
    <div className="panel" style={{ height: '100%' }}>
      <div className="panel-header">
        <span className="panel-title">{symbol ? `${symbol} — ` : ''}Insider Activity</span>
        {loading && <span className="spinner" />}
      </div>
      <div className="panel-body">
        {items.length > 0 && (
          <div>
            <div style={{ color: 'var(--amber)', fontSize: 10, fontWeight: 700, padding: '6px 8px 4px', textTransform: 'uppercase' }}>
              SAST / Insider Trades
            </div>
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Person</th>
                  <th>Type</th>
                  <th>Action</th>
                  <th style={{ textAlign: 'right' }}>Shares</th>
                  <th style={{ textAlign: 'right' }}>Price</th>
                  <th style={{ textAlign: 'right' }}>Value</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t, i) => (
                  <tr key={i}>
                    <td style={{ color: 'var(--amber)', fontWeight: 700 }}>{t.symbol}</td>
                    <td style={{ color: 'var(--text-secondary)', maxWidth: 120 }} className="truncate">{t.person_name}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 10 }}>{t.person_type}</td>
                    <td>
                      <span style={{
                        color: t.transaction_type?.toLowerCase().includes('buy') ? 'var(--green)' : 'var(--red)',
                        fontWeight: 700,
                      }}>
                        {t.transaction_type}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{t.shares?.toLocaleString('en-IN')}</td>
                    <td style={{ textAlign: 'right' }}>₹{t.price?.toFixed(2)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--cyan)' }}>{fmtVal(t.value)}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 10 }}>{t.date?.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {blocks.length > 0 && (
          <div>
            <div style={{ color: 'var(--cyan)', fontSize: 10, fontWeight: 700, padding: '6px 8px 4px', textTransform: 'uppercase', borderTop: '1px solid var(--border)' }}>
              Block Deals
            </div>
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Client</th>
                  <th>Action</th>
                  <th style={{ textAlign: 'right' }}>Shares</th>
                  <th style={{ textAlign: 'right' }}>Price</th>
                  <th style={{ textAlign: 'right' }}>Value</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((d, i) => (
                  <tr key={i}>
                    <td style={{ color: 'var(--amber)', fontWeight: 700 }}>{d.symbol}</td>
                    <td style={{ color: 'var(--text-secondary)', maxWidth: 120 }} className="truncate">{d.client}</td>
                    <td>
                      <span style={{ color: d.transaction_type === 'BUY' ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                        {d.transaction_type}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{d.shares?.toLocaleString('en-IN')}</td>
                    <td style={{ textAlign: 'right' }}>₹{d.price?.toFixed(2)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--cyan)' }}>{fmtVal(d.value)}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 10 }}>{d.date?.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {items.length === 0 && blocks.length === 0 && (
          <div className="p-3 text-muted">No insider trading data available</div>
        )}
      </div>
    </div>
  );
};
