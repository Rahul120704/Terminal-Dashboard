/**
 * Global Pub/Sub Event Bus — RxJS Subject-based
 *
 * Used to decouple the shell from MFEs and MFEs from each other.
 * All active panels subscribe to TICKER_CHANGE so they auto-update
 * when the user types a new symbol in the MnemonicCLI.
 *
 * Usage:
 *   eventBus.emit('TICKER_CHANGE', { ticker: 'RELIANCE', source: 'CLI' });
 *   eventBus.on('TICKER_CHANGE').subscribe(({ payload }) => ...);
 */

import { Subject, Observable } from 'rxjs';
import { filter, share } from 'rxjs/operators';

// ── Event type catalogue ───────────────────────────────────────────────────────
export type EventType =
  | 'TICKER_CHANGE'       // User changed active security
  | 'MNEMONIC_EXEC'       // User ran a command (DES, YCRV, etc.)
  | 'THEME_CHANGE'        // Dark ↔ Light toggle
  | 'TIMEFRAME_CHANGE'    // Chart period changed (1D, 1W, 1M...)
  | 'WS_TICK'             // Raw market tick from WebSocket
  | 'WS_STATUS'           // WS connection state change
  | 'MFE_LOADED'          // A remote MFE finished loading
  | 'MFE_ERROR'           // A remote MFE failed to load
  | 'ALERT_TRIGGERED'     // Price alert fired
  | 'PANEL_FOCUS'         // User switched the active panel
  | 'ORDER_INTENT'        // MFE requests the order panel
  | 'BROADCAST';          // Generic shell → all MFEs broadcast

// ── Typed payloads ─────────────────────────────────────────────────────────────
export interface TickerChangePayload {
  ticker: string;
  exchange?: 'NSE' | 'BSE' | 'MCX' | 'NCDEX' | 'NSE_FO';
  assetClass?: 'EQUITY' | 'OPTION' | 'FUTURE' | 'BOND' | 'FX' | 'COMMODITY';
  source: 'CLI' | 'SIDEBAR' | 'MFE' | 'DEEPDIVE' | 'SCREENER';
}

export interface MnemonicExecPayload {
  mnemonic: string;
  args: string[];
  rawInput: string;
}

export interface WSTickPayload {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  timestamp: number;
}

export interface WSStatusPayload {
  connected: boolean;
  url: string;
  latencyMs?: number;
}

export interface MFELoadedPayload {
  mnemonic: string;
  scope: string;
  durationMs: number;
}

export interface MFEErrorPayload {
  mnemonic: string;
  error: string;
}

// ── Payload map (for type safety on emit/on) ───────────────────────────────────
export interface EventPayloadMap {
  TICKER_CHANGE: TickerChangePayload;
  MNEMONIC_EXEC: MnemonicExecPayload;
  THEME_CHANGE: { theme: 'dark' | 'light' };
  TIMEFRAME_CHANGE: { period: string; bars: number };
  WS_TICK: WSTickPayload;
  WS_STATUS: WSStatusPayload;
  MFE_LOADED: MFELoadedPayload;
  MFE_ERROR: MFEErrorPayload;
  ALERT_TRIGGERED: { symbol: string; price: number; condition: string };
  PANEL_FOCUS: { mnemonic: string };
  ORDER_INTENT: { symbol: string; side: 'BUY' | 'SELL' };
  BROADCAST: { key: string; value: unknown };
}

export interface BusEvent<T extends EventType = EventType> {
  type: T;
  payload: EventPayloadMap[T];
  source?: string;
  timestamp: number;
}

// ── EventBus class ─────────────────────────────────────────────────────────────
export class EventBus {
  private readonly _subject = new Subject<BusEvent>();
  readonly events$: Observable<BusEvent> = this._subject.asObservable().pipe(share());

  emit<T extends EventType>(
    type: T,
    payload: EventPayloadMap[T],
    source?: string,
  ): void {
    this._subject.next({ type, payload, source, timestamp: Date.now() });
  }

  /** Returns a filtered observable for a specific event type */
  on<T extends EventType>(type: T): Observable<BusEvent<T>> {
    return this.events$.pipe(
      filter((e): e is BusEvent<T> => e.type === type),
    );
  }

  /** Subscribe with an inline callback (returns unsubscribe fn) */
  subscribe<T extends EventType>(
    type: T,
    handler: (event: BusEvent<T>) => void,
  ): () => void {
    const sub = this.on(type).subscribe(handler);
    return () => sub.unsubscribe();
  }

  destroy(): void {
    this._subject.complete();
  }
}

// Singleton — injected into every MFE via MFEProps.bus
export const eventBus = new EventBus();
