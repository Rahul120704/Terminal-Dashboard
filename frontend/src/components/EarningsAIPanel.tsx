/**
 * Earnings AI Panel — AI-powered beat probability calendar.
 * Uses /api/quant/earnings-calendar (EarningsPredictorAgent backend).
 * Shows upcoming earnings with XGBoost beat probabilities, confidence,
 * and per-stock AI deep-dive via /api/quant/earnings-predict/{symbol}.
 */

import React, { useState, memo } from 'react';
import { useApiData } from '../hooks/useApi';

interface EarningsCalEntry {
  symbol: string;
  company_name: string;
  earnings_date: string;
  quarter: string;
  sector: string;
  days_to_earnings: number;
  beat_probability: number | null;
  confidence: string | null;
}

interface EarningsPrediction {
  symbol: string;
  company_name: string;
  earnings_date: string;
  quarter: string;
  beat_probability: number;
  confidence: string;
  factors: string[];
  recommendation: string;
}

interface CalResponse {
  value: EarningsCalEntry[];
  Count: number;
}

function daysBadge(d: number) {
  const color = d <= 3 ? 'var(--red)' : d <= 7 ? 'var(--amber)' : 'var(--text-muted)';
  return <span style={{ color, fontWeight: 700, fontSize: 10 }}>{d}d</span>;
}

function probBar(p: number | null) {
  if (p == null) return <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>N/A</span>;
  const color = p >= 60 ? 'var(--green)' : p <= 40 ? 'var(--red)' : 'var(--amber)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 50, height: 5, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${p}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ color, fontWeight: 700, fontSize: 11 }}>{p.toFixed(1)}%</span>
    </div>
  );
}

const SECTOR_COLOR: Record<string, string> = {
  BANK: '#4fc3f7', IT: '#81c784', PHARMA: '#ce93d8', AUTO: '#ffb74d',
  FMCG: '#a5d6a7', ENERGY: '#ff8a65', METAL: '#90a4ae', INFRA: '#80cbc4',
  TELECOM: '#ef9a9a', NBFC: '#80deea',
};

export const EarningsAIPanel: React.FC<{ onSelectTicker?: (sym: string) => void }> = memo(({ onSelectTicker }) => {
  const { data: calRaw, loading } = useApiData<CalResponse>('/api/quant/earnings-calendar', 0, 300_000);
  const [selected, setSelected] = useState<string | null>(null);

  const { data: prediction, loading: predLoading } = useApiData<EarningsPrediction>(
    selected ? `/api/quant/earnings-predict/${selected.replace('.NS', '')}` : null,
    0, 300_000
  );

  const entries: EarningsCalEntry[] = calRaw?.value ?? [];
  const upcoming = entries.filter(e => e.days_to_earnings >= 0).sort((a, b) => a.days_to_earnings - b.days_to_earnings);
  const past = entries.filter(e => e.days_to_earnings < 0);

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', gap: 1 }}>
      {/* Left — calendar */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="panel-header">
          <span className="panel-title">EARNINGS AI — BEAT PROBABILITY</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>XGBoost · FinBERT · 13-factor model</span>
            {loading && <span className="spinner" />}
          </div>
        </div>

        <div className="panel-body" style={{ overflow: 'auto' }}>
          {upcoming.length === 0 ? (
            <div className="p-3 text-muted">Loading AI earnings calendar…</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Company</th>
                  <th>Date</th>
                  <th>Qtr</th>
                  <th>Sector</th>
                  <th style={{ textAlign: 'right' }}>Days</th>
                  <th style={{ textAlign: 'right' }}>Beat Prob</th>
                  <th>Conf</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map(e => {
                  const rawSym = e.symbol.replace('.NS', '');
                  const isSelected = selected === e.symbol;
                  return (
                    <tr
                      key={e.symbol}
                      style={{
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(255,149,0,0.08)' : undefined,
                      }}
                      onClick={() => setSelected(isSelected ? null : e.symbol)}
                    >
                      <td>
                        <span
                          style={{ color: 'var(--amber)', fontWeight: 700, cursor: 'pointer' }}
                          onClick={ev => { ev.stopPropagation(); onSelectTicker?.(rawSym); }}
                        >
                          {rawSym}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.company_name}
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{e.earnings_date}</td>
                      <td style={{ color: 'var(--amber)' }}>{e.quarter}</td>
                      <td>
                        <span style={{
                          fontSize: 9, padding: '1px 5px', borderRadius: 2,
                          background: `${SECTOR_COLOR[e.sector] || '#555'}22`,
                          color: SECTOR_COLOR[e.sector] || 'var(--text-muted)',
                          fontWeight: 700,
                        }}>
                          {e.sector}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>{daysBadge(e.days_to_earnings)}</td>
                      <td style={{ textAlign: 'right' }}>{probBar(e.beat_probability)}</td>
                      <td>
                        {e.confidence && (
                          <span style={{
                            fontSize: 9, padding: '1px 4px',
                            color: e.confidence === 'HIGH' ? 'var(--green)' : e.confidence === 'LOW' ? 'var(--red)' : 'var(--amber)',
                            border: `1px solid ${e.confidence === 'HIGH' ? 'var(--green-dim)' : e.confidence === 'LOW' ? 'var(--red-dim)' : 'var(--amber-dim)'}`,
                          }}>
                            {e.confidence}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {past.length > 0 && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 6 }}>RECENT (PAST)</div>
              <table>
                <tbody>
                  {past.slice(0, 5).map(e => (
                    <tr key={e.symbol} style={{ opacity: 0.6 }}>
                      <td><span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>{e.symbol.replace('.NS', '')}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}>{e.quarter}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{e.earnings_date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Right — stock deep-dive prediction */}
      {selected && (
        <div style={{ width: 300, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
          <div className="panel-header">
            <span className="panel-title">{selected.replace('.NS', '')} — AI PREDICTION</span>
            {predLoading && <span className="spinner" />}
          </div>
          <div className="panel-body" style={{ overflow: 'auto' }}>
            {prediction ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ textAlign: 'center', padding: '12px 0' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>BEAT PROBABILITY</div>
                  <div style={{
                    fontSize: 32, fontWeight: 900, fontVariantNumeric: 'tabular-nums',
                    color: prediction.beat_probability >= 60 ? 'var(--green)' : prediction.beat_probability <= 40 ? 'var(--red)' : 'var(--amber)',
                  }}>
                    {prediction.beat_probability.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{prediction.quarter} · {prediction.earnings_date}</div>
                </div>

                <div style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 6 }}>RECOMMENDATION</div>
                  <div style={{
                    fontSize: 12, fontWeight: 700,
                    color: prediction.recommendation?.includes('BUY') || prediction.recommendation?.includes('BEAT') ? 'var(--green)'
                         : prediction.recommendation?.includes('SELL') || prediction.recommendation?.includes('MISS') ? 'var(--red)'
                         : 'var(--amber)',
                  }}>
                    {prediction.recommendation || '—'}
                  </div>
                </div>

                {prediction.factors?.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 6 }}>KEY FACTORS</div>
                    {prediction.factors.map((f, i) => (
                      <div key={i} style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 3, paddingLeft: 8, borderLeft: '2px solid var(--amber-dim)' }}>
                        {f}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>CONFIDENCE</div>
                  <span style={{
                    fontSize: 10, padding: '2px 8px',
                    color: prediction.confidence === 'HIGH' ? 'var(--green)' : prediction.confidence === 'LOW' ? 'var(--red)' : 'var(--amber)',
                    border: `1px solid ${prediction.confidence === 'HIGH' ? 'var(--green-dim)' : prediction.confidence === 'LOW' ? 'var(--red-dim)' : 'var(--amber-dim)'}`,
                  }}>
                    {prediction.confidence}
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-3 text-muted">
                {predLoading ? 'Loading AI prediction…' : 'No AI prediction available for this stock'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default EarningsAIPanel;
