import React, { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../hooks/useApi';

interface ScreenerResult {
  symbol:          string;
  name?:           string;
  sector?:         string;
  price?:          number;
  change_pct?:     number;
  rsi?:            number;
  signal?:         string;
  trend?:          string;
  volume_ratio?:   number;
  pe_ratio?:       number;
  roce?:           number;
  roe?:            number;
  revenue_growth?: number;
  promoter_holding?: number;
  market_cap?:     number;
}

interface Preset {
  id: string;
  label: string;
  desc: string;
  params: Record<string, any>;
}

const SECTORS = ['Banking', 'IT', 'Pharma', 'FMCG', 'Auto', 'Energy', 'Metals', 'Realty', 'Telecom', 'Infrastructure', 'Finance', 'Cement'];

const fmtNum = (v?: number, d = 2) => (v == null || isNaN(v)) ? '—' : v.toFixed(d);
const fmtMCap = (v?: number) => {
  if (v == null) return '—';
  if (v >= 1e12) return `₹${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9)  return `₹${(v / 1e9).toFixed(0)}B`;
  return `₹${(v / 1e7).toFixed(0)}Cr`;
};

const SignalBadge: React.FC<{ signal?: string }> = ({ signal }) => {
  if (!signal) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const color = signal.includes('BUY') ? 'var(--green)' : signal.includes('SELL') ? 'var(--red)' : 'var(--amber)';
  return (
    <span style={{ color, border: `1px solid ${color}`, padding: '1px 5px', fontSize: 9, fontWeight: 700 }}>
      {signal}
    </span>
  );
};

const RSIBar: React.FC<{ rsi?: number }> = ({ rsi }) => {
  if (rsi == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const color = rsi >= 70 ? 'var(--red)' : rsi <= 30 ? 'var(--green)' : rsi >= 55 ? '#69f0ae' : rsi <= 45 ? '#ff6e40' : 'var(--amber)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ color, fontWeight: 700, fontSize: 10, minWidth: 28 }}>{rsi.toFixed(0)}</span>
      <div style={{ width: 40, height: 4, background: '#222', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${rsi}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
};

export const Screener: React.FC<{ onSelectTicker: (sym: string) => void }> = ({ onSelectTicker }) => {
  const [results, setResults] = useState<ScreenerResult[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState('change_pct');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Filter state
  const [sector, setSector]     = useState('');
  const [minRsi, setMinRsi]     = useState('');
  const [maxRsi, setMaxRsi]     = useState('');
  const [minChg, setMinChg]     = useState('');
  const [maxChg, setMaxChg]     = useState('');
  const [minVolR, setMinVolR]   = useState('');
  const [signal, setSignal]     = useState('');
  const [minRoce, setMinRoce]   = useState('');
  const [maxPe, setMaxPe]       = useState('');

  useEffect(() => {
    apiFetch<Preset[]>('/api/screener/presets').then(p => {
      if (p) setPresets(p);
    });
  }, []);

  const runScreen = useCallback(async (extraParams?: Record<string, any>) => {
    setLoading(true);
    try {
      const params: Record<string, string> = { sort_by: sortBy, sort_dir: sortDir, limit: '100' };
      if (sector)   params.sector    = sector;
      if (minRsi)   params.min_rsi   = minRsi;
      if (maxRsi)   params.max_rsi   = maxRsi;
      if (minChg)   params.min_change = minChg;
      if (maxChg)   params.max_change = maxChg;
      if (minVolR)  params.min_vol_ratio = minVolR;
      if (signal)   params.signal    = signal;
      if (minRoce)  params.min_roce  = minRoce;
      if (maxPe)    params.max_pe    = maxPe;

      // Merge preset params
      if (extraParams) {
        Object.entries(extraParams).forEach(([k, v]) => {
          if (k === 'sort_by') params.sort_by = String(v);
          else if (k === 'sort_dir') params.sort_dir = String(v);
          else params[k] = String(v);
        });
      }

      const qs = new URLSearchParams(params).toString();
      const data = await apiFetch<ScreenerResult[]>(`/api/screener?${qs}`);
      if (data) setResults(data);
    } catch (_) {}
    setLoading(false);
  }, [sector, minRsi, maxRsi, minChg, maxChg, minVolR, signal, minRoce, maxPe, sortBy, sortDir]);

  const applyPreset = (preset: Preset) => {
    setActivePreset(preset.id);
    // Reset filters
    setSector(''); setMinRsi(''); setMaxRsi(''); setMinChg(''); setMaxChg('');
    setMinVolR(''); setSignal(''); setMinRoce(''); setMaxPe('');
    runScreen(preset.params);
  };

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  };

  const SortArrow: React.FC<{ col: string }> = ({ col }) => {
    if (sortBy !== col) return <span style={{ color: '#333' }}>↕</span>;
    return <span style={{ color: 'var(--amber)' }}>{sortDir === 'desc' ? '↓' : '↑'}</span>;
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="panel-header">
        <span className="panel-title">📊 STOCK SCREENER — BLOOMBERG SRCH</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>NSE + BSE UNIVERSE</span>
      </div>

      {/* Preset buttons */}
      <div style={{ display: 'flex', gap: 4, padding: '6px 8px', background: '#0e0e0e', borderBottom: '1px solid #222', flexWrap: 'wrap', flexShrink: 0 }}>
        {presets.map(p => (
          <button
            key={p.id}
            onClick={() => applyPreset(p)}
            title={p.desc}
            style={{
              background: activePreset === p.id ? 'rgba(255,149,0,0.15)' : '#141414',
              border: `1px solid ${activePreset === p.id ? 'var(--amber-dim)' : '#333'}`,
              color: activePreset === p.id ? 'var(--amber)' : 'var(--text-secondary)',
              padding: '2px 8px', cursor: 'pointer', fontSize: 9, fontFamily: 'monospace',
              fontWeight: activePreset === p.id ? 700 : 400,
            }}
          >
            {p.label}
          </button>
        ))}
        <span style={{ color: '#333', margin: '0 4px' }}>|</span>
        <button
          onClick={() => { setActivePreset(null); runScreen(); }}
          style={{ background: '#0a6aff20', border: '1px solid #0a6aff44', color: '#82b1ff', padding: '2px 8px', cursor: 'pointer', fontSize: 9, fontFamily: 'monospace' }}
        >
          RUN CUSTOM
        </button>
      </div>

      {/* Filters row */}
      <div style={{ display: 'flex', gap: 6, padding: '5px 8px', background: '#0a0a0a', borderBottom: '1px solid #1a1a1a', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={sector} onChange={e => setSector(e.target.value)} style={{ height: 22, fontSize: 9, padding: '0 4px' }}>
          <option value="">All Sectors</option>
          {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select value={signal} onChange={e => setSignal(e.target.value)} style={{ height: 22, fontSize: 9, padding: '0 4px' }}>
          <option value="">Any Signal</option>
          <option value="BUY">BUY</option>
          <option value="HOLD">HOLD</option>
          <option value="SELL">SELL</option>
        </select>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>RSI:</span>
          <input style={{ width: 38, height: 22, fontSize: 9 }} placeholder="min" value={minRsi} onChange={e => setMinRsi(e.target.value)} />
          <span style={{ color: '#333' }}>–</span>
          <input style={{ width: 38, height: 22, fontSize: 9 }} placeholder="max" value={maxRsi} onChange={e => setMaxRsi(e.target.value)} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Chg%:</span>
          <input style={{ width: 38, height: 22, fontSize: 9 }} placeholder="min" value={minChg} onChange={e => setMinChg(e.target.value)} />
          <span style={{ color: '#333' }}>–</span>
          <input style={{ width: 38, height: 22, fontSize: 9 }} placeholder="max" value={maxChg} onChange={e => setMaxChg(e.target.value)} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Vol×:</span>
          <input style={{ width: 42, height: 22, fontSize: 9 }} placeholder="min" value={minVolR} onChange={e => setMinVolR(e.target.value)} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>ROCE≥:</span>
          <input style={{ width: 38, height: 22, fontSize: 9 }} placeholder="%" value={minRoce} onChange={e => setMinRoce(e.target.value)} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>P/E≤:</span>
          <input style={{ width: 38, height: 22, fontSize: 9 }} placeholder="max" value={maxPe} onChange={e => setMaxPe(e.target.value)} />
        </div>

        <button
          onClick={() => { setActivePreset(null); runScreen(); }}
          style={{ background: 'rgba(255,149,0,0.1)', border: '1px solid var(--amber-dim)', color: 'var(--amber)', padding: '2px 10px', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace', fontWeight: 700 }}
        >
          SCREEN {loading ? '…' : '▶'}
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: 9, marginLeft: 4 }}>
          {results.length > 0 && `${results.length} results`}
        </span>
      </div>

      {/* Results table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {results.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60%', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Select a preset or set filters and click SCREEN</div>
            <div style={{ color: '#333', fontSize: 10 }}>Screening across NSE + BSE universe</div>
          </div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#0a0a0a' }}>
              <tr>
                {[
                  { key: 'symbol',          label: 'SYMBOL',    align: 'left' },
                  { key: 'sector',          label: 'SECTOR',    align: 'left' },
                  { key: 'price',           label: 'PRICE',     align: 'right' },
                  { key: 'change_pct',      label: 'CHG%',      align: 'right' },
                  { key: 'rsi',             label: 'RSI',       align: 'left' },
                  { key: 'signal',          label: 'SIGNAL',    align: 'center' },
                  { key: 'volume_ratio',    label: 'VOL×',      align: 'right' },
                  { key: 'pe_ratio',        label: 'P/E',       align: 'right' },
                  { key: 'roce',            label: 'ROCE%',     align: 'right' },
                  { key: 'revenue_growth',  label: 'REV G%',    align: 'right' },
                  { key: 'promoter_holding',label: 'PROMOTER%', align: 'right' },
                  { key: 'market_cap',      label: 'MCAP',      align: 'right' },
                ].map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    style={{
                      textAlign: col.align as any,
                      padding: '4px 6px',
                      fontSize: 9,
                      color: sortBy === col.key ? 'var(--amber)' : 'var(--text-muted)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      borderBottom: '1px solid #222',
                      fontWeight: 400,
                      userSelect: 'none',
                    }}
                  >
                    {col.label} <SortArrow col={col.key} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => {
                const chgColor = (r.change_pct || 0) >= 0 ? 'var(--green)' : 'var(--red)';
                return (
                  <tr
                    key={i}
                    onClick={() => onSelectTicker(r.symbol)}
                    style={{ borderBottom: '1px solid #111', cursor: 'pointer' }}
                    className="screener-row"
                  >
                    <td style={{ padding: '4px 6px' }}>
                      <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 11 }}>{r.symbol}</span>
                      {r.name && <span style={{ color: 'var(--text-muted)', fontSize: 9, marginLeft: 4, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}>{r.name?.slice(0, 20)}</span>}
                    </td>
                    <td style={{ padding: '4px 6px', color: 'var(--text-muted)', fontSize: 9 }}>{r.sector?.slice(0, 15) || '—'}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', fontSize: 11 }}>
                      {r.price ? `₹${r.price.toFixed(2)}` : '—'}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', color: chgColor, fontWeight: 700, fontSize: 10 }}>
                      {r.change_pct != null ? `${r.change_pct >= 0 ? '+' : ''}${r.change_pct.toFixed(2)}%` : '—'}
                    </td>
                    <td style={{ padding: '4px 6px' }}><RSIBar rsi={r.rsi} /></td>
                    <td style={{ padding: '4px 6px', textAlign: 'center' }}><SignalBadge signal={r.signal} /></td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', color: (r.volume_ratio || 1) >= 2 ? 'var(--amber)' : 'var(--text-secondary)', fontSize: 10, fontWeight: (r.volume_ratio || 1) >= 2 ? 700 : 400 }}>
                      {r.volume_ratio ? `${r.volume_ratio.toFixed(1)}×` : '—'}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text-secondary)', fontSize: 10 }}>
                      {fmtNum(r.pe_ratio, 1)}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', color: (r.roce || 0) >= 15 ? 'var(--green)' : 'var(--text-secondary)', fontSize: 10, fontWeight: (r.roce || 0) >= 15 ? 700 : 400 }}>
                      {fmtNum(r.roce, 1)}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', color: (r.revenue_growth || 0) >= 15 ? 'var(--green)' : (r.revenue_growth || 0) < 0 ? 'var(--red)' : 'var(--text-secondary)', fontSize: 10 }}>
                      {r.revenue_growth != null ? `${r.revenue_growth >= 0 ? '+' : ''}${fmtNum(r.revenue_growth, 1)}%` : '—'}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', color: (r.promoter_holding || 0) >= 50 ? 'var(--green)' : 'var(--text-secondary)', fontSize: 10 }}>
                      {fmtNum(r.promoter_holding, 1)}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text-muted)', fontSize: 9 }}>
                      {fmtMCap(r.market_cap)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
