/**
 * FXMatrix — Bloomberg WFX / FXC equivalent
 * Cross-currency rate matrix heatmap for 10 major currencies
 */
import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';

interface RateCell {
  rate: number | null;
  change_pct: number | null;
}

interface MatrixRow {
  base: string;
  rates: Record<string, RateCell>;
}

interface MatrixData {
  bases: string[];
  quotes: string[];
  matrix: MatrixRow[];
  updated_at: string;
}

const CURRENCY_NAMES: Record<string, string> = {
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'Brit. Pound',
  JPY: 'Jap. Yen',
  CHF: 'Swiss Franc',
  AUD: 'Aus. Dollar',
  CAD: 'Can. Dollar',
  INR: 'Indian Rupee',
  CNY: 'Chinese Yuan',
  SGD: 'S\'pore Dollar',
};

const FLAG: Record<string, string> = {
  USD:'🇺🇸', EUR:'🇪🇺', GBP:'🇬🇧', JPY:'🇯🇵', CHF:'🇨🇭',
  AUD:'🇦🇺', CAD:'🇨🇦', INR:'🇮🇳', CNY:'🇨🇳', SGD:'🇸🇬',
};

function heatColor(rate: number | null, base: string, quote: string): string {
  if (base === quote) return '#0d0d0d';
  if (rate == null)   return '#111';
  // Just highlight cross vs USD as baseline
  return '#0e1a0e';
}

function fmtRate(rate: number | null, base: string, quote: string): string {
  if (base === quote) return '1.0000';
  if (rate == null)   return '—';
  // For JPY pairs show 2 decimal places; otherwise 4
  return (quote === 'JPY' || base === 'JPY')
    ? rate.toFixed(2)
    : rate < 0.001
    ? rate.toFixed(6)
    : rate.toFixed(4);
}

export const FXMatrix: React.FC = () => {
  const [data, setData]       = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ base: string; quote: string } | null>(null);
  const [forexRates, setForexRates] = useState<any>({});

  const load = useCallback(async () => {
    const [matrix, forex] = await Promise.all([
      apiFetch<MatrixData>('/api/fx/matrix'),
      apiFetch<any>('/api/forex'),
    ]);
    if (matrix) { setData(matrix); setLoading(false); }
    if (forex)  setForexRates(forex);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const bases  = data?.bases  ?? [];
  const quotes = data?.quotes ?? [];

  // Get change pct from forex raw for highlight
  const getPct = (base: string, quote: string): number | null => {
    const pairKey = `${base}${quote}=X`;
    const inv     = `${quote}${base}=X`;
    const found   = forexRates[pairKey] || forexRates[inv];
    if (!found) return null;
    const pct = found.change_pct;
    return pairKey in forexRates ? pct : pct ? -pct : null;
  };

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#0a0a0a', color: '#e8e8e0', fontFamily: 'Consolas, monospace' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', borderBottom: '1px solid #1a1a1a', background: '#111', flexShrink: 0 }}>
        <span style={{ color: '#ff9500', fontWeight: 700, fontSize: 12 }}>FX CROSS MATRIX</span>
        <span style={{ color: '#555', fontSize: 10 }}>WFX · FXC</span>
        <div style={{ flex: 1 }} />
        {data?.updated_at && (
          <span style={{ color: '#555', fontSize: 10 }}>
            {new Date(data.updated_at).toLocaleTimeString('en-IN', { hour12: false })} IST
          </span>
        )}
        <button onClick={load} style={{ background: 'transparent', border: '1px solid #333', color: '#888', padding: '2px 8px', cursor: 'pointer', fontSize: 10, fontFamily: 'Consolas, monospace' }}>
          ↻ REFRESH
        </button>
      </div>

      {/* Selected pair detail */}
      {selected && (
        <div style={{ padding: '6px 12px', background: '#0d1a0d', borderBottom: '1px solid #1a1a1a', display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0 }}>
          <span style={{ color: '#ff9500', fontWeight: 700 }}>{FLAG[selected.base]} {selected.base} / {FLAG[selected.quote]} {selected.quote}</span>
          {(() => {
            const row = data?.matrix.find(r => r.base === selected.base);
            const cell = row?.rates[selected.quote];
            const rate = cell?.rate;
            const pct  = getPct(selected.base, selected.quote);
            return (
              <>
                <span style={{ color: '#e8e8e0', fontSize: 16, fontWeight: 700 }}>
                  {fmtRate(rate ?? null, selected.base, selected.quote)}
                </span>
                {pct != null && (
                  <span style={{ color: pct >= 0 ? '#00c853' : '#ff3d00', fontSize: 12 }}>
                    {pct >= 0 ? '+' : ''}{pct.toFixed(4)}%
                  </span>
                )}
                <span style={{ color: '#555', fontSize: 10 }}>
                  {CURRENCY_NAMES[selected.base]} → {CURRENCY_NAMES[selected.quote]}
                </span>
                <span style={{ color: '#555', fontSize: 10 }}>1 {selected.base} = {fmtRate(rate ?? null, selected.base, selected.quote)} {selected.quote}</span>
              </>
            );
          })()}
        </div>
      )}

      {/* Matrix grid */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#555', padding: 40, fontSize: 11 }}>Loading FX matrix…</div>
        ) : (
          <table style={{ borderCollapse: 'separate', borderSpacing: 2, fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ padding: '4px 8px', color: '#555', textAlign: 'left', background: '#0d0d0d' }}>BASE\QUOTE</th>
                {quotes.map(q => (
                  <th key={q} style={{ padding: '4px 10px', color: '#ff9500', fontWeight: 700, textAlign: 'center', background: '#0d0d0d', whiteSpace: 'nowrap' }}>
                    {FLAG[q]} {q}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.matrix.map(row => (
                <tr key={row.base}>
                  <td style={{ padding: '4px 8px', color: '#ff9500', fontWeight: 700, background: '#0d0d0d', whiteSpace: 'nowrap' }}>
                    {FLAG[row.base]} {row.base}
                    <div style={{ color: '#555', fontSize: 9, fontWeight: 400 }}>{CURRENCY_NAMES[row.base]}</div>
                  </td>
                  {quotes.map(q => {
                    const cell    = row.rates[q];
                    const isDiag  = row.base === q;
                    const isSelBQ = selected?.base === row.base && selected?.quote === q;
                    const isSelQB = selected?.base === q && selected?.quote === row.base;
                    const pct     = !isDiag ? getPct(row.base, q) : null;
                    const bgColor = isDiag ? '#0d0d0d'
                      : isSelBQ || isSelQB ? '#1e3a1e'
                      : pct != null && Math.abs(pct) > 0.5 ? (pct > 0 ? '#0a1f0a' : '#1f0a0a')
                      : '#111';

                    return (
                      <td
                        key={q}
                        onClick={() => !isDiag && setSelected({ base: row.base, quote: q })}
                        style={{
                          padding: '5px 10px',
                          textAlign: 'center',
                          background: bgColor,
                          cursor: isDiag ? 'default' : 'pointer',
                          border: (isSelBQ || isSelQB) ? '1px solid #2d5a2d' : '1px solid transparent',
                          borderRadius: 2,
                          transition: 'background 0.15s',
                          minWidth: 80,
                        }}
                        onMouseEnter={e => { if (!isDiag) (e.currentTarget as HTMLElement).style.background = '#1a2a1a'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = bgColor; }}
                      >
                        {isDiag ? (
                          <span style={{ color: '#333' }}>—</span>
                        ) : (
                          <>
                            <div style={{ color: '#e8e8e0', fontWeight: 700 }}>
                              {fmtRate(cell?.rate ?? null, row.base, q)}
                            </div>
                            {pct != null && (
                              <div style={{ color: pct >= 0 ? '#00c853' : '#ff3d00', fontSize: 9 }}>
                                {pct >= 0 ? '+' : ''}{pct.toFixed(3)}%
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* FX rates table */}
        {!loading && Object.keys(forexRates).length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ color: '#ff9500', fontSize: 11, fontWeight: 700, marginBottom: 8 }}>LIVE FX RATES</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
              {Object.entries(forexRates).map(([pair, info]: [string, any]) => {
                const pct = info?.change_pct ?? 0;
                return (
                  <div key={pair} style={{ background: '#111', border: '1px solid #1a1a1a', padding: '6px 10px', borderRadius: 3 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: '#ff9500', fontSize: 11, fontWeight: 700 }}>{pair.replace('=X', '')}</span>
                      <span style={{ color: '#e8e8e0', fontWeight: 700 }}>{info?.price?.toFixed(4) ?? '—'}</span>
                    </div>
                    <div style={{ color: pct >= 0 ? '#00c853' : '#ff3d00', fontSize: 10, textAlign: 'right' }}>
                      {pct >= 0 ? '+' : ''}{pct?.toFixed(4)}%
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FXMatrix;
