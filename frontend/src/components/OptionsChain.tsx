import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useApiData } from '../hooks/useApi';

interface Props { symbol: string; }

// ── Format helpers ─────────────────────────────────────────────────────────────
const fmt = (v?: number | null, d = 2): string => {
  if (v == null || isNaN(v)) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
};
const fmtOI = (v?: number | null): string => {
  if (!v) return '—';
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toString();
};
const fmtIV = (v?: number | null): string => v ? `${v.toFixed(1)}%` : '—';
const oiColor = (v?: number | null): string =>
  !v ? 'var(--text-muted)' : v > 0 ? 'var(--green)' : 'var(--red)';

// ── OI bar component ───────────────────────────────────────────────────────────
const OIBar: React.FC<{ value: number; max: number; side: 'call' | 'put' }> = ({ value, max, side }) => {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const color = side === 'call' ? 'rgba(0,200,83,0.5)' : 'rgba(255,61,0,0.5)';
  return (
    <div style={{ position: 'relative', height: 14, background: 'rgba(255,255,255,0.03)', flex: 1, minWidth: 40 }}>
      <div style={{
        position: 'absolute', top: 0, height: '100%', width: `${pct}%`,
        background: color,
        [side === 'call' ? 'right' : 'left']: 0,
      }} />
    </div>
  );
};

// ── IV Skew mini chart ─────────────────────────────────────────────────────────
const IVSkewChart: React.FC<{ strikes: any[]; atm: number }> = ({ strikes, atm }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !strikes.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const pts = strikes
      .filter(s => s.call_iv || s.put_iv)
      .sort((a, b) => a.strike - b.strike)
      .map(s => ({ x: s.strike, callIV: s.call_iv || 0, putIV: s.put_iv || 0 }));

    if (pts.length < 2) return;
    const minX = pts[0].x, maxX = pts[pts.length - 1].x;
    const maxIV = Math.max(...pts.map(p => Math.max(p.callIV, p.putIV)));
    const toX = (v: number) => ((v - minX) / (maxX - minX)) * (w - 20) + 10;
    const toY = (v: number) => h - 8 - (v / (maxIV || 1)) * (h - 16);

    // ATM line
    const atmX = toX(atm);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255,149,0,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(atmX, 0); ctx.lineTo(atmX, h); ctx.stroke();
    ctx.setLineDash([]);

    // Call IV line (green)
    ctx.strokeStyle = '#00c853';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(toX(p.x), toY(p.callIV));
      else ctx.lineTo(toX(p.x), toY(p.callIV));
    });
    ctx.stroke();

    // Put IV line (red)
    ctx.strokeStyle = '#ff3d00';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(toX(p.x), toY(p.putIV));
      else ctx.lineTo(toX(p.x), toY(p.putIV));
    });
    ctx.stroke();

    // Labels
    ctx.fillStyle = 'rgba(138,138,122,0.8)';
    ctx.font = '9px Consolas';
    ctx.fillText('IV SKEW', 4, 10);
    ctx.fillStyle = '#00c853'; ctx.fillText('CE', w - 28, 10);
    ctx.fillStyle = '#ff3d00'; ctx.fillText('PE', w - 14, 10);
  }, [strikes, atm]);

  return <canvas ref={canvasRef} width={420} height={80} style={{ width: '100%', height: 80 }} />;
};

// ── OI by Strike chart ─────────────────────────────────────────────────────────
const OIChart: React.FC<{ strikes: any[]; atm: number; maxPain?: number }> = ({ strikes, atm, maxPain }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !strikes.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const sorted = [...strikes].sort((a, b) => a.strike - b.strike);
    const n = Math.min(sorted.length, 30);
    const visible = sorted.slice(Math.max(0, sorted.findIndex(s => s.strike >= atm) - 15),
                                 Math.max(0, sorted.findIndex(s => s.strike >= atm) - 15) + n);
    if (!visible.length) return;

    const barW = Math.max(2, (w - 20) / (visible.length * 2 + 1));
    const maxOI = Math.max(...visible.map(s => Math.max(s.call_oi || 0, s.put_oi || 0)));
    const scaleY = (maxOI > 0) ? (h - 30) / maxOI : 1;
    const minX = visible[0].strike, maxX = visible[visible.length - 1].strike;
    const toXPos = (strike: number) => {
      const idx = visible.findIndex(s => s.strike === strike);
      return 10 + idx * (barW * 2 + 2) + barW / 2;
    };

    // ATM background
    const atmIdx = visible.findIndex(s => Math.abs(s.strike - atm) <= (visible[1]?.strike - visible[0]?.strike) / 2);
    if (atmIdx >= 0) {
      ctx.fillStyle = 'rgba(255,149,0,0.05)';
      ctx.fillRect(10 + atmIdx * (barW * 2 + 2), 0, barW * 2 + 2, h - 20);
    }

    // Bars
    visible.forEach((s, i) => {
      const x = 10 + i * (barW * 2 + 2);
      const callH = (s.call_oi || 0) * scaleY;
      const putH  = (s.put_oi  || 0) * scaleY;
      // Call OI (green, right bar)
      ctx.fillStyle = 'rgba(0,200,83,0.7)';
      ctx.fillRect(x + barW + 1, h - 20 - callH, barW, callH);
      // Put OI (red, left bar)
      ctx.fillStyle = 'rgba(255,61,0,0.7)';
      ctx.fillRect(x, h - 20 - putH, barW, putH);
    });

    // Max pain line
    if (maxPain) {
      const mpIdx = visible.findIndex(s => Math.abs(s.strike - maxPain) < 1);
      if (mpIdx >= 0) {
        const mpX = 10 + mpIdx * (barW * 2 + 2) + barW;
        ctx.setLineDash([4, 2]);
        ctx.strokeStyle = '#ffd600';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(mpX, 0); ctx.lineTo(mpX, h - 20); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffd600';
        ctx.font = '8px Consolas';
        ctx.fillText('MAX PAIN', mpX + 2, 10);
      }
    }

    // Strike labels (every 3rd)
    ctx.fillStyle = 'rgba(138,138,122,0.6)';
    ctx.font = '8px Consolas';
    visible.forEach((s, i) => {
      if (i % 3 === 0) {
        const x = 10 + i * (barW * 2 + 2);
        ctx.fillText(String(s.strike), x, h - 4);
      }
    });

    // Legend
    ctx.fillStyle = '#00c853'; ctx.fillText('CE OI', 4, 12);
    ctx.fillStyle = '#ff3d00'; ctx.fillText('PE OI', 40, 12);
  }, [strikes, atm, maxPain]);

  return <canvas ref={canvasRef} width={600} height={120} style={{ width: '100%', height: 120 }} />;
};

// ── Main Options Chain Component ───────────────────────────────────────────────
type ChainView = 'chain' | 'oi_chart' | 'iv_skew' | 'strategy';

const STRATEGIES = [
  { name: 'Long Call', legs: [{ type: 'CE', action: 'BUY', qty: 1 }] },
  { name: 'Long Put',  legs: [{ type: 'PE', action: 'BUY', qty: 1 }] },
  { name: 'Bull Call Spread', legs: [{ type:'CE',action:'BUY',qty:1 }, { type:'CE',action:'SELL',qty:1,offset:1 }] },
  { name: 'Bear Put Spread',  legs: [{ type:'PE',action:'BUY',qty:1 }, { type:'PE',action:'SELL',qty:1,offset:-1}] },
  { name: 'Long Straddle', legs: [{ type:'CE',action:'BUY',qty:1 }, { type:'PE',action:'BUY',qty:1 }] },
  { name: 'Long Strangle', legs: [{ type:'CE',action:'BUY',qty:1,offset:1 }, { type:'PE',action:'BUY',qty:1,offset:-1}] },
  { name: 'Iron Condor', legs: [
    { type:'PE',action:'BUY',qty:1,offset:-2 }, { type:'PE',action:'SELL',qty:1,offset:-1 },
    { type:'CE',action:'SELL',qty:1,offset:1 }, { type:'CE',action:'BUY',qty:1,offset:2 },
  ]},
  { name: 'Short Straddle', legs: [{ type:'CE',action:'SELL',qty:1 }, { type:'PE',action:'SELL',qty:1 }] },
];

export const OptionsChain: React.FC<Props> = ({ symbol }) => {
  const [view, setView] = useState<ChainView>('chain');
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [strikeSearch, setStrikeSearch] = useState<string>('');
  const [showGreeks, setShowGreeks] = useState(true);
  const [showOIChange, setShowOIChange] = useState(true);
  const [filterMode, setFilterMode] = useState<'all' | 'itm' | 'otm' | 'atm'>('all');
  const [selectedStrategy, setSelectedStrategy] = useState<string>('Long Straddle');

  // Try Fyers options first, fall back to NSE
  const { data: fyersOpts } = useApiData<any>(`/api/fyers/options/${symbol}?strikes=30`, 30000);
  const { data: nseOpts } = useApiData<any>(`/api/options/${symbol}`, 60000);
  const data = fyersOpts || nseOpts;

  const expiries = useMemo(() => data?.expiry_dates || [], [data]);
  const activeExpiry = selectedExpiry || expiries[0] || '';
  const underlying = data?.underlying_value || 0;

  const strikes = useMemo(() => {
    let s = (data?.strikes || []).filter((s: any) => !activeExpiry || s.expiry === activeExpiry);
    if (strikeSearch) {
      const q = parseFloat(strikeSearch);
      if (!isNaN(q)) s = s.filter((x: any) => Math.abs(x.strike - q) <= 500);
    }
    return s.sort((a: any, b: any) => a.strike - b.strike);
  }, [data, activeExpiry, strikeSearch]);

  const atmStrike = useMemo(() => {
    if (!underlying || !strikes.length) return 0;
    return strikes.reduce((best: any, curr: any) =>
      Math.abs(curr.strike - underlying) < Math.abs(best.strike - underlying) ? curr : best, strikes[0]
    )?.strike || 0;
  }, [underlying, strikes]);

  const filteredStrikes = useMemo(() => {
    const step = strikes.length > 1 ? (strikes[1].strike - strikes[0].strike) : 100;
    if (filterMode === 'itm') return strikes.filter((s: any) =>
      s.strike < underlying - step || s.strike > underlying + step);
    if (filterMode === 'otm') return strikes.filter((s: any) =>
      s.strike > underlying + step || s.strike < underlying - step);
    if (filterMode === 'atm') return strikes.filter((s: any) =>
      Math.abs(s.strike - atmStrike) <= step * 10);
    return strikes;
  }, [strikes, filterMode, underlying, atmStrike]);

  const maxCallOI = useMemo(() => Math.max(...strikes.map((s: any) => s.call_oi || 0), 1), [strikes]);
  const maxPutOI  = useMemo(() => Math.max(...strikes.map((s: any) => s.put_oi  || 0), 1), [strikes]);
  const totalCEOI = data?.total_ce_oi || 0;
  const totalPEOI = data?.total_pe_oi || 0;
  const pcr = data?.pcr || 0;
  const maxPain = data?.max_pain;

  // ATM IV
  const atmStrikeData = strikes.find((s: any) => s.strike === atmStrike);
  const atmIV = atmStrikeData ? ((atmStrikeData.call_iv || 0) + (atmStrikeData.put_iv || 0)) / 2 : 0;

  // Unusual activity
  const unusual = useMemo(() =>
    strikes.filter((s: any) => (s.call_oi_change || 0) > maxCallOI * 0.15 || (s.put_oi_change || 0) > maxPutOI * 0.15),
    [strikes, maxCallOI, maxPutOI]
  );

  // PCR color
  const pcrColor = pcr > 1.3 ? 'var(--green)' : pcr < 0.7 ? 'var(--red)' : 'var(--amber)';

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ── */}
      <div className="panel-header" style={{ height: 'auto', flexDirection: 'column', gap: 4, padding: '4px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
          <span className="panel-title">⚡ {symbol} OPTIONS MONITOR</span>
          {data?.source === 'fyers' && <span style={{ fontSize: 9, color: 'var(--green)', border: '1px solid var(--green-dim)', padding: '1px 4px' }}>FYERS LIVE</span>}
          <div style={{ flex: 1 }} />
          {/* Summary metrics */}
          {data && (
            <div style={{ display: 'flex', gap: 12, fontSize: 10 }}>
              <span>SPOT <b style={{ color: 'var(--amber)' }}>{fmt(underlying)}</b></span>
              <span>ATM IV <b style={{ color: underlying > 0 ? 'var(--cyan)' : 'var(--text-muted)' }}>{fmtIV(atmIV)}</b></span>
              <span>PCR <b style={{ color: pcrColor }}>{pcr.toFixed(2)}</b></span>
              {maxPain && <span>MAX PAIN <b style={{ color: '#ffd600' }}>{fmt(maxPain, 0)}</b></span>}
              <span style={{ color: 'var(--text-muted)' }}>CE OI: <b>{fmtOI(totalCEOI)}</b></span>
              <span style={{ color: 'var(--text-muted)' }}>PE OI: <b>{fmtOI(totalPEOI)}</b></span>
            </div>
          )}
        </div>

        {/* Controls row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
          {/* Strike search */}
          <input
            value={strikeSearch}
            onChange={e => setStrikeSearch(e.target.value)}
            placeholder="Search strike…"
            style={{ width: 120, height: 22, fontSize: 10 }}
          />

          {/* Expiry tabs */}
          <div style={{ display: 'flex', gap: 1, overflowX: 'auto', flex: 1 }}>
            {expiries.map((exp: string) => (
              <button key={exp} onClick={() => setSelectedExpiry(exp)}
                style={{
                  background: activeExpiry === exp ? 'var(--bg-selected)' : 'transparent',
                  border: '1px solid ' + (activeExpiry === exp ? 'var(--amber-dim)' : 'var(--border)'),
                  color: activeExpiry === exp ? 'var(--amber)' : 'var(--text-secondary)',
                  padding: '1px 8px', fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap',
                  fontFamily: 'var(--font-mono)',
                }}>
                {exp}
              </button>
            ))}
          </div>

          {/* Filter */}
          {(['all','atm','itm','otm'] as const).map(f => (
            <button key={f} onClick={() => setFilterMode(f)}
              className={`btn ${filterMode === f ? 'btn-amber' : ''}`}
              style={{ padding: '1px 5px', fontSize: 9 }}>
              {f.toUpperCase()}
            </button>
          ))}

          {/* Toggles */}
          <button onClick={() => setShowGreeks(g => !g)} className={`btn ${showGreeks ? 'btn-amber' : ''}`}
            style={{ padding: '1px 5px', fontSize: 9 }}>GREEKS</button>
          <button onClick={() => setShowOIChange(g => !g)} className={`btn ${showOIChange ? 'btn-amber' : ''}`}
            style={{ padding: '1px 5px', fontSize: 9 }}>OI CHG</button>
        </div>

        {/* View tabs */}
        <div style={{ display: 'flex', gap: 1 }}>
          {([
            ['chain','OPTION CHAIN'], ['oi_chart','OI CHART'], ['iv_skew','IV SKEW'], ['strategy','STRATEGY']
          ] as [ChainView, string][]).map(([v, l]) => (
            <button key={v} onClick={() => setView(v)}
              style={{
                background: view === v ? 'var(--bg-selected)' : 'transparent',
                border: 'none', borderBottom: view === v ? '2px solid var(--amber)' : '2px solid transparent',
                color: view === v ? 'var(--amber)' : 'var(--text-muted)',
                padding: '2px 10px', cursor: 'pointer', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
              }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="panel-body" style={{ flex: 1 }}>

        {/* Unusual Activity Banner */}
        {unusual.length > 0 && view === 'chain' && (
          <div style={{ background: 'rgba(255,214,0,0.06)', borderBottom: '1px solid rgba(255,214,0,0.2)', padding: '3px 8px', display: 'flex', gap: 12, overflowX: 'auto' }}>
            <span style={{ color: '#ffd600', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>⚡ UNUSUAL:</span>
            {unusual.slice(0, 6).map((s: any, i: number) => (
              <span key={i} style={{ fontSize: 9, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                {s.strike} {s.call_oi_change > 0 ? <span style={{ color: 'var(--green)' }}>CE +{fmtOI(s.call_oi_change)}</span> : null}
                {s.put_oi_change > 0 ? <span style={{ color: 'var(--red)' }}> PE +{fmtOI(s.put_oi_change)}</span> : null}
              </span>
            ))}
          </div>
        )}

        {/* ── CHAIN VIEW ── */}
        {view === 'chain' && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 900 }}>
              <thead>
                <tr>
                  <th colSpan={showGreeks ? 8 : 5} style={{ textAlign: 'center', color: 'var(--green)', background: 'rgba(0,200,83,0.05)', borderRight: '2px solid var(--border-bright)' }}>CALLS</th>
                  <th style={{ textAlign: 'center', color: 'var(--amber)', background: 'rgba(255,149,0,0.05)', borderRight: '2px solid var(--border-bright)' }}>STRIKE</th>
                  <th colSpan={showGreeks ? 8 : 5} style={{ textAlign: 'center', color: 'var(--red)', background: 'rgba(255,61,0,0.05)' }}>PUTS</th>
                </tr>
                <tr style={{ fontSize: 9 }}>
                  {/* Call columns */}
                  {showGreeks && <>
                    <th style={{ textAlign: 'right', color: 'var(--cyan)' }}>Δ</th>
                    <th style={{ textAlign: 'right', color: 'var(--cyan)' }}>Γ</th>
                    <th style={{ textAlign: 'right', color: 'var(--cyan)' }}>Θ</th>
                    <th style={{ textAlign: 'right', color: 'var(--cyan)' }}>Vega</th>
                  </>}
                  <th style={{ textAlign: 'right' }}>IV%</th>
                  <th style={{ textAlign: 'right' }}>LTP</th>
                  {showOIChange && <th style={{ textAlign: 'right' }}>OI CHG</th>}
                  <th style={{ textAlign: 'right' }}>OI</th>
                  <th style={{ width: 60 }}></th>
                  {/* Strike */}
                  <th style={{ textAlign: 'center', color: 'var(--amber)', borderLeft: '2px solid var(--border-bright)', borderRight: '2px solid var(--border-bright)' }}>STRIKE</th>
                  {/* Put columns */}
                  <th style={{ width: 60 }}></th>
                  <th style={{ textAlign: 'left' }}>OI</th>
                  {showOIChange && <th style={{ textAlign: 'left' }}>OI CHG</th>}
                  <th style={{ textAlign: 'left' }}>LTP</th>
                  <th style={{ textAlign: 'left' }}>IV%</th>
                  {showGreeks && <>
                    <th style={{ textAlign: 'left', color: 'var(--cyan)' }}>Vega</th>
                    <th style={{ textAlign: 'left', color: 'var(--cyan)' }}>Θ</th>
                    <th style={{ textAlign: 'left', color: 'var(--cyan)' }}>Γ</th>
                    <th style={{ textAlign: 'left', color: 'var(--cyan)' }}>Δ</th>
                  </>}
                </tr>
              </thead>
              <tbody>
                {!data && (
                  <tr><td colSpan={20} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                    Loading options chain…
                  </td></tr>
                )}
                {filteredStrikes.map((s: any, i: number) => {
                  const isATM = s.strike === atmStrike;
                  const isMaxPain = maxPain && Math.abs(s.strike - maxPain) < 1;
                  const isITM_Call = s.strike < underlying;
                  const isITM_Put  = s.strike > underlying;
                  const rowBg = isATM
                    ? 'rgba(255,149,0,0.08)'
                    : isMaxPain ? 'rgba(255,214,0,0.05)' : 'transparent';

                  return (
                    <tr key={i} style={{ background: rowBg, borderBottom: '1px solid var(--border)' }}>
                      {/* CALL Greeks */}
                      {showGreeks && <>
                        <td style={{ textAlign: 'right', color: 'var(--cyan)', fontSize: 10 }}>{fmt(s.call_delta, 3)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--cyan)', fontSize: 9 }}>{fmt(s.call_gamma, 4)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--red)', fontSize: 9 }}>{fmt(s.call_theta, 2)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--blue-bright)', fontSize: 9 }}>{fmt(s.call_vega, 2)}</td>
                      </>}
                      {/* Call IV */}
                      <td style={{ textAlign: 'right', color: 'var(--cyan)', fontSize: 10 }}>{fmtIV(s.call_iv)}</td>
                      {/* Call LTP */}
                      <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 11, color: isITM_Call ? 'var(--green-bright)' : 'var(--text-primary)' }}>
                        {fmt(s.call_ltp)}
                      </td>
                      {/* Call OI change */}
                      {showOIChange && <td style={{ textAlign: 'right', color: oiColor(s.call_oi_change), fontSize: 10 }}>
                        {s.call_oi_change ? (s.call_oi_change > 0 ? '+' : '') + fmtOI(s.call_oi_change) : '—'}
                      </td>}
                      {/* Call OI + bar */}
                      <td style={{ textAlign: 'right', fontSize: 10 }}>{fmtOI(s.call_oi)}</td>
                      <td style={{ width: 60, padding: '2px 4px' }}>
                        <OIBar value={s.call_oi || 0} max={maxCallOI} side="call" />
                      </td>
                      {/* STRIKE */}
                      <td style={{
                        textAlign: 'center', fontWeight: 700, fontSize: 12,
                        color: isATM ? 'var(--amber)' : isMaxPain ? '#ffd600' : 'var(--text-primary)',
                        borderLeft: '2px solid var(--border-bright)', borderRight: '2px solid var(--border-bright)',
                        padding: '2px 6px',
                      }}>
                        {isATM && <span style={{ fontSize: 8, color: 'var(--amber)', marginRight: 2 }}>ATM</span>}
                        {isMaxPain && <span style={{ fontSize: 8, color: '#ffd600', marginRight: 2 }}>MP</span>}
                        {s.strike?.toLocaleString('en-IN')}
                      </td>
                      {/* Put OI bar */}
                      <td style={{ width: 60, padding: '2px 4px' }}>
                        <OIBar value={s.put_oi || 0} max={maxPutOI} side="put" />
                      </td>
                      {/* Put OI */}
                      <td style={{ textAlign: 'left', fontSize: 10 }}>{fmtOI(s.put_oi)}</td>
                      {/* Put OI change */}
                      {showOIChange && <td style={{ textAlign: 'left', color: oiColor(s.put_oi_change), fontSize: 10 }}>
                        {s.put_oi_change ? (s.put_oi_change > 0 ? '+' : '') + fmtOI(s.put_oi_change) : '—'}
                      </td>}
                      {/* Put LTP */}
                      <td style={{ textAlign: 'left', fontWeight: 700, fontSize: 11, color: isITM_Put ? 'var(--red-bright)' : 'var(--text-primary)' }}>
                        {fmt(s.put_ltp)}
                      </td>
                      {/* Put IV */}
                      <td style={{ textAlign: 'left', color: 'var(--cyan)', fontSize: 10 }}>{fmtIV(s.put_iv)}</td>
                      {/* Put Greeks */}
                      {showGreeks && <>
                        <td style={{ textAlign: 'left', color: 'var(--blue-bright)', fontSize: 9 }}>{fmt(s.put_vega, 2)}</td>
                        <td style={{ textAlign: 'left', color: 'var(--red)', fontSize: 9 }}>{fmt(s.put_theta, 2)}</td>
                        <td style={{ textAlign: 'left', color: 'var(--cyan)', fontSize: 9 }}>{fmt(s.put_gamma, 4)}</td>
                        <td style={{ textAlign: 'left', color: 'var(--cyan)', fontSize: 10 }}>{fmt(s.put_delta, 3)}</td>
                      </>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── OI CHART VIEW ── */}
        {view === 'oi_chart' && (
          <div style={{ padding: 8 }}>
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: 4, marginBottom: 8 }}>
              <OIChart strikes={filteredStrikes} atm={atmStrike} maxPain={maxPain} />
            </div>
            <div style={{ display: 'flex', gap: 8, fontSize: 10 }}>
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: 8, flex: 1 }}>
                <div style={{ color: 'var(--text-muted)', fontSize: 9, marginBottom: 4 }}>TOP CALL OI (RESISTANCE)</div>
                {[...filteredStrikes].sort((a: any, b: any) => (b.call_oi || 0) - (a.call_oi || 0)).slice(0, 5).map((s: any, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--green)', marginBottom: 2 }}>
                    <span>{s.strike?.toLocaleString()}</span>
                    <span>{fmtOI(s.call_oi)}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: 8, flex: 1 }}>
                <div style={{ color: 'var(--text-muted)', fontSize: 9, marginBottom: 4 }}>TOP PUT OI (SUPPORT)</div>
                {[...filteredStrikes].sort((a: any, b: any) => (b.put_oi || 0) - (a.put_oi || 0)).slice(0, 5).map((s: any, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--red)', marginBottom: 2 }}>
                    <span>{s.strike?.toLocaleString()}</span>
                    <span>{fmtOI(s.put_oi)}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: 8, flex: 1 }}>
                <div style={{ color: 'var(--text-muted)', fontSize: 9, marginBottom: 4 }}>ANALYTICS</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>PCR</span>
                  <span style={{ color: pcrColor, fontWeight: 700 }}>{pcr.toFixed(3)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Max Pain</span>
                  <span style={{ color: '#ffd600', fontWeight: 700 }}>{maxPain ? fmt(maxPain, 0) : '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>ATM IV</span>
                  <span style={{ color: 'var(--cyan)' }}>{fmtIV(atmIV)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Signal</span>
                  <span style={{ color: pcr > 1.2 ? 'var(--green)' : pcr < 0.8 ? 'var(--red)' : 'var(--amber)', fontWeight: 700 }}>
                    {pcr > 1.2 ? 'BULLISH' : pcr < 0.8 ? 'BEARISH' : 'NEUTRAL'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── IV SKEW VIEW ── */}
        {view === 'iv_skew' && (
          <div style={{ padding: 8 }}>
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: 4, marginBottom: 8 }}>
              <IVSkewChart strikes={filteredStrikes} atm={atmStrike} />
            </div>
            <table style={{ width: '100%', fontSize: 10 }}>
              <thead>
                <tr>
                  <th>STRIKE</th><th style={{ textAlign: 'right', color: 'var(--green)' }}>CE IV</th>
                  <th style={{ textAlign: 'right', color: 'var(--red)' }}>PE IV</th>
                  <th style={{ textAlign: 'right' }}>SKEW (PE-CE)</th>
                  <th style={{ textAlign: 'right' }}>CE Δ</th>
                  <th style={{ textAlign: 'right' }}>PE Δ</th>
                  <th style={{ textAlign: 'right' }}>CE VEGA</th>
                  <th style={{ textAlign: 'right' }}>PE VEGA</th>
                </tr>
              </thead>
              <tbody>
                {filteredStrikes.filter((s: any) => s.call_iv || s.put_iv).map((s: any, i) => {
                  const skew = (s.put_iv || 0) - (s.call_iv || 0);
                  const isATM = s.strike === atmStrike;
                  return (
                    <tr key={i} style={{ background: isATM ? 'rgba(255,149,0,0.06)' : 'transparent' }}>
                      <td style={{ color: isATM ? 'var(--amber)' : 'var(--text-primary)', fontWeight: isATM ? 700 : 400 }}>
                        {isATM && '★ '}{s.strike?.toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--green)' }}>{fmtIV(s.call_iv)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--red)' }}>{fmtIV(s.put_iv)}</td>
                      <td style={{ textAlign: 'right', color: skew > 0 ? 'var(--red)' : 'var(--green)' }}>
                        {skew !== 0 ? `${skew > 0 ? '+' : ''}${skew.toFixed(1)}%` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--cyan)' }}>{fmt(s.call_delta, 3)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--cyan)' }}>{fmt(s.put_delta, 3)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--blue-bright)' }}>{fmt(s.call_vega, 2)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--blue-bright)' }}>{fmt(s.put_vega, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── STRATEGY VIEW ── */}
        {view === 'strategy' && (
          <div style={{ padding: 8 }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
              {STRATEGIES.map(st => (
                <button key={st.name} onClick={() => setSelectedStrategy(st.name)}
                  className={`btn ${selectedStrategy === st.name ? 'btn-amber' : ''}`}
                  style={{ fontSize: 10, padding: '2px 8px' }}>
                  {st.name}
                </button>
              ))}
            </div>
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: 12, marginBottom: 8 }}>
              <div style={{ color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>{selectedStrategy}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 10 }}>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 9 }}>UNDERLYING</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--amber)' }}>{fmt(underlying)}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 9 }}>ATM STRIKE</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{atmStrike?.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 9 }}>ATM IV</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--cyan)' }}>{fmtIV(atmIV)}</div>
                </div>
              </div>
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 10, border: '1px solid var(--border)', padding: 8, background: 'var(--bg-secondary)' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 9, marginBottom: 6 }}>STRATEGY LEGS</div>
              {(STRATEGIES.find(s => s.name === selectedStrategy)?.legs || []).map((leg, i) => {
                const step = strikes.length > 1 ? strikes[1].strike - strikes[0].strike : 100;
                const targetStrike = atmStrike + ((leg as any).offset || 0) * step;
                const nearStrike = strikes.reduce((best: any, curr: any) =>
                  Math.abs(curr.strike - targetStrike) < Math.abs(best.strike - targetStrike) ? curr : best, strikes[0] || {});
                const ltp = leg.type === 'CE' ? nearStrike?.call_ltp : nearStrike?.put_ltp;
                return (
                  <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 4, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: leg.action === 'BUY' ? 'var(--green)' : 'var(--red)', fontWeight: 700, width: 40 }}>{leg.action}</span>
                    <span style={{ color: leg.type === 'CE' ? 'var(--green)' : 'var(--red)', width: 30 }}>{leg.type}</span>
                    <span style={{ color: 'var(--text-primary)', width: 60 }}>{nearStrike?.strike?.toLocaleString() || '—'}</span>
                    <span style={{ color: 'var(--amber)', width: 60 }}>₹{fmt(ltp)}</span>
                    <span style={{ color: 'var(--cyan)' }}>IV: {leg.type === 'CE' ? fmtIV(nearStrike?.call_iv) : fmtIV(nearStrike?.put_iv)}</span>
                  </div>
                );
              })}
              <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 9 }}>
                ℹ Position sizing and P&L calculations require live data. Max loss/profit shown here requires position simulation.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
