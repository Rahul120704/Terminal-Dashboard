/**
 * BTI Anomaly Panel — Real-time z-score anomaly alerts
 * Shows price spikes, volume surges, news correlation anomalies
 */

import React, { useState, useEffect, useCallback } from 'react';

interface AnomalyAlert {
  alert_id: string;
  symbol: string;
  alert_type: string;
  severity: string;
  zscore: number;
  current_value: number;
  baseline_mean: number;
  baseline_std: number;
  description: string;
  timestamp: string;
  price: number;
  price_change_pct: number;
  volume_ratio: number;
  resolved: boolean;
}

interface AnomalyStats {
  total_alerts: number;
  by_severity: Record<string, number>;
  by_type: Record<string, number>;
  scan_count: number;
  symbols_watched: number;
  zscore_threshold: number;
}

interface AnomalyPanelProps {
  onSelectSymbol?: (symbol: string) => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: 'text-red-400 bg-red-900/30 border-red-700/50',
  HIGH: 'text-orange-400 bg-orange-900/30 border-orange-700/50',
  MEDIUM: 'text-yellow-400 bg-yellow-900/30 border-yellow-700/50',
  LOW: 'text-gray-400 bg-gray-800/30 border-gray-600/30',
};

const TYPE_ICONS: Record<string, string> = {
  PRICE_SPIKE: '⚡',
  VOLUME_SURGE: '📊',
  OI_BUILDUP: '⚙️',
  SPREAD_WIDE: '↔️',
  NEWS_CORR: '📰',
};

const TYPE_LABELS: Record<string, string> = {
  PRICE_SPIKE: 'Price Spike',
  VOLUME_SURGE: 'Volume Surge',
  OI_BUILDUP: 'OI Buildup',
  SPREAD_WIDE: 'Spread Wide',
  NEWS_CORR: 'News Surge',
};

function AlertRow({ alert, onSelect }: { alert: AnomalyAlert; onSelect?: (s: string) => void }) {
  const sev = SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.LOW;
  const ago = Math.round((Date.now() - new Date(alert.timestamp).getTime()) / 60000);

  return (
    <div
      className={`border rounded px-3 py-2 mb-2 cursor-pointer hover:opacity-90 transition-opacity ${sev}`}
      onClick={() => onSelect?.(alert.symbol.replace('.NS', '').replace('.BO', ''))}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-lg leading-none">{TYPE_ICONS[alert.alert_type] || '⚠️'}</span>
          <span className="font-mono font-bold text-sm">{alert.symbol.replace('.NS', '')}</span>
          <span className="text-xs opacity-75">{TYPE_LABELS[alert.alert_type] || alert.alert_type}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono opacity-80">{alert.zscore.toFixed(1)}σ</span>
          <span className="text-xs opacity-60">{ago}m ago</span>
          <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${sev}`}>
            {alert.severity}
          </span>
        </div>
      </div>
      <div className="text-xs opacity-80">{alert.description}</div>
      {(alert.price_change_pct !== 0 || alert.volume_ratio > 1) && (
        <div className="flex gap-3 mt-1">
          {alert.price_change_pct !== 0 && (
            <span className={`text-xs font-mono ${alert.price_change_pct > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {alert.price_change_pct > 0 ? '▲' : '▼'}{Math.abs(alert.price_change_pct).toFixed(2)}%
            </span>
          )}
          {alert.volume_ratio > 1 && (
            <span className="text-xs font-mono text-blue-400">
              Vol {alert.volume_ratio.toFixed(1)}x avg
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function AnomalyPanel({ onSelectSymbol }: AnomalyPanelProps) {
  const [alerts, setAlerts] = useState<AnomalyAlert[]>([]);
  const [stats, setStats] = useState<AnomalyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'CRITICAL' | 'HIGH' | 'MEDIUM'>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [scanning, setScanning] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchAlerts = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (filter !== 'ALL') params.set('severity', filter);
      if (typeFilter !== 'ALL') params.set('alert_type', typeFilter);
      const resp = await fetch(`/api/quant/anomalies?${params}`);
      const data = await resp.json();
      setAlerts(data.alerts || []);
      setStats(data.stats || null);
      setLastUpdate(new Date());
    } catch (e) {
      console.error('Anomaly fetch failed:', e);
    } finally {
      setLoading(false);
    }
  }, [filter, typeFilter]);

  useEffect(() => {
    fetchAlerts();
    const iv = setInterval(fetchAlerts, 30_000);
    return () => clearInterval(iv);
  }, [fetchAlerts]);

  const triggerScan = async () => {
    setScanning(true);
    try {
      const resp = await fetch('/api/quant/anomalies/scan', { method: 'POST' });
      const data = await resp.json();
      if (data.new_alerts > 0) fetchAlerts();
    } catch (e) {
      console.error('Manual scan failed:', e);
    } finally {
      setScanning(false);
    }
  };

  const criticalCount = alerts.filter((a) => a.severity === 'CRITICAL').length;
  const highCount = alerts.filter((a) => a.severity === 'HIGH').length;

  return (
    <div className="flex flex-col h-full bg-gray-900/50 font-mono">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/50">
        <div className="flex items-center gap-3">
          <span className="text-amber-400 font-bold text-sm">◆ ANOMALY DETECTOR</span>
          {criticalCount > 0 && (
            <span className="bg-red-900/60 border border-red-700/60 text-red-300 text-xs px-2 py-0.5 rounded animate-pulse">
              {criticalCount} CRITICAL
            </span>
          )}
          {highCount > 0 && (
            <span className="bg-orange-900/50 border border-orange-700/50 text-orange-300 text-xs px-2 py-0.5 rounded">
              {highCount} HIGH
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastUpdate && (
            <span className="text-gray-600 text-xs">{lastUpdate.toLocaleTimeString()}</span>
          )}
          <button
            onClick={triggerScan}
            disabled={scanning}
            className="text-xs border border-amber-700/50 text-amber-500 hover:text-amber-300 px-2 py-1 rounded transition-colors disabled:opacity-50"
          >
            {scanning ? 'SCANNING…' : '⟳ SCAN'}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="flex gap-4 px-3 py-1.5 border-b border-gray-700/30 text-xs">
          <span className="text-gray-500">
            Total: <span className="text-gray-300">{stats.total_alerts}</span>
          </span>
          <span className="text-gray-500">
            Scans: <span className="text-gray-300">{stats.scan_count}</span>
          </span>
          <span className="text-gray-500">
            Watching: <span className="text-gray-300">{stats.symbols_watched}</span>
          </span>
          <span className="text-gray-500">
            Threshold: <span className="text-gray-300">{stats.zscore_threshold}σ</span>
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-1 px-3 py-2 border-b border-gray-700/30 flex-wrap">
        {(['ALL', 'CRITICAL', 'HIGH', 'MEDIUM'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              filter === s
                ? 'bg-amber-800/60 border-amber-700/60 text-amber-200'
                : 'border-gray-600/40 text-gray-500 hover:text-gray-300'
            }`}
          >
            {s}
          </button>
        ))}
        <div className="w-px bg-gray-700/50 mx-1" />
        {['ALL', 'PRICE_SPIKE', 'VOLUME_SURGE', 'NEWS_CORR'].map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              typeFilter === t
                ? 'bg-blue-900/50 border-blue-700/50 text-blue-200'
                : 'border-gray-600/40 text-gray-500 hover:text-gray-300'
            }`}
          >
            {t === 'ALL' ? 'ALL TYPES' : TYPE_LABELS[t] || t}
          </button>
        ))}
      </div>

      {/* Alert list */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="text-gray-500 text-sm text-center mt-8">Loading anomaly scanner…</div>
        ) : alerts.length === 0 ? (
          <div className="text-center text-gray-600 mt-8">
            <div className="text-4xl mb-3">✓</div>
            <div className="text-sm">No anomalies detected</div>
            <div className="text-xs text-gray-700 mt-1">
              3σ threshold — markets appear normal
            </div>
          </div>
        ) : (
          alerts.map((alert) => (
            <AlertRow key={alert.alert_id} alert={alert} onSelect={onSelectSymbol} />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-gray-700/30 text-xs text-gray-600">
        Z-score 3σ threshold • Price + Volume + News • Auto-refresh 30s
      </div>
    </div>
  );
}
