/**
 * CryptoDashboard — Bloomberg CRYP panel equivalent
 * Real-time prices from CryptoCompare WebSocket cache + OHLCV chart + news
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { apiFetch } from '../hooks/useApi';

interface CryptoPrice {
  symbol: string;
  price?: number;
  open24h?: number;
  high24h?: number;
  low24h?: number;
  volume24h?: number;
  changePct24h?: number;
  change24h?: number;
  marketCap?: number;
  // From REST top endpoint (CryptoCompare schema)
  price_usd?: number;
  market_cap?: number;
  volume_24h?: number;
  change_pct_24h?: number;
  change_24h?: number;   // CoinGecko raw field
  high_24h?: number;
  low_24h?: number;
  name?: string;
  image?: string;
}

interface OHLCVBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CryptoNews {
  id: string;
  headline: string;
  url: string;
  source: string;
  published_at: number;
  tags?: string;
}

const TOP_20 = [
  'BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','DOT','LINK',
  'MATIC','UNI','ATOM','LTC','NEAR','FTM','ALGO','VET','MANA','SAND',
];

const fmt = (v?: number, digits = 2) =>
  v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const fmtLarge = (v?: number) => {
  if (v == null) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toFixed(2)}`;
};

const timeAgo = (ts?: number) => {
  if (!ts) return '';
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
};

// ── Module-level cache — seeded by Terminal.tsx prefetchApi at startup ────────
// The _apiCache in useApi.ts is populated 3s after app launch, so when this
// component first mounts the coins are already available: useState initialiser
// reads the cache synchronously → zero loading state on first visit.
function _readCoinCache(): CryptoPrice[] {
  try {
    // Access the shared useApi cache via a direct fetch (synchronous read only)
    const key = '/api/crypto/top?limit=20';
    // useApiData's _apiCache is module-level; we can't reach it without the hook.
    // Instead we check sessionStorage as a secondary warm-up path.
    const raw = sessionStorage.getItem('crypto_top_cache');
    if (raw) {
      const { data, exp } = JSON.parse(raw) as { data: CryptoPrice[]; exp: number };
      if (exp > Date.now()) return data;
    }
  } catch {}
  return [];
}

async function _warmCryptoCache(): Promise<void> {
  try {
    const res = await fetch('/api/crypto/top?limit=20');
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      sessionStorage.setItem('crypto_top_cache', JSON.stringify({ data, exp: Date.now() + 60_000 }));
    }
  } catch {}
}

// Warm immediately on module load (happens when Vite imports this chunk)
_warmCryptoCache();

export const CryptoDashboard: React.FC = () => {
  const cachedCoins = _readCoinCache();
  const [prices, setPrices] = useState<Record<string, CryptoPrice>>(() => {
    const m: Record<string, CryptoPrice> = {};
    cachedCoins.forEach(c => { m[c.symbol] = c; });
    return m;
  });
  const [topCoins, setTopCoins] = useState<CryptoPrice[]>(cachedCoins);
  const [selected, setSelected] = useState<string>('BTC');
  const [history, setHistory] = useState<OHLCVBar[]>([]);
  const [news, setNews] = useState<CryptoNews[]>([]);
  const [resolution, setResolution] = useState<'day' | 'hour'>('day');
  const [histDays, setHistDays] = useState(365);
  const [activeTab, setActiveTab] = useState<'chart' | 'table' | 'news'>('chart');
  const [loading, setLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval>>();

  // ── WebSocket: subscribe to crypto_tick broadcasts ─────────────────────────
  // RAF batching: accumulate all ticks in pricesRef, render once per animation
  // frame (16ms) — eliminates per-tick re-renders while keeping display smooth.
  const pricesRef = useRef<Record<string, CryptoPrice>>({});
  const rafRef    = useRef<number | null>(null);

  useEffect(() => {
    const scheduleRender = () => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        setPrices({ ...pricesRef.current });
        rafRef.current = null;
      });
    };

    const connect = () => {
      const ws = new WebSocket(`ws://127.0.0.1:8000/ws`);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'crypto_tick' && msg.data?.symbol) {
            const d   = msg.data;
            const sym = (d.symbol as string).toUpperCase();
            // Merge into ref immediately — zero re-render cost
            pricesRef.current[sym] = { ...(pricesRef.current[sym] || {}), ...d, symbol: sym };
            scheduleRender();
          }
        } catch {}
      };
      ws.onclose = () => setTimeout(connect, 2000);
      ws.onerror = () => {};
    };
    connect();
    return () => {
      wsRef.current?.close();
      clearInterval(pingRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ── REST: fetch top coins (for table + initial prices) ─────────────────────
  // Priority: Delta Exchange WS cache (instant) → /api/crypto/top → /api/crypto
  const loadTop = useCallback(async () => {
    // 1. Delta Exchange WS cache — served from in-process memory, sub-ms latency
    let data = await apiFetch<CryptoPrice[]>('/api/crypto/delta');

    // 2. Fallback: /api/crypto/top (CryptoCompare → CoinGecko chain in backend)
    if (!data || data.length < 5) {
      data = await apiFetch<CryptoPrice[]>('/api/crypto/top?limit=20');
    }

    // 3. Last resort: raw CoinGecko endpoint
    if (!data || data.length === 0) {
      const cg = await apiFetch<CryptoPrice[]>('/api/crypto?limit=20');
      if (cg && cg.length > 0) {
        // CoinGecko returns change_24h; normalise to change_pct_24h so table renders
        data = cg.map(c => ({
          ...c,
          price_usd:      (c as any).price ?? c.price_usd,
          change_pct_24h: (c as any).change_24h ?? c.change_pct_24h,
        }));
      }
    }

    if (data && data.length > 0) {
      setTopCoins(data);
      const map: Record<string, CryptoPrice> = {};
      data.forEach(c => { map[c.symbol] = c; });
      setPrices(prev => {
        const merged: Record<string, CryptoPrice> = { ...map };
        // Overlay live WS prices on top
        Object.entries(prev).forEach(([sym, liveData]) => {
          if (merged[sym]) merged[sym] = { ...merged[sym], ...liveData };
          else merged[sym] = liveData;
        });
        return merged;
      });
    }
  }, []);

  // ── REST: fetch OHLCV history ──────────────────────────────────────────────
  const loadHistory = useCallback(async (sym: string, res: string, lim: number) => {
    setLoading(true);
    const data = await apiFetch<OHLCVBar[]>(
      `/api/crypto/history/${sym}?resolution=${res}&limit=${lim}`
    );
    setHistory(data || []);
    setLoading(false);
  }, []);

  // ── REST: fetch crypto news ────────────────────────────────────────────────
  const loadNews = useCallback(async () => {
    const data = await apiFetch<CryptoNews[]>('/api/crypto/news?limit=20');
    setNews(data || []);
  }, []);

  // loadTop every 60s — Delta WS crypto_tick messages override REST data in real-time.
  // The REST call is just to seed the table on first load; live prices come via WS.
  useEffect(() => {
    loadTop();
    loadNews();
    const t = setInterval(loadTop, 60_000);
    return () => clearInterval(t);
  }, [loadTop, loadNews]);
  useEffect(() => { loadHistory(selected, resolution, resolution === 'day' ? histDays : 168); }, [selected, resolution, histDays, loadHistory]);

  // Update last bar in history chart when a live Delta tick arrives for selected coin
  const tickPrice = prices[selected]?.price;
  useEffect(() => {
    if (!tickPrice || !history.length) return;
    setHistory(prev => {
      if (!prev.length) return prev;
      const updated = [...prev];
      const last    = { ...updated[updated.length - 1] };
      last.close    = tickPrice;
      last.high     = Math.max(last.high, tickPrice);
      last.low      = Math.min(last.low,  tickPrice);
      updated[updated.length - 1] = last;
      return updated;
    });
  }, [tickPrice]);

  // Derived chart data
  const chartData = history.map(b => ({
    t: new Date(b.time * 1000).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
    close: b.close,
    volume: b.volume,
  }));

  const selCoin = prices[selected] || topCoins.find(c => c.symbol === selected);
  const livePrice = selCoin?.price ?? selCoin?.price_usd;
  const liveChange = selCoin?.changePct24h ?? selCoin?.change_pct_24h ?? selCoin?.change_24h;
  const positive = (liveChange ?? 0) >= 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0a0a', color: '#e8e8e0', fontFamily: 'Consolas, monospace', overflow: 'hidden' }}>

      {/* ── Header bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', borderBottom: '1px solid #1a1a1a', background: '#111', flexShrink: 0 }}>
        <span style={{ color: '#ff9500', fontWeight: 700, fontSize: 12 }}>◆ CRYPTO</span>
        <span style={{ color: '#555', fontSize: 10 }}>|</span>
        {selCoin && (
          <>
            <span style={{ color: '#ff9500', fontWeight: 700 }}>{selected}/USD</span>
            <span style={{ color: '#e8e8e0', fontWeight: 700, fontSize: 15 }}>
              ${livePrice != null ? livePrice.toLocaleString('en-US', { maximumFractionDigits: livePrice < 1 ? 6 : 2 }) : '—'}
            </span>
            <span style={{ color: positive ? '#00c853' : '#ff3d00', fontWeight: 700, fontSize: 12 }}>
              {positive ? '▲' : '▼'} {Math.abs(liveChange ?? 0).toFixed(2)}%
            </span>
            <span style={{ color: '#888', fontSize: 10 }}>
              H:{fmt(selCoin.high24h ?? selCoin.high_24h, 2)} L:{fmt(selCoin.low24h ?? selCoin.low_24h, 2)}
            </span>
            <span style={{ color: '#555', fontSize: 10 }}>MCAP: {fmtLarge(selCoin.marketCap ?? selCoin.market_cap)}</span>
          </>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: '#00c853' }}>● LIVE</span>
      </div>

      {/* ── Symbol strip ── */}
      <div style={{ display: 'flex', gap: 2, padding: '4px 8px', borderBottom: '1px solid #1a1a1a', overflowX: 'auto', flexShrink: 0, background: '#0d0d0d' }}>
        {TOP_20.map(sym => {
          const c = prices[sym];
          const pct = c?.changePct24h ?? c?.change_pct_24h ?? c?.change_24h ?? 0;
          const p   = c?.price ?? c?.price_usd;
          return (
            <button
              key={sym}
              onClick={() => setSelected(sym)}
              style={{
                background: selected === sym ? '#1e2a1e' : 'transparent',
                border: `1px solid ${selected === sym ? '#2d5a2d' : '#1a1a1a'}`,
                borderRadius: 3, padding: '3px 8px', cursor: 'pointer',
                color: pct >= 0 ? '#00c853' : '#ff3d00',
                fontSize: 10, whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              <span style={{ color: '#ff9500', marginRight: 4, fontWeight: 700 }}>{sym}</span>
              {p != null ? (p >= 1 ? `$${p.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${p.toFixed(5)}`) : '—'}
              <span style={{ marginLeft: 4, fontSize: 9 }}>
                {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        {(['chart', 'table', 'news'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: activeTab === tab ? '#1a1a1a' : 'transparent',
              border: 'none', borderBottom: activeTab === tab ? '2px solid #ff9500' : '2px solid transparent',
              color: activeTab === tab ? '#ff9500' : '#666',
              padding: '6px 16px', cursor: 'pointer', fontSize: 11,
              fontFamily: 'Consolas, monospace', fontWeight: 700,
            }}
          >
            {tab.toUpperCase()}
          </button>
        ))}
        {activeTab === 'chart' && (
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center', paddingRight: 12 }}>
            {(['1W', '1M', '3M', '1Y', '5Y'] as const).map(r => {
              const days = r === '1W' ? 7 : r === '1M' ? 30 : r === '3M' ? 90 : r === '1Y' ? 365 : 1825;
              return (
                <button
                  key={r}
                  onClick={() => { setHistDays(days); setResolution('day'); }}
                  style={{
                    background: histDays === days ? '#1e2a1e' : 'transparent',
                    border: '1px solid', borderColor: histDays === days ? '#2d5a2d' : '#333',
                    color: histDays === days ? '#00c853' : '#666',
                    padding: '2px 8px', cursor: 'pointer', fontSize: 10,
                    fontFamily: 'Consolas, monospace', borderRadius: 2,
                  }}
                >
                  {r}
                </button>
              );
            })}
            <button
              onClick={() => setResolution('hour')}
              style={{
                background: resolution === 'hour' ? '#1e2a1e' : 'transparent',
                border: '1px solid', borderColor: resolution === 'hour' ? '#2d5a2d' : '#333',
                color: resolution === 'hour' ? '#00c853' : '#666',
                padding: '2px 8px', cursor: 'pointer', fontSize: 10,
                fontFamily: 'Consolas, monospace', borderRadius: 2,
              }}
            >
              1H
            </button>
          </div>
        )}
      </div>

      {/* ── Content area ── */}
      <div style={{ flex: 1, overflow: 'hidden' }}>

        {/* CHART TAB */}
        {activeTab === 'chart' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px 4px' }}>
            {loading && (
              <div style={{ textAlign: 'center', color: '#555', padding: 20, fontSize: 11 }}>Loading chart…</div>
            )}
            {!loading && chartData.length > 0 && (
              <>
                <div style={{ flex: 3 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <defs>
                        <linearGradient id="cryptoGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={positive ? '#00c853' : '#ff3d00'} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={positive ? '#00c853' : '#ff3d00'} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                      <XAxis dataKey="t" tick={{ fill: '#555', fontSize: 9 }} tickLine={false} interval="preserveStartEnd" />
                      <YAxis
                        tick={{ fill: '#555', fontSize: 9 }} tickLine={false} axisLine={false}
                        tickFormatter={v => `$${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(v < 1 ? 4 : 2)}`}
                        width={72}
                      />
                      <Tooltip
                        contentStyle={{ background: '#111', border: '1px solid #333', fontSize: 11 }}
                        formatter={(v: any) => [`$${Number(v).toLocaleString('en-US', { maximumFractionDigits: v < 1 ? 6 : 2 })}`, 'Price']}
                        labelStyle={{ color: '#888' }}
                      />
                      <Area
                        type="monotone" dataKey="close"
                        stroke={positive ? '#00c853' : '#ff3d00'}
                        strokeWidth={1.5}
                        fill="url(#cryptoGrad)"
                        dot={false} activeDot={{ r: 3 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                {/* Volume bar */}
                <div style={{ flex: 1, marginTop: 4 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 0, right: 16, left: 8, bottom: 4 }}>
                      <XAxis dataKey="t" hide />
                      <YAxis tick={{ fill: '#444', fontSize: 8 }} tickLine={false} axisLine={false} width={72}
                        tickFormatter={v => fmtLarge(v).replace('$', '')} />
                      <Tooltip
                        contentStyle={{ background: '#111', border: '1px solid #333', fontSize: 10 }}
                        formatter={(v: any) => [fmtLarge(Number(v)), 'Volume']}
                      />
                      <Area type="monotone" dataKey="volume" stroke="#3a3a3a" fill="#1a1a1a" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
        )}

        {/* TABLE TAB */}
        {activeTab === 'table' && (
          <div style={{ height: '100%', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: '#111', position: 'sticky', top: 0, zIndex: 2 }}>
                  {['#', 'Symbol', 'Price (USD)', '24h %', 'MCap', '24h Vol', 'H24', 'L24'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: h === '#' || h === 'Symbol' ? 'left' : 'right', color: '#888', fontWeight: 600, borderBottom: '1px solid #222', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(topCoins.length > 0 ? topCoins : TOP_20.map(s => ({ symbol: s } as CryptoPrice))).map((coin, i) => {
                  const live = prices[coin.symbol];
                  const pct  = live?.changePct24h ?? coin.change_pct_24h ?? coin.change_24h ?? 0;
                  const price = live?.price ?? coin.price_usd ?? coin.price;
                  return (
                    <tr
                      key={coin.symbol}
                      onClick={() => { setSelected(coin.symbol); setActiveTab('chart'); }}
                      style={{ borderBottom: '1px solid #111', cursor: 'pointer', background: selected === coin.symbol ? '#0d1a0d' : 'transparent' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#111')}
                      onMouseLeave={e => (e.currentTarget.style.background = selected === coin.symbol ? '#0d1a0d' : 'transparent')}
                    >
                      <td style={{ padding: '5px 10px', color: '#555' }}>{i + 1}</td>
                      <td style={{ padding: '5px 10px', color: '#ff9500', fontWeight: 700 }}>{coin.symbol}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: '#e8e8e0', fontWeight: 700 }}>
                        {price != null ? `$${price.toLocaleString('en-US', { maximumFractionDigits: price < 1 ? 6 : 2 })}` : '—'}
                      </td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: pct >= 0 ? '#00c853' : '#ff3d00', fontWeight: 700 }}>
                        {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                      </td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: '#aaa' }}>{fmtLarge(live?.marketCap ?? coin.market_cap)}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: '#888' }}>{fmtLarge(live?.volume24h ?? coin.volume_24h)}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: '#555' }}>{fmt(live?.high24h ?? coin.high_24h)}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: '#555' }}>{fmt(live?.low24h ?? coin.low_24h)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* NEWS TAB */}
        {activeTab === 'news' && (
          <div style={{ height: '100%', overflowY: 'auto', padding: '8px 12px' }}>
            {news.length === 0 && <div style={{ color: '#555', fontSize: 11, textAlign: 'center', padding: 20 }}>Loading news…</div>}
            {news.map(item => (
              <div key={item.id} style={{ marginBottom: 12, borderBottom: '1px solid #1a1a1a', paddingBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#e8e8e0', fontSize: 12, fontWeight: 600, textDecoration: 'none', flex: 1, lineHeight: 1.4 }}
                  >
                    {item.headline}
                  </a>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 10, color: '#555' }}>
                  <span style={{ color: '#ff9500' }}>{item.source}</span>
                  <span>{timeAgo(item.published_at)}</span>
                  {item.tags && <span style={{ color: '#2d5a2d' }}>{item.tags.split('|').slice(0, 3).join(' · ')}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CryptoDashboard;
