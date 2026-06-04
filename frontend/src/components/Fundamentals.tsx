import React, { useState } from 'react';
import { Fundamentals as FundamentalsType } from '../types';
import { useApiData } from '../hooks/useApi';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

interface Props { symbol: string; }

function fmt(v?: number, decimals = 2): string {
  if (v === undefined || v === null) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtCr(v?: number): string {
  if (v === undefined || v === null) return '—';
  if (Math.abs(v) >= 1e12) return `₹${(v / 1e12).toFixed(1)}T`;
  if (Math.abs(v) >= 1e9) return `₹${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  return `₹${v.toFixed(0)}`;
}

function pctColor(v?: number): string {
  if (v === undefined || v === null) return 'var(--text-primary)';
  return v >= 0 ? 'var(--green)' : 'var(--red)';
}

const CHART_THEME = {
  tooltip: { background: '#141414', border: '1px solid #333', color: '#e8e8e0', fontSize: 11 },
};

type Tab = 'overview' | 'financials' | 'balance' | 'cashflow' | 'holding' | 'peers';

export const Fundamentals: React.FC<Props> = ({ symbol }) => {
  const [tab, setTab] = useState<Tab>('overview');
  const { data: f, loading } = useApiData<FundamentalsType>(`/api/fundamentals/${symbol}`, 300000);

  if (loading) return (
    <div className="panel h-full flex items-center justify-center">
      <div className="spinner" />
    </div>
  );

  if (!f) return <div className="panel h-full p-3 text-muted">No fundamental data</div>;

  const tabs: Tab[] = ['overview', 'financials', 'balance', 'cashflow', 'holding', 'peers'];

  return (
    <div className="panel" style={{ height: '100%' }}>
      <div className="panel-header">
        <div>
          <span className="panel-title">{symbol}</span>
          {f.name && <span style={{ color: 'var(--text-secondary)', marginLeft: 8, fontSize: 11 }}>{f.name}</span>}
          {f.sector && <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 10 }}>{f.sector}</span>}
        </div>
      </div>

      <div className="flex border-b" style={{ background: 'var(--bg-secondary)', padding: '2px 4px', gap: 1 }}>
        {tabs.map(t => (
          <button key={t} className={`nav-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="panel-body" style={{ padding: 8 }}>
        {tab === 'overview' && <OverviewTab f={f} />}
        {tab === 'financials' && <FinancialsTab f={f} />}
        {tab === 'balance' && <BalanceTab f={f} />}
        {tab === 'cashflow' && <CashflowTab f={f} />}
        {tab === 'holding' && <HoldingTab f={f} />}
        {tab === 'peers' && <PeersTab f={f} />}
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: React.ReactNode; color?: string }> = ({ label, value, color }) => (
  <div className="flex justify-between border-b" style={{ padding: '4px 0' }}>
    <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{label}</span>
    <span style={{ color: color || 'var(--text-primary)', fontWeight: 600, fontSize: 11 }}>{value}</span>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ marginBottom: 12 }}>
    <div style={{ color: 'var(--amber)', fontSize: 10, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase' }}>{title}</div>
    {children}
  </div>
);

const OverviewTab: React.FC<{ f: FundamentalsType }> = ({ f }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
    <Section title="Valuation">
      <Row label="Market Cap" value={fmtCr(f.market_cap)} />
      <Row label="Enterprise Value" value={fmtCr(f.enterprise_value)} />
      <Row label="P/E Ratio" value={fmt(f.pe_ratio)} />
      <Row label="P/B Ratio" value={fmt(f.pb_ratio)} />
      <Row label="EV/EBITDA" value={fmt(f.ev_ebitda)} />
      <Row label="Div Yield" value={f.div_yield ? `${fmt(f.div_yield * 100, 1)}%` : '—'} />
      <Row label="52W High" value={fmt(f.week_52_high)} color="var(--green)" />
      <Row label="52W Low" value={fmt(f.week_52_low)} color="var(--red)" />
    </Section>

    <Section title="Profitability">
      <Row label="Revenue (TTM)" value={fmtCr(f.revenue)} />
      <Row label="Revenue Growth" value={f.revenue_growth ? `${fmt(f.revenue_growth * 100, 1)}%` : '—'} color={pctColor(f.revenue_growth)} />
      <Row label="EBITDA" value={fmtCr(f.ebitda)} />
      <Row label="EBITDA Margin" value={f.ebitda_margin ? `${fmt(f.ebitda_margin * 100, 1)}%` : '—'} />
      <Row label="PAT" value={fmtCr(f.pat)} />
      <Row label="PAT Margin" value={f.pat_margin ? `${fmt(f.pat_margin * 100, 1)}%` : '—'} />
      <Row label="EPS" value={fmt(f.eps)} />
      <Row label="Book Value" value={fmt(f.book_value)} />
    </Section>

    <Section title="Returns & Quality">
      <Row label="ROE" value={f.roe ? `${fmt(f.roe * 100, 1)}%` : '—'} color={pctColor(f.roe)} />
      <Row label="ROCE" value={f.roce ? `${fmt(f.roce, 1)}%` : '—'} color={pctColor(f.roce)} />
      <Row label="ROA" value={f.roa ? `${fmt(f.roa * 100, 1)}%` : '—'} />
      <Row label="Free Cash Flow" value={fmtCr(f.free_cf)} />
      <Row label="Operating CF" value={fmtCr(f.operating_cf)} />
    </Section>

    <Section title="Leverage">
      <Row label="Debt/Equity" value={fmt(f.debt_equity)} color={(f.debt_equity || 0) > 1.5 ? 'var(--red)' : 'var(--text-primary)'} />
      <Row label="Current Ratio" value={fmt(f.current_ratio)} color={(f.current_ratio || 0) < 1 ? 'var(--red)' : 'var(--green)'} />
      <Row label="Total Assets" value={fmtCr(f.total_assets)} />
      <Row label="Net Worth" value={fmtCr(f.net_worth)} />
    </Section>

    {f.description && (
      <div style={{ gridColumn: '1 / -1' }}>
        <Section title="Business">
          <p style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {f.description.slice(0, 500)}{f.description.length > 500 ? '…' : ''}
          </p>
        </Section>
      </div>
    )}
  </div>
);

const FinancialsTab: React.FC<{ f: FundamentalsType }> = ({ f }) => {
  const qr = f.quarterly_results || [];
  const chartData = qr.slice(0, 8).reverse().map(q => ({
    period: q.period || '',
    revenue: (q.revenue || 0),
    pat: (q.pat || 0),
    opm: q.opm_pct || 0,
  }));

  return (
    <div>
      {chartData.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: 'var(--amber)', fontSize: 10, fontWeight: 700, marginBottom: 8 }}>QUARTERLY REVENUE & PAT (₹Cr)</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
              <Tooltip contentStyle={CHART_THEME.tooltip} />
              <Bar dataKey="revenue" fill="rgba(41,121,255,0.7)" name="Revenue" />
              <Bar dataKey="pat" fill="rgba(0,200,83,0.7)" name="PAT" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {qr.length > 0 && (
        <div>
          <div style={{ color: 'var(--amber)', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>QUARTERLY RESULTS</div>
          <table>
            <thead>
              <tr>
                <th>Quarter</th>
                <th style={{ textAlign: 'right' }}>Revenue</th>
                <th style={{ textAlign: 'right' }}>Op Profit</th>
                <th style={{ textAlign: 'right' }}>OPM%</th>
                <th style={{ textAlign: 'right' }}>PAT</th>
                <th style={{ textAlign: 'right' }}>EPS</th>
              </tr>
            </thead>
            <tbody>
              {qr.slice(0, 8).map((q, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--text-secondary)' }}>{q.period}</td>
                  <td style={{ textAlign: 'right' }}>{q.revenue ? fmtCr(q.revenue) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{q.operating_profit ? fmtCr(q.operating_profit) : '—'}</td>
                  <td style={{ textAlign: 'right', color: (q.opm_pct || 0) >= 15 ? 'var(--green)' : 'var(--text-primary)' }}>
                    {q.opm_pct ? `${q.opm_pct.toFixed(1)}%` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', color: (q.pat || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {q.pat ? fmtCr(q.pat) : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>{q.eps ? fmt(q.eps) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const BalanceTab: React.FC<{ f: FundamentalsType }> = ({ f }) => {
  const bs = f.annual_balance_sheet || [];
  return (
    <div>
      {bs.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Year</th>
              <th style={{ textAlign: 'right' }}>Total Assets</th>
              <th style={{ textAlign: 'right' }}>Total Liab</th>
              <th style={{ textAlign: 'right' }}>Borrowings</th>
              <th style={{ textAlign: 'right' }}>Net Worth</th>
            </tr>
          </thead>
          <tbody>
            {bs.map((row, i) => (
              <tr key={i}>
                <td style={{ color: 'var(--text-secondary)' }}>{row.period}</td>
                <td style={{ textAlign: 'right' }}>{fmtCr(row.total_assets)}</td>
                <td style={{ textAlign: 'right' }}>{fmtCr(row.total_liabilities)}</td>
                <td style={{ textAlign: 'right', color: (row.borrowings || 0) > 0 ? 'var(--red)' : 'var(--green)' }}>
                  {fmtCr(row.borrowings)}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--green)' }}>{fmtCr(row.net_worth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-muted p-3">Balance sheet data not available</div>
      )}
    </div>
  );
};

const CashflowTab: React.FC<{ f: FundamentalsType }> = ({ f }) => {
  const cf = f.cashflow || [];
  return (
    <div>
      {cf.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Year</th>
              <th style={{ textAlign: 'right' }}>Operating</th>
              <th style={{ textAlign: 'right' }}>Investing</th>
              <th style={{ textAlign: 'right' }}>Financing</th>
            </tr>
          </thead>
          <tbody>
            {cf.map((row, i) => (
              <tr key={i}>
                <td style={{ color: 'var(--text-secondary)' }}>{row.period}</td>
                <td style={{ textAlign: 'right', color: (row.operating_cf || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {fmtCr(row.operating_cf)}
                </td>
                <td style={{ textAlign: 'right', color: (row.investing_cf || 0) >= 0 ? 'var(--green)' : 'var(--amber)' }}>
                  {fmtCr(row.investing_cf)}
                </td>
                <td style={{ textAlign: 'right', color: (row.financing_cf || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {fmtCr(row.financing_cf)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-muted p-3">Cashflow data not available</div>
      )}
    </div>
  );
};

const HoldingTab: React.FC<{ f: FundamentalsType }> = ({ f }) => {
  const holdings = [
    { label: 'Promoter', value: f.promoter_holding, color: 'var(--amber)' },
    { label: 'FII', value: f.fii_holding, color: 'var(--blue-bright)' },
    { label: 'DII', value: f.dii_holding, color: 'var(--cyan)' },
    { label: 'Public', value: f.promoter_holding && f.fii_holding && f.dii_holding
        ? 100 - (f.promoter_holding + f.fii_holding + f.dii_holding)
        : undefined, color: 'var(--text-secondary)' },
  ];

  return (
    <div>
      <Section title="Shareholding Pattern">
        {holdings.map(h => (
          <div key={h.label} style={{ marginBottom: 8 }}>
            <div className="flex justify-between" style={{ marginBottom: 3 }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{h.label}</span>
              <span style={{ color: h.color, fontWeight: 700 }}>
                {h.value !== undefined ? `${h.value.toFixed(2)}%` : '—'}
              </span>
            </div>
            <div style={{ background: 'var(--bg-secondary)', height: 4, borderRadius: 2 }}>
              <div style={{
                width: `${Math.min(h.value || 0, 100)}%`,
                height: '100%',
                background: h.color,
                borderRadius: 2,
              }} />
            </div>
          </div>
        ))}
        {f.promoter_pledge_pct !== undefined && (
          <Row label="Promoter Pledge %" value={`${fmt(f.promoter_pledge_pct)}%`}
            color={(f.promoter_pledge_pct || 0) > 20 ? 'var(--red)' : 'var(--green)'} />
        )}
      </Section>
    </div>
  );
};

const PeersTab: React.FC<{ f: FundamentalsType }> = ({ f }) => {
  const peers = f.peers || [];
  return (
    <div>
      {peers.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th style={{ textAlign: 'right' }}>CMP</th>
              <th style={{ textAlign: 'right' }}>P/E</th>
              <th style={{ textAlign: 'right' }}>Market Cap</th>
            </tr>
          </thead>
          <tbody>
            {peers.map((p, i) => (
              <tr key={i}>
                <td style={{ color: 'var(--amber)' }}>{p.name}</td>
                <td style={{ textAlign: 'right' }}>{fmt(p.cmp)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(p.pe)}</td>
                <td style={{ textAlign: 'right' }}>{p.market_cap ? fmtCr(p.market_cap * 1e7) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-muted p-3">Peer data not available</div>
      )}
    </div>
  );
};
