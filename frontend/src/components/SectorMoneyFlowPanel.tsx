/**
 * SectorMoneyFlowPanel — Sectoral money flow: FII · DII · MF estimate · Retail proxy
 * NSE + BSE stock coverage. Click any sector row to see constituent stocks.
 */
import React, { useState } from 'react';
import { useApiData } from '../hooks/useApi';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

function fmtCr(v?: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(1)}L Cr`;
  if (abs >= 1000) return `₹${(v / 1000).toFixed(1)}K Cr`;
  if (abs >= 100)  return `₹${v.toFixed(0)} Cr`;
  return `₹${v.toFixed(1)} Cr`;
}

function flowClr(v: number): string {
  if (v > 0) return 'var(--green)';
  if (v < 0) return 'var(--red)';
  return 'var(--text-muted)';
}

function signalBadge(sig: string): { label: string; color: string } {
  switch (sig) {
    case 'STRONG_INFLOW':  return { label: '▲▲ STRONG', color: '#00e676' };
    case 'INFLOW':         return { label: '▲ INFLOW',  color: '#4caf50' };
    case 'OUTFLOW':        return { label: '▼ OUTFLOW', color: '#ef5350' };
    case 'STRONG_OUTFLOW': return { label: '▼▼ STRONG', color: '#b71c1c' };
    default:               return { label: '─ NEUTRAL', color: '#888' };
  }
}

type Period = '1W' | '2W' | '1M' | '3M';
const PERIOD_WEEKS: Record<Period, number> = { '1W': 1, '2W': 2, '1M': 4, '3M': 12 };

interface SectorFlow {
  sector: string;
  weight_pct: number;
  fii_net: number;
  dii_net: number;
  mf_est: number;
  retail_est: number;
  inst_net: number;
  total_net: number;
  signal: string;
  stocks_nse: string[];
  stocks_bse: string[];
}

interface FlowData {
  weeks: number;
  total_fii: number;
  total_dii: number;
  total_mf_est: number;
  total_retail_est: number;
  sectors: SectorFlow[];
  methodology: string;
  updated_at: string;
}

const SUMMARY_TOOLTIP: React.CSSProperties = {
  background: '#141414', border: '1px solid #333', fontSize: 10,
};

export const SectorMoneyFlowPanel: React.FC = () => {
  const [period, setPeriod]     = useState<Period>('1M');
  const [selected, setSelected] = useState<string | null>(null);

  const weeks = PERIOD_WEEKS[period];
  const { data, loading } = useApiData<FlowData>(
    `/api/sector-money-flow?weeks=${weeks}`,
    300_000,
    300_000,
  );

  const sectors: SectorFlow[] = data?.sectors ?? [];
  const sel = selected ? sectors.find(s => s.sector === selected) ?? null : null;

  // Horizontal stacked bar data — top 10 sectors
  const chartData = sectors.slice(0, 10).map(s => ({
    name: s.sector.replace('Capital Goods', 'Cap.Goods').replace('Consumer Disc', 'Cons.Disc'),
    FII:    s.fii_net,
    DII:    s.dii_net,
    MF:     s.mf_est,
    Retail: s.retail_est,
  }));

  const noData = !loading && sectors.length === 0;

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="panel-header">
        <span className="panel-title">SECTOR MONEY FLOW</span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 6 }}>
          FII · DII · MF EST · RETAIL
        </span>
        {loading && <span className="spinner" style={{ marginLeft: 8 }} />}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 3, alignItems: 'center' }}>
          {(['1W', '2W', '1M', '3M'] as Period[]).map(p => (
            <button
              key={p}
              className={`nav-tab${period === p ? ' active' : ''}`}
              onClick={() => setPeriod(p)}
              style={{ padding: '1px 6px', fontSize: 9 }}
            >{p}</button>
          ))}
        </div>
      </div>

      {/* ── Summary strip ───────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        background: '#0d0d0d', borderBottom: '1px solid #1a1a1a', flexShrink: 0,
      }}>
        {([
          { label: 'FII NET',    v: data?.total_fii,         est: false, note: 'NSE NSDL data' },
          { label: 'DII NET',    v: data?.total_dii,         est: false, note: 'NSE data' },
          { label: 'MF EST',     v: data?.total_mf_est,      est: true,  note: '68% of DII' },
          { label: 'RETAIL EST', v: data?.total_retail_est,  est: true,  note: 'contra-flow proxy' },
        ] as const).map(({ label, v, est, note }) => (
          <div key={label} style={{ padding: '7px 10px', borderRight: '1px solid #1a1a1a' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', display: 'flex', gap: 4, alignItems: 'center', marginBottom: 2 }}>
              {label}
              {est && <span style={{ color: '#444', fontSize: 7, letterSpacing: 0.5 }}>EST</span>}
            </div>
            <div style={{
              fontSize: 15, fontWeight: 700, color: flowClr(v ?? 0),
              fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
            }}>
              {v != null ? (v >= 0 ? '+' : '') + fmtCr(v) : '—'}
            </div>
            <div style={{ fontSize: 8, color: '#333', marginTop: 1 }}>{note}</div>
          </div>
        ))}
      </div>

      {/* ── No-data state ───────────────────────────────────────────────────── */}
      {noData && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
          No FII/DII flow data in DB yet — check MacroAgent status
        </div>
      )}

      {/* ── Main body: chart + table ─────────────────────────────────────────── */}
      {!noData && (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden', minHeight: 0 }}>

          {/* Left — horizontal stacked bar chart */}
          <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid #1a1a1a', overflow: 'hidden' }}>
            <div style={{ padding: '4px 8px', fontSize: 9, color: '#555', background: '#0a0a0a', borderBottom: '1px solid #111', flexShrink: 0 }}>
              INSTITUTIONAL FLOW BY SECTOR — {period} (₹ Cr)
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 4, right: 12, bottom: 4, left: 72 }}
                  barSize={9}
                >
                  <CartesianGrid strokeDasharray="2 2" stroke="#141414" horizontal={false} />
                  <XAxis
                    type="number"
                    tickFormatter={v => fmtCr(v).replace('₹', '')}
                    tick={{ fontSize: 8, fill: '#555' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 8, fill: '#aaa' }}
                    axisLine={false}
                    tickLine={false}
                    width={70}
                  />
                  <Tooltip
                    contentStyle={SUMMARY_TOOLTIP}
                    formatter={(val: number, name: string) => [
                      (val >= 0 ? '+' : '') + fmtCr(val), name,
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 8, paddingTop: 2 }} />
                  <Bar dataKey="FII"    stackId="a" fill="#2196f3" />
                  <Bar dataKey="DII"    stackId="a" fill="#4caf50" />
                  <Bar dataKey="MF"     stackId="a" fill="#ff9800" />
                  <Bar dataKey="Retail" stackId="a" fill="#9c27b0" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right — sector detail table */}
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Table header */}
            <div style={{
              padding: '4px 8px', fontSize: 8, color: '#555',
              background: '#0a0a0a', borderBottom: '1px solid #111',
              display: 'grid', gridTemplateColumns: '2.2fr 1fr 1fr 1fr 1.2fr 1.4fr 0.6fr',
              gap: 2, flexShrink: 0,
            }}>
              <span>SECTOR</span>
              <span style={{ textAlign: 'right' }}>FII</span>
              <span style={{ textAlign: 'right' }}>DII</span>
              <span style={{ textAlign: 'right' }}>MF EST</span>
              <span style={{ textAlign: 'right' }}>INST NET</span>
              <span style={{ textAlign: 'center' }}>SIGNAL</span>
              <span style={{ textAlign: 'center' }}>WT%</span>
            </div>

            {/* Rows */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              {sectors.map(s => {
                const { label, color } = signalBadge(s.signal);
                const isSel = selected === s.sector;
                return (
                  <div
                    key={s.sector}
                    onClick={() => setSelected(isSel ? null : s.sector)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '2.2fr 1fr 1fr 1fr 1.2fr 1.4fr 0.6fr',
                      gap: 2, padding: '4px 8px',
                      borderBottom: '1px solid #0f0f0f',
                      background: isSel ? '#0e1a2e' : 'transparent',
                      cursor: 'pointer',
                      alignItems: 'center',
                    }}
                    onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = '#121212'; }}
                    onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                  >
                    <span style={{ fontSize: 10, fontWeight: 600, color: isSel ? 'var(--amber)' : '#ddd' }}>
                      {s.sector}
                    </span>
                    <span style={{ fontSize: 9, textAlign: 'right', color: flowClr(s.fii_net), fontVariantNumeric: 'tabular-nums' }}>
                      {s.fii_net >= 0 ? '+' : ''}{fmtCr(s.fii_net)}
                    </span>
                    <span style={{ fontSize: 9, textAlign: 'right', color: flowClr(s.dii_net), fontVariantNumeric: 'tabular-nums' }}>
                      {s.dii_net >= 0 ? '+' : ''}{fmtCr(s.dii_net)}
                    </span>
                    <span style={{ fontSize: 9, textAlign: 'right', color: flowClr(s.mf_est), fontVariantNumeric: 'tabular-nums' }}>
                      {s.mf_est >= 0 ? '+' : ''}{fmtCr(s.mf_est)}
                    </span>
                    <span style={{ fontSize: 10, textAlign: 'right', fontWeight: 700, color: flowClr(s.inst_net), fontVariantNumeric: 'tabular-nums' }}>
                      {s.inst_net >= 0 ? '+' : ''}{fmtCr(s.inst_net)}
                    </span>
                    <span style={{ fontSize: 8, textAlign: 'center', color, fontWeight: 700 }}>
                      {label}
                    </span>
                    <span style={{ fontSize: 8, textAlign: 'center', color: '#444' }}>
                      {s.weight_pct}%
                    </span>
                  </div>
                );
              })}

              {/* Methodology footnote */}
              {sectors.length > 0 && (
                <div style={{ padding: '5px 8px', fontSize: 7, color: '#2a2a2a', borderTop: '1px solid #111', lineHeight: 1.5 }}>
                  FII/DII: NSE NSDL daily data · MF: 68%×DII estimate · Retail: contra-flow proxy
                  <br />Click any row to see NSE + BSE constituent stocks
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Stock detail drawer (expands below on sector click) ──────────────── */}
      {sel && (
        <div style={{
          borderTop: '2px solid #1e3a5f',
          background: '#060c14',
          flexShrink: 0,
          maxHeight: 150,
          overflow: 'auto',
          padding: '8px 10px',
        }}>
          {/* Sector title + flow summary */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', letterSpacing: 0.5 }}>
              {sel.sector}
            </span>
            <span style={{ fontSize: 9, color: flowClr(sel.fii_net) }}>
              FII {sel.fii_net >= 0 ? '+' : ''}{fmtCr(sel.fii_net)}
            </span>
            <span style={{ fontSize: 9, color: flowClr(sel.dii_net) }}>
              DII {sel.dii_net >= 0 ? '+' : ''}{fmtCr(sel.dii_net)}
            </span>
            <span style={{ fontSize: 9, color: flowClr(sel.mf_est) }}>
              MF~{sel.mf_est >= 0 ? '+' : ''}{fmtCr(sel.mf_est)}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 8, color: '#333' }}>
              {sel.stocks_nse.length} NSE · {sel.stocks_bse.length} BSE stocks
            </span>
          </div>

          {/* NSE stocks */}
          {sel.stocks_nse.length > 0 && (
            <div style={{ marginBottom: 5 }}>
              <span style={{ fontSize: 8, color: '#4caf50', fontWeight: 700, marginRight: 7, letterSpacing: 0.5 }}>
                NSE
              </span>
              <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 3 }}>
                {sel.stocks_nse.map(sym => (
                  <span key={sym} style={{
                    padding: '1px 6px', background: '#071407',
                    border: '1px solid #1a3a1a', borderRadius: 2,
                    fontSize: 9, color: '#7fff7f', fontWeight: 600,
                  }}>{sym}</span>
                ))}
              </span>
            </div>
          )}

          {/* BSE stocks */}
          {sel.stocks_bse.length > 0 && (
            <div>
              <span style={{ fontSize: 8, color: '#ff9800', fontWeight: 700, marginRight: 7, letterSpacing: 0.5 }}>
                BSE
              </span>
              <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 3 }}>
                {sel.stocks_bse.map(sym => (
                  <span key={sym} style={{
                    padding: '1px 6px', background: '#140a00',
                    border: '1px solid #3a1a00', borderRadius: 2,
                    fontSize: 9, color: '#ffab40', fontWeight: 600,
                  }}>{sym}</span>
                ))}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
