import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';

interface SearchResult {
  symbol: string;
  name: string;
  sector: string;
  exchange: string;
  price?: number;
  change_pct?: number;
}

interface Props {
  onSelect: (symbol: string) => void;
  placeholder?: string;
}

export const TickerSearch: React.FC<Props> = ({ onSelect, placeholder = 'Search symbol or company…' }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const priceAbortRef = useRef<AbortController | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q || q.length < 1) { setResults([]); setOpen(false); return; }

    // Cancel any in-flight price fetch from prior search
    priceAbortRef.current?.abort();

    setLoading(true);
    const data = await apiFetch<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}&limit=12`);
    const items = data || [];
    setResults(items);
    setOpen(true);
    setHighlighted(0);
    setLoading(false);

    // ── Background price fetch for symbols missing from quote cache ──────────
    const missing = items.filter(r => r.price === undefined || r.price === null).map(r => r.symbol);
    if (missing.length > 0) {
      const ctrl = new AbortController();
      priceAbortRef.current = ctrl;
      try {
        const symbols = missing.slice(0, 8).join(',');
        const prices = await apiFetch<Record<string, { price: number; change_pct: number }>>(
          `/api/quick-quote?symbols=${encodeURIComponent(symbols)}`,
          { signal: ctrl.signal } as RequestInit,
        );
        if (prices && !ctrl.signal.aborted) {
          setResults(prev =>
            prev.map(r => {
              const q = prices[r.symbol];
              if (q && (r.price === undefined || r.price === null)) {
                return { ...r, price: q.price, change_pct: q.change_pct };
              }
              return r;
            })
          );
        }
      } catch {
        // Aborted or network error — ignore
      }
    }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 120);
    return () => clearTimeout(debounceRef.current);
  }, [query, search]);

  const select = (sym: string) => {
    onSelect(sym.toUpperCase());
    setQuery('');
    setOpen(false);
    setResults([]);
    priceAbortRef.current?.abort();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[highlighted]) select(results[highlighted].symbol); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fmtChange = (v?: number) => {
    if (v === undefined || v === null) return '';
    return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  };

  return (
    <div style={{ position: 'relative', minWidth: 260 }}>
      <div style={{ display: 'flex', alignItems: 'center', background: '#1a1a1a', border: '1px solid #333', borderRadius: 3 }}>
        <span style={{ color: 'var(--text-muted)', padding: '0 6px', fontSize: 11 }}>⌕</span>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value.toUpperCase())}
          onKeyDown={onKeyDown}
          onFocus={() => query.length > 0 && setOpen(true)}
          placeholder={placeholder}
          style={{
            background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--text-primary)', fontSize: 11, fontFamily: 'var(--font-mono)',
            width: '100%', height: 26, padding: '0 4px',
          }}
          autoComplete="off"
          spellCheck={false}
        />
        {loading && <span style={{ color: 'var(--text-muted)', fontSize: 10, paddingRight: 6 }}>…</span>}
      </div>

      {open && results.length > 0 && (
        <div
          ref={listRef}
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999,
            background: '#111', border: '1px solid #333', borderTop: 'none',
            maxHeight: 360, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.8)',
            transform: 'translateZ(0)',
            willChange: 'transform',
          }}
        >
          {results.map((r, i) => (
            <div
              key={r.symbol}
              onClick={() => select(r.symbol)}
              style={{
                display: 'flex', alignItems: 'center', padding: '6px 10px',
                cursor: 'pointer', gap: 8,
                background: i === highlighted ? '#1e2a1e' : 'transparent',
                borderBottom: '1px solid #1a1a1a',
                transition: 'background 0.1s',
              }}
              onMouseEnter={() => setHighlighted(i)}
            >
              <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 12, minWidth: 80 }}>{r.symbol}</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 10, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 9, minWidth: 30 }}>{r.exchange}</span>
              {r.price !== undefined && r.price !== null ? (
                <span style={{ color: 'var(--text-primary)', fontSize: 11, fontWeight: 700, minWidth: 60, textAlign: 'right' }}>
                  ₹{r.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)', fontSize: 10, minWidth: 60, textAlign: 'right', fontStyle: 'italic' }}>—</span>
              )}
              {r.change_pct !== undefined && r.change_pct !== null && (
                <span style={{
                  color: r.change_pct >= 0 ? 'var(--green)' : 'var(--red)',
                  fontSize: 10, fontWeight: 700, minWidth: 54, textAlign: 'right',
                }}>
                  {fmtChange(r.change_pct)}
                </span>
              )}
              {r.sector && <span style={{ color: 'var(--text-muted)', fontSize: 9, minWidth: 70, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sector}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
