/**
 * Delivery Volume Panel — NSE delivery % analysis
 * High delivery % = strong institutional conviction (not just intraday speculation)
 * Shows trend, comparison with avg, and interpretation
 */

import React, { useState } from 'react';
import { useApiData } from '../hooks/useApi';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';

interface Props { symbol: string; }

function pct(v?: number | null): string {
  if (v == null) return '—';
  return `${Number(v).toFixed(2)}%`;
}

function getDeliveryColor(pct: number): string {
  if (pct >= 70) return 'var(--green)';
  if (pct >= 50) return 'var(--amber)';
  if (pct >= 30) return '#ff9500aa';
  return 'var(--red)';
}

export const DeliveryVolumePanel: React.FC<Props> = ({ symbol }) => {
  const [days, setDays] = useState(30);
  const { data, loading } = useApiData<any>(`/api/delivery/${symbol}?days=${days}`, 3600000);

  if (loading) return (
    <div className="panel h-full flex-center"><div className="spinner" /></div>
  );

  if (!data || data.signal === 'DATA UNAVAILABLE') return (
    <div className="panel h-full" style={{ padding: 16 }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
        Delivery volume data not available for {symbol}.
        NSE delivery data requires active session cookies.
      </div>
    </div>
  );

  const rows: any[] = data.data || [];
  const avg = data.avg_delivery_pct;
  const latest = data.latest_delivery_pct;
  const signal = data.signal;

  const signalColor = signal === 'HIGH CONVICTION'
    ? 'var(--green)' : signal === 'SPECULATIVE'
      ? 'var(--red)' : 'var(--amber)';

  // Chart data
  const chartData = rows.map((r: any) => ({
    date: r.date?.substring(5),
    deliveryPct: r.delivery_pct,
    volume: Math.round((r.volume || 0) / 1e5),   // in lakhs
    close: r.close,
    changePct: r.change_pct,
  }));

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="panel-title">DELIVERY VOLUME ANALYSIS</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 6 }}>{symbol}</span>
        <span style={{
          marginLeft: 10, fontSize: 10, fontWeight: 700, color: signalColor,
          border: `1px solid ${signalColor}44`, padding: '1px 7px', background: `${signalColor}11`,
        }}>
          {signal}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {[15, 30, 60].map(d => (
            <button key={d} className={`nav-tab${days === d ? ' active' : ''}`} onClick={() => setDays(d)} style={{ padding: '1px 5px', fontSize: 9 }}>
              {d}D
            </button>
          ))}
        </div>
      </div>

      {/* Summary strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        background: '#111', borderBottom: '1px solid #222', flexShrink: 0,
      }}>
        {[
          { label: 'Latest Delivery %', value: pct(latest), color: latest ? getDeliveryColor(latest) : 'var(--text-primary)' },
          { label: `${days}D Avg Delivery %`, value: pct(avg), color: avg ? getDeliveryColor(avg) : 'var(--text-primary)' },
          { label: 'Avg Volume (Lakhs)', value: data.avg_volume ? (data.avg_volume / 1e5).toFixed(1) : '—', color: 'var(--text-primary)' },
          { label: 'Signal', value: signal, color: signalColor },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ padding: '6px 10px', textAlign: 'center', borderRight: '1px solid #1a1a1a' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="panel-body" style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {/* Chart */}
        {chartData.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>
              Delivery % vs Total Volume
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#555' }} interval={4} />
                <YAxis yAxisId="pct" domain={[0, 100]} tick={{ fontSize: 8, fill: '#666' }} unit="%" />
                <YAxis yAxisId="vol" orientation="right" tick={{ fontSize: 8, fill: '#444' }} unit="L" />
                <Tooltip
                  contentStyle={{ background: '#141414', border: '1px solid #333', fontSize: 9 }}
                  formatter={(v: any, name: string) => [
                    name === 'deliveryPct' ? `${Number(v).toFixed(2)}%` : `${v}L`,
                    name === 'deliveryPct' ? 'Delivery %' : 'Volume',
                  ]}
                />
                <ReferenceLine yAxisId="pct" y={avg || 50} stroke="var(--amber)" strokeDasharray="4 2"
                  label={{ value: `Avg ${pct(avg)}`, fill: 'var(--amber)', fontSize: 8, position: 'right' }} />
                <Bar yAxisId="vol" dataKey="volume" fill="#4fc3f733" name="Volume" />
                <Line yAxisId="pct" type="monotone" dataKey="deliveryPct"
                  stroke="var(--amber)" strokeWidth={2} dot={false}
                  name="Delivery %" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Table */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 6 }}>DAILY BREAKDOWN</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
            <thead>
              <tr>
                {['Date', 'Close', 'Chg%', 'Total Vol', 'Delivery', 'Del%'].map(h => (
                  <th key={h} style={{ textAlign: 'right', color: 'var(--text-muted)', padding: '3px 6px', borderBottom: '1px solid #222', fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().slice(0, 20).map((r: any, i: number) => {
                const dlvPct = r.delivery_pct;
                const dlvColor = getDeliveryColor(dlvPct);
                const chgColor = r.change_pct >= 0 ? 'var(--green)' : 'var(--red)';
                return (
                  <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: '#888' }}>{r.date}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: '#e8e8e0' }}>₹{r.close?.toFixed(2)}</td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: chgColor }}>
                      {r.change_pct >= 0 ? '+' : ''}{r.change_pct?.toFixed(2)}%
                    </td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: '#888' }}>
                      {r.volume ? (r.volume / 1e5).toFixed(1) + 'L' : '—'}
                    </td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: '#888' }}>
                      {r.delivery ? (r.delivery / 1e5).toFixed(1) + 'L' : '—'}
                    </td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', color: dlvColor, fontWeight: 700 }}>
                      {pct(dlvPct)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Interpretation */}
        <div style={{ padding: '10px 12px', background: 'var(--bg-secondary)', border: '1px solid #222' }}>
          <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 6 }}>DELIVERY % INTERPRETATION</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 9 }}>
            {[
              { range: '> 70%', label: 'HIGH CONVICTION', color: 'var(--green)', desc: 'Strong institutional buying/selling. Positions held overnight — high conviction move.' },
              { range: '40–70%', label: 'MODERATE', color: 'var(--amber)', desc: 'Mixed intraday + delivery. Watch for follow-through in next session.' },
              { range: '< 40%', label: 'SPECULATIVE', color: 'var(--red)', desc: 'Mostly intraday trades. Day trader driven — less reliable directional signal.' },
            ].map(r => (
              <div key={r.range} style={{
                padding: '6px 8px', borderLeft: `3px solid ${r.color}`,
                background: `${r.color}08`,
              }}>
                <div style={{ color: r.color, fontWeight: 700, marginBottom: 3 }}>{r.range}</div>
                <div style={{ color: r.label === 'HIGH CONVICTION' ? 'var(--green)' : r.label === 'SPECULATIVE' ? 'var(--red)' : 'var(--amber)', fontSize: 8, fontWeight: 700, marginBottom: 3 }}>
                  {r.label}
                </div>
                <div style={{ color: '#666', lineHeight: 1.5 }}>{r.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeliveryVolumePanel;
