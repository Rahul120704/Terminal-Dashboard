import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import { useAllQuotes } from '../store/marketStore';

interface WatchItem {
  symbol: string;
  note?: string;
  addedAt: string;
}

interface Props {
  onSelectTicker: (sym: string) => void;
}

interface SymbolHit {
  symbol: string;
  name: string;
}

const STORAGE_KEY = 'bti_watchlist_v1';
const DEFAULT_WATCHLIST: WatchItem[] = [
  { symbol: 'RELIANCE',  addedAt: '' },
  { symbol: 'TCS',       addedAt: '' },
  { symbol: 'INFY',      addedAt: '' },
  { symbol: 'HDFCBANK',  addedAt: '' },
  { symbol: 'WIPRO',     addedAt: '' },
  { symbol: 'ICICIBANK', addedAt: '' },
  { symbol: 'AXISBANK',  addedAt: '' },
  { symbol: 'SBIN',      addedAt: '' },
  { symbol: 'BAJFINANCE', addedAt: '' },
  { symbol: 'NIFTY',    addedAt: '' },
];

function loadList(): WatchItem[] {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? JSON.parse(s) : DEFAULT_WATCHLIST;
  } catch { return DEFAULT_WATCHLIST; }
}
function saveList(l: WatchItem[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(l)); }

function fmtVol(v?: number): string {
  if (!v) return '—';
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  return v.toLocaleString();
}

// ── Inline search/autocomplete for adding tickers ────────────────────────────
const WatchlistAddBar: React.FC<{ onAdd: (sym: string) => void }> = ({ onAdd }) => {
  const [query, setQuery]           = useState('');
  const [hits, setHits]             = useState<SymbolHit[]>([]);
  const [open, setOpen]             = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [loading, setLoading]       = useState(false);
  const inputRef  = useRef<HTMLInputElement>(null);
  const dropRef   = useRef<HTMLDivElement>(null);
  const debounceR = useRef<ReturnType<typeof setTimeout>>();

  const search = useCallback(async (q: string) => {
    if (!q || q.length < 1) { setHits([]); setOpen(false); return; }
    setLoading(true);
    try {
      // Try Fyers symbol master first (4500+ stocks), fall back to search API
      const masterData = await apiFetch<{ results: SymbolHit[] }>(
        `/api/market-symbols?q=${encodeURIComponent(q)}&limit=10`
      );
      const fromMaster: SymbolHit[] = masterData?.results ?? [];

      if (fromMaster.length > 0) {
        setHits(fromMaster);
      } else {
        // Fallback: stock universe search
        const searchData = await apiFetch<Array<{ symbol: string; name: string }>>(
          `/api/search?q=${encodeURIComponent(q)}&limit=10`
        );
        setHits((searchData ?? []).map(r => ({ symbol: r.symbol, name: r.name })));
      }
      setOpen(true);
      setHighlighted(0);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    clearTimeout(debounceR.current);
    debounceR.current = setTimeout(() => search(query), 150);
    return () => clearTimeout(debounceR.current);
  }, [query, search]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropRef.current && !dropRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const commit = (sym: string) => {
    if (!sym) return;
    onAdd(sym.toUpperCase());
    setQuery('');
    setHits([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && hits[highlighted]) commit(hits[highlighted].symbol);
      else if (query.trim()) commit(query.trim());
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          background: '#111', border: '1px solid #2a2a2a', borderRadius: 2,
          flex: 1,
        }}>
          <span style={{ color: 'var(--text-muted)', padding: '0 5px', fontSize: 10 }}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value.toUpperCase())}
            onKeyDown={onKeyDown}
            onFocus={() => query.length > 0 && hits.length > 0 && setOpen(true)}
            placeholder="Add ticker…"
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-primary)', fontSize: 10,
              fontFamily: 'var(--font-mono)',
              width: 90, height: 22, padding: '0 2px',
            }}
            autoComplete="off"
            spellCheck={false}
          />
          {loading && <span style={{ color: 'var(--text-muted)', fontSize: 9, paddingRight: 4 }}>…</span>}
        </div>
        <button
          className="btn btn-amber"
          onClick={() => {
            if (open && hits[highlighted]) commit(hits[highlighted].symbol);
            else if (query.trim()) commit(query.trim());
          }}
          style={{ padding: '1px 7px', fontSize: 10, flexShrink: 0 }}
          title="Add to watchlist (Enter)"
        >+</button>
      </div>

      {/* Autocomplete dropdown */}
      {open && hits.length > 0 && (
        <div
          ref={dropRef}
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999,
            background: '#111', border: '1px solid #2a2a2a', borderTop: 'none',
            maxHeight: 220, overflowY: 'auto',
            boxShadow: '0 6px 20px rgba(0,0,0,0.8)',
          }}
        >
          {hits.map((hit, i) => (
            <div
              key={hit.symbol}
              onClick={() => commit(hit.symbol)}
              onMouseEnter={() => setHighlighted(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 8px', cursor: 'pointer',
                background: i === highlighted ? 'rgba(255,149,0,0.1)' : 'transparent',
                borderBottom: '1px solid #1a1a1a',
              }}
            >
              <span style={{
                color: 'var(--amber)', fontWeight: 700, fontSize: 11,
                minWidth: 70, fontFamily: 'var(--font-mono)',
              }}>
                {hit.symbol}
              </span>
              <span style={{
                color: 'var(--text-muted)', fontSize: 9,
                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {hit.name}
              </span>
            </div>
          ))}
          <div style={{ padding: '3px 8px', borderTop: '1px solid #1a1a1a', fontSize: 8, color: '#333' }}>
            ↑↓ navigate · Enter to add · Esc close
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main Watchlist component ──────────────────────────────────────────────────
export const Watchlist: React.FC<Props> = ({ onSelectTicker }) => {
  const quotes = useAllQuotes();
  const [list, setList]       = useState<WatchItem[]>(loadList);
  const [sortBy, setSortBy]   = useState<'symbol' | 'change_pct' | 'volume'>('change_pct');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [flashMap, setFlashMap] = useState<Record<string, 'up' | 'down'>>({});
  const prevPrices = useRef<Record<string, number>>({});

  useEffect(() => { saveList(list); }, [list]);

  // Flash row on price change
  useEffect(() => {
    const newFlash: Record<string, 'up' | 'down'> = {};
    list.forEach(item => {
      const q = quotes[item.symbol];
      if (!q) return;
      const prev = prevPrices.current[item.symbol];
      if (prev !== undefined && q.price !== prev) {
        newFlash[item.symbol] = q.price > prev ? 'up' : 'down';
      }
      prevPrices.current[item.symbol] = q.price;
    });
    if (Object.keys(newFlash).length) {
      setFlashMap(newFlash);
      setTimeout(() => setFlashMap({}), 400);
    }
  }, [quotes, list]);

  const handleAdd = (sym: string) => {
    if (!sym || list.some(i => i.symbol === sym)) return;
    setList(prev => [...prev, { symbol: sym, addedAt: new Date().toISOString() }]);
  };

  const handleRemove = (sym: string) => setList(prev => prev.filter(i => i.symbol !== sym));

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) setSortDir(d => d === 1 ? -1 : 1);
    else { setSortBy(field); setSortDir(-1); }
  };

  type QuoteEntry = ReturnType<typeof useAllQuotes>[string];
  const sorted = [...list].sort((a, b) => {
    const qa: Partial<QuoteEntry> = quotes[a.symbol] ?? {};
    const qb: Partial<QuoteEntry> = quotes[b.symbol] ?? {};
    if (sortBy === 'symbol')     return sortDir * a.symbol.localeCompare(b.symbol);
    if (sortBy === 'change_pct') return sortDir * ((qa.change_pct ?? 0) - (qb.change_pct ?? 0));
    if (sortBy === 'volume')     return sortDir * ((qa.volume ?? 0) - (qb.volume ?? 0));
    return 0;
  });

  const SortHdr = ({ field, label }: { field: typeof sortBy; label: string }) => (
    <th onClick={() => handleSort(field)} style={{ cursor: 'pointer', userSelect: 'none' }}>
      {label} {sortBy === field ? (sortDir === -1 ? '▼' : '▲') : ''}
    </th>
  );

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ flexDirection: 'column', gap: 4, paddingBottom: 4 }}>
        <span className="panel-title" style={{ marginBottom: 2 }}>WATCHLIST</span>
        <WatchlistAddBar onAdd={handleAdd} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              <SortHdr field="symbol" label="TICKER" />
              <th style={{ textAlign: 'right' }}>LTP</th>
              <th style={{ textAlign: 'right' }}>CHG</th>
              <SortHdr field="change_pct" label="CHG%" />
              <th style={{ textAlign: 'right' }}>H</th>
              <th style={{ textAlign: 'right' }}>L</th>
              <SortHdr field="volume" label="VOL" />
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map(item => {
              const q     = quotes[item.symbol];
              const flash = flashMap[item.symbol];
              const bgFlash = flash === 'up'   ? 'rgba(0,200,83,0.15)'
                            : flash === 'down' ? 'rgba(255,61,0,0.15)'
                            : undefined;
              return (
                <tr
                  key={item.symbol}
                  onClick={() => onSelectTicker(item.symbol)}
                  style={{ background: bgFlash, transition: 'background 0.1s', cursor: 'pointer' }}
                >
                  <td style={{ color: 'var(--amber)', fontWeight: 700 }}>
                    {item.symbol}
                    {item.note && (
                      <span style={{ fontSize: 8, color: 'var(--text-muted)', marginLeft: 3 }}>
                        {item.note}
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>
                    {q ? q.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                  </td>
                  <td style={{
                    textAlign: 'right', fontWeight: 700,
                    color: q ? (q.change >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)',
                  }}>
                    {q ? `${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)}` : '—'}
                  </td>
                  <td style={{
                    textAlign: 'right', fontWeight: 700,
                    color: q ? (q.change_pct >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)',
                  }}>
                    {q ? `${q.change_pct >= 0 ? '▲' : '▼'}${Math.abs(q.change_pct).toFixed(2)}%` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 10, color: 'var(--text-secondary)' }}>
                    {q?.high?.toFixed(2) || '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 10, color: 'var(--text-secondary)' }}>
                    {q?.low?.toFixed(2) || '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 10, color: 'var(--cyan)' }}>
                    {fmtVol(q?.volume)}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => handleRemove(item.symbol)}
                      style={{
                        background: 'none', border: 'none',
                        color: 'var(--text-muted)', cursor: 'pointer',
                        fontSize: 11, padding: '0 2px', lineHeight: 1,
                      }}
                      title="Remove from watchlist"
                    >×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{
        padding: '3px 8px', borderTop: '1px solid var(--border)',
        fontSize: 9, color: 'var(--text-muted)', flexShrink: 0,
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>{list.length} symbols · click to chart</span>
        <span style={{ color: '#333' }}>sorted by {sortBy}</span>
      </div>
    </div>
  );
};
