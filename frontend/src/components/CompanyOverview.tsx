/**
 * Bloomberg DES — Company Overview Panel
 * Tabs: Profile | Management | Ownership | Corp Actions | Analysis
 */

import React, { useState } from 'react';
import { useApiData } from '../hooks/useApi';

interface Props { symbol: string; onNavigate?: (view: string) => void; }

function fmt(v?: number | null, d = 2): string {
  if (v == null) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtCr(v?: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `₹${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `₹${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  return `₹${v.toFixed(0)}`;
}

function fmtPct(v?: number | null): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(2)}%`;
}

function pctColor(v?: number | null): string {
  if (v == null) return 'var(--text-primary)';
  return (v >= 0) ? 'var(--green)' : 'var(--red)';
}

const Row: React.FC<{ label: string; value: React.ReactNode; color?: string; bold?: boolean }> = ({ label, value, color, bold }) => (
  <div style={{
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '4px 0', borderBottom: '1px solid #1a1a1a',
  }}>
    <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{label}</span>
    <span style={{ color: color || 'var(--text-primary)', fontSize: 11, fontWeight: bold ? 700 : 500 }}>{value}</span>
  </div>
);

const Badge: React.FC<{ label: string; color?: string }> = ({ label, color = '#ff9500' }) => (
  <span style={{
    display: 'inline-block', padding: '1px 6px', fontSize: 9, fontWeight: 700,
    border: `1px solid ${color}33`, color, background: `${color}11`,
    borderRadius: 2, marginRight: 4, marginBottom: 3,
  }}>
    {label}
  </span>
);

type Tab = 'profile' | 'management' | 'valuation' | 'analysis';

export const CompanyOverview: React.FC<Props> = ({ symbol, onNavigate }) => {
  const [tab, setTab] = useState<Tab>('profile');
  const { data, loading, error } = useApiData<any>(`/api/company-overview/${symbol}`, 300000);
  const { data: peers } = useApiData<any>(`/api/peers/${symbol}`, 3600000);

  if (loading) return (
    <div className="panel h-full" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spinner" />
      <span style={{ marginLeft: 10, color: 'var(--text-muted)', fontSize: 11 }}>Loading company data…</span>
    </div>
  );

  if (error || !data) return (
    <div className="panel h-full" style={{ padding: 16, color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 12 }}>DES: {symbol}</div>
      <div style={{ fontSize: 10, marginTop: 8 }}>Company data unavailable. Market may be closed or symbol incorrect.</div>
    </div>
  );

  const tabs: Tab[] = ['profile', 'management', 'valuation', 'analysis'];

  const rec = data.recommendation?.toUpperCase();
  const recColor = rec === 'BUY' ? 'var(--green)' : rec === 'SELL' || rec === 'UNDERPERFORM' ? 'var(--red)' : 'var(--amber)';

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="panel-header" style={{ flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="panel-title">{symbol}</span>
            <span style={{ color: '#e8e8e0', fontSize: 13, fontWeight: 600 }}>{data.name}</span>
            {data.exchange && <Badge label={data.exchange} />}
            {data.sector && <Badge label={data.sector} color="#4fc3f7" />}
          </div>
          {data.industry && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{data.industry}</div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {rec && (
            <div style={{ color: recColor, fontSize: 11, fontWeight: 700 }}>{rec}</div>
          )}
          {data.target_price && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>TP: ₹{fmt(data.target_price)}</div>
          )}
          {data.analyst_count && (
            <div style={{ fontSize: 9, color: '#555' }}>{data.analyst_count} analysts</div>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 1, background: 'var(--bg-secondary)',
        padding: '2px 4px', borderBottom: '1px solid #222', flexShrink: 0,
      }}>
        {tabs.map(t => (
          <button key={t} className={`nav-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
        {onNavigate && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            {['FA', 'RV', 'DCF', 'OWN'].map(cmd => (
              <button key={cmd} className="nav-tab" onClick={() => onNavigate(
                cmd === 'FA' ? 'fundamentals' : cmd === 'RV' ? 'peers' : cmd === 'DCF' ? 'dcf' : 'shareholding'
              )} style={{ fontSize: 9 }}>
                {cmd}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="panel-body" style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {tab === 'profile' && <ProfileTab data={data} />}
        {tab === 'management' && <ManagementTab data={data} />}
        {tab === 'valuation' && <ValuationTab data={data} peers={peers} />}
        {tab === 'analysis' && <AnalysisTab data={data} />}
      </div>
    </div>
  );
};

// ─── Profile Tab ─────────────────────────────────────────────────────────────
const ProfileTab: React.FC<{ data: any }> = ({ data }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
    <div>
      <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>COMPANY PROFILE</div>
      <Row label="Country" value={data.country} />
      <Row label="City" value={[data.city, data.state].filter(Boolean).join(', ')} />
      <Row label="Address" value={data.address} />
      <Row label="Website" value={
        data.website ? (
          <a href={data.website} target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--amber)', fontSize: 10 }}>
            {data.website.replace('https://', '').replace('http://', '')}
          </a>
        ) : '—'
      } />
      <Row label="Phone" value={data.phone} />
      <Row label="Employees" value={data.employees ? data.employees.toLocaleString('en-IN') : '—'} />
      <Row label="Currency" value={data.currency} />
      {data.isin && <Row label="ISIN" value={data.isin} />}

      <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginTop: 16, marginBottom: 8 }}>KEY METRICS</div>
      <Row label="Market Cap" value={fmtCr(data.market_cap)} bold />
      <Row label="Enterprise Value" value={fmtCr(data.enterprise_value)} />
      <Row label="52W High" value={`₹${fmt(data['52w_high'])}`} color="var(--green)" />
      <Row label="52W Low" value={`₹${fmt(data['52w_low'])}`} color="var(--red)" />
      <Row label="Beta" value={data.beta ? fmt(data.beta, 3) : '—'} />
      <Row label="Float Shares" value={data.float_shares ? (data.float_shares / 1e7).toFixed(2) + ' Cr' : '—'} />
      <Row label="Avg Volume (10D)" value={data.avg_volume_10d ? (data.avg_volume_10d / 1e5).toFixed(2) + ' L' : '—'} />
    </div>

    <div>
      <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>BUSINESS DESCRIPTION</div>
      <div style={{
        fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6,
        maxHeight: 300, overflowY: 'auto',
        borderLeft: '2px solid var(--amber)', paddingLeft: 8,
      }}>
        {data.description || 'Business description not available.'}
      </div>

      <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginTop: 16, marginBottom: 8 }}>FINANCIALS SNAPSHOT</div>
      <Row label="Revenue" value={fmtCr(data.revenue)} />
      <Row label="Gross Profit" value={fmtCr(data.gross_profit)} />
      <Row label="EBITDA" value={fmtCr(data.ebitda)} />
      <Row label="Net Income" value={fmtCr(data.net_income)} color={data.net_income > 0 ? 'var(--green)' : 'var(--red)'} />
      <Row label="Free Cash Flow" value={fmtCr(data.free_cashflow)} />
      <Row label="Total Cash" value={fmtCr(data.total_cash)} />
      <Row label="Total Debt" value={fmtCr(data.total_debt)} />
      <Row label="Revenue Growth" value={fmtPct(data.revenue_growth)} color={pctColor(data.revenue_growth)} />
      <Row label="Earnings Growth" value={fmtPct(data.earnings_growth)} color={pctColor(data.earnings_growth)} />
    </div>
  </div>
);

// ─── Management Tab ───────────────────────────────────────────────────────────
const ManagementTab: React.FC<{ data: any }> = ({ data }) => {
  const mgmt: any[] = data.management || [];
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 10 }}>
        BOARD OF DIRECTORS & KEY MANAGEMENT
      </div>
      {mgmt.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          Management data not available from yfinance. Visit NSE website for full details.
        </div>
      )}
      <div style={{ display: 'grid', gap: 6 }}>
        {mgmt.map((m: any, i: number) => (
          <div key={i} style={{
            background: 'var(--bg-secondary)', border: '1px solid #222',
            padding: '8px 12px', borderRadius: 2,
            display: 'grid', gridTemplateColumns: '1fr auto', gap: 8,
          }}>
            <div>
              <div style={{ color: '#e8e8e0', fontSize: 11, fontWeight: 600 }}>{m.name}</div>
              <div style={{ color: 'var(--amber)', fontSize: 10, marginTop: 2 }}>{m.title}</div>
              {m.age && <div style={{ color: '#555', fontSize: 9, marginTop: 1 }}>Age: {m.age}</div>}
            </div>
            {m.total_pay && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: '#555' }}>Total Pay</div>
                <div style={{ fontSize: 11, color: 'var(--green)' }}>{fmtCr(m.total_pay)}</div>
              </div>
            )}
          </div>
        ))}
      </div>
      {mgmt.length > 0 && (
        <div style={{ fontSize: 9, color: '#555', marginTop: 10 }}>
          Source: Yahoo Finance · For complete board details, refer NSE Annual Report filings
        </div>
      )}
    </div>
  );
};

// ─── Valuation Tab ────────────────────────────────────────────────────────────
const ValuationTab: React.FC<{ data: any; peers: any }> = ({ data, peers }) => {
  const medians = peers?.sector_medians || {};

  const valRows = [
    { label: 'P/E (TTM)', value: fmt(data.pe_ratio), key: 'pe_ratio', lower_better: true },
    { label: 'P/E (Fwd)', value: fmt(data.forward_pe), key: 'pe_ratio', lower_better: true },
    { label: 'P/B', value: fmt(data.pb_ratio), key: 'pb_ratio', lower_better: true },
    { label: 'P/S', value: fmt(data.ps_ratio), key: 'ps_ratio', lower_better: true },
    { label: 'EV/EBITDA', value: fmt(data.ev_ebitda), key: 'ev_ebitda', lower_better: true },
    { label: 'Div Yield', value: fmtPct(data.dividend_yield), key: 'dividend_yield', lower_better: false },
    { label: 'Payout Ratio', value: fmtPct(data.payout_ratio), key: null, lower_better: null },
    { label: 'ROE', value: fmtPct(data.roe), key: 'roe', lower_better: false },
    { label: 'ROA', value: fmtPct(data.roa), key: 'roa', lower_better: false },
    { label: 'Gross Margin', value: fmtPct(data.gross_margins), key: 'profit_margins', lower_better: false },
    { label: 'Op Margin', value: fmtPct(data.operating_margins), key: null, lower_better: null },
    { label: 'Net Margin', value: fmtPct(data.profit_margins), key: 'profit_margins', lower_better: false },
    { label: 'D/E Ratio', value: fmt(data.debt_to_equity), key: 'debt_to_equity', lower_better: true },
    { label: 'Current Ratio', value: fmt(data.current_ratio), key: null, lower_better: null },
    { label: 'Quick Ratio', value: fmt(data.quick_ratio), key: null, lower_better: null },
    { label: 'Beta', value: fmt(data.beta, 3), key: null, lower_better: null },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div>
        <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>VALUATION MULTIPLES</div>
        {valRows.slice(0, 8).map((r, i) => {
          const sectorVal = r.key ? medians[r.key] : null;
          let vsColor: string | undefined;
          if (sectorVal && r.lower_better !== null) {
            const numVal = data[r.key];
            if (numVal != null) {
              vsColor = r.lower_better
                ? (numVal < sectorVal ? 'var(--green)' : 'var(--red)')
                : (numVal > sectorVal ? 'var(--green)' : 'var(--red)');
            }
          }
          return (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '4px 0', borderBottom: '1px solid #1a1a1a',
            }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{r.label}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {sectorVal && (
                  <span style={{ color: '#444', fontSize: 9 }}>Sect: {fmt(sectorVal)}</span>
                )}
                <span style={{ color: vsColor || 'var(--text-primary)', fontSize: 11, fontWeight: 600 }}>{r.value}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div>
        <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>MARGINS & RETURNS</div>
        {valRows.slice(8).map((r, i) => (
          <Row key={i} label={r.label} value={r.value} />
        ))}
        {peers?.sector_medians && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10, color: '#4fc3f7', fontWeight: 700, marginBottom: 8 }}>SECTOR MEDIANS</div>
            {Object.entries(peers.sector_medians).map(([k, v]: any) => (
              <Row key={k} label={k.replace(/_/g, ' ').toUpperCase()} value={typeof v === 'number' ? fmt(v) : '—'} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Analysis Tab ─────────────────────────────────────────────────────────────
const AnalysisTab: React.FC<{ data: any }> = ({ data }) => {
  const rec = data.recommendation?.toUpperCase();
  const recColor = rec === 'BUY' ? 'var(--green)' : rec?.includes('SELL') ? 'var(--red)' : 'var(--amber)';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div>
        <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>ANALYST CONSENSUS</div>
        {rec && (
          <div style={{
            textAlign: 'center', padding: 20,
            border: `1px solid ${recColor}33`, background: `${recColor}08`,
            marginBottom: 10,
          }}>
            <div style={{ color: recColor, fontSize: 24, fontWeight: 900, fontFamily: 'monospace' }}>{rec}</div>
            <div style={{ color: '#aaa', fontSize: 11, marginTop: 4 }}>
              {data.analyst_count} analysts
            </div>
            {data.target_price && (
              <div style={{ color: 'var(--amber)', fontSize: 14, fontWeight: 700, marginTop: 8 }}>
                PT: ₹{fmt(data.target_price)}
              </div>
            )}
          </div>
        )}

        <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8, marginTop: 16 }}>SHORT INTEREST</div>
        <Row label="Short Shares" value={data.shares_short ? (data.shares_short / 1e7).toFixed(2) + ' Cr' : '—'} />
        <Row label="Short Ratio" value={data.short_ratio ? fmt(data.short_ratio, 1) + 'x' : '—'} />
      </div>
      <div>
        <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8 }}>GROWTH OUTLOOK</div>
        <Row label="Revenue Growth" value={fmtPct(data.revenue_growth)} color={pctColor(data.revenue_growth)} bold />
        <Row label="Earnings Growth" value={fmtPct(data.earnings_growth)} color={pctColor(data.earnings_growth)} bold />
        <Row label="Profit Margins" value={fmtPct(data.profit_margins)} color={pctColor(data.profit_margins)} />
        <Row label="Gross Margins" value={fmtPct(data.gross_margins)} color={pctColor(data.gross_margins)} />
        <Row label="ROE" value={fmtPct(data.roe)} color={pctColor(data.roe)} />

        <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 8, marginTop: 16 }}>LIQUIDITY</div>
        <Row label="Total Cash" value={fmtCr(data.total_cash)} color="var(--green)" />
        <Row label="Total Debt" value={fmtCr(data.total_debt)} />
        <Row label="Free Cash Flow" value={fmtCr(data.free_cashflow)} color={data.free_cashflow > 0 ? 'var(--green)' : 'var(--red)'} />
        <Row label="Current Ratio" value={fmt(data.current_ratio)} />
        <Row label="D/E Ratio" value={fmt(data.debt_to_equity)} />
      </div>
    </div>
  );
};

export default CompanyOverview;
