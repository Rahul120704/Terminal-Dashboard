import React from 'react';
import { TechnicalSignal } from '../types';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts';

interface Props {
  symbol: string;
  data?: TechnicalSignal;
  price?: number;
}

function fmt(v?: number, d = 2): string {
  if (v === undefined || v === null) return '—';
  return v.toFixed(d);
}

function pctDiff(price: number, level?: number): string {
  if (!level || !price) return '';
  const diff = ((price - level) / level) * 100;
  return ` (${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%)`;
}

function rsiColor(rsi?: number): string {
  if (!rsi) return 'var(--text-primary)';
  if (rsi >= 70) return 'var(--red)';
  if (rsi <= 30) return 'var(--green)';
  if (rsi >= 55) return 'var(--green)';
  if (rsi <= 45) return 'var(--red)';
  return 'var(--amber)';
}

function signalColor(signal?: string): string {
  if (signal === 'BUY') return 'var(--green)';
  if (signal === 'SELL') return 'var(--red)';
  return 'var(--amber)';
}

function trendColor(trend?: string): string {
  if (trend === 'UPTREND') return 'var(--green)';
  if (trend === 'DOWNTREND') return 'var(--red)';
  return 'var(--amber)';
}

export const TechnicalIndicators: React.FC<Props> = ({ symbol, data, price }) => {
  if (!data) return (
    <div className="panel h-full flex items-center justify-center text-muted">
      Loading technicals…
    </div>
  );

  const p = price || data.close || 0;

  const emaVsPrice = [
    { label: 'EMA 20', val: data.ema20, above: p > (data.ema20 || 0) },
    { label: 'EMA 50', val: data.ema50, above: p > (data.ema50 || 0) },
    { label: 'EMA 200', val: data.ema200, above: p > (data.ema200 || 0) },
    { label: 'SMA 20', val: data.sma20, above: p > (data.sma20 || 0) },
    { label: 'SMA 50', val: data.sma50, above: p > (data.sma50 || 0) },
    { label: 'SMA 200', val: data.sma200, above: p > (data.sma200 || 0) },
    { label: 'VWAP', val: data.vwap, above: p > (data.vwap || 0) },
  ];

  const radarData = [
    { subject: 'Trend', value: data.trend === 'UPTREND' ? 80 : data.trend === 'DOWNTREND' ? 20 : 50 },
    { subject: 'RSI', value: Math.max(0, Math.min(100, ((data.rsi14 || 50) - 30) / 40 * 100)) },
    { subject: 'MACD', value: (data.macd_hist || 0) > 0 ? 70 : 30 },
    { subject: 'ADX', value: Math.min(data.adx14 || 0, 50) * 2 },
    { subject: 'Vol', value: (data.strength || 0.5) * 100 },
    { subject: 'BB', value: p > (data.bb_mid || p) ? 60 : 40 },
  ];

  return (
    <div className="panel" style={{ height: '100%' }}>
      <div className="panel-header">
        <span className="panel-title">{symbol} — Technicals</span>
        <div className="flex items-center gap-2">
          <span style={{
            fontSize: 12, fontWeight: 700, padding: '2px 8px',
            background: `rgba(${data.signal === 'BUY' ? '0,200,83' : data.signal === 'SELL' ? '255,61,0' : '255,149,0'},0.15)`,
            border: `1px solid ${signalColor(data.signal)}`,
            color: signalColor(data.signal),
          }}>
            {data.signal || 'HOLD'} {data.strength ? `(${(data.strength * 100).toFixed(0)}%)` : ''}
          </span>
          <span style={{ color: trendColor(data.trend), fontSize: 11, fontWeight: 700 }}>
            {data.trend || 'SIDEWAYS'}
          </span>
        </div>
      </div>

      <div className="panel-body" style={{ padding: 8 }}>
        {data.signal_reasons && data.signal_reasons.length > 0 && (
          <div style={{ marginBottom: 8, padding: '4px 6px', background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
            {data.signal_reasons.map((r, i) => (
              <div key={i} style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 2 }}>
                • {r}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* Moving Averages */}
          <div>
            <div style={{ color: 'var(--amber)', fontSize: 10, fontWeight: 700, marginBottom: 6 }}>MOVING AVERAGES</div>
            <table>
              <thead>
                <tr><th>MA</th><th style={{ textAlign: 'right' }}>Value</th><th>Signal</th></tr>
              </thead>
              <tbody>
                {emaVsPrice.map(row => (
                  <tr key={row.label}>
                    <td style={{ color: 'var(--text-secondary)' }}>{row.label}</td>
                    <td style={{ textAlign: 'right' }}>
                      {fmt(row.val)}
                      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{pctDiff(p, row.val)}</span>
                    </td>
                    <td>
                      <span style={{ color: row.above ? 'var(--green)' : 'var(--red)', fontSize: 10, fontWeight: 700 }}>
                        {row.above ? 'ABOVE' : 'BELOW'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Oscillators */}
          <div>
            <div style={{ color: 'var(--amber)', fontSize: 10, fontWeight: 700, marginBottom: 6 }}>OSCILLATORS</div>
            <div>
              {/* RSI */}
              <div style={{ marginBottom: 8 }}>
                <div className="flex justify-between" style={{ marginBottom: 3 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>RSI (14)</span>
                  <span style={{ color: rsiColor(data.rsi14), fontWeight: 700 }}>{fmt(data.rsi14, 1)}</span>
                </div>
                <div style={{ background: 'var(--bg-secondary)', height: 6, borderRadius: 3, position: 'relative' }}>
                  <div style={{ position: 'absolute', left: '30%', top: 0, bottom: 0, width: 1, background: 'var(--green-dim)' }} />
                  <div style={{ position: 'absolute', left: '70%', top: 0, bottom: 0, width: 1, background: 'var(--red-dim)' }} />
                  <div style={{
                    width: `${Math.min(data.rsi14 || 0, 100)}%`,
                    height: '100%',
                    background: rsiColor(data.rsi14),
                    borderRadius: 3,
                  }} />
                </div>
                <div className="flex justify-between" style={{ marginTop: 2 }}>
                  <span style={{ fontSize: 9, color: 'var(--green)' }}>OVERSOLD 30</span>
                  <span style={{ fontSize: 9, color: 'var(--red)' }}>OVERBOUGHT 70</span>
                </div>
              </div>

              <div className="border-b" style={{ padding: '3px 0' }}>
                <div className="flex justify-between">
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>MACD</span>
                  <span style={{ color: (data.macd || 0) > 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(data.macd, 3)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Signal</span>
                  <span>{fmt(data.macd_signal, 3)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Histogram</span>
                  <span style={{ color: (data.macd_hist || 0) > 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                    {fmt(data.macd_hist, 3)}
                  </span>
                </div>
              </div>

              <div className="border-b" style={{ padding: '3px 0' }}>
                <div className="flex justify-between">
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>ADX (14)</span>
                  <span style={{ color: (data.adx14 || 0) > 25 ? 'var(--amber)' : 'var(--text-muted)' }}>
                    {fmt(data.adx14, 1)}
                    <span style={{ fontSize: 9, marginLeft: 4, color: 'var(--text-muted)' }}>
                      {(data.adx14 || 0) > 40 ? 'STRONG' : (data.adx14 || 0) > 20 ? 'TREND' : 'WEAK'}
                    </span>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Stoch %K</span>
                  <span>{fmt(data.stoch_k, 1)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Stoch %D</span>
                  <span>{fmt(data.stoch_d, 1)}</span>
                </div>
              </div>

              <div style={{ padding: '3px 0' }}>
                <div className="flex justify-between">
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>BB Upper</span>
                  <span style={{ color: 'var(--red)' }}>{fmt(data.bb_upper)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>BB Mid</span>
                  <span>{fmt(data.bb_mid)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>BB Lower</span>
                  <span style={{ color: 'var(--green)' }}>{fmt(data.bb_lower)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>ATR (14)</span>
                  <span>{fmt(data.atr14)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Radar chart */}
        <div style={{ marginTop: 8 }}>
          <div style={{ color: 'var(--amber)', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>SIGNAL STRENGTH RADAR</div>
          <ResponsiveContainer width="100%" height={140}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="var(--border-bright)" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
              <Radar dataKey="value" stroke="var(--amber)" fill="rgba(255,149,0,0.2)" fillOpacity={0.6} />
              <Tooltip contentStyle={{ background: '#141414', border: '1px solid #333', fontSize: 10 }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
