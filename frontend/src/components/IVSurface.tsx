/**
 * BTI IV Surface — Implied Volatility Surface Visualization
 * 3D-style heatmap rendering the IV across strike (moneyness) × expiry (maturity)
 * Uses CSS gradient heatmap (no WebGL dependency needed)
 */

import React, { useState, useEffect, useCallback } from 'react';

interface IVSurfaceData {
  symbol: string;
  spot: number;
  moneyness_grid: number[];   // strike/spot ratios
  maturity_grid: number[];    // days to expiry
  iv_matrix: number[][];      // [moneyness_idx][maturity_idx]
  timestamp: string;
  points: Array<{ moneyness: number; maturity: number; iv: number }>;
}

interface PCRData {
  pcr_oi: number;
  pcr_vol: number;
  regime: string;
  signal: string;
  calls_oi: number;
  puts_oi: number;
}

interface IVSurfaceProps {
  symbol: string;
  spot?: number;
}

// Map IV value to a color (blue=low vol → green → yellow → red=high vol)
function ivToColor(iv: number, minIv: number, maxIv: number): string {
  const t = maxIv === minIv ? 0.5 : (iv - minIv) / (maxIv - minIv);
  const clamped = Math.max(0, Math.min(1, t));

  if (clamped < 0.25) {
    // blue → cyan
    const p = clamped / 0.25;
    return `rgb(${Math.round(30 + p * 0)}, ${Math.round(100 + p * 100)}, ${Math.round(200 + p * 55)})`;
  } else if (clamped < 0.5) {
    // cyan → green
    const p = (clamped - 0.25) / 0.25;
    return `rgb(${Math.round(30 + p * 50)}, ${Math.round(200)}, ${Math.round(255 - p * 155)})`;
  } else if (clamped < 0.75) {
    // green → yellow
    const p = (clamped - 0.5) / 0.25;
    return `rgb(${Math.round(80 + p * 175)}, ${Math.round(200)}, ${Math.round(100 - p * 100)})`;
  } else {
    // yellow → red
    const p = (clamped - 0.75) / 0.25;
    return `rgb(${Math.round(255)}, ${Math.round(200 - p * 170)}, ${Math.round(0)})`;
  }
}

function IVCell({ iv, minIv, maxIv }: { iv: number; minIv: number; maxIv: number }) {
  const color = ivToColor(iv, minIv, maxIv);
  return (
    <td
      title={`IV: ${iv.toFixed(1)}%`}
      style={{ backgroundColor: color, opacity: 0.85, width: 40, height: 28 }}
      className="text-center text-xs font-mono cursor-default select-none border border-gray-900/20 transition-opacity hover:opacity-100"
    >
      <span style={{ color: iv > (minIv + maxIv) / 2 ? '#111' : '#eee', textShadow: 'none' }}>
        {iv.toFixed(0)}
      </span>
    </td>
  );
}

function ColorLegend({ minIv, maxIv }: { minIv: number; maxIv: number }) {
  const steps = 10;
  return (
    <div className="flex items-center gap-2 mt-2">
      <span className="text-gray-600 text-xs">Low IV</span>
      <div className="flex">
        {Array.from({ length: steps }, (_, i) => {
          const iv = minIv + (i / steps) * (maxIv - minIv);
          return (
            <div
              key={i}
              style={{ backgroundColor: ivToColor(iv, minIv, maxIv), width: 20, height: 12 }}
            />
          );
        })}
      </div>
      <span className="text-gray-600 text-xs">High IV</span>
      <span className="text-gray-600 text-xs ml-2">
        Range: {minIv.toFixed(0)}% – {maxIv.toFixed(0)}%
      </span>
    </div>
  );
}

export default function IVSurface({ symbol, spot }: IVSurfaceProps) {
  const [surface, setSurface] = useState<IVSurfaceData | null>(null);
  const [pcr, setPcr] = useState<PCRData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const fetchSurface = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const [surfResp, pcrResp] = await Promise.all([
        fetch(`/api/quant/iv-surface/${symbol}`),
        fetch(`/api/quant/pcr/${symbol}`),
      ]);

      if (surfResp.ok) {
        const data = await surfResp.json();
        setSurface(data);
        setLastFetch(new Date());
      } else {
        const err = await surfResp.json().catch(() => ({}));
        setError(err.detail || 'Failed to load IV surface');
      }

      if (pcrResp.ok) {
        setPcr(await pcrResp.json());
      }
    } catch (e) {
      setError('Network error fetching IV surface');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchSurface();
  }, [fetchSurface]);

  const hasGrid =
    surface &&
    surface.iv_matrix.length > 0 &&
    surface.moneyness_grid.length > 0 &&
    surface.maturity_grid.length > 0;

  const allIVs = hasGrid ? surface.iv_matrix.flat() : surface?.points.map((p) => p.iv) || [];
  const minIv = allIVs.length ? Math.min(...allIVs) : 10;
  const maxIv = allIVs.length ? Math.max(...allIVs) : 80;

  const atmIdx = hasGrid
    ? surface.moneyness_grid.reduce(
        (best, m, i) => (Math.abs(m - 1) < Math.abs(surface.moneyness_grid[best] - 1) ? i : best),
        0
      )
    : -1;

  return (
    <div className="flex flex-col h-full bg-gray-900/50 font-mono">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/50">
        <div className="flex items-center gap-3">
          <span className="text-amber-400 font-bold text-sm">◆ IV SURFACE</span>
          <span className="text-gray-400 text-sm font-bold">{symbol}</span>
          {spot && <span className="text-gray-500 text-xs">Spot: ₹{spot.toFixed(0)}</span>}
        </div>
        <div className="flex items-center gap-2">
          {lastFetch && (
            <span className="text-gray-600 text-xs">{lastFetch.toLocaleTimeString()}</span>
          )}
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="text-xs border border-gray-600/50 text-gray-500 px-2 py-0.5 rounded hover:text-gray-300"
          >
            {showRaw ? 'GRID' : 'RAW'}
          </button>
          <button
            onClick={fetchSurface}
            disabled={loading}
            className="text-xs border border-amber-700/50 text-amber-500 px-2 py-1 rounded hover:text-amber-300 disabled:opacity-50"
          >
            {loading ? '…' : '⟳'}
          </button>
        </div>
      </div>

      {/* PCR Bar */}
      {pcr && (
        <div className="flex items-center gap-4 px-3 py-1.5 border-b border-gray-700/30 text-xs">
          <span className="text-gray-500">
            PCR OI: <span className="text-amber-300 font-bold">{pcr.pcr_oi.toFixed(2)}</span>
          </span>
          <span className="text-gray-500">
            PCR Vol: <span className="text-blue-300">{pcr.pcr_vol.toFixed(2)}</span>
          </span>
          <span
            className={`font-bold px-2 py-0.5 rounded ${
              pcr.regime === 'FEAR'
                ? 'text-red-300 bg-red-900/30'
                : pcr.regime === 'GREED'
                ? 'text-green-300 bg-green-900/30'
                : 'text-gray-300 bg-gray-800/30'
            }`}
          >
            {pcr.regime}
          </span>
          <span className="text-gray-500">
            Signal: <span className="text-purple-300">{pcr.signal}</span>
          </span>
        </div>
      )}

      <div className="flex-1 overflow-auto p-3">
        {loading ? (
          <div className="text-gray-500 text-sm text-center mt-8">Loading IV surface…</div>
        ) : error ? (
          <div className="text-red-400 text-sm text-center mt-8">
            <div className="mb-2">⚠️ {error}</div>
            <div className="text-gray-600 text-xs">NSE options chain may not be available outside market hours</div>
            <button onClick={fetchSurface} className="mt-3 text-amber-500 hover:text-amber-300 border border-amber-700/40 px-3 py-1 rounded text-xs">
              RETRY
            </button>
          </div>
        ) : !surface ? (
          <div className="text-gray-600 text-sm text-center mt-8">No surface data</div>
        ) : !showRaw && hasGrid ? (
          /* Heatmap grid view */
          <div>
            <div className="text-xs text-gray-500 mb-2">
              Implied Volatility Surface — moneyness (K/S) × days to expiry
            </div>
            <div className="overflow-x-auto">
              <table className="border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="text-gray-500 text-right pr-2 pb-1 text-xs">K/S ↓ | DTE →</th>
                    {surface.maturity_grid.map((d) => (
                      <th key={d} className="text-gray-500 pb-1 text-center" style={{ width: 40 }}>
                        {Math.round(d)}d
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {surface.iv_matrix.map((row, mi) => {
                    const moneyness = surface.moneyness_grid[mi];
                    const isATM = mi === atmIdx;
                    return (
                      <tr key={mi}>
                        <td
                          className={`text-right pr-2 text-xs ${isATM ? 'text-amber-400 font-bold' : 'text-gray-500'}`}
                        >
                          {moneyness.toFixed(3)}
                          {isATM && ' ATM'}
                        </td>
                        {row.map((iv, ti) => (
                          <IVCell key={ti} iv={iv} minIv={minIv} maxIv={maxIv} />
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ColorLegend minIv={minIv} maxIv={maxIv} />

            {/* Term structure at ATM */}
            {atmIdx >= 0 && (
              <div className="mt-4 border-t border-gray-700/30 pt-3">
                <div className="text-xs text-gray-500 mb-2">ATM Term Structure (K/S ≈ 1.0)</div>
                <div className="flex items-end gap-1">
                  {surface.maturity_grid.map((d, ti) => {
                    const iv = surface.iv_matrix[atmIdx]?.[ti] ?? 0;
                    const barH = Math.round(((iv - minIv) / (maxIv - minIv + 1)) * 60 + 10);
                    return (
                      <div key={ti} className="flex flex-col items-center gap-0.5" title={`${Math.round(d)}d: ${iv.toFixed(1)}%`}>
                        <span className="text-gray-400" style={{ fontSize: 9 }}>{iv.toFixed(0)}</span>
                        <div
                          style={{
                            height: barH,
                            width: 24,
                            backgroundColor: ivToColor(iv, minIv, maxIv),
                            opacity: 0.8,
                          }}
                          className="rounded-t"
                        />
                        <span className="text-gray-600" style={{ fontSize: 9 }}>{Math.round(d)}d</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Raw points table */
          <div>
            <div className="text-xs text-gray-500 mb-2">Raw IV points ({surface.points.length} contracts)</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700/30">
                  <th className="text-left py-1">K/S</th>
                  <th className="text-left py-1">DTE</th>
                  <th className="text-right py-1">IV%</th>
                </tr>
              </thead>
              <tbody>
                {surface.points
                  .sort((a, b) => a.moneyness - b.moneyness)
                  .map((p, i) => (
                    <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                      <td className={`py-0.5 ${Math.abs(p.moneyness - 1) < 0.01 ? 'text-amber-400 font-bold' : 'text-gray-400'}`}>
                        {p.moneyness.toFixed(3)}
                      </td>
                      <td className="py-0.5 text-gray-400">{Math.round(p.maturity * 365)}d</td>
                      <td className="py-0.5 text-right" style={{ color: ivToColor(p.iv, minIv, maxIv) }}>
                        {p.iv.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-gray-700/30 text-xs text-gray-600">
        Black-Scholes IV • Brent solver • scipy griddata smoothing • {surface?.points.length ?? 0} contracts
      </div>
    </div>
  );
}
