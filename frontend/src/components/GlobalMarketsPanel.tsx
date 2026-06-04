import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApiData } from '../hooks/useApi';

type Tab = 'indices' | 'crypto' | 'forex' | 'prediction' | 'futures';

const fmt = (v: number, dec = 2) => v?.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) || '—';
const fmtChange = (v?: number) => {
  if (v === undefined || v === null || isNaN(v)) return { text: '—', color: 'var(--text-muted)' };
  return { text: `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, color: v >= 0 ? 'var(--green)' : 'var(--red)' };
};

// ── Delta Exchange real-time ticker via backend WebSocket ─────────────────────
// Uses requestAnimationFrame batching: all ticks arriving within one 16ms frame
// are merged into a SINGLE React state update → 60fps renders, zero extra delay.
type TickData = {
  price: number; change: number;
  high24h: number; low24h: number; volume24h: number;
  markPrice: number; fundingRate: number; openInterest: number;
  flash: 'up' | 'down' | null;
};

function useDeltaTicker() {
  const [prices, setPrices] = useState<Record<string, TickData>>({});

  // Refs updated instantly on every WS message — no re-render cost
  const pricesRef    = useRef<Record<string, TickData>>({});
  const prevRef      = useRef<Record<string, number>>({});
  const wsRef        = useRef<WebSocket | null>(null);
  const rafRef       = useRef<number | null>(null);
  const flashTimers  = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const scheduleRender = () => {
      if (rafRef.current !== null) return;        // already scheduled
      rafRef.current = requestAnimationFrame(() => {
        setPrices({ ...pricesRef.current });       // one render for all pending ticks
        rafRef.current = null;
      });
    };

    const connect = () => {
      const ws = new WebSocket('ws://127.0.0.1:8000/ws');
      wsRef.current = ws;

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type !== 'crypto_tick' || !msg.data?.symbol) return;
          const d     = msg.data;
          const sym   = (d.symbol as string).toUpperCase();
          const price = Number(d.price) || 0;
          const prev  = prevRef.current[sym] ?? price;
          const flash: 'up' | 'down' | null =
            price > prev ? 'up' : price < prev ? 'down' : null;
          prevRef.current[sym] = price;

          // Update ref immediately (zero overhead — no re-render)
          pricesRef.current[sym] = {
            price,
            change:       Number(d.changePct24h ?? d.change_pct_24h ?? d.change_24h) || 0,
            high24h:      Number(d.high24h)      || 0,
            low24h:       Number(d.low24h)       || 0,
            volume24h:    Number(d.volume24h)    || 0,
            markPrice:    Number(d.mark_price)   || price,
            fundingRate:  Number(d.funding_rate) || 0,
            openInterest: Number(d.open_interest)|| 0,
            flash,
          };

          // Schedule a batched render (RAF fires at most once per 16ms frame)
          scheduleRender();

          // Clear flash after 400ms
          if (flash) {
            clearTimeout(flashTimers.current[sym]);
            flashTimers.current[sym] = setTimeout(() => {
              if (pricesRef.current[sym]) {
                pricesRef.current[sym] = { ...pricesRef.current[sym], flash: null };
                scheduleRender();
              }
            }, 400);
          }
        } catch (_) {}
      };

      ws.onclose = () => setTimeout(connect, 2000);
      ws.onerror = () => {};
    };

    connect();
    return () => {
      wsRef.current?.close();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      Object.values(flashTimers.current).forEach(clearTimeout);
    };
  }, []);

  return prices;
}

// ── Crypto Tab — Delta Exchange live prices ───────────────────────────────────
const CryptoTab: React.FC = React.memo(() => {
  const { data: crypto } = useApiData<any[]>('/api/crypto?limit=50', 120_000);
  const live = useDeltaTicker();

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead style={{ position: 'sticky', top: 0, background: '#0a0a0a', zIndex: 1 }}>
          <tr>
            <th style={{ textAlign: 'left',  padding: '4px 6px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 400, width: 24 }}>#</th>
            <th style={{ textAlign: 'left',  padding: '4px 6px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>COIN</th>
            <th style={{ textAlign: 'right', padding: '4px 6px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>PRICE</th>
            <th style={{ textAlign: 'right', padding: '4px 6px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>1H%</th>
            <th style={{ textAlign: 'right', padding: '4px 6px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>24H%</th>
            <th style={{ textAlign: 'right', padding: '4px 6px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>7D%</th>
            <th style={{ textAlign: 'right', padding: '4px 6px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>MCAP</th>
            <th style={{ textAlign: 'right', padding: '4px 6px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>LIVE</th>
          </tr>
        </thead>
        <tbody>
          {(crypto || []).map((c: any, i: number) => {
            const sym        = (c.symbol || '').toUpperCase();
            const tick       = live[sym];
            const price      = tick?.price ?? c.price;
            const change24h  = tick?.change ?? c.change_24h;
            const c1h        = fmtChange(c.change_1h);
            const c24        = fmtChange(change24h);
            const c7d        = fmtChange(c.change_7d);
            const mcap       = c.market_cap >= 1e9
              ? `$${(c.market_cap / 1e9).toFixed(1)}B`
              : c.market_cap >= 1e6
              ? `$${(c.market_cap / 1e6).toFixed(0)}M`
              : '—';
            const priceFmt   = price >= 10000 ? fmt(price, 0)
              : price >= 1000 ? fmt(price, 1)
              : price >= 1 ? fmt(price, 2)
              : fmt(price, 5);
            const flashBg    = tick?.flash === 'up'
              ? 'rgba(0,200,83,0.15)'
              : tick?.flash === 'down'
              ? 'rgba(255,61,0,0.15)'
              : 'transparent';

            return (
              <tr key={i} style={{ borderBottom: '1px solid #111', background: flashBg, transition: 'background 0.3s' }}>
                <td style={{ color: 'var(--text-muted)', padding: '3px 6px', fontSize: 9 }}>{c.rank}</td>
                <td style={{ padding: '3px 6px' }}>
                  <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 10 }}>{sym}</span>
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700, padding: '3px 6px', fontSize: 11, fontFamily: 'monospace' }}>
                  ${priceFmt}
                </td>
                <td style={{ textAlign: 'right', color: c1h.color,        padding: '3px 6px', fontSize: 9 }}>{c1h.text}</td>
                <td style={{ textAlign: 'right', color: c24.color, fontWeight: 700, padding: '3px 6px', fontSize: 10 }}>{c24.text}</td>
                <td style={{ textAlign: 'right', color: c7d.color,        padding: '3px 6px', fontSize: 9 }}>{c7d.text}</td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)', padding: '3px 6px', fontSize: 9 }}>{mcap}</td>
                <td style={{ textAlign: 'right', padding: '3px 6px' }}>
                  {tick ? (
                    <span style={{ color: 'var(--green)', fontSize: 8, fontWeight: 700 }}>● LIVE</span>
                  ) : (
                    <span style={{ color: '#333', fontSize: 8 }}>○</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!crypto?.length && <div style={{ color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>Loading crypto…</div>}
    </div>
  );
});

// ── Global Indices Tab ────────────────────────────────────────────────────────
const IndicesTab: React.FC = React.memo(() => {
  const { data: global } = useApiData<any[]>('/api/global-markets', 30000);
  const regions = ['India', 'USA', 'UK', 'Germany', 'Japan', 'HongKong', 'Commodities', 'Bonds'];

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      {regions.map(region => {
        const items = (global || []).filter((g: any) => g.region === region);
        if (!items.length) return null;
        return (
          <div key={region} style={{ marginBottom: 6 }}>
            <div style={{ color: 'var(--amber)', fontSize: 9, fontWeight: 700, padding: '3px 8px', background: '#0e0e0e', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid #1a1a1a' }}>
              {region}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {items.map((g: any, i: number) => {
                  const chg = fmtChange(g.change_pct);
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                      <td style={{ color: 'var(--text-secondary)', fontSize: 10, padding: '3px 8px', whiteSpace: 'nowrap' }}>{g.name}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, padding: '3px 8px', fontSize: 11, fontFamily: 'monospace' }}>{fmt(g.price)}</td>
                      <td style={{ textAlign: 'right', color: chg.color, fontWeight: 700, padding: '3px 8px', fontSize: 10, minWidth: 60 }}>{chg.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      {!global?.length && <div style={{ color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>Loading global markets…</div>}
    </div>
  );
});

// ── Forex Tab ─────────────────────────────────────────────────────────────────
const ForexTab: React.FC = React.memo(() => {
  const { data: forex } = useApiData<Record<string, any>>('/api/forex', 15000);
  const rates = forex ? Object.values(forex) : [];

  const MAJORS = ['USDINR', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCNY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD'];

  const getDisplayName = (r: any) =>
    (r.symbol || '').replace('=X', '').replace('-Y.NYB', '').replace('INR=', '').replace('X=', '');

  const sorted = [...rates].sort((a, b) => {
    const ai = MAJORS.indexOf(getDisplayName(a));
    const bi = MAJORS.indexOf(getDisplayName(b));
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return getDisplayName(a).localeCompare(getDisplayName(b));
  });

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      <div style={{ color: 'var(--amber)', fontSize: 9, fontWeight: 700, padding: '3px 8px', background: '#0e0e0e', borderBottom: '1px solid #1a1a1a' }}>FOREX / FX RATES</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead style={{ position: 'sticky', top: 0, background: '#0a0a0a' }}>
          <tr>
            <th style={{ textAlign: 'left',  padding: '4px 8px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>PAIR</th>
            <th style={{ textAlign: 'right', padding: '4px 8px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>RATE</th>
            <th style={{ textAlign: 'right', padding: '4px 8px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>CHG%</th>
            <th style={{ textAlign: 'right', padding: '4px 8px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>DESCRIPTION</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r: any, i: number) => {
            const chg  = fmtChange(r.change_pct);
            const name = getDisplayName(r);
            const isINR = name.includes('INR');
            return (
              <tr key={i} style={{ borderBottom: '1px solid #111', background: isINR ? 'rgba(255,149,0,0.03)' : 'transparent' }}>
                <td style={{ padding: '4px 8px' }}>
                  <span style={{ color: isINR ? 'var(--amber)' : 'var(--text-primary)', fontWeight: 700, fontSize: 11 }}>{name}</span>
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700, padding: '4px 8px', fontSize: 12, fontFamily: 'monospace' }}>
                  {r.price < 1 ? r.price?.toFixed(5) : r.price < 10 ? r.price?.toFixed(4) : fmt(r.price, 2)}
                </td>
                <td style={{ textAlign: 'right', color: chg.color, fontWeight: 700, padding: '4px 8px', fontSize: 10 }}>{chg.text}</td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)', padding: '4px 8px', fontSize: 9 }}>{r.name || ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rates.length && <div style={{ color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>Loading FX rates…</div>}
    </div>
  );
});

// ── Futures Tab — Delta Exchange perpetual futures ────────────────────────────
const FuturesTab: React.FC = React.memo(() => {
  const { data: global }      = useApiData<any[]>('/api/global-markets', 30000);
  const { data: deltaPerps }  = useApiData<any[]>('/api/crypto/delta',   8000);
  const commodities = (global || []).filter((g: any) => g.region === 'Commodities');

  const PERP_SYMS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX'];
  const fmtVol = (v?: number) =>
    !v ? '—' : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`;

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      {/* Commodities */}
      <div style={{ color: 'var(--amber)', fontSize: 9, fontWeight: 700, padding: '3px 8px', background: '#0e0e0e', borderBottom: '1px solid #1a1a1a' }}>COMMODITIES FUTURES</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
        <tbody>
          {commodities.map((g: any, i: number) => {
            const chg = fmtChange(g.change_pct);
            return (
              <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                <td style={{ color: 'var(--text-secondary)', fontSize: 10, padding: '3px 8px' }}>{g.name}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, padding: '3px 8px', fontSize: 11, fontFamily: 'monospace' }}>{fmt(g.price)}</td>
                <td style={{ textAlign: 'right', color: chg.color, fontWeight: 700, padding: '3px 8px', fontSize: 10 }}>{chg.text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Delta Exchange perpetual futures */}
      <div style={{ color: 'var(--amber)', fontSize: 9, fontWeight: 700, padding: '3px 8px', background: '#0e0e0e', borderBottom: '1px solid #1a1a1a' }}>
        CRYPTO PERPS (DELTA EXCHANGE)
        <span style={{ color: 'var(--green)', marginLeft: 8 }}>● LIVE</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left',  padding: '3px 8px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>PAIR</th>
            <th style={{ textAlign: 'right', padding: '3px 8px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>MARK</th>
            <th style={{ textAlign: 'right', padding: '3px 8px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>24H%</th>
            <th style={{ textAlign: 'right', padding: '3px 8px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>FUNDING</th>
            <th style={{ textAlign: 'right', padding: '3px 8px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>OI</th>
          </tr>
        </thead>
        <tbody>
          {PERP_SYMS.map(sym => {
            const d = (deltaPerps || []).find((p: any) => p.symbol === sym);
            if (!d) return (
              <tr key={sym} style={{ borderBottom: '1px solid #111' }}>
                <td style={{ color: 'var(--amber)', fontWeight: 700, padding: '3px 8px', fontSize: 10 }}>{sym}-PERP</td>
                <td colSpan={4} style={{ color: 'var(--text-muted)', padding: '3px 8px', fontSize: 9 }}>
                  {deltaPerps ? '—' : 'Loading…'}
                </td>
              </tr>
            );
            const chg    = fmtChange(d.changePct24h ?? d.change_pct_24h);
            const mark   = d.mark_price || d.price || 0;
            const fr     = d.funding_rate;
            const oi     = d.open_interest;
            const markFmt = mark >= 10000 ? fmt(mark, 0) : mark >= 1 ? fmt(mark, 2) : fmt(mark, 4);
            const frFmt  = fr != null ? `${(fr * 100).toFixed(4)}%` : '—';
            const oiFmt  = oi ? fmtVol(oi * mark) : '—';
            return (
              <tr key={sym} style={{ borderBottom: '1px solid #111' }}>
                <td style={{ color: 'var(--amber)', fontWeight: 700, padding: '3px 8px', fontSize: 10 }}>{sym}-PERP</td>
                <td style={{ textAlign: 'right', fontWeight: 700, padding: '3px 8px', fontSize: 11, fontFamily: 'monospace' }}>${markFmt}</td>
                <td style={{ textAlign: 'right', color: chg.color, fontWeight: 700, padding: '3px 8px', fontSize: 10 }}>{chg.text}</td>
                <td style={{ textAlign: 'right', color: fr != null && fr > 0 ? 'var(--green)' : 'var(--red)', padding: '3px 8px', fontSize: 9 }}>{frFmt}</td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)', padding: '3px 8px', fontSize: 9 }}>{oiFmt}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

// ── Prediction Markets Tab ────────────────────────────────────────────────────
const PredictionTab: React.FC = React.memo(() => {
  const { data: markets } = useApiData<any>('/api/prediction-markets', 120000);
  const poly   = markets?.polymarket || [];
  const kalshi = markets?.kalshi || [];

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      <div style={{ color: 'var(--amber)', fontSize: 9, fontWeight: 700, padding: '4px 8px', background: '#0e0e0e', borderBottom: '1px solid #1a1a1a' }}>POLYMARKET — PREDICTION MARKETS ({poly.length})</div>
      {poly.slice(0, 25).map((m: any, i: number) => (
        <div key={i} style={{ padding: '5px 8px', borderBottom: '1px solid #111' }}>
          <div style={{ color: 'var(--text-primary)', fontSize: 10, marginBottom: 3, lineHeight: 1.4 }}>{m.question}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {m.probabilities?.length > 0 && (
              <>
                <div style={{ flex: 1, background: '#1a1a1a', height: 4, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${m.probabilities[0]?.toFixed(1)}%`, height: '100%', background: 'var(--green)', borderRadius: 2 }} />
                </div>
                <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 11, minWidth: 40 }}>YES {m.probabilities[0]?.toFixed(0)}%</span>
                {m.probabilities[1] !== undefined && (
                  <span style={{ color: 'var(--red)', fontSize: 10 }}>NO {m.probabilities[1]?.toFixed(0)}%</span>
                )}
              </>
            )}
            <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>Vol: ${(m.volume / 1000).toFixed(0)}K</span>
          </div>
        </div>
      ))}
      <div style={{ color: 'var(--amber)', fontSize: 9, fontWeight: 700, padding: '4px 8px', background: '#0e0e0e', borderBottom: '1px solid #1a1a1a', marginTop: 6 }}>MANIFOLD MARKETS ({kalshi.length})</div>
      {kalshi.slice(0, 15).map((m: any, i: number) => (
        <div key={i} style={{ padding: '5px 8px', borderBottom: '1px solid #111' }}>
          <div style={{ color: 'var(--text-primary)', fontSize: 10, marginBottom: 3 }}>{m.question}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {m.yes_price != null && (
              <>
                <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 11 }}>YES {m.yes_price?.toFixed(0)}%</span>
                <span style={{ color: 'var(--red)', fontSize: 10 }}>NO {m.no_price?.toFixed(0)}%</span>
              </>
            )}
            <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>Liq: ${(m.volume || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            {m.unique_bettors > 0 && <span style={{ color: 'var(--cyan)', fontSize: 9 }}>{m.unique_bettors} traders</span>}
          </div>
        </div>
      ))}
      {!poly.length && !kalshi.length && <div style={{ color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>Loading prediction markets…</div>}
    </div>
  );
});

// ── Main Panel ────────────────────────────────────────────────────────────────
export const GlobalMarketsPanel: React.FC = React.memo(() => {
  const [tab, setTab] = useState<Tab>('crypto');

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'crypto',     label: 'CRYPTO'     },
    { id: 'indices',    label: 'INDICES'    },
    { id: 'forex',      label: 'FX'         },
    { id: 'futures',    label: 'FUTURES'    },
    { id: 'prediction', label: 'PREDICTION' },
  ];

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="panel-title">🌐 GLOBAL MARKETS</span>
        <span style={{ color: 'var(--green)', fontSize: 9, fontWeight: 700 }}>● DELTA LIVE</span>
      </div>
      <div style={{ display: 'flex', borderBottom: '1px solid #222', flexShrink: 0, overflowX: 'auto' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--amber)' : '2px solid transparent',
              color: tab === t.id ? 'var(--amber)' : 'var(--text-muted)',
              padding: '5px 10px', cursor: 'pointer', fontSize: 10,
              fontFamily: 'var(--font-mono)', fontWeight: tab === t.id ? 700 : 400,
              flexShrink: 0,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'crypto'     && <CryptoTab />}
        {tab === 'indices'    && <IndicesTab />}
        {tab === 'forex'      && <ForexTab />}
        {tab === 'futures'    && <FuturesTab />}
        {tab === 'prediction' && <PredictionTab />}
      </div>
    </div>
  );
});
