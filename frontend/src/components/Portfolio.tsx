import React, { useState, useEffect, useCallback } from 'react';
import { useAllQuotes } from '../store/marketStore';

interface Position {
  id: string;
  symbol: string;
  qty: number;
  avgPrice: number;
  buyDate: string;
  note?: string;
}

interface Props {
  onSelectTicker: (sym: string) => void;
}

const STORAGE_KEY = 'bti_portfolio_v1';

function loadPositions(): Position[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function savePositions(p: Position[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

function fmtNum(v: number, dec = 2): string {
  return v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtCr(v: number): string {
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`;
  return `₹${fmtNum(v)}`;
}

export const Portfolio: React.FC<Props> = ({ onSelectTicker }) => {
  const quotes = useAllQuotes();
  const [positions, setPositions] = useState<Position[]>(loadPositions);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ symbol: '', qty: '', avgPrice: '', buyDate: new Date().toISOString().slice(0, 10), note: '' });
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => { savePositions(positions); }, [positions]);

  const enriched = positions.map(p => {
    const q: { price?: number; change_pct?: number; name?: string } = quotes[p.symbol] || {};
    const cmp = q.price || p.avgPrice;
    const invested = p.qty * p.avgPrice;
    const current  = p.qty * cmp;
    const pl       = current - invested;
    const plPct    = invested > 0 ? (pl / invested) * 100 : 0;
    return { ...p, cmp, invested, current, pl, plPct, chg: q.change_pct || 0, name: q.name };
  });

  const totInvested = enriched.reduce((s, p) => s + p.invested, 0);
  const totCurrent  = enriched.reduce((s, p) => s + p.current, 0);
  const totPL       = totCurrent - totInvested;
  const totPLPct    = totInvested > 0 ? (totPL / totInvested) * 100 : 0;

  const handleAdd = () => {
    if (!form.symbol || !form.qty || !form.avgPrice) return;
    const pos: Position = {
      id: editId || Date.now().toString(),
      symbol: form.symbol.toUpperCase(),
      qty: parseFloat(form.qty),
      avgPrice: parseFloat(form.avgPrice),
      buyDate: form.buyDate,
      note: form.note,
    };
    if (editId) {
      setPositions(prev => prev.map(p => p.id === editId ? pos : p));
      setEditId(null);
    } else {
      setPositions(prev => [...prev, pos]);
    }
    setForm({ symbol: '', qty: '', avgPrice: '', buyDate: new Date().toISOString().slice(0, 10), note: '' });
    setShowAdd(false);
  };

  const handleEdit = (p: Position) => {
    setForm({ symbol: p.symbol, qty: String(p.qty), avgPrice: String(p.avgPrice), buyDate: p.buyDate, note: p.note || '' });
    setEditId(p.id);
    setShowAdd(true);
  };

  const handleDelete = (id: string) => setPositions(prev => prev.filter(p => p.id !== id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Summary bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 1, padding: 4, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {[
          { label: 'INVESTED', value: fmtCr(totInvested), color: 'var(--amber)' },
          { label: 'CURRENT', value: fmtCr(totCurrent), color: 'var(--text-primary)' },
          { label: 'TOTAL P&L', value: fmtCr(totPL), color: totPL >= 0 ? 'var(--green)' : 'var(--red)' },
          { label: 'RETURN %', value: `${totPLPct >= 0 ? '+' : ''}${totPLPct.toFixed(2)}%`, color: totPL >= 0 ? 'var(--green)' : 'var(--red)' },
          { label: 'POSITIONS', value: positions.length.toString(), color: 'var(--text-primary)' },
        ].map(item => (
          <div key={item.label} className="metric-box">
            <div className="metric-label">{item.label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: item.color, marginTop: 2 }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 11 }}>PORTFOLIO — PORT</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-amber" onClick={() => { setShowAdd(!showAdd); setEditId(null); setForm({ symbol: '', qty: '', avgPrice: '', buyDate: new Date().toISOString().slice(0, 10), note: '' }); }}>
          {showAdd ? '✕ CANCEL' : '+ ADD POSITION'}
        </button>
        <button className="btn" onClick={() => {
          const csv = ['Symbol,Qty,AvgPrice,BuyDate,CurrentPrice,Invested,Current,P&L,P&L%',
            ...enriched.map(p => `${p.symbol},${p.qty},${p.avgPrice},${p.buyDate},${p.cmp.toFixed(2)},${p.invested.toFixed(2)},${p.current.toFixed(2)},${p.pl.toFixed(2)},${p.plPct.toFixed(2)}%`)
          ].join('\n');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
          a.download = `portfolio_${new Date().toISOString().slice(0,10)}.csv`;
          a.click();
        }} style={{ fontSize: 10 }}>⬇ EXPORT CSV</button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ display: 'flex', gap: 6, padding: '6px 8px', background: 'rgba(255,149,0,0.05)', borderBottom: '1px solid var(--amber-dim)', flexShrink: 0, flexWrap: 'wrap' }}>
          {[
            { key: 'symbol',   label: 'SYMBOL',    type: 'text',   placeholder: 'e.g. RELIANCE' },
            { key: 'qty',      label: 'QUANTITY',  type: 'number', placeholder: '100' },
            { key: 'avgPrice', label: 'AVG PRICE', type: 'number', placeholder: '2500.00' },
            { key: 'buyDate',  label: 'BUY DATE',  type: 'date',   placeholder: '' },
          ].map(f => (
            <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <label style={{ fontSize: 9, color: 'var(--text-muted)' }}>{f.label}</label>
              <input
                type={f.type}
                placeholder={f.placeholder}
                value={(form as any)[f.key]}
                onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                style={{ width: 120 }}
              />
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <label style={{ fontSize: 9, color: 'var(--text-muted)' }}>NOTE</label>
            <input
              type="text"
              placeholder="Optional note"
              value={form.note}
              onChange={e => setForm(prev => ({ ...prev, note: e.target.value }))}
              style={{ width: 160 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn btn-green" onClick={handleAdd}>
              {editId ? '✓ UPDATE' : '✓ ADD'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {enriched.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: 8 }}>
            <div style={{ fontSize: 32 }}>📊</div>
            <div style={{ fontSize: 13, color: 'var(--amber)' }}>No positions tracked</div>
            <div style={{ fontSize: 11 }}>Click + ADD POSITION to start tracking your portfolio</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                {['SYMBOL','NAME','QTY','AVG PRICE','CMP','INVESTED','CURRENT','P&L','P&L %','TODAY %','ACTION'].map(h => (
                  <th key={h} style={{ textAlign: h === 'ACTION' ? 'center' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {enriched.map(p => (
                <tr key={p.id} onClick={() => onSelectTicker(p.symbol)} style={{ cursor: 'pointer' }}>
                  <td style={{ color: 'var(--amber)', fontWeight: 700 }}>{p.symbol}</td>
                  <td style={{ color: 'var(--text-secondary)', maxWidth: 140 }} className="truncate">{p.name || '—'}</td>
                  <td>{p.qty.toLocaleString()}</td>
                  <td>{fmtNum(p.avgPrice)}</td>
                  <td style={{ fontWeight: 700 }}>{fmtNum(p.cmp)}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{fmtCr(p.invested)}</td>
                  <td style={{ fontWeight: 700 }}>{fmtCr(p.current)}</td>
                  <td style={{ color: p.pl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                    {p.pl >= 0 ? '+' : ''}{fmtCr(p.pl)}
                  </td>
                  <td style={{ color: p.plPct >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                    {p.plPct >= 0 ? '▲' : '▼'}{Math.abs(p.plPct).toFixed(2)}%
                  </td>
                  <td style={{ color: p.chg >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {p.chg >= 0 ? '+' : ''}{p.chg.toFixed(2)}%
                  </td>
                  <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                    <button className="btn" onClick={() => handleEdit(p)} style={{ padding: '1px 4px', fontSize: 9, marginRight: 2 }}>✎</button>
                    <button className="btn" onClick={() => handleDelete(p.id)} style={{ padding: '1px 4px', fontSize: 9, color: 'var(--red)', borderColor: 'var(--red-dim)' }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Allocation bar */}
      {enriched.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '6px 8px', flexShrink: 0 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>ALLOCATION</div>
          <div style={{ display: 'flex', height: 14, borderRadius: 2, overflow: 'hidden', gap: 1 }}>
            {enriched.map((p, i) => {
              const pct = totCurrent > 0 ? (p.current / totCurrent) * 100 : 0;
              const COLORS = ['#ff9500','#2979ff','#00c853','#ff3d00','#00b8d4','#ffd600','#ff6e40','#82b1ff','#69f0ae'];
              return (
                <div key={p.id} style={{ width: `${pct}%`, background: COLORS[i % COLORS.length], minWidth: 2 }} title={`${p.symbol} ${pct.toFixed(1)}%`} />
              );
            })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', marginTop: 4 }}>
            {enriched.map((p, i) => {
              const pct = totCurrent > 0 ? (p.current / totCurrent) * 100 : 0;
              const COLORS = ['#ff9500','#2979ff','#00c853','#ff3d00','#00b8d4','#ffd600','#ff6e40','#82b1ff','#69f0ae'];
              return (
                <span key={p.id} style={{ fontSize: 9, color: COLORS[i % COLORS.length] }}>■ {p.symbol} {pct.toFixed(1)}%</span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
