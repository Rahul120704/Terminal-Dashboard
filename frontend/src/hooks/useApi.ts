import { useState, useEffect, useCallback, useRef } from 'react';

const BASE = '';

// ── Client-side API cache (per session, avoids repeated fetches for same URL) ─
// Key: URL string  Value: { data, expiresAt (ms timestamp) }
const _apiCache = new Map<string, { data: unknown; expiresAt: number }>();
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes client-side cache

function _cacheGet<T>(url: string): T | null {
  const entry = _apiCache.get(url);
  if (entry && Date.now() < entry.expiresAt) return entry.data as T;
  return null;
}

function _cacheSet(url: string, data: unknown, ttlMs: number) {
  _apiCache.set(url, { data, expiresAt: Date.now() + ttlMs });
}

// Invalidate cache for a specific URL (call after mutations)
export function invalidateCache(url: string) {
  _apiCache.delete(url);
}

// ── Fyers status hook ─────────────────────────────────────────────────────────
export interface FyersStatus {
  authenticated: boolean;
  token_date: string | null;
  app_id: string;
  auth_url: string | null;
}

export function useFyersStatus() {
  const [status, setStatus] = useState<FyersStatus | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/fyers/status');
      if (res.ok) setStatus(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    check();
    timerRef.current = setInterval(check, 30000); // re-check every 30s
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [check]);

  return { status, refetch: check };
}

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, opts);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Pre-warm the client-side cache without rendering anything.
 *  Call from Terminal.tsx on mount so panels load instantly on first visit. */
export async function prefetchApi(path: string, ttlMs = DEFAULT_CACHE_TTL_MS): Promise<void> {
  if (_cacheGet(path) !== null) return; // already warm
  try {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) return;
    const data = await res.json();
    _cacheSet(path, data, ttlMs);
  } catch { /* silent — prefetch is best-effort */ }
}

/**
 * useApiData — fetches data from a REST endpoint with:
 * - Accepts `null` as path — skips all fetching and returns {data: null, loading: false}
 *   This enables safe conditional fetching: `useApiData(isActive ? url : null, ...)`
 * - Client-side cache (default 5 min) to avoid redundant fetches on remount
 * - Optional auto-refresh interval (refreshMs)
 * - cacheTtlMs: how long to keep data in client cache (0 = no client cache)
 */
export function useApiData<T>(path: string | null, refreshMs = 0, cacheTtlMs = DEFAULT_CACHE_TTL_MS) {
  const [data, setData] = useState<T | null>(() => {
    if (!path) return null;
    // Synchronously seed from cache on mount — zero-latency for warm cache
    return _cacheGet<T>(path);
  });
  const [loading, setLoading] = useState<boolean>(() => !!path && _cacheGet(path) === null);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async (skipCache = false) => {
    if (!path) return;  // null path = disabled
    // Use client cache unless explicitly skipped (e.g., manual refetch)
    if (!skipCache && cacheTtlMs > 0) {
      const cached = _cacheGet<T>(path);
      if (cached !== null) {
        setData(cached);
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    try {
      const result = await apiFetch<T>(path);
      if (result !== null) {
        setData(result);
        if (cacheTtlMs > 0) _cacheSet(path, result, cacheTtlMs);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [path, cacheTtlMs]);

  useEffect(() => {
    if (!path) {
      // Null path: clear stale data from a previous active path
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    fetch_();
    if (refreshMs > 0) {
      const interval = setInterval(() => fetch_(true), refreshMs); // skip cache on periodic refresh
      return () => clearInterval(interval);
    }
  }, [fetch_, refreshMs, path]);

  const refetch = useCallback(() => fetch_(true), [fetch_]);

  return { data, loading, error, refetch };
}
