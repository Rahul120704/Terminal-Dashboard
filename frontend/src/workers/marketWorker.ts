/**
 * Market Data Web Worker
 *
 * Bloomberg architecture principle: keep the main thread free for rendering.
 * The WebSocket connection + all JSON parsing runs here, off the UI thread.
 *
 * Message routing:
 *   HIGH PRIORITY  → sent immediately to main thread (no batching):
 *     tick_update, q (compact ticks), indices, fyers_auth, connected
 *
 *   LOW PRIORITY   → can be slightly delayed; still sent immediately but
 *     main thread uses requestIdleCallback to process them:
 *     news, filing, sentiment_update, macro_update, technicals_update,
 *     volume_shockers, global_markets, hedge_fund_update
 *
 * Tick batching (Bloomberg "B-PIPE batch mode"):
 *   Fyers WS can fire 50+ ticks/sec. We accumulate within one 16ms frame
 *   and flush as ONE postMessage to main thread. This turns 50 separate
 *   postMessage calls into 3-4 batched calls per second — drastically
 *   reduces JS scheduling overhead.
 *
 * Compact protocol (/ws/v2):
 *   Worker connects to /ws/v2 if available (compact JSON, ~40% smaller).
 *   Falls back to /ws (standard JSON). Compact decoding happens here in the
 *   Worker — main thread always receives expanded full-field messages.
 */

/// <reference lib="webworker" />

interface WorkerCommand {
  type: 'connect' | 'send' | 'disconnect';
  url?: string;
  data?: unknown;
}

// High-priority types — forward immediately to main thread, no batching
const HIGH_PRIORITY = new Set([
  'tick_update', 'q', 'indices', 'fyers_auth', 'connected', '_ws_connected', '_ws_disconnected',
]);

let ws: WebSocket | null = null;
let wsUrl = '';
let reconnectCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_RECONNECTS = 100;

// ── Data-silence watchdog ─────────────────────────────────────────────────────
// If no tick/quote data arrives within 8s of connecting, request a snapshot.
// This covers the case where the initial snapshot was empty (cache not yet warm).
let _silenceTimer: ReturnType<typeof setTimeout> | null = null;
let _receivedData = false;

function _resetSilenceWatchdog() {
  if (_silenceTimer) clearTimeout(_silenceTimer);
  _silenceTimer = setTimeout(() => {
    if (!_receivedData && ws?.readyState === WebSocket.OPEN) {
      // Request a fresh quote snapshot from the backend
      ws.send(JSON.stringify({ type: 'get_quote', symbol: 'NIFTY50' }));
      ws.send(JSON.stringify({ type: 'subscribe', symbols: ['RELIANCE', 'NIFTY50', 'HDFCBANK'] }));
      console.warn('[BTI Worker] No data in 8s after connect — sent snapshot refresh request');
    }
  }, 8000);
}

// ── Tick batching buffer (16ms window, ~60fps flush) ─────────────────────────
const _tickBuf: unknown[] = [];
let _batchTimer: ReturnType<typeof setTimeout> | null = null;

function _flushTickBuf() {
  _batchTimer = null;
  if (_tickBuf.length === 0) return;
  const batch = _tickBuf.splice(0);
  self.postMessage({ type: 'tick_update', data: batch });
}

function _scheduleBatch() {
  if (_batchTimer === null) {
    // 50ms window: backend already batches at 33ms, so 50ms aligns naturally
    // and reduces postMessage overhead by ~3x vs the old 16ms.
    _batchTimer = setTimeout(_flushTickBuf, 50);
  }
}

// ── Connection ───────────────────────────────────────────────────────────────
function connect(url: string) {
  wsUrl = url;
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

  ws = new WebSocket(url);

  ws.onopen = () => {
    reconnectCount = 0;
    _receivedData = false;
    _resetSilenceWatchdog();
    self.postMessage({ type: '_ws_connected' });
    console.info(`[BTI Worker] WebSocket connected to ${url}`);
  };

  ws.onmessage = (evt) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(evt.data as string) as Record<string, unknown>;
    } catch {
      return; // malformed — discard
    }

    const type = msg.type as string;

    // ── Compact tick protocol (/ws/v2 sends type: 'q') ────────────────────
    if (type === 'q') {
      // data is CompactTick[] — expand inline in Worker
      const ticks = (msg.d as Array<Record<string, unknown>>) ?? [];
      if (ticks.length > 0) {
        _receivedData = true;
        const expanded = ticks.map(t => ({
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
          source:     'fyers_ws',
        }));
        // Batch with regular ticks
        _tickBuf.push(...expanded);
        _scheduleBatch();
      }
      return;
    }

    // ── Regular tick_update — batch for 16ms ─────────────────────────────
    if (type === 'tick_update') {
      const data = msg.data;
      const ticks: unknown[] = Array.isArray(data) ? data : [data];
      if (ticks.length > 0) {
        _receivedData = true;
        _tickBuf.push(...ticks);
        _scheduleBatch();
      }
      return;
    }

    // ── High-priority: forward immediately ───────────────────────────────
    if (HIGH_PRIORITY.has(type)) {
      self.postMessage(msg);
      return;
    }

    // ── Low-priority: forward immediately but tagged as low-priority ─────
    // Main thread can process these during idle time
    self.postMessage({ ...msg, _lowPriority: true });
  };

  ws.onclose = (evt) => {
    // Flush any pending ticks before reporting disconnect
    if (_tickBuf.length > 0) _flushTickBuf();
    if (_silenceTimer) { clearTimeout(_silenceTimer); _silenceTimer = null; }
    self.postMessage({ type: '_ws_disconnected' });
    console.warn(`[BTI Worker] WebSocket closed (code=${evt.code}), scheduling reconnect`);
    scheduleReconnect();
  };

  ws.onerror = (evt) => {
    console.error('[BTI Worker] WebSocket error:', evt);
    ws?.close();
  };
}

function scheduleReconnect() {
  if (reconnectCount >= MAX_RECONNECTS) return;
  // Exponential backoff: 1.5s, 2.25s, 3.4s … capped at 30s
  const delay = Math.min(1500 * Math.pow(1.5, reconnectCount), 30_000);
  reconnectCount++;
  reconnectTimer = setTimeout(() => connect(wsUrl), delay);
}

// ── Commands from main thread ─────────────────────────────────────────────────
self.onmessage = (evt: MessageEvent<WorkerCommand>) => {
  const { type, url, data } = evt.data;
  switch (type) {
    case 'connect':
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (url) connect(url);
      break;
    case 'send':
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
      break;
    case 'disconnect':
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      reconnectCount = MAX_RECONNECTS; // prevent auto-reconnect
      ws?.close();
      ws = null;
      break;
  }
};
