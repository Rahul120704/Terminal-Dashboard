import React from 'react';
import { VolumeShockerItem } from '../types';
import { useApiData } from '../hooks/useApi';
import { useVolumeShockers as useShockersStore } from '../store/liveDataStore';

function fmtVol(v: number): string {
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toString();
}

interface Props {
  onSelectTicker?: (sym: string) => void;
  liveShockers?: VolumeShockerItem[];
}

export const VolumeShockers: React.FC<Props> = ({ onSelectTicker, liveShockers: propShockers = [] }) => {
  const { data: apiShockers } = useApiData<VolumeShockerItem[]>('/api/volume-shockers', 60000);
  const storeShockers = useShockersStore();
  // Priority: store (live WS) > prop > REST API
  const items = storeShockers.length > 0 ? storeShockers : propShockers.length > 0 ? propShockers : (apiShockers || []);

  return (
    <div className="panel" style={{ height: '100%' }}>
      <div className="panel-header">
        <span className="panel-title">Volume Shockers</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>Vol ≥ 2x Avg</span>
      </div>
      <div className="panel-body">
        {items.length === 0 ? (
          <div className="p-3 text-muted">Computing volume shockers…</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th style={{ textAlign: 'right' }}>Chg%</th>
                <th style={{ textAlign: 'right' }}>Volume</th>
                <th style={{ textAlign: 'right' }}>Avg Vol</th>
                <th style={{ textAlign: 'right' }}>Ratio</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s, i) => (
                <tr key={i} onClick={() => onSelectTicker?.(s.symbol)} style={{ cursor: 'pointer' }}>
                  <td style={{ color: 'var(--amber)', fontWeight: 700 }}>{s.symbol}</td>
                  <td style={{ textAlign: 'right' }}>{s.price.toFixed(2)}</td>
                  <td style={{ textAlign: 'right', color: s.change_pct >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                    {s.change_pct >= 0 ? '+' : ''}{s.change_pct.toFixed(2)}%
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--cyan)' }}>{fmtVol(s.volume)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtVol(s.avg_volume_20d)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span style={{
                      color: s.volume_ratio >= 5 ? 'var(--red-bright)' : s.volume_ratio >= 3 ? 'var(--amber)' : 'var(--green)',
                      fontWeight: 700,
                    }}>
                      {s.volume_ratio.toFixed(1)}x
                    </span>
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
