/**
 * Bloomberg-style fine-grained market data store.
 *
 * ⚠️  CRITICAL RULE for useSyncExternalStore:
 *     getSnapshot MUST return the SAME reference between data changes.
 *     Returning a new object on every call causes an infinite render loop.
 *     We cache snapshots and only rebuild them inside _flush() — once per
 *     RAF frame, not once per getSnapshot() call.
 */

import { useSyncExternalStore, useCallback, useEffect, useState } from 'react';
import type { Quote, IndexData } from '../types/index';

type Listener = () => void;

// ── Compact protocol field map ─────────────────────────────────────────────────
export interface CompactTick {
  s:  string;
  p:  number;
  c?: number;
  cp?: number;
  v?: number;
  o?: number;
  h?: number;
  l?: number;
  pc?: number;
  n?: string;
}

export function expandCompactTick(t: CompactTick): Quote {
  return {
    symbol:     t.s,
    price:      t.p,
    change:     t.c  ?? 0,
    change_pct: t.cp ?? 0,
    volume:     t.v  ?? 0,
    open:       t.o  ?? 0,
    high:       t.h  ?? 0,
    low:        t.l  ?? 0,
    prev_close: t.pc ?? 0,
    name:       t.n,
  };
}

// ── Core store ─────────────────────────────────────────────────────────────────
class MarketDataStore {
  // ── Quote storage ────────────────────────────────────────────────────────────
  private _quotes      = new Map<string, Quote>();
  private _quoteListeners  = new Map<string, Set<Listener>>();
  private _wildcardListeners = new Set<Listener>();

  // ── Cached snapshots (STABLE REFERENCES for useSyncExternalStore) ────────────
  // Only rebuilt inside _flush() — one allocation per RAF frame, not per getSnapshot() call.
  private _quotesSnapshot:  Record<string, Quote> = {};
  private _indicesSnapshot: IndexData[]            = [];

  // ── Index storage ────────────────────────────────────────────────────────────
  private _indices     = new Map<string, IndexData>();
  private _indexListeners = new Map<string, Set<Listener>>();
  private _allIdxListeners = new Set<Listener>();

  // ── RAF batching ──────────────────────────────────────────────────────────────
  private _pendingQuotes  = new Set<string>();
  private _pendingIndices = new Set<string>();
  private _rafId: number | null = null;
  private _timeoutId: ReturnType<typeof setTimeout> | null = null;

  private _flush = () => {
    // First to fire (RAF or backstop timeout) wins; cancel the other.
    if (this._rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this._rafId);
    }
    if (this._timeoutId !== null) clearTimeout(this._timeoutId);
    this._rafId = null;
    this._timeoutId = null;

    // ── Quote notifications ─────────────────────────────────────────────────
    if (this._pendingQuotes.size > 0) {
      // Patch only changed symbols — O(changed) not O(all 500+ symbols).
      // Object.fromEntries on 500 entries every 30fps was generating ~15k
      // property assignments/sec and significant GC pressure.
      const next: Record<string, Quote> = { ...this._quotesSnapshot };
      for (const sym of this._pendingQuotes) {
        const q = this._quotes.get(sym);
        if (q !== undefined) next[sym] = q;
      }
      this._quotesSnapshot = next;

      for (const sym of this._pendingQuotes) {
        this._quoteListeners.get(sym)?.forEach(fn => fn());
      }
      this._wildcardListeners.forEach(fn => fn());
      this._pendingQuotes.clear();
    }

    // ── Index notifications ─────────────────────────────────────────────────
    if (this._pendingIndices.size > 0) {
      // Same pattern — rebuild array once, same reference until next flush.
      this._indicesSnapshot = Array.from(this._indices.values());

      for (const name of this._pendingIndices) {
        this._indexListeners.get(name)?.forEach(fn => fn());
      }
      this._allIdxListeners.forEach(fn => fn());
      this._pendingIndices.clear();
    }
  };

  private _schedule() {
    if (this._rafId !== null || this._timeoutId !== null) return;
    if (typeof requestAnimationFrame !== 'undefined') {
      this._rafId = requestAnimationFrame(this._flush);
      // 1500ms backstop: only fires when tab is invisible long enough for RAF
      // to be throttled to near-zero. In foreground, RAF wins at ~16ms and
      // cancels this before it can fire — no double-flush in normal use.
      this._timeoutId = setTimeout(this._flush, 1500);
    } else {
      this._timeoutId = setTimeout(this._flush, 16);
    }
  }

  // ── Quote mutations ──────────────────────────────────────────────────────────

  setQuote(sym: string, q: Quote): void {
    this._quotes.set(sym, q);
    this._pendingQuotes.add(sym);
    this._schedule();
  }

  patchQuote(sym: string, partial: Partial<Quote>): void {
    const existing = this._quotes.get(sym);
    this._quotes.set(sym, existing ? { ...existing, ...partial } : partial as Quote);
    this._pendingQuotes.add(sym);
    this._schedule();
  }

  setQuotesSnapshot(snapshot: Record<string, Quote>): void {
    for (const [sym, q] of Object.entries(snapshot)) {
      this._quotes.set(sym, q);
      this._pendingQuotes.add(sym);
    }
    this._schedule();
  }

  applyTicks(ticks: Partial<Quote>[]): void {
    for (const t of ticks) {
      if (!t.symbol) continue;
      const existing = this._quotes.get(t.symbol);
      this._quotes.set(t.symbol, existing ? { ...existing, ...t } : t as Quote);
      this._pendingQuotes.add(t.symbol);
    }
    this._schedule();
  }

  applyCompactTicks(ticks: CompactTick[]): void {
    for (const t of ticks) {
      if (!t.s) continue;
      const q = expandCompactTick(t);
      const existing = this._quotes.get(t.s);
      this._quotes.set(t.s, existing ? { ...existing, ...q } : q);
      this._pendingQuotes.add(t.s);
    }
    this._schedule();
  }

  // ── Quote queries ────────────────────────────────────────────────────────────

  getQuote(sym: string): Quote | undefined {
    return this._quotes.get(sym);
  }

  /**
   * Returns the CACHED snapshot — same reference until next _flush().
   * Safe to pass to useSyncExternalStore's getSnapshot.
   */
  getQuoteSnapshot(): Record<string, Quote> {
    return this._quotesSnapshot;
  }

  getQuoteMap(): ReadonlyMap<string, Quote> {
    return this._quotes;
  }

  // ── Quote subscriptions ──────────────────────────────────────────────────────

  subscribeSymbol(sym: string, fn: Listener): () => void {
    if (!this._quoteListeners.has(sym)) this._quoteListeners.set(sym, new Set());
    this._quoteListeners.get(sym)!.add(fn);
    return () => this._quoteListeners.get(sym)?.delete(fn);
  }

  subscribeAllQuotes(fn: Listener): () => void {
    this._wildcardListeners.add(fn);
    return () => this._wildcardListeners.delete(fn);
  }

  // ── Index mutations ──────────────────────────────────────────────────────────

  setIndicesArray(arr: IndexData[]): void {
    for (const idx of arr) {
      this._indices.set(idx.name, idx);
      this._pendingIndices.add(idx.name);
    }
    this._schedule();
  }

  patchIndex(name: string, partial: Partial<IndexData>): void {
    const existing = this._indices.get(name);
    this._indices.set(name, existing ? { ...existing, ...partial } : partial as IndexData);
    this._pendingIndices.add(name);
    this._schedule();
  }

  // ── Index queries ────────────────────────────────────────────────────────────

  getIndex(name: string): IndexData | undefined {
    return this._indices.get(name);
  }

  /**
   * Returns the CACHED array — same reference until next _flush().
   * Safe to pass to useSyncExternalStore's getSnapshot.
   */
  getIndicesSnapshot(): IndexData[] {
    return this._indicesSnapshot;
  }

  // ── Index subscriptions ──────────────────────────────────────────────────────

  subscribeIndex(name: string, fn: Listener): () => void {
    if (!this._indexListeners.has(name)) this._indexListeners.set(name, new Set());
    this._indexListeners.get(name)!.add(fn);
    return () => this._indexListeners.get(name)?.delete(fn);
  }

  subscribeAllIndices(fn: Listener): () => void {
    this._allIdxListeners.add(fn);
    return () => this._allIdxListeners.delete(fn);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
export const marketStore = new MarketDataStore();

// ── Stable module-level subscribe/snapshot references ─────────────────────────
// useSyncExternalStore requires these to be STABLE across renders.
// Arrow functions defined inside hooks are recreated every render — don't do that.
// Module-level constants are created once and never change.
const _subAllQuotes   = (cb: Listener) => marketStore.subscribeAllQuotes(cb);
const _snapAllQuotes  = ()             => marketStore.getQuoteSnapshot();
const _subAllIndices  = (cb: Listener) => marketStore.subscribeAllIndices(cb);
const _snapAllIndices = ()             => marketStore.getIndicesSnapshot();

// ── React hooks ───────────────────────────────────────────────────────────────

/**
 * useQuote(symbol)
 * Re-renders ONLY when this specific symbol ticks.
 * subscribe/snapshot wrapped in useCallback — stable per symbol string.
 */
export function useQuote(symbol: string): Quote | undefined {
  return useSyncExternalStore(
    useCallback((cb: Listener) => marketStore.subscribeSymbol(symbol, cb), [symbol]),
    useCallback(() => marketStore.getQuote(symbol), [symbol]),
  );
}

/**
 * useAllQuotes()
 * Re-renders when ANY quote changes (one re-render per RAF frame max).
 * Uses stable module-level functions — no new references between renders.
 */
export function useAllQuotes(): Record<string, Quote> {
  return useSyncExternalStore(_subAllQuotes, _snapAllQuotes);
}

/**
 * useConstituentsQuotes(symbols)
 * Efficiently subscribe to a fixed set of symbols (e.g., NIFTY 50 constituents).
 * symbols must be a stable reference (module-level const).
 */
export function useConstituentsQuotes(symbols: readonly string[]): Map<string, Quote> {
  const [snap, setSnap] = useState<Map<string, Quote>>(() => {
    const m = new Map<string, Quote>();
    for (const s of symbols) {
      const q = marketStore.getQuote(s);
      if (q) m.set(s, q);
    }
    return m;
  });

  useEffect(() => {
    let rafId: number | null = null;
    const unsubs: Array<() => void> = [];

    const scheduleUpdate = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const m = new Map<string, Quote>();
        for (const s of symbols) {
          const q = marketStore.getQuote(s);
          if (q) m.set(s, q);
        }
        setSnap(m);
      });
    };

    for (const sym of symbols) {
      unsubs.push(marketStore.subscribeSymbol(sym, scheduleUpdate));
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      unsubs.forEach(fn => fn());
    };
  }, [symbols]);

  return snap;
}

/**
 * useIndexData(name)
 * Re-renders only when THAT index value changes.
 */
export function useIndexData(name: string): IndexData | undefined {
  return useSyncExternalStore(
    useCallback((cb: Listener) => marketStore.subscribeIndex(name, cb), [name]),
    useCallback(() => marketStore.getIndex(name), [name]),
  );
}

/**
 * useAllIndices()
 * Re-renders when any index changes.
 * Uses stable module-level functions — no infinite loop.
 */
export function useAllIndices(): IndexData[] {
  return useSyncExternalStore(_subAllIndices, _snapAllIndices);
}
