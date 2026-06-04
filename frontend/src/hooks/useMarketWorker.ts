/**
 * useMarketWorker — connects the market data Web Worker to:
 *   1. marketStore  (quotes + indices — direct, bypasses React state)
 *   2. onMessage    (news, filings, sentiment, macro etc. — existing handler)
 *
 * Drop-in replacement for useWebSocket in Terminal.tsx.
 * All tick-parsing + JSON work happens in the Worker off the main thread.
 *
 * Idle-time processing (Bloomberg "render budget"):
 *   Low-priority messages (news, macro) are dispatched via requestIdleCallback
 *   so they never interrupt a high-fps price render cycle.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { marketStore } from '../store/marketStore';
import {
  pushNews, pushNewsArray, pushFiling, mergeTechnicals,
  sentimentStore, macroStore, shockersStore,
  globalStore, hedgeFundStore, guardiansStore,
} from '../store/liveDataStore';
import type { Quote, IndexData } from '../types/index';

// Vite Web Worker import syntax — bundles the worker as a separate chunk
import MarketWorker from '../workers/marketWorker?worker';

type MessageHandler = (msg: Record<string, unknown>) => void;

interface Options {
  /** Called for non-price messages (news, sentiment, macro etc.) */
  onMessage?: MessageHandler;
}

interface UseMarketWorkerReturn {
  connected: boolean;
  send: (data: Record<string, unknown>) => void;
}

// ── Idle-time dispatcher ──────────────────────────────────────────────────────
// Bloomberg technique: high-priority renders (prices) are never blocked by
// low-priority work (news feeds, macro data). We schedule low-priority messages
// during browser idle time so they don't compete with RAF-based renders.
function dispatchIdleOrImmediate(fn: () => void): void {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(fn, { timeout: 2000 });
  } else {
    setTimeout(fn, 0);
  }
}

// ── Main hook ─────────────────────────────────────────────────────────────────
export function useMarketWorker({ onMessage }: Options = {}): UseMarketWorkerReturn {
  const [connected, setConnected] = useState(false);
  const workerRef   = useRef<Worker | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;   // always up-to-date without re-creating effect

  // ── Worker message handler ────────────────────────────────────────────────
  const handleWorkerMessage = useCallback((evt: MessageEvent<Record<string, unknown>>) => {
    const msg  = evt.data;
    const type = msg.type as string;

    // ── Price & index data → directly into store (no React setState) ───────
    switch (type) {
      case 'tick_update': {
        const data = msg.data;
        const ticks: Partial<Quote>[] = Array.isArray(data) ? data : [data as Partial<Quote>];
        marketStore.applyTicks(ticks);
        // Also pass to onMessage for lastTick tracking in Terminal
        onMessageRef.current?.(msg);
        return;
      }
      case 'quotes': {
        const data = msg.data as Record<string, Quote> | undefined;
        if (data) marketStore.setQuotesSnapshot(data);
        return;
      }
      case 'indices': {
        const data = msg.data as IndexData[] | undefined;
        if (Array.isArray(data)) marketStore.setIndicesArray(data);
        // Also forward to onMessage — Terminal.tsx still uses indices state for some components
        onMessageRef.current?.(msg);
        return;
      }

      // ── WS connection lifecycle ───────────────────────────────────────────
      case '_ws_connected':
        setConnected(true);
        onMessageRef.current?.({ type: 'connected' });
        return;
      case '_ws_disconnected':
        setConnected(false);
        return;

      // ── Instant auth update ───────────────────────────────────────────────
      case 'fyers_auth':
        onMessageRef.current?.(msg);
        return;
    }

    // ── Non-price live data → directly into isolated stores ──────────────
    // Each store has its own RAF-batched flush. Only the component that
    // subscribes to that store re-renders — NOT the entire Terminal tree.
    const d = (msg.data ?? (msg as any).payload) as any;
    switch (type) {
      case 'news':
        if (Array.isArray(d)) pushNewsArray(d);
        else if (d?.headline) pushNews(d);
        // Also forward to onMessage so Terminal can track ticker-specific news
        onMessageRef.current?.(msg);
        return;

      case 'filing':
        if (d) pushFiling(d);
        onMessageRef.current?.(msg);
        return;

      case 'sentiment_update':
        if (d) sentimentStore.set(d);
        // Forward so Terminal can read regime for header
        onMessageRef.current?.(msg);
        return;

      case 'macro_update':
        if (d) macroStore.set(d);
        return;   // MacroPanel reads macroStore directly — no prop needed

      case 'technicals_update':
        if (d && typeof d === 'object') mergeTechnicals(d);
        return;   // TechnicalIndicators reads techStore directly

      case 'volume_shockers':
        if (Array.isArray(d)) shockersStore.set(d);
        return;   // VolumeShockers reads shockersStore directly

      case 'global_markets':
        if (d) globalStore.set(d);
        return;   // GlobalMarketsPanel reads globalStore directly

      case 'hedge_fund_update':
        if (d) hedgeFundStore.set(d);
        return;   // HedgeFundPanel reads hedgeFundStore directly

      case 'guardian_alert':
      case 'guardian_status':
        if (d) guardiansStore.set(d);
        return;
    }

    // ── Low-priority messages → idle dispatch ────────────────────────────
    if ((msg as { _lowPriority?: boolean })._lowPriority) {
      dispatchIdleOrImmediate(() => onMessageRef.current?.(msg));
      return;
    }

    // ── Everything else → immediate dispatch ─────────────────────────────
    onMessageRef.current?.(msg);
  }, []);

  // ── Worker lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    let worker: Worker;
    try {
      worker = new MarketWorker();
    } catch {
      // Web Workers not available (e.g., file:// origin) — fallback handled externally
      console.warn('[BTI] Web Worker unavailable — falling back to main-thread WS');
      return;
    }

    worker.addEventListener('message', handleWorkerMessage);
    workerRef.current = worker;

    // Resolve backend WS base URL.
    // Three contexts:
    //   1. Electron prod  — loads from file://, hostname = '' → always localhost:8000
    //   2. Browser dev    — loads from http://localhost:3000  → backend on :8000
    //   3. Browser prod   — same host/port as the HTTP server
    const proto = window.location.protocol;
    const host  = window.location.hostname;
    const wsBase =
      proto === 'file:' || host === '' || host === 'localhost' || host === '127.0.0.1'
        ? 'ws://localhost:8000'
        : `ws://${window.location.host}`;

    worker.postMessage({ type: 'connect', url: `${wsBase}/ws/v2` });

    return () => {
      worker.postMessage({ type: 'disconnect' });
      worker.removeEventListener('message', handleWorkerMessage);
      worker.terminate();
      workerRef.current = null;
    };
  }, [handleWorkerMessage]);

  // ── send function (subscribe, get_quote, etc.) ────────────────────────────
  const send = useCallback((data: Record<string, unknown>) => {
    workerRef.current?.postMessage({ type: 'send', data });
  }, []);

  return { connected, send };
}
