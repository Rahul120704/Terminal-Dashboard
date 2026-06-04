import { useEffect, useRef, useCallback, useState } from 'react';

type MessageHandler = (data: any) => void;

interface UseWebSocketOptions {
  onMessage?: MessageHandler;
  reconnectDelay?: number;
  maxReconnects?: number;
}

export function useWebSocket(url: string, options: UseWebSocketOptions = {}) {
  const { onMessage, reconnectDelay = 2000, maxReconnects = 50 } = options;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCount = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectCount.current = 0;
      setConnected(true);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        onMessage?.(msg);
      } catch (_) {}
    };

    ws.onclose = () => {
      setConnected(false);
      if (reconnectCount.current < maxReconnects) {
        reconnectCount.current++;
        const delay = Math.min(reconnectDelay * reconnectCount.current, 30000);
        reconnectTimer.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [url, onMessage, reconnectDelay, maxReconnects]);

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected, send };
}
