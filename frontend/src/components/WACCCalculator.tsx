/**
 * WACCCalculator — Bloomberg WACC / DCF helper panel
 * Interactive WACC model with live data pull for selected ticker
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../hooks/useApi';

interface FundamentalsData {
  beta?: number;
  debt_equity?: number;
  market_cap?: number;
  roe?: number;
  roce?: number;
  pe_ratio?: number;
  tax_rate?: number;
  revenue?: number;
  net_profit?: number;
}

const Slider = ({
  label, value, min, max, step, unit, onChange, color = '#ff9500',
}: {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  onChange: (v: number) => void; color?: string;
}) => (
  <div style={{ marginBottom: 14 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ color: '#888', fontSize: 11 }}>{label}</span>
      <span style={{ color, fontWeight: 700, fontSize: 12 }}>
        {value.toFixed(step < 0.1 ? 2 : 1)}{unit}
      </span>
    </div>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width: '100%', accentColor: color, cursor: 'pointer', height: 4 }}
    />
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#444', marginTop: 2 }}>
      <span>{min}{unit}</span><span>{max}{unit}</span>
    </div>
  </div>
);

function fmt2(v: number) { return v.toFixed(2); }
function fmtPct(v: number) { return `${(v * 100).toFixed(2)}%`; }
function fmtINR(v: number) {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export const WACCCalculator: React.FC<{ symbol?: string }> = ({ symbol = 'RELIANCE' }) => {
  const [sym, setSym]         = useState(symbol.toUpperCase());
  const [inputVal, setInputVal] = useState(symbol.toUpperCase());
  const [loading, setLoading] = useState(false);

  // WACC inputs
  const [riskFreeRate,  setRiskFreeRate]  = useState(7.2);   // India 10Y G-Sec
  const [marketReturn,  setMarketReturn]  = useState(13.0);  // Nifty CAGR
  const [beta,          setBeta]          = useState(1.0);
  const [taxRate,       setTaxRate]       = useState(25.0);  // India corporate tax
  const [debtWeight,    setDebtWeight]    = useState(30.0);  // % debt in capital
  const [costOfDebt,    setCostOfDebt]    = useState(8.5);   // pre-tax cost of debt
  const [termGrowth,    setTermGrowth]    = useState(4.5);   // terminal growth rate
  const [projGrowth,    setProjGrowth]    = useState(12.0);  // revenue CAGR forecast
  const [margin,        setMargin]        = useState(15.0);  // net margin %
  const [revenue,       setRevenue]       = useState(0);     // crore
  const [liveData, setLiveData]           = useState<FundamentalsData>({});

  const loadFundamentals = useCallback(async (s: string) => {
    setLoading(true);
    try {
      const data = await apiFetch<{ basic?: FundamentalsData; financials?: any }>(`/api/fundamentals/${s}`);
      if (data) {
        const basic = data.basic || {};
        if (basic.beta && basic.beta > 0)          setBeta(Number(basic.beta.toFixed(2)));
        if (basic.tax_rate)                         setTaxRate(Number((basic.tax_rate * 100).toFixed(1)));
        if (basic.debt_equity)                      setDebtWeight(Math.min(60, Number(((basic.debt_equity / (1 + basic.debt_equity)) * 100).toFixed(1))));
        if (basic.net_profit && basic.revenue && basic.revenue > 0)
          setMargin(Number(((basic.net_profit / basic.revenue) * 100).toFixed(1)));
        if (basic.revenue)                          setRevenue(Number((basic.revenue / 1e7).toFixed(0)));  // → crores
        setLiveData(basic);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadFundamentals(sym); }, [sym, loadFundamentals]);

  // ── WACC formula ─────────────────────────────────────────────────────────────
  const results = useMemo(() => {
    const ew   = (100 - debtWeight) / 100;           // equity weight
    const dw   = debtWeight / 100;                    // debt weight
    const ke   = (riskFreeRate + beta * (marketReturn - riskFreeRate)) / 100;   // CAPM
    const kd   = (costOfDebt / 100) * (1 - taxRate / 100);                      // after-tax cost of debt
    const wacc = ew * ke + dw * kd;

    // Simple DCF (5 years explicit + terminal)
    const baseRev   = revenue > 0 ? revenue : 1000;  // crore
    let pvFCF = 0;
    let r = baseRev;
    for (let yr = 1; yr <= 5; yr++) {
      r *= (1 + projGrowth / 100);
      const fcf = r * (margin / 100);
      pvFCF += fcf / Math.pow(1 + wacc, yr);
    }
    const termValue = (r * (1 + termGrowth / 100) * (margin / 100)) / Math.max(0.001, wacc - termGrowth / 100);
    const pvTerminal = termValue / Math.pow(1 + wacc, 5);
    const totalValue = pvFCF + pvTerminal;

    return {
      ke: ke * 100,
      kd: kd * 100,
      wacc: wacc * 100,
      equityWeight: ew * 100,
      debtWeight,
      pvFCF,
      pvTerminal,
      totalValue,
      terminalPct: pvTerminal / totalValue * 100,
    };
  }, [riskFreeRate, marketReturn, beta, taxRate, debtWeight, costOfDebt, termGrowth, projGrowth, margin, revenue]);

  const waccColor = results.wacc < 10 ? '#00c853' : results.wacc < 14 ? '#ff9500' : '#ff3d00';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a', color: '#e8e8e0', fontFamily: 'Consolas, monospace', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', borderBottom: '1px solid #1a1a1a', background: '#111', flexShrink: 0 }}>
        <span style={{ color: '#ff9500', fontWeight: 700, fontSize: 12 }}>WACC</span>
        <span style={{ color: '#555', fontSize: 10 }}>Weighted Avg. Cost of Capital · DCF</span>
        <div style={{ flex: 1 }} />
        <input
          value={inputVal}
          onChange={e => setInputVal(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') setSym(inputVal); }}
          placeholder="SYMBOL ↵"
          style={{ background: '#1a1a1a', border: '1px solid #333', color: '#ff9500', padding: '3px 8px', fontSize: 11, fontFamily: 'Consolas, monospace', width: 130, outline: 'none' }}
        />
        {loading && <span style={{ color: '#555', fontSize: 10 }}>Loading…</span>}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, height: '100%' }}>

          {/* Left: Inputs */}
          <div style={{ padding: '12px 16px', borderRight: '1px solid #1a1a1a', overflowY: 'auto' }}>
            <div style={{ color: '#ff9500', fontSize: 10, fontWeight: 700, marginBottom: 12, letterSpacing: 1 }}>CAPM INPUTS</div>
            <Slider label="Risk-Free Rate (10Y G-Sec)" value={riskFreeRate} min={4} max={12} step={0.1} unit="%" onChange={setRiskFreeRate} color="#4fc3f7" />
            <Slider label="Expected Market Return (Nifty CAGR)" value={marketReturn} min={8} max={20} step={0.1} unit="%" onChange={setMarketReturn} color="#4fc3f7" />
            <Slider label="Beta (Systematic Risk)" value={beta} min={0.1} max={3.0} step={0.05} unit="x" onChange={setBeta} color="#ff9500" />

            <div style={{ color: '#ff9500', fontSize: 10, fontWeight: 700, margin: '16px 0 12px', letterSpacing: 1 }}>CAPITAL STRUCTURE</div>
            <Slider label="Debt Weight in Capital" value={debtWeight} min={0} max={80} step={1} unit="%" onChange={setDebtWeight} color="#a78bfa" />
            <Slider label="Pre-Tax Cost of Debt" value={costOfDebt} min={4} max={20} step={0.1} unit="%" onChange={setCostOfDebt} color="#a78bfa" />
            <Slider label="Effective Tax Rate" value={taxRate} min={10} max={35} step={0.5} unit="%" onChange={setTaxRate} color="#a78bfa" />

            <div style={{ color: '#ff9500', fontSize: 10, fontWeight: 700, margin: '16px 0 12px', letterSpacing: 1 }}>DCF PROJECTIONS</div>
            <Slider label="Revenue Base (₹ Crore)" value={revenue || 1000} min={100} max={200000} step={100} unit=" Cr" onChange={setRevenue} color="#00c853" />
            <Slider label="Revenue CAGR (5yr)" value={projGrowth} min={-10} max={40} step={0.5} unit="%" onChange={setProjGrowth} color="#00c853" />
            <Slider label="Net Margin" value={margin} min={-5} max={40} step={0.5} unit="%" onChange={setMargin} color="#00c853" />
            <Slider label="Terminal Growth Rate" value={termGrowth} min={0} max={8} step={0.1} unit="%" onChange={setTermGrowth} color="#00c853" />
          </div>

          {/* Right: Results */}
          <div style={{ padding: '12px 16px', overflowY: 'auto' }}>
            {/* WACC big display */}
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: '#555', marginBottom: 4 }}>WACC ({sym})</div>
              <div style={{ fontSize: 52, fontWeight: 700, color: waccColor, lineHeight: 1 }}>
                {results.wacc.toFixed(2)}<span style={{ fontSize: 22 }}>%</span>
              </div>
              <div style={{ color: '#555', fontSize: 10, marginTop: 4 }}>Hurdle rate for capital allocation</div>
            </div>

            {/* Component breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              {[
                { label: 'Cost of Equity (Ke)', value: `${results.ke.toFixed(2)}%`, color: '#ff9500', sub: `CAPM: Rf + β·(Rm-Rf)` },
                { label: 'Cost of Debt (Kd)', value: `${results.kd.toFixed(2)}%`, color: '#a78bfa', sub: `After-tax: ${fmt2(costOfDebt)}% × (1-${fmt2(taxRate)}%)` },
                { label: 'Equity Weight', value: `${results.equityWeight.toFixed(1)}%`, color: '#ff9500', sub: 'E / (E+D)' },
                { label: 'Debt Weight', value: `${results.debtWeight.toFixed(1)}%`, color: '#a78bfa', sub: 'D / (E+D)' },
              ].map(c => (
                <div key={c.label} style={{ background: '#111', border: '1px solid #1a1a1a', padding: '8px 10px', borderRadius: 3 }}>
                  <div style={{ color: c.color, fontWeight: 700, fontSize: 15 }}>{c.value}</div>
                  <div style={{ color: '#888', fontSize: 10, fontWeight: 700 }}>{c.label}</div>
                  <div style={{ color: '#444', fontSize: 9, marginTop: 2 }}>{c.sub}</div>
                </div>
              ))}
            </div>

            {/* DCF Output */}
            <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: 14 }}>
              <div style={{ color: '#00c853', fontSize: 10, fontWeight: 700, marginBottom: 10, letterSpacing: 1 }}>DCF VALUATION (5Y EXPLICIT)</div>
              {[
                { label: 'PV of FCFs (5Y)', value: fmtINR(results.pvFCF * 1e7) },
                { label: 'PV of Terminal Value', value: fmtINR(results.pvTerminal * 1e7) },
                { label: 'Terminal Value %', value: `${results.terminalPct.toFixed(1)}%` },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #111' }}>
                  <span style={{ color: '#888', fontSize: 11 }}>{row.label}</span>
                  <span style={{ color: '#e8e8e0', fontWeight: 700, fontSize: 11 }}>{row.value}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', marginTop: 4, borderTop: '1px solid #2d2d2d' }}>
                <span style={{ color: '#00c853', fontWeight: 700, fontSize: 12 }}>Enterprise Value</span>
                <span style={{ color: '#00c853', fontWeight: 700, fontSize: 14 }}>{fmtINR(results.totalValue * 1e7)}</span>
              </div>
            </div>

            {/* Live fundamentals */}
            {Object.keys(liveData).length > 0 && (
              <div style={{ marginTop: 14, borderTop: '1px solid #1a1a1a', paddingTop: 14 }}>
                <div style={{ color: '#555', fontSize: 10, fontWeight: 700, marginBottom: 8, letterSpacing: 1 }}>LIVE FUNDAMENTALS — {sym}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {[
                    { label: 'Beta', value: liveData.beta?.toFixed(2) },
                    { label: 'P/E', value: liveData.pe_ratio?.toFixed(1) },
                    { label: 'ROE', value: liveData.roe ? `${liveData.roe.toFixed(1)}%` : null },
                    { label: 'ROCE', value: liveData.roce ? `${liveData.roce.toFixed(1)}%` : null },
                    { label: 'D/E', value: liveData.debt_equity?.toFixed(2) },
                  ].filter(r => r.value).map(r => (
                    <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 6px', background: '#111', borderRadius: 2 }}>
                      <span style={{ color: '#555', fontSize: 10 }}>{r.label}</span>
                      <span style={{ color: '#e8e8e0', fontSize: 10, fontWeight: 700 }}>{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WACCCalculator;
