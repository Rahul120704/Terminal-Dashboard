/**
 * WebSocket Multiplexer
 *
 * Single WS connection to the BTI backend with channel-based subscription routing.
 * MFEs subscribe to named channels ('ticks', 'news', 'macro', ...) and receive
 * only their relevant message slices — no raw JSON parsing on the main thread.
 *
 * Features:
 *  - Exponential backoff reconnection (max 30s)
 *  - Ping/keepalive every 20s
 *  - Symbol-level tick subscriptions (avoids sending all 4500 ticks to MFEs)
 *  - RxJS Subject streams per channel so MFEs can use reactive pipelines
 *  - Latency tracking (via ping timestamps)
 *
 * Channel names mirror the BTI backend WS message types:
 *   ticks, quotes, news, sentiment, macro, technicals, filings,
 *   volume_shockers, hedge_fund, anomalies, earnings
 */

import { Subject, Observable } from 'rxjs';
import { filter, share } from 'rxjs/operators';
import { eventBus } from '../mfe/bus';

// ── Channel types ──────────────────────────────────────────────────────────────
export type WSChannel =
  | 'ticks'
  | 'quotes'
  | 'news'
  | 'sentiment'
  | 'macro'
  | 'technicals'
  | 'filings'
  | 'volume_shockers'
  | 'hedge_fund'
  | 'anomalies'
  | 'earnings'
  | 'crypto'
  | 'global_markets'
  | 'raw';           // All raw messages (for debug)

export interface WSMessage {
  channel: WSChannel;
  type: string;
  data: unknown;
  ts: number;        // server timestamp (ms)
  receivedAt: number; // client timestamp (ms)
}

export interface TickSubscription {
  symbols: string[];           // NSE symbols to watch, [] = all
  onTick: (tick: TickData) => void;
}

export interface TickData {
  s: string;   // symbol
  p: number;   // price
  c?: number;  // change
  cp?: number; // change pct
  v?: number;  // volume
  o?: number;  // open
  h?: number;  // high
  l?: number;  // low
  pc?: number; // prev close
  n?: string;  // name
}

// ── Multiplexer class ──────────────────────────────────────────────────────────
export class WSMultiplexer {
  private _ws: WebSocket | null = null;
  private _url: string;
  private _fallbackUrl: string;
  private _connected = false;
  private _reconnectAttempt = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _pingTimer: ReturnType<typeof setInterval> | null = null;
  private _destroyed = false;
  private _lastPingTs = 0;

  // Per-channel RxJS subjects
  private readonly _subjects = new Map<WSChannel, Subject<WSMessage>>();
  private readonly _rawSubject = new Subject<WSMessage>();

  // Symbol-filtered tick subscriptions from MFEs
  private readonly _tickSubs = new Set<TickSubscription>();

  constructor(primaryUrl: string, fallbackUrl?: string) {
    this._url = primaryUrl;
    this._fallbackUrl = fallbackUrl ?? primaryUrl.replace('/v2', '');
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  connect(): void {
    if (this._ws?.readyState === WebSocket.OPEN) return;
    this._doConnect(this._url);
  }

  disconnect(): void {
    this._destroyed = true;
    this._clearTimers();
    this._ws?.close(1000, 'client disconnect');
    this._ws = null;
  }

  /** Subscribe to a channel stream */
  channel$(ch: WSChannel): Observable<WSMessage> {
    if (!this._subjects.has(ch)) {
      this._subjects.set(ch, new Subject<WSMessage>());
    }
    return this._subjects.get(ch)!.asObservable().pipe(share());
  }

  /** Subscribe to tick messages for specific symbols */
  subscribeTicks(sub: TickSubscription): () => void {
    this._tickSubs.add(sub);
    return () => this._tickSubs.delete(sub);
  }

  /** One-shot observable for a specific message type on a channel */
  on$(ch: WSChannel, type: string): Observable<WSMessage> {
    return this.channel$(ch).pipe(filter(m => m.type === type));
  }

  get connected(): boolean { return this._connected; }
  get latencyMs(): number {
    return this._lastPingTs > 0 ? Date.now() - this._lastPingTs : -1;
  }

  // ── Internal ──────────────────────────────────────────────────────────────────

  private _doConnect(url: string): void {
    if (this._destroyed) return;

    try {
      this._ws = new WebSocket(url);
    } catch {
      this._scheduleReconnect();
      return;
    }

    this._ws.binaryType = 'arraybuffer';

    this._ws.onopen = () => {
      this._connected = true;
      this._reconnectAttempt = 0;
      this._startPing();
      eventBus.emit('WS_STATUS', { connected: true, url });
    };

    this._ws.onclose = (ev) => {
      this._connected = false;
      this._clearTimers();
      eventBus.emit('WS_STATUS', { connected: false, url, latencyMs: -1 });
      if (!this._destroyed && ev.code !== 1000) {
        this._scheduleReconnect();
      }
    };

    this._ws.onerror = () => {
      // onclose fires after onerror — reconnect handled there
      if (url === this._url && this._fallbackUrl !== this._url) {
        // Try fallback on first connect error
        this._ws?.close();
        this._doConnect(this._fallbackUrl);
      }
    };

    this._ws.onmessage = (ev) => {
      this._onMessage(ev.data as string);
    };
  }

  private _onMessage(raw: string): void {
    let parsed: { type?: string; [k: string]: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const type = (parsed.type as string) ?? 'unknown';
    const receivedAt = Date.now();

    // Handle pong
    if (type === 'pong') {
      eventBus.emit('WS_STATUS', {
        connected: true,
        url: this._url,
        latencyMs: receivedAt - this._lastPingTs,
      });
      return;
    }

    // Route to channel
    const channel = this._resolveChannel(type, parsed);
    const msg: WSMessage = {
      channel,
      type,
      data: parsed,
      ts: (parsed.ts as number) ?? receivedAt,
      receivedAt,
    };

    // Dispatch to channel subject
    const subject = this._subjects.get(channel);
    subject?.next(msg);

    // Dispatch ticks to symbol subscribers
    if (channel === 'ticks' && type === 'ticks_v2') {
      this._dispatchTicks(parsed);
    }

    // Raw stream
    this._rawSubject.next(msg);
  }

  private _resolveChannel(
    type: string,
    _msg: Record<string, unknown>,
  ): WSChannel {
    if (type === 'ticks_v2' || type === 'tick') return 'ticks';
    if (type === 'quotes') return 'quotes';
    if (type === 'news') return 'news';
    if (type === 'sentiment') return 'sentiment';
    if (type === 'macro') return 'macro';
    if (type === 'technicals') return 'technicals';
    if (type === 'filings') return 'filings';
    if (type === 'volume_shockers') return 'volume_shockers';
    if (type === 'hedge_fund') return 'hedge_fund';
    if (type === 'anomalies') return 'anomalies';
    if (type === 'earnings') return 'earnings';
    if (type === 'crypto') return 'crypto';
    if (type === 'global_markets') return 'global_markets';
    return 'raw';
  }

  private _dispatchTicks(msg: Record<string, unknown>): void {
    const batch = msg.ticks as TickData[] | undefined;
    if (!batch?.length) return;

    for (const sub of this._tickSubs) {
      const watchAll = sub.symbols.length === 0;
      const watchSet = watchAll ? null : new Set(sub.symbols);

      for (const tick of batch) {
        if (watchAll || watchSet!.has(tick.s)) {
          try { sub.onTick(tick); } catch {}
        }
      }
    }
  }

  private _startPing(): void {
    this._clearPing();
    this._pingTimer = setInterval(() => {
      if (this._ws?.readyState === WebSocket.OPEN) {
        this._lastPingTs = Date.now();
        this._ws.send(JSON.stringify({ type: 'ping', ts: this._lastPingTs }));
      }
    }, 20_000);
  }

  private _scheduleReconnect(): void {
    if (this._destroyed) return;
    const delay = Math.min(1000 * 2 ** this._reconnectAttempt, 30_000);
    this._reconnectAttempt++;
    this._reconnectTimer = setTimeout(() => this._doConnect(this._url), delay);
  }

  private _clearTimers(): void {
    this._clearPing();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private _clearPing(): void {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }
}

// ── Singleton instance ─────────────────────────────────────────────────────────
// Shared across the shell and all MFEs that import this module.
export const wsMux = new WSMultiplexer(
  `ws://${window.location.hostname}:8000/ws/v2`,
  `ws://${window.location.hostname}:8000/ws`,
);
