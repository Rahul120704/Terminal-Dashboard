/**
 * TickerBar — scrolling marquee of live prices.
 *
 * Performance design:
 *  • The STRUCTURE (which symbols are visible) rebuilds every 30s only.
 *    This keeps the CSS @keyframes animation alive — it never restarts.
 *  • PRICES update on every WS tick via direct DOM mutation (no React re-render).
 *    The useEffect runs on every quotes/indices change but only touches textContent
 *    and className — zero React reconciliation cost.
 *
 *  Result: smooth, uninterrupted scroll + sub-100ms price refresh.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Quote, IndexData } from '../types';
import { useAllQuotes, useAllIndices } from '../store/marketStore';

interface TickerItem {
  sym: string;
  price: number;
  pct: number;
  isIndex?: boolean;
}

function fmt(v: number): string {
  return v >= 0 ? `+${v.toFixed(2)}%` : `${v.toFixed(2)}%`;
}

function fmtPrice(v: number): string {
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const PRIORITY_INDICES = ['NIFTY 50', 'NIFTY BANK', 'INDIA VIX', 'SENSEX', 'NIFTY IT', 'NIFTY MIDCAP 100'];

// Raw Fyers index symbols that also stream into the quote map — exclude them
// from the alphabetical equity list so they don't duplicate the priority tiles.
const INDEX_RAW_SYMBOLS = new Set([
  'NIFTY50', 'NIFTYBANK', 'INDIAVIX', 'SENSEX', 'NIFTYMIDCAP100', 'NIFTYREALTY',
  'CNXIT', 'CNXPHARMA', 'CNXAUTO', 'CNXMETAL', 'CNXFMCG', 'CNXENERGY', 'NIFTYNEXT50',
]);

// NSE index constituent maps (keep in sync with backend nse_data.py INDEX_MAP)
const INDEX_CONSTITUENTS: Record<string, Set<string>> = {
  ALL:       new Set(),    // empty = show all
  NIFTY50:   new Set(['RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','HINDUNILVR','ITC','SBIN','BHARTIARTL','KOTAKBANK','LT','AXISBANK','ASIANPAINT','MARUTI','NTPC','SUNPHARMA','WIPRO','ULTRACEMCO','BAJFINANCE','TECHM','HCLTECH','TITAN','POWERGRID','ONGC','NESTLEIND','TATAMOTORS','JSWSTEEL','TATASTEEL','ADANIENT','M&M','BAJAJFINSV','COALINDIA','ADANIPORTS','DIVISLAB','CIPLA','BPCL','DRREDDY','HINDALCO','GRASIM','BRITANNIA','HDFCLIFE','SBILIFE','EICHERMOT','APOLLOHOSP','INDUSINDBK','BAJAJ-AUTO','UPL','HEROMOTOCO','TATACONSUM','LTIM']),
  BANKNIFTY: new Set(['HDFCBANK','ICICIBANK','KOTAKBANK','AXISBANK','SBIN','INDUSINDBK','AUBANK','BANDHANBNK','FEDERALBNK','IDFCFIRSTB','PNB','BANKBARODA']),
  NIFTYIT:   new Set(['TCS','INFY','HCLTECH','WIPRO','TECHM','LTIM','MPHASIS','COFORGE','PERSISTENT','OFSS']),
  NIFTYPHARMA: new Set(['SUNPHARMA','DRREDDY','CIPLA','DIVISLAB','APOLLOHOSP','TORNTPHARM','BIOCON','ALKEM','IPCALAB','AUROPHARMA']),
  NIFTYFMCG: new Set(['HINDUNILVR','ITC','NESTLEIND','BRITANNIA','DABUR','MARICO','COLPAL','GODREJCP','TATACONSUM','MCDOWELL-N']),
  NIFTYAUTO: new Set(['MARUTI','TATAMOTORS','M&M','BAJAJ-AUTO','HEROMOTOCO','EICHERMOT','TVSMOTOR','ASHOKLEY','BALKRISIND','MOTHERSON']),
  NIFTYMETAL:new Set(['TATASTEEL','JSWSTEEL','HINDALCO','VEDL','NMDC','SAIL','HINDCOPPER','RATNAMANI','NATIONALUM','COALINDIA']),
  NIFTYENERGY:new Set(['RELIANCE','ONGC','BPCL','GAIL','IOC','TATAPOWER','NTPC','POWERGRID','NHPC','ADANIGREEN']),
  NIFTYREALTY:new Set(['DLF','GODREJPROP','PRESTIGE','OBEROIRLTY','PHOENIXLTD','SOBHA','BRIGADE','NYKAA','MACROTECH','SUNTECK']),
};

const INDEX_OPTIONS = [
  { value: 'ALL',        label: 'ALL' },
  { value: 'NIFTY50',    label: 'NIFTY 50' },
  { value: 'BANKNIFTY',  label: 'BANK NIFTY' },
  { value: 'NIFTYIT',    label: 'NIFTY IT' },
  { value: 'NIFTYPHARMA',label: 'NIFTY PHARMA' },
  { value: 'NIFTYFMCG',  label: 'NIFTY FMCG' },
  { value: 'NIFTYAUTO',  label: 'NIFTY AUTO' },
  { value: 'NIFTYMETAL', label: 'NIFTY METAL' },
  { value: 'NIFTYENERGY',label: 'NIFTY ENERGY' },
  { value: 'NIFTYREALTY',label: 'NIFTY REALTY' },
];

export const TickerBar: React.FC = () => {
  const quotes  = useAllQuotes();
  const indices = useAllIndices();
  // Stable items list — only rebuilt every 30s to prevent animation restart
  const [items, setItems] = useState<TickerItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<string>('ALL');

  // Snapshot refs so the 30s interval can access latest data without being a dep
  const quotesSnap       = useRef(quotes);
  const indicesSnap      = useRef(indices);
  const selectedIndexRef = useRef(selectedIndex);
  quotesSnap.current       = quotes;
  indicesSnap.current      = indices;
  selectedIndexRef.current = selectedIndex;

  // DOM refs for direct price mutation: key = `${sym}:${copyIndex}` (0 or 1 for doubled)
  const priceRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
  const pctRefs   = useRef<Map<string, HTMLSpanElement>>(new Map());

  const buildItems = useCallback(() => {
    const result: TickerItem[] = [];
    const idx_filter = selectedIndexRef.current;
    const constituents = INDEX_CONSTITUENTS[idx_filter] ?? new Set();
    const filterEquity = idx_filter !== 'ALL' && constituents.size > 0;

    // ── Priority indices first (amber) — always shown regardless of filter ──
    for (const name of PRIORITY_INDICES) {
      const idx = indicesSnap.current.find(
        i => (i.name ?? '').toUpperCase().includes(name.split(' ').pop()!)
      );
      if (idx) result.push({ sym: idx.name, price: idx.value, pct: idx.change_pct, isIndex: true });
    }
    // ── Equities — filtered by selected index ──────────────────────────────
    const quoteList = Object.values(quotesSnap.current)
      .filter(q => {
        if (!q.symbol || INDEX_RAW_SYMBOLS.has(q.symbol)) return false;
        if (filterEquity) return constituents.has(q.symbol);
        return true;
      })
      .sort((a, b) => (a.symbol ?? '').localeCompare(b.symbol ?? ''));
    for (const q of quoteList) {
      result.push({ sym: q.symbol, price: q.price, pct: q.change_pct });
    }

    // Clear stale DOM refs before React unmounts old elements
    priceRefs.current.clear();
    pctRefs.current.clear();
    setItems(result);
  }, []);

  // Build on mount, then every 30s
  useEffect(() => {
    buildItems();
    const t = setInterval(buildItems, 30_000);
    return () => clearInterval(t);
  }, [buildItems]);

  // Rebuild promptly the first time data arrives so the ticker isn't blank
  // for up to 30s after load (mount fires before WS/REST data lands).
  useEffect(() => {
    if (items.length === 0 && (Object.keys(quotes).length > 0 || indices.length > 0)) {
      buildItems();
    }
  }, [quotes, indices, items.length, buildItems]);

  // Rebuild immediately when user switches index (ref already updated above)
  useEffect(() => { buildItems(); }, [selectedIndex, buildItems]);

  // ── Direct DOM updates on every tick (NO React re-render) ───────────────
  // Iterate only rendered items (not all 500+ symbols in quotes map).
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    for (const item of itemsRef.current) {
      const live = item.isIndex
        ? indices.find(i => i.name === item.sym)
        : quotes[item.sym];
      if (!live) continue;
      const price = item.isIndex ? (live as IndexData).value : (live as Quote).price;
      const pct   = item.isIndex ? (live as IndexData).change_pct : (live as Quote).change_pct;
      for (let copy = 0; copy < 2; copy++) {
        const key = `${item.sym}:${copy}`;
        const priceEl = priceRefs.current.get(key);
        if (priceEl) priceEl.textContent = fmtPrice(price);
        const pctEl = pctRefs.current.get(key);
        if (pctEl) {
          pctEl.textContent = fmt(pct);
          pctEl.className = `tick-pct ${pct >= 0 ? 'text-green' : 'text-red'}`;
        }
      }
    }
  }, [quotes, indices]);

  // Double items for seamless CSS loop
  const doubled = [
    ...items.map((item, i) => ({ ...item, copy: 0, uid: `${i}:0` })),
    ...items.map((item, i) => ({ ...item, copy: 1, uid: `${i}:1` })),
  ];

  return (
    <div className="ticker-bar" style={{ display: 'flex', alignItems: 'center' }}>
      {/* Index chooser — left side, doesn't scroll */}
      <select
        value={selectedIndex}
        onChange={e => setSelectedIndex(e.target.value)}
        style={{
          flexShrink: 0, fontSize: 9, height: 22, background: '#0d0d0d',
          border: '1px solid #ff9500', color: '#ff9500', padding: '0 4px',
          cursor: 'pointer', fontFamily: 'Consolas, monospace', fontWeight: 700,
          minWidth: 90, marginRight: 4,
        }}
        title="Filter ticker by index"
      >
        {INDEX_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <div
        className="ticker-scroll"
        style={{ animationDuration: `${Math.min(180, Math.max(40, items.length * 1.2))}s`, flex: 1, overflow: 'hidden' }}
      >
        {doubled.map(item => (
          <span key={item.uid} className="ticker-item">
            <span style={{ color: item.isIndex ? 'var(--amber)' : 'var(--text-secondary)' }}>
              {item.sym}
            </span>
            <span
              ref={el => {
                if (el) priceRefs.current.set(`${item.sym}:${item.copy}`, el);
                else    priceRefs.current.delete(`${item.sym}:${item.copy}`);
              }}
              style={{ fontWeight: 700, color: 'var(--text-primary)' }}
            >
              {fmtPrice(item.price)}
            </span>
            <span
              ref={el => {
                if (el) pctRefs.current.set(`${item.sym}:${item.copy}`, el);
                else    pctRefs.current.delete(`${item.sym}:${item.copy}`);
              }}
              className={`tick-pct ${item.pct >= 0 ? 'text-green' : 'text-red'}`}
            >
              {fmt(item.pct)}
            </span>
            <span style={{ color: 'var(--border-bright)', marginLeft: 8 }}>|</span>
          </span>
        ))}
      </div>
    </div>
  );
};
