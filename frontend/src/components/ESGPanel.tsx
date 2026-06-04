/**
 * ESGPanel — Bloomberg ESG equivalent
 * Environmental, Social, Governance scores for Indian stocks
 */
import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';

interface ESGData {
  symbol: string;
  esg_score: number | null;
  environmental: number | null;
  social: number | null;
  governance: number | null;
  risk_level: string | null;
  source: string;
  note?: string;
}

const ESG_BENCHMARKS: Record<string, { label: string; color: string }> = {
  Low:    { label: 'LOW RISK',    color: '#00c853' },
  Medium: { label: 'MEDIUM RISK', color: '#ff9500' },
  High:   { label: 'HIGH RISK',   color: '#ff3d00' },
};

const POPULAR = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'ITC', 'HINDUNILVR', 'BAJFINANCE', 'WIPRO'];

function ScoreBar({ label, value, color }: { label: string; value: number | null; color: string }) {
  const pct = value ?? 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ color: '#888', fontSize: 11 }}>{label}</span>
        <span style={{ color, fontWeight: 700, fontSize: 13 }}>
          {value != null ? value.toFixed(1) : '—'}<span style={{ color: '#444', fontSize: 10 }}>/100</span>
        </span>
      </div>
      <div style={{ background: '#1a1a1a', height: 6, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}

function RadarChart({ e, s, g }: { e: number; s: number; g: number }) {
  const size = 140;
  const cx = size / 2, cy = size / 2, r = 55;
  const labels = ['E', 'S', 'G'];
  const values = [e / 100, s / 100, g / 100];
  const angles = [-90, 30, 150]; // degrees

  const toXY = (angle: number, radius: number) => ({
    x: cx + radius * Math.cos((angle * Math.PI) / 180),
    y: cy + radius * Math.sin((angle * Math.PI) / 180),
  });

  const pts = values.map((v, i) => toXY(angles[i], v * r));
  const polygon = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const gridRings = [0.25, 0.5, 0.75, 1.0];
  const colors = ['#00c853', '#4fc3f7', '#ff9500'];

  return (
    <svg width={size} height={size}>
      {/* Grid rings */}
      {gridRings.map((pct, i) => {
        const ringPts = angles.map(a => toXY(a, pct * r));
        const poly = ringPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        return <polygon key={i} points={poly} fill="none" stroke="#222" strokeWidth={0.5} />;
      })}
      {/* Axes */}
      {angles.map((a, i) => {
        const end = toXY(a, r);
        return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="#333" strokeWidth={0.5} />;
      })}
      {/* Value polygon */}
      <polygon points={polygon} fill="rgba(0,200,83,0.15)" stroke="#00c853" strokeWidth={1.5} />
      {/* Data points */}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={colors[i]} />
      ))}
      {/* Labels */}
      {labels.map((lbl, i) => {
        const pos = toXY(angles[i], r + 14);
        return (
          <text key={i} x={pos.x} y={pos.y} fill={colors[i]} fontSize={11} fontWeight="bold"
            textAnchor="middle" dominantBaseline="middle" fontFamily="Consolas, monospace">
            {lbl}
          </text>
        );
      })}
    </svg>
  );
}

export const ESGPanel: React.FC<{ symbol?: string }> = ({ symbol = 'RELIANCE' }) => {
  const [sym, setSym]             = useState(symbol.toUpperCase());
  const [data, setData]           = useState<ESGData | null>(null);
  const [loading, setLoading]     = useState(false);
  const [inputVal, setInputVal]   = useState(symbol.toUpperCase());
  const [bulkData, setBulkData]   = useState<ESGData[]>([]);
  const [activeTab, setActiveTab] = useState<'single' | 'compare'>('single');

  const loadSingle = useCallback(async (s: string) => {
    setLoading(true);
    const d = await apiFetch<ESGData>(`/api/esg/${s}`);
    setData(d);
    setLoading(false);
  }, []);

  const loadBulk = useCallback(async () => {
    const results = await Promise.allSettled(POPULAR.map(s => apiFetch<ESGData>(`/api/esg/${s}`)));
    setBulkData(results.filter(r => r.status === 'fulfilled' && (r as any).value?.esg_score).map(r => (r as any).value));
  }, []);

  useEffect(() => { loadSingle(sym); }, [sym, loadSingle]);
  useEffect(() => { if (activeTab === 'compare') loadBulk(); }, [activeTab, loadBulk]);

  const riskInfo = data?.risk_level ? ESG_BENCHMARKS[data.risk_level] : null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a', color: '#e8e8e0', fontFamily: 'Consolas, monospace', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', borderBottom: '1px solid #1a1a1a', background: '#111', flexShrink: 0 }}>
        <span style={{ color: '#00c853', fontWeight: 700, fontSize: 12 }}>ESG</span>
        <span style={{ color: '#555', fontSize: 10 }}>Environmental · Social · Governance</span>
        <div style={{ flex: 1 }} />
        {/* Symbol input */}
        <input
          value={inputVal}
          onChange={e => setInputVal(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') { setSym(inputVal); setActiveTab('single'); } }}
          placeholder="SYMBOL ENTER↵"
          style={{ background: '#1a1a1a', border: '1px solid #333', color: '#ff9500', padding: '3px 8px', fontSize: 11, fontFamily: 'Consolas, monospace', width: 140, outline: 'none' }}
        />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        {(['single', 'compare'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            background: activeTab === tab ? '#111' : 'transparent',
            border: 'none', borderBottom: activeTab === tab ? '2px solid #00c853' : '2px solid transparent',
            color: activeTab === tab ? '#00c853' : '#555',
            padding: '5px 16px', cursor: 'pointer', fontSize: 11,
            fontFamily: 'Consolas, monospace', fontWeight: 700,
          }}>
            {tab === 'single' ? `${sym} ESG` : 'COMPARE'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>

        {/* SINGLE */}
        {activeTab === 'single' && (
          <div style={{ padding: 16 }}>
            {loading && <div style={{ color: '#555', fontSize: 11, textAlign: 'center', padding: 20 }}>Loading ESG scores…</div>}
            {!loading && data && (
              <>
                {/* Main score + radar */}
                <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginBottom: 20 }}>
                  {/* Big score */}
                  <div style={{ textAlign: 'center', minWidth: 100 }}>
                    <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>ESG SCORE</div>
                    <div style={{
                      fontSize: 48, fontWeight: 700, lineHeight: 1,
                      color: data.esg_score == null ? '#333'
                        : data.esg_score >= 70 ? '#00c853'
                        : data.esg_score >= 45 ? '#ff9500' : '#ff3d00',
                    }}>
                      {data.esg_score != null ? data.esg_score.toFixed(0) : '—'}
                    </div>
                    {riskInfo && (
                      <div style={{ marginTop: 6, padding: '2px 10px', background: 'transparent', border: `1px solid ${riskInfo.color}`, color: riskInfo.color, fontSize: 10, borderRadius: 2 }}>
                        {riskInfo.label}
                      </div>
                    )}
                    <div style={{ marginTop: 6, color: '#555', fontSize: 9 }}>
                      {data.source === 'estimated' ? '⚠ ESTIMATED' : data.source.toUpperCase()}
                    </div>
                  </div>

                  {/* Radar */}
                  {data.environmental != null && (
                    <RadarChart
                      e={data.environmental}
                      s={data.social ?? 0}
                      g={data.governance ?? 0}
                    />
                  )}

                  {/* Score bars */}
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <ScoreBar label="🌱 Environmental" value={data.environmental} color="#00c853" />
                    <ScoreBar label="👥 Social" value={data.social} color="#4fc3f7" />
                    <ScoreBar label="🏛 Governance" value={data.governance} color="#ff9500" />
                  </div>
                </div>

                {/* Methodology note */}
                {data.note && (
                  <div style={{ padding: '8px 12px', background: '#111', border: '1px solid #1a2a1a', borderRadius: 3, fontSize: 10, color: '#555', lineHeight: 1.6 }}>
                    ⓘ {data.note}
                  </div>
                )}

                {/* Breakdown cards */}
                <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {[
                    { label: 'Environmental', sub: 'Carbon, waste, energy', val: data.environmental, color: '#00c853', icon: '🌱' },
                    { label: 'Social', sub: 'Labor, supply chain, safety', val: data.social, color: '#4fc3f7', icon: '👥' },
                    { label: 'Governance', sub: 'Board, audit, transparency', val: data.governance, color: '#ff9500', icon: '🏛' },
                  ].map(card => (
                    <div key={card.label} style={{ background: '#111', border: '1px solid #1a1a1a', padding: '10px 12px', borderRadius: 3 }}>
                      <div style={{ fontSize: 16, marginBottom: 4 }}>{card.icon}</div>
                      <div style={{ color: card.color, fontWeight: 700, fontSize: 13 }}>
                        {card.val != null ? card.val.toFixed(1) : '—'}
                      </div>
                      <div style={{ color: '#888', fontSize: 10, fontWeight: 700 }}>{card.label}</div>
                      <div style={{ color: '#444', fontSize: 9, marginTop: 2 }}>{card.sub}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* COMPARE */}
        {activeTab === 'compare' && (
          <div style={{ padding: '8px 12px' }}>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 10 }}>Top NSE stocks — ESG Comparison</div>
            {bulkData.length === 0 && <div style={{ color: '#444', fontSize: 11, textAlign: 'center', padding: 20 }}>Loading…</div>}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: '#111' }}>
                  {['Symbol', 'ESG Score', '🌱 E', '👥 S', '🏛 G', 'Risk'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: h === 'Symbol' ? 'left' : 'center', color: '#888', borderBottom: '1px solid #222', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...bulkData].sort((a, b) => (b.esg_score ?? 0) - (a.esg_score ?? 0)).map(row => {
                  const risk = row.risk_level ? ESG_BENCHMARKS[row.risk_level] : null;
                  const sc   = row.esg_score ?? 0;
                  return (
                    <tr key={row.symbol} style={{ borderBottom: '1px solid #111', cursor: 'pointer' }}
                      onClick={() => { setSym(row.symbol); setInputVal(row.symbol); setActiveTab('single'); }}>
                      <td style={{ padding: '6px 10px', color: '#ff9500', fontWeight: 700 }}>{row.symbol}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'center', color: sc >= 70 ? '#00c853' : sc >= 45 ? '#ff9500' : '#ff3d00', fontWeight: 700 }}>
                        {sc.toFixed(1)}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'center', color: '#00c853' }}>{row.environmental?.toFixed(1) ?? '—'}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'center', color: '#4fc3f7' }}>{row.social?.toFixed(1) ?? '—'}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'center', color: '#ff9500' }}>{row.governance?.toFixed(1) ?? '—'}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                        {risk && <span style={{ color: risk.color, fontSize: 10, border: `1px solid ${risk.color}`, padding: '1px 6px', borderRadius: 2 }}>{risk.label}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ESGPanel;
