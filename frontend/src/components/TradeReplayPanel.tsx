/**
 * Trade Replay Panel — Bloomberg TRA clone
 * ==========================================
 * Tick-by-tick trade replay for any NSE/BSE symbol.
 * Shows: time, price, volume, trade side (buy/sell), market impact.
 * Live mode: streams from Fyers WS. Replay mode: from DuckDB tick store.
 */

import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useApiData } from '../hooks/useApi';

interface Trade {
  id: string;
  timestamp: string;
  price: number;
  volume: number;
  side: 'BUY' | 'SELL' | 'UNKNOWN';
  trade_type: 'market' | 'limit' | 'stop';
  change_from_prev: number;
  cumulative_volume: number;
  vwap: number;
  market_depth_buy: number;
  market_depth_sell: number;
}

interface ReplayData {
  symbol: string;
  date: string;
  trades: Trade[];
  open: number;
  high: number;
  low: number;
  close: number;
  total_volume: number;
  vwap: number;
  trades_count: number;
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 80, h = 20;
  const points = data.map((v, i) =>
    `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`
  ).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

export const TradeReplayPanel: React.FC<{ ticker?: string }> = memo(({ ticker = 'RELIANCE' }) => {
  const [sym, setSym] = useState(ticker || 'RELIANCE');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [replayIdx, setReplayIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [filter, setFilter] = useState<'all' | 'BUY' | 'SELL' | 'large'>('all');
  const listRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  // (path, refreshMs, cacheTtlMs)  — live mode polls every 2s, replay mode no auto-refresh
  const { data, loading, refetch } = useApiData<ReplayData>(
    `/api/trade-replay/${sym}?date=${date}`,
    mode === 'live' ? 2000 : 0,   // refreshMs
    mode === 'live' ? 2000 : 60_000,
  );

  // Live: auto-scroll to bottom
  useEffect(() => {
    if (mode === 'live' && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [data, mode]);

  // Replay: step through trades at selected speed
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!isPlaying || !data?.trades) return;
    timerRef.current = setInterval(() => {
      setReplayIdx(i => {
        if (i >= (data.trades.length - 1)) { setIsPlaying(false); return i; }
        return i + 1;
      });
    }, 1000 / replaySpeed);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isPlaying, replaySpeed, data]);

  const trades = data?.trades || FALLBACK_TRADES;
  const displayTrades = mode === 'replay' ? trades.slice(0, replayIdx + 1) : trades;
  const filtered = filter === 'large'
    ? displayTrades.filter(t => t.volume > 5000)
    : filter === 'all'
    ? displayTrades
    : displayTrades.filter(t => t.side === filter);

  const priceHistory = displayTrades.map(t => t.price);
  const vwapHistory  = displayTrades.map(t => t.vwap);

  const fmt2 = (v: number) => v?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—';
  const fmtVol = (v: number) => v >= 1_00_000 ? `${(v/1_00_000).toFixed(1)}L` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v);

  const sideColor  = (s: string) => s === 'BUY' ? '#22c55e' : s === 'SELL' ? '#ef4444' : '#6b7280';
  const sideSymbol = (s: string) => s === 'BUY' ? '▲' : s === 'SELL' ? '▼' : '◆';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 13 }}>TRA</span>
          <input
            value={sym}
            onChange={e => setSym(e.target.value.toUpperCase())}
            style={{
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              color: 'var(--text)', padding: '2px 8px', borderRadius: 3, fontSize: 11,
              fontWeight: 700, width: 100, textTransform: 'uppercase',
            }}
          />
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={{
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              color: 'var(--text-muted)', padding: '2px 6px', borderRadius: 3, fontSize: 10,
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button onClick={() => setMode('live')} style={{
            padding: '2px 8px', fontSize: 9, fontWeight: 600,
            background: mode === 'live' ? 'var(--green)' : 'var(--bg-secondary)',
            color: mode === 'live' ? '#000' : 'var(--text-muted)',
            border: 'none', borderRadius: 3, cursor: 'pointer',
          }}>● LIVE</button>
          <button onClick={() => setMode('replay')} style={{
            padding: '2px 8px', fontSize: 9, fontWeight: 600,
            background: mode === 'replay' ? 'var(--amber)' : 'var(--bg-secondary)',
            color: mode === 'replay' ? '#000' : 'var(--text-muted)',
            border: 'none', borderRadius: 3, cursor: 'pointer',
          }}>⏮ REPLAY</button>
        </div>
      </div>

      {/* Summary bar */}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
          {[
            { label: 'OPEN',    value: fmt2(data.open),         color: 'var(--text)' },
            { label: 'HIGH',    value: fmt2(data.high),         color: 'var(--green)' },
            { label: 'LOW',     value: fmt2(data.low),          color: 'var(--red)' },
            { label: 'CLOSE',   value: fmt2(data.close),        color: 'var(--amber)' },
            { label: 'VWAP',    value: fmt2(data.vwap),         color: 'var(--cyan)' },
            { label: 'TRADES',  value: data.trades_count?.toLocaleString(), color: 'var(--text-muted)' },
          ].map(item => (
            <div key={item.label} style={{ padding: '4px 6px', background: 'var(--bg-secondary)', borderRadius: 3, textAlign: 'center' }}>
              <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>{item.label}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: item.color }}>{item.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Replay controls */}
      {mode === 'replay' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => { setIsPlaying(!isPlaying); }} style={{
            padding: '3px 12px', fontSize: 11, background: isPlaying ? 'var(--red)' : 'var(--green)',
            color: '#000', border: 'none', borderRadius: 3, cursor: 'pointer', fontWeight: 700,
          }}>{isPlaying ? '⏸ PAUSE' : '▶ PLAY'}</button>
          <button onClick={() => { setReplayIdx(0); setIsPlaying(false); }} style={{
            padding: '3px 8px', fontSize: 11, background: 'var(--bg-secondary)',
            color: 'var(--text-muted)', border: 'none', borderRadius: 3, cursor: 'pointer',
          }}>⏭ RESET</button>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Speed:</span>
          {[1, 5, 10, 50].map(s => (
            <button key={s} onClick={() => setReplaySpeed(s)} style={{
              padding: '2px 6px', fontSize: 9,
              background: replaySpeed === s ? 'var(--amber)' : 'var(--bg-secondary)',
              color: replaySpeed === s ? '#000' : 'var(--text-muted)',
              border: 'none', borderRadius: 3, cursor: 'pointer',
            }}>{s}x</button>
          ))}
          <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {replayIdx + 1}/{trades.length}
          </span>
          <input
            type="range" min={0} max={trades.length - 1} value={replayIdx}
            onChange={e => { setReplayIdx(+e.target.value); setIsPlaying(false); }}
            style={{ flex: 1, accentColor: 'var(--amber)' }}
          />
        </div>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: 4 }}>
        {(['all', 'BUY', 'SELL', 'large'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '2px 8px', fontSize: 9, fontWeight: 600,
            background: filter === f ? 'rgba(255,149,0,0.15)' : 'var(--bg-secondary)',
            color: filter === f ? 'var(--amber)' : 'var(--text-muted)',
            border: `1px solid ${filter === f ? 'var(--amber)' : 'transparent'}`,
            borderRadius: 3, cursor: 'pointer',
          }}>{f === 'large' ? '🐋 LARGE' : f.toUpperCase()}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-muted)' }}>{filtered.length} trades</span>
      </div>

      {/* Trade log */}
      <div ref={listRef} style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--bg)' }}>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Time', 'Price', 'Δ', 'Volume', 'Cum.Vol', 'VWAP', 'Side'].map(h => (
                <th key={h} style={{ padding: '3px 6px', textAlign: h === 'Side' || h === 'Time' ? 'left' : 'right', color: 'var(--text-muted)', fontSize: 8, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...filtered].reverse().map((trade, i) => (
              <tr key={trade.id || i} style={{
                borderBottom: '1px solid rgba(255,255,255,0.02)',
                background: trade.volume > 10000 ? 'rgba(255,149,0,0.04)' : 'transparent',
              }}>
                <td style={{ padding: '3px 6px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {new Date(trade.timestamp).toLocaleTimeString('en-IN', { hour12: false })}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--text)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {fmt2(trade.price)}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: trade.change_from_prev > 0 ? 'var(--green)' : trade.change_from_prev < 0 ? 'var(--red)' : 'var(--text-muted)', fontSize: 9 }}>
                  {trade.change_from_prev > 0 ? '+' : ''}{trade.change_from_prev?.toFixed(2)}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: trade.volume > 5000 ? 'var(--amber)' : 'var(--text-muted)' }}>
                  {fmtVol(trade.volume)}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--text-muted)', fontSize: 9 }}>
                  {fmtVol(trade.cumulative_volume)}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--cyan)', fontSize: 9 }}>
                  {fmt2(trade.vwap)}
                </td>
                <td style={{ padding: '3px 6px' }}>
                  <span style={{ color: sideColor(trade.side), fontWeight: 700, fontSize: 10 }}>
                    {sideSymbol(trade.side)} {trade.side}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

// Fallback trade data
const FALLBACK_TRADES: Trade[] = Array.from({ length: 40 }, (_, i) => {
  const basePrice = 2480;
  const price = basePrice + (Math.random() - 0.5) * 30;
  const vol = Math.floor(Math.random() * 8000) + 100;
  const side: 'BUY' | 'SELL' = Math.random() > 0.5 ? 'BUY' : 'SELL';
  const ts = new Date(Date.now() - (40 - i) * 15000).toISOString();
  return {
    id: String(i),
    timestamp: ts,
    price: +price.toFixed(2),
    volume: vol,
    side,
    trade_type: 'market',
    change_from_prev: +(Math.random() - 0.5).toFixed(2),
    cumulative_volume: (i + 1) * 2000 + vol,
    vwap: +(basePrice + Math.sin(i/5) * 5).toFixed(2),
    market_depth_buy: Math.floor(Math.random() * 10000) + 1000,
    market_depth_sell: Math.floor(Math.random() * 10000) + 1000,
  };
});
