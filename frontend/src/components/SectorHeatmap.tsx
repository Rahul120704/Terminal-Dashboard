/**
 * SectorHeatmap — live sector performance + rotation view
 *
 * Performance fix: subscribes to marketStore directly via ref + 2-second
 * interval, rather than useAllQuotes() which triggers 60 re-renders/second.
 *
 * Time horizons: 1D uses live quote cache (zero latency); 5D/1M/3M fetch
 * from /api/sector-performance which queries DuckDB OHLCV history.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { marketStore } from '../store/marketStore';
import { useApiData } from '../hooks/useApi';
import type { Quote } from '../types';

type Horizon = '1D' | '5D' | '1M' | '3M';

const SECTORS: Record<string, string[]> = {
  'IT':          ['TCS', 'INFY', 'WIPRO', 'HCLTECH', 'TECHM', 'LTM', 'MPHASIS', 'PERSISTENT', 'LTTS', 'COFORGE'],
  'Banking':     ['HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK', 'INDUSINDBK', 'BANDHANBNK', 'FEDERALBNK', 'IDFCFIRSTB', 'PNB'],
  'NBFC':        ['BAJFINANCE', 'BAJAJFINSV', 'CHOLAFIN', 'MUTHOOTFIN', 'SHRIRAMFIN', 'MANAPPURAM', 'LICHSGFIN', 'HDFCLIFE', 'SBILIFE'],
  'Auto':        ['MARUTI', 'TMCV', 'M&M', 'BAJAJ-AUTO', 'HEROMOTOCO', 'EICHERMOT', 'TVSMOTOR'],
  'Pharma':      ['SUNPHARMA', 'DRREDDY', 'CIPLA', 'DIVISLAB', 'BIOCON', 'TORNTPHARM', 'ALKEM', 'AUROPHARMA'],
  'Energy':      ['RELIANCE', 'ONGC', 'BPCL', 'NTPC', 'POWERGRID', 'TATAPOWER', 'NHPC', 'ADANIGREEN'],
  'Metals':      ['TATASTEEL', 'JSWSTEEL', 'HINDALCO', 'VEDL', 'NMDC', 'COALINDIA', 'SAIL'],
  'FMCG':        ['HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'MARICO', 'DABUR', 'COLPAL', 'GODREJCP', 'UNITDSPR'],
  'Infra':       ['LT', 'ADANIENT', 'ADANIPORTS', 'SIEMENS', 'ABB', 'BHEL'],
  'Real Estate': ['DLF', 'GODREJPROP', 'PRESTIGE', 'OBEROIRLTY', 'PHOENIXLTD'],
  'Cement':      ['ULTRACEMCO', 'GRASIM', 'AMBUJACEM', 'ACC'],
  'Telecom':     ['BHARTIARTL', 'INDUSTOWER'],
};

function heatBg(pct: number): string {
  const intensity = Math.min(Math.abs(pct) / 4, 1);
  if (pct > 0) return `rgba(0,${Math.floor(80 + intensity * 130)},50,0.8)`;
  return `rgba(${Math.floor(110 + intensity * 130)},20,20,0.8)`;
}

function arrow(pct: number): string {
  if (pct > 1) return '▲▲';
  if (pct > 0) return '▲';
  if (pct < -1) return '▼▼';
  if (pct < 0) return '▼';
  return '─';
}

interface SectorSnapshot {
  sector: string;
  avg_change: number;
  breadth: number;  // stocks advancing
  total: number;
  stocks: { symbol: string; change_pct: number; price: number }[];
}

function computeFrom1D(quotes: Record<string, Quote>): SectorSnapshot[] {
  return Object.entries(SECTORS).map(([sector, syms]) => {
    const stocks = syms.map(s => ({
      symbol: s,
      change_pct: quotes[s]?.change_pct || 0,
      price:      quotes[s]?.price || 0,
    }));
    const active = stocks.filter(s => s.price > 0);
    const avg = active.length > 0
      ? active.reduce((sum, s) => sum + s.change_pct, 0) / active.length
      : 0;
    return {
      sector,
      avg_change: avg,
      breadth: active.filter(s => s.change_pct > 0).length,
      total: active.length,
      stocks,
    };
  });
}

interface Props {
  onSelectTicker?: (sym: string) => void;
}

export const SectorHeatmap: React.FC<Props> = ({ onSelectTicker }) => {
  const [horizon, setHorizon] = useState<Horizon>('1D');
  const [sectorData, setSectorData] = useState<SectorSnapshot[]>(() =>
    computeFrom1D(marketStore.getQuoteSnapshot())
  );

  // ── Fix: subscribe via ref + 2s interval instead of useAllQuotes() ───────────
  // useAllQuotes() triggers ~60 re-renders/sec. A 2s timer gives smooth rotation
  // display without hammering the reconciler on every tick.
  const quotesRef = useRef<Record<string, Quote>>(marketStore.getQuoteSnapshot());

  useEffect(() => {
    const unsub = marketStore.subscribeAllQuotes(() => {
      quotesRef.current = marketStore.getQuoteSnapshot();
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (horizon !== '1D') return;
    const update = () => setSectorData(computeFrom1D(quotesRef.current));
    update();
    const t = setInterval(update, 2000); // 2s refresh for 1D live view
    return () => clearInterval(t);
  }, [horizon]);

  // ── Historical horizons: /api/sector-performance ─────────────────────────────
  const { data: histData, loading: histLoading } = useApiData<Record<string, {
    change_pct: number; breadth: number; total: number;
    stocks: { symbol: string; change_pct: number; price: number }[];
  }>>(
    horizon !== '1D' ? `/api/sector-rotation?horizon=${horizon}` : null,
    120_000,  // auto-refresh every 2 min
    60_000,
  );

  const display: SectorSnapshot[] = horizon === '1D'
    ? sectorData
    : histData
      ? Object.entries(histData).map(([sector, d]) => ({
          sector,
          avg_change: d.change_pct,
          breadth: d.breadth,
          total: d.total,
          stocks: d.stocks || [],
        }))
      : sectorData; // fallback to 1D while loading

  const sorted = [...display].sort((a, b) => b.avg_change - a.avg_change);

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="panel-title">SECTOR ROTATION</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
          {histLoading && <span className="spinner" />}
          {(['1D', '5D', '1M', '3M'] as Horizon[]).map(h => (
            <button
              key={h}
              className={`btn ${horizon === h ? 'btn-amber' : ''}`}
              onClick={() => setHorizon(h)}
              style={{ padding: '1px 7px', fontSize: 9 }}
            >{h}</button>
          ))}
        </div>
      </div>

      {/* Rotation summary bar — top movers */}
      <div style={{
        display: 'flex', gap: 1, overflowX: 'auto', background: '#0d0d0d',
        borderBottom: '1px solid #1a1a1a', padding: '3px 6px', flexShrink: 0,
      }}>
        {sorted.slice(0, 6).map(s => (
          <div key={s.sector} style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px',
            background: heatBg(s.avg_change), borderRadius: 2, whiteSpace: 'nowrap', fontSize: 9,
          }}>
            <span style={{ color: 'white', fontWeight: 700 }}>{s.sector}</span>
            <span style={{ color: s.avg_change >= 0 ? '#7fff7f' : '#ff9999', fontWeight: 700 }}>
              {s.avg_change >= 0 ? '+' : ''}{s.avg_change.toFixed(2)}%
            </span>
            <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 8 }}>{arrow(s.avg_change)}</span>
          </div>
        ))}
      </div>

      <div className="panel-body" style={{ padding: 6, overflow: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
          {sorted.map(sector => (
            <div key={sector.sector} style={{ border: '1px solid #1a1a1a', borderRadius: 3, overflow: 'hidden' }}>

              {/* Sector header */}
              <div style={{
                background: heatBg(sector.avg_change),
                padding: '5px 8px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'white' }}>{sector.sector}</span>
                  <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.65)' }}>
                    {sector.breadth}/{sector.total} ▲
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    fontSize: 12, fontWeight: 700,
                    color: sector.avg_change >= 0 ? '#7fff7f' : '#ff8888',
                  }}>
                    {arrow(sector.avg_change)} {sector.avg_change >= 0 ? '+' : ''}{sector.avg_change.toFixed(2)}%
                  </div>
                </div>
              </div>

              {/* Stock grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, padding: 2, background: '#0a0a0a' }}>
                {sector.stocks.slice(0, 9).map(s => (
                  <div
                    key={s.symbol}
                    onClick={() => onSelectTicker?.(s.symbol)}
                    title={`${s.symbol}: ₹${s.price.toFixed(2)} (${s.change_pct >= 0 ? '+' : ''}${s.change_pct.toFixed(2)}%)`}
                    style={{
                      background: heatBg(s.change_pct),
                      padding: '3px 2px', cursor: 'pointer',
                      textAlign: 'center', borderRadius: 1,
                      transition: 'opacity 0.15s',
                    }}
                  >
                    <div style={{ fontSize: 8, color: 'white', fontWeight: 600, letterSpacing: 0.3 }}>{s.symbol}</div>
                    <div style={{
                      fontSize: 8, fontWeight: 700,
                      color: s.change_pct >= 0 ? '#7fff7f' : '#ff8888',
                    }}>
                      {s.change_pct >= 0 ? '+' : ''}{s.change_pct.toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>

            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
