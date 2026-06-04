/**
 * liveDataStore — Bloomberg-style isolated stores for non-price live data.
 *
 * Same architecture as marketStore.ts:
 *   • useSyncExternalStore for React 18 concurrent-mode safety
 *   • RAF-batched notifications — one flush per animation frame max
 *   • Stable snapshot references — no new object allocations between flushes
 *   • Each store is INDEPENDENT — news arriving never re-renders MacroPanel,
 *     sentiment update never re-renders NewsPanel, etc.
 *
 * Before this refactor, ALL WS messages landed in Terminal.tsx setState(),
 * causing the entire PanelRouter tree to re-render on every news/filing/
 * sentiment/macro message — even panels that didn't care.
 *
 * Bloomberg's proprietary JS terminal uses the same principle: each
 * "component cell" subscribes only to the data channels it actually needs.
 */

import { useSyncExternalStore, useCallback } from 'react';
import type {
  NewsItem, FilingItem, MarketSentiment,
  MacroDashboard, TechnicalSignal, VolumeShockerItem,
} from '../types';

type Listener = () => void;

// ── Generic RAF-batched store ──────────────────────────────────────────────────
class LiveStore<T> {
  private _data: T;
  private _snapshot: T;
  private _listeners = new Set<Listener>();
  private _rafId: number | null = null;
  private _timeoutId: ReturnType<typeof setTimeout> | null = null;
  private _dirty = false;

  constructor(initial: T) {
    this._data = initial;
    this._snapshot = initial;
  }

  private _flush = () => {
    if (this._rafId  !== null && typeof cancelAnimationFrame !== 'undefined')
      cancelAnimationFrame(this._rafId);
    if (this._timeoutId !== null) clearTimeout(this._timeoutId);
    this._rafId = null;
    this._timeoutId = null;

    if (this._dirty) {
      this._snapshot = this._data;
      this._dirty = false;
      this._listeners.forEach(fn => fn());
    }
  };

  private _schedule() {
    if (this._rafId !== null || this._timeoutId !== null) return;
    if (typeof requestAnimationFrame !== 'undefined') {
      this._rafId = requestAnimationFrame(this._flush);
      // 1500ms backstop — same as marketStore; RAF wins in foreground
      this._timeoutId = setTimeout(this._flush, 1500);
    } else {
      this._timeoutId = setTimeout(this._flush, 16);
    }
  }

  set(value: T): void {
    this._data = value;
    this._dirty = true;
    this._schedule();
  }

  /** Mutate current value in-place. fn receives current data, returns next data. */
  update(fn: (current: T) => T): void {
    this._data = fn(this._data);
    this._dirty = true;
    this._schedule();
  }

  get(): T { return this._data; }

  /** Stable reference — never changes between flushes. Safe for useSyncExternalStore. */
  getSnapshot(): T { return this._snapshot; }

  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
}

// ── Store instances ────────────────────────────────────────────────────────────

export const newsStore      = new LiveStore<NewsItem[]>([]);
export const filingsStore   = new LiveStore<FilingItem[]>([]);
export const sentimentStore = new LiveStore<MarketSentiment | null>(null);
export const macroStore     = new LiveStore<MacroDashboard | null>(null);
export const techStore      = new LiveStore<Record<string, TechnicalSignal>>({});
export const shockersStore  = new LiveStore<VolumeShockerItem[]>([]);
export const globalStore    = new LiveStore<any>(null);
export const hedgeFundStore = new LiveStore<any>(null);
export const guardiansStore = new LiveStore<any>(null);

// ── Typed update helpers ───────────────────────────────────────────────────────

/** Prepend one news item, cap at 200. Deduplicates by id or headline prefix. */
export function pushNews(item: NewsItem): void {
  newsStore.update(prev => {
    const key = (item as any).id ?? item.headline?.slice(0, 50);
    if (key && prev.some(n => ((n as any).id ?? n.headline?.slice(0, 50)) === key))
      return prev; // duplicate
    return [item, ...prev].slice(0, 200);
  });
}

/** Replace with array OR prepend array (WS sends both forms). */
export function pushNewsArray(items: NewsItem[]): void {
  if (!items.length) return;
  newsStore.update(prev => {
    const existing = new Set(prev.map(n => (n as any).id ?? n.headline?.slice(0, 50)));
    const fresh = items.filter(i => {
      const k = (i as any).id ?? i.headline?.slice(0, 50);
      return !k || !existing.has(k);
    });
    return [...fresh, ...prev].slice(0, 200);
  });
}

/** Prepend one filing, cap at 100. */
export function pushFiling(item: FilingItem): void {
  filingsStore.update(prev => [item, ...prev].slice(0, 100));
}

/** Merge technicals update — only update symbols present in patch. */
export function mergeTechnicals(patch: Record<string, TechnicalSignal>): void {
  techStore.update(prev => ({ ...prev, ...patch }));
}

// ── Module-level stable references for useSyncExternalStore ───────────────────
// These MUST be module-level constants — functions created inside hooks/components
// are recreated on every render, breaking the "subscribe is stable" contract.
const _subNews       = (cb: Listener) => newsStore.subscribe(cb);
const _snapNews      = ()             => newsStore.getSnapshot();
const _subFilings    = (cb: Listener) => filingsStore.subscribe(cb);
const _snapFilings   = ()             => filingsStore.getSnapshot();
const _subSentiment  = (cb: Listener) => sentimentStore.subscribe(cb);
const _snapSentiment = ()             => sentimentStore.getSnapshot();
const _subMacro      = (cb: Listener) => macroStore.subscribe(cb);
const _snapMacro     = ()             => macroStore.getSnapshot();
const _subTech       = (cb: Listener) => techStore.subscribe(cb);
const _snapTech      = ()             => techStore.getSnapshot();
const _subShockers   = (cb: Listener) => shockersStore.subscribe(cb);
const _snapShockers  = ()             => shockersStore.getSnapshot();
const _subGlobal     = (cb: Listener) => globalStore.subscribe(cb);
const _snapGlobal    = ()             => globalStore.getSnapshot();
const _subHF         = (cb: Listener) => hedgeFundStore.subscribe(cb);
const _snapHF        = ()             => hedgeFundStore.getSnapshot();
const _subGuardians  = (cb: Listener) => guardiansStore.subscribe(cb);
const _snapGuardians = ()             => guardiansStore.getSnapshot();

// ── React hooks ───────────────────────────────────────────────────────────────

/** Re-renders only when news list changes (new item pushed). */
export function useLiveNews(): NewsItem[] {
  return useSyncExternalStore(_subNews, _snapNews);
}

/** Filter by ticker — re-renders when news for that ticker arrives. */
export function useTickerNews(ticker: string): NewsItem[] {
  const all = useSyncExternalStore(_subNews, _snapNews);
  return useCallback(
    () => all.filter(n =>
      n.ticker === ticker ||
      (n.headline ?? '').toUpperCase().includes(ticker.toUpperCase())
    ),
    [all, ticker]
  )();
}

/** Re-renders only when a new filing arrives. */
export function useLiveFilings(): FilingItem[] {
  return useSyncExternalStore(_subFilings, _snapFilings);
}

/** Re-renders only when sentiment/regime changes. */
export function useSentiment(): MarketSentiment | null {
  return useSyncExternalStore(_subSentiment, _snapSentiment);
}

/** Re-renders only when macro dashboard data changes. */
export function useMacroDash(): MacroDashboard | null {
  return useSyncExternalStore(_subMacro, _snapMacro);
}

/** Re-renders when ANY technical signal is updated. */
export function useTechnicals(): Record<string, TechnicalSignal> {
  return useSyncExternalStore(_subTech, _snapTech);
}

/** Single-symbol technical signals — re-renders only when that symbol updates. */
export function useSymbolTechnicals(sym: string): TechnicalSignal | null {
  const all = useSyncExternalStore(_subTech, _snapTech);
  return all[sym] ?? null;
}

/** Re-renders when volume shockers list changes. */
export function useVolumeShockers(): VolumeShockerItem[] {
  return useSyncExternalStore(_subShockers, _snapShockers);
}

/** Re-renders when global markets data changes. */
export function useGlobalData(): any {
  return useSyncExternalStore(_subGlobal, _snapGlobal);
}

/** Re-renders when hedge fund state changes. */
export function useHedgeFundState(): any {
  return useSyncExternalStore(_subHF, _snapHF);
}

/** Re-renders when Guardian status changes. */
export function useGuardianState(): any {
  return useSyncExternalStore(_subGuardians, _snapGuardians);
}
