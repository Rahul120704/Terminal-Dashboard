/**
 * DCF Valuation Panel — Discounted Cash Flow intrinsic value calculator
 * Interactive inputs: WACC, terminal growth, years, revenue growth
 * Output: intrinsic value, margin of safety, sensitivity table
 */

import React, { useState, useCallback } from 'react';

interface Props { symbol: string; }

function fmt(v?: number | null, d = 2): string {
  if (v == null) return '—';
  return Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtCr(v?: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(0)}L Cr`;
  if (abs >= 100) return `₹${v.toFixed(0)} Cr`;
  return `₹${v.toFixed(2)} Cr`;
}

const Slider: React.FC<{
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; display?: string;
}> = ({ label, value, min, max, step, onChange, display }) => (
  <div style={{ marginBottom: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)' }}>{display || `${value}%`}</span>
    </div>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
      style={{ width: '100%', accentColor: 'var(--amber)' }}
    />
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#444' }}>
      <span>{min}%</span><span>{max}%</span>
    </div>
  </div>
);

export const DCFValuationPanel: React.FC<Props> = ({ symbol }) => {
  const [wacc, setWacc] = useState(12);
  const [terminalGrowth, setTerminalGrowth] = useState(4);
  const [years, setYears] = useState(10);
  const [revenueGrowth, setRevenueGrowth] = useState<number | null>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState(false);

  const runDCF = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        wacc: String(wacc),
        terminal_growth: String(terminalGrowth),
        years: String(years),
      });
      if (revenueGrowth !== null) params.set('revenue_growth', String(revenueGrowth));

      const res = await fetch(`/api/dcf/${symbol}?${params}`);
      const json = await res.json();
      if (json.error) setError(json.error);
      else setData(json);
      setRan(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [symbol, wacc, terminalGrowth, years, revenueGrowth]);

  // Run on mount and when symbol changes
  React.useEffect(() => {
    setData(null);
    setRan(false);
    setError(null);
    // Auto-run with default assumptions
    const p = new URLSearchParams({ wacc: String(wacc), terminal_growth: String(terminalGrowth), years: String(years) });
    setLoading(true);
    fetch(`/api/dcf/${symbol}?${p}`)
      .then(r => r.json())
      .then(j => { if (j.error) setError(j.error); else setData(j); setRan(true); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [symbol]); // eslint-disable-line

  const mosColor = data?.margin_of_safety_pct >= 15
    ? 'var(--green)' : data?.margin_of_safety_pct <= -15
      ? 'var(--red)' : 'var(--amber)';

  const verdictColor = data?.verdict === 'UNDERVALUED'
    ? 'var(--green)' : data?.verdict === 'OVERVALUED'
      ? 'var(--red)' : 'var(--amber)';

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="panel-title">DCF — INTRINSIC VALUE</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 6 }}>{symbol}</span>
        {data?.verdict && (
          <span style={{
            marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: verdictColor,
            border: `1px solid ${verdictColor}33`, padding: '1px 8px', background: `${verdictColor}11`,
          }}>
            {data.verdict}
          </span>
        )}
      </div>

      <div className="panel-body" style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>

          {/* ── LEFT: Assumptions Panel ──────────────────────────────── */}
          <div>
            <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 12 }}>MODEL ASSUMPTIONS</div>

            <Slider label="WACC (Discount Rate)" value={wacc} min={6} max={20} step={0.5} onChange={setWacc} />
            <Slider label="Terminal Growth Rate" value={terminalGrowth} min={1} max={8} step={0.5} onChange={setTerminalGrowth} />

            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Projection Years</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)' }}>{years}Y</span>
              </div>
              <input
                type="range" min={3} max={15} step={1} value={years}
                onChange={e => setYears(parseInt(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--amber)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#444' }}>
                <span>3Y</span><span>15Y</span>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Revenue Growth Override</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: revenueGrowth !== null ? 'var(--amber)' : '#555' }}>
                  {revenueGrowth !== null ? `${revenueGrowth}%` : 'AUTO'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="range" min={0} max={40} step={1}
                  value={revenueGrowth ?? (data?.assumptions?.revenue_growth ?? 10)}
                  onChange={e => setRevenueGrowth(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--amber)' }}
                />
                <button
                  onClick={() => setRevenueGrowth(null)}
                  style={{
                    fontSize: 8, padding: '1px 5px', background: 'transparent',
                    border: '1px solid #333', color: '#555', cursor: 'pointer',
                  }}
                >
                  AUTO
                </button>
              </div>
            </div>

            <button
              onClick={runDCF}
              disabled={loading}
              style={{
                width: '100%', padding: '8px', background: 'var(--amber)',
                color: '#000', border: 'none', fontWeight: 900, fontSize: 12,
                cursor: loading ? 'wait' : 'pointer', fontFamily: 'monospace',
                letterSpacing: 1,
              }}
            >
              {loading ? 'CALCULATING…' : '▶ RUN DCF'}
            </button>

            {data?.assumptions && (
              <div style={{ marginTop: 12, fontSize: 9, color: '#555', lineHeight: 1.6 }}>
                <div>WACC: <b style={{ color: '#888' }}>{data.assumptions.wacc}%</b></div>
                <div>Terminal g: <b style={{ color: '#888' }}>{data.assumptions.terminal_growth}%</b></div>
                <div>Rev Growth: <b style={{ color: '#888' }}>{data.assumptions.revenue_growth}%</b></div>
                <div>FCF Margin: <b style={{ color: '#888' }}>{data.assumptions.fcf_margin}%</b></div>
                <div>Base FCF: <b style={{ color: '#888' }}>{fmtCr(data.base_fcf_cr)}</b></div>
              </div>
            )}
          </div>

          {/* ── RIGHT: Results ────────────────────────────────────────── */}
          <div>
            {!ran && !loading && (
              <div style={{ color: 'var(--text-muted)', fontSize: 11, padding: 20 }}>
                Click RUN DCF to calculate intrinsic value.
              </div>
            )}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 20 }}>
                <div className="spinner" />
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Running DCF model…</span>
              </div>
            )}

            {error && (
              <div style={{ padding: 12, background: 'rgba(255,61,0,0.08)', border: '1px solid rgba(255,61,0,0.2)', color: 'var(--red)', fontSize: 10 }}>
                ⚠ {error}
                <div style={{ fontSize: 9, marginTop: 4, color: '#aaa' }}>
                  Ensure {symbol} has sufficient financial history for DCF analysis.
                </div>
              </div>
            )}

            {data && !error && (
              <div>
                {/* ── Valuation Summary ── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
                  {[
                    { label: 'Intrinsic Value', value: `₹${fmt(data.intrinsic_value)}`, color: verdictColor, big: true },
                    { label: 'Current Price', value: `₹${fmt(data.current_price)}`, color: 'var(--text-primary)', big: true },
                    {
                      label: 'Margin of Safety',
                      value: `${data.margin_of_safety_pct >= 0 ? '+' : ''}${fmt(data.margin_of_safety_pct, 1)}%`,
                      color: mosColor, big: true,
                    },
                  ].map(({ label, value, color, big }) => (
                    <div key={label} style={{
                      background: 'var(--bg-secondary)', border: '1px solid #222',
                      padding: '10px 12px', textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: big ? 18 : 13, fontWeight: 900, color, fontFamily: 'monospace' }}>
                        {value}
                      </div>
                    </div>
                  ))}
                </div>

                {/* ── Value Bridge ── */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>VALUE BRIDGE (₹ Crores)</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {[
                      { label: 'Sum of PV (FCF projections)', value: data.sum_pv_cr, color: 'var(--green)' },
                      { label: `Terminal Value PV (Year ${years}+)`, value: data.terminal_pv_cr, color: '#4fc3f7' },
                      { label: 'Total Enterprise Value', value: (data.sum_pv_cr || 0), color: 'var(--amber)', bold: true },
                    ].map((r, i) => (
                      <div key={i} style={{
                        display: 'flex', justifyContent: 'space-between',
                        padding: '4px 8px', background: 'var(--bg-secondary)',
                        border: '1px solid #1a1a1a',
                      }}>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.label}</span>
                        <span style={{ fontSize: 11, color: r.color, fontWeight: r.bold ? 700 : 500 }}>
                          {fmtCr(r.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Projected FCF Table ── */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 6 }}>FCF PROJECTIONS</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: 9, width: '100%' }}>
                      <thead>
                        <tr>
                          {['Year', 'FCF (Cr)', 'Growth', 'Disc Factor', 'PV FCF (Cr)'].map(h => (
                            <th key={h} style={{ textAlign: 'right', color: 'var(--text-muted)', padding: '3px 6px', borderBottom: '1px solid #222' }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(data.projected_fcf || []).map((row: any, i: number) => (
                          <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                            <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--amber)' }}>Y{row.year}</td>
                            <td style={{ padding: '3px 6px', textAlign: 'right', color: '#e8e8e0' }}>{fmtCr(row.fcf)}</td>
                            <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--green)' }}>{row.growth_rate}%</td>
                            <td style={{ padding: '3px 6px', textAlign: 'right', color: '#666' }}>{row.discount_factor}</td>
                            <td style={{ padding: '3px 6px', textAlign: 'right', color: '#4fc3f7' }}>{fmtCr(row.pv_fcf)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── Sensitivity Table ── */}
                {data.sensitivity && (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 6 }}>
                      SENSITIVITY ANALYSIS — Intrinsic Value (₹)
                    </div>
                    <div style={{ fontSize: 9, color: '#555', marginBottom: 6 }}>
                      Rows: WACC | Cols: Terminal Growth Rate
                    </div>
                    <table style={{ borderCollapse: 'collapse', fontSize: 9, width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'center', color: '#555', padding: '3px 6px', borderBottom: '1px solid #222' }}>WACC\TG</th>
                          {(data.sensitivity_labels?.tg_range || []).map((tg: string) => (
                            <th key={tg} style={{ textAlign: 'right', color: '#4fc3f7', padding: '3px 6px', borderBottom: '1px solid #222' }}>{tg}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(data.sensitivity || []).map((row: any, i: number) => (
                          <tr key={i} style={{ borderBottom: '1px solid #111' }}>
                            <td style={{ padding: '3px 6px', textAlign: 'center', color: 'var(--amber)', fontWeight: 700 }}>
                              {data.sensitivity_labels?.wacc_range?.[i]}
                            </td>
                            {(row.values || []).map((v: number | null, j: number) => {
                              const cp = data.current_price;
                              const mos = v && cp ? (v - cp) / v * 100 : null;
                              const color = mos == null ? '#444' : mos >= 15 ? 'var(--green)' : mos <= -15 ? 'var(--red)' : 'var(--amber)';
                              return (
                                <td key={j} style={{ padding: '3px 8px', textAlign: 'right', color, fontWeight: i === 1 && j === 1 ? 900 : 400 }}>
                                  {v ? `₹${fmt(v, 0)}` : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ fontSize: 8, color: '#444', marginTop: 4 }}>
                      Green = undervalued vs current price | Red = overvalued | Bold = base case
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DCFValuationPanel;
