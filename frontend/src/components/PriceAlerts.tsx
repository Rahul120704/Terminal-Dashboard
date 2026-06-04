import React, { useState, useEffect, useRef } from 'react';
import { useAllQuotes } from '../store/marketStore';

export interface Alert {
  id: string;
  symbol: string;
  direction: 'above' | 'below';
  target: number;
  note?: string;
  triggered: boolean;
  triggeredAt?: string;
  createdAt: string;
}

interface ToastMsg { id: string; text: string; color: string }

interface Props {
  onSelectTicker: (sym: string) => void;
}

const STORAGE_KEY = 'bti_alerts_v1';

function loadAlerts(): Alert[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveAlerts(a: Alert[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(a)); }

// Global toast manager — exported so Terminal can render toasts
export const toastBus = { listeners: [] as ((t: ToastMsg) => void)[] };
function fireToast(t: ToastMsg) { toastBus.listeners.forEach(fn => fn(t)); }

export const AlertsToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  useEffect(() => {
    const fn = (t: ToastMsg) => {
      setToasts(prev => [t, ...prev].slice(0, 8));
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), 6000);
    };
    toastBus.listeners.push(fn);
    return () => { toastBus.listeners = toastBus.listeners.filter(f => f !== fn); };
  }, []);

  if (!toasts.length) return null;

  return (
    <div style={{ position: 'fixed', top: 44, right: 8, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'none' }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: 'var(--bg-panel)', border: `1px solid ${t.color}`,
          padding: '6px 12px', fontSize: 11, color: t.color, fontWeight: 700,
          boxShadow: `0 0 12px ${t.color}40`, minWidth: 220,
          animation: 'slideIn 0.2s ease-out',
        }}>
          ⚡ {t.text}
        </div>
      ))}
    </div>
  );
};

export const PriceAlerts: React.FC<Props> = ({ onSelectTicker }) => {
  const quotes = useAllQuotes();
  const [alerts, setAlerts] = useState<Alert[]>(loadAlerts);
  const [form, setForm] = useState({ symbol: '', direction: 'above' as 'above' | 'below', target: '', note: '' });
  const prevPricesRef = useRef<Record<string, number>>({});
  const triggeredRef = useRef<Set<string>>(new Set());

  useEffect(() => { saveAlerts(alerts); }, [alerts]);

  // Check alerts against live quotes
  useEffect(() => {
    const updated: Alert[] = [];
    let changed = false;

    alerts.forEach(alert => {
      if (alert.triggered) { updated.push(alert); return; }
      const q = quotes[alert.symbol];
      if (!q) { updated.push(alert); return; }
      const price = q.price;
      const hit = alert.direction === 'above' ? price >= alert.target : price <= alert.target;
      if (hit && !triggeredRef.current.has(alert.id)) {
        triggeredRef.current.add(alert.id);
        const now = new Date().toISOString();
        const updatedAlert: Alert = { ...alert, triggered: true, triggeredAt: now };
        updated.push(updatedAlert);
        changed = true;
        fireToast({
          id: alert.id,
          text: `${alert.symbol} ${alert.direction === 'above' ? '▲' : '▼'} ₹${alert.target.toFixed(2)} — now ₹${price.toFixed(2)}${alert.note ? ` (${alert.note})` : ''}`,
          color: alert.direction === 'above' ? 'var(--green)' : 'var(--red)',
        });
      } else {
        updated.push(alert);
      }
    });

    if (changed) setAlerts(updated);
    prevPricesRef.current = Object.fromEntries(Object.entries(quotes).map(([k, v]) => [k, v.price]));
  }, [quotes, alerts]);

  const handleAdd = () => {
    if (!form.symbol || !form.target) return;
    const alert: Alert = {
      id: Date.now().toString(),
      symbol: form.symbol.toUpperCase(),
      direction: form.direction,
      target: parseFloat(form.target),
      note: form.note,
      triggered: false,
      createdAt: new Date().toISOString(),
    };
    setAlerts(prev => [alert, ...prev]);
    setForm(prev => ({ ...prev, symbol: '', target: '', note: '' }));
  };

  const handleDelete = (id: string) => {
    triggeredRef.current.delete(id);
    setAlerts(prev => prev.filter(a => a.id !== id));
  };
  const handleReset = (id: string) => {
    triggeredRef.current.delete(id);
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, triggered: false, triggeredAt: undefined } : a));
  };

  const active    = alerts.filter(a => !a.triggered);
  const triggered = alerts.filter(a => a.triggered);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '4px 8px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 11 }}>PRICE ALERTS — ALRT</span>
        <span style={{ fontSize: 10, color: 'var(--green)' }}>{active.length} ACTIVE</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{triggered.length} TRIGGERED</span>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => setAlerts(prev => prev.filter(a => !a.triggered))} style={{ fontSize: 9 }}>
          CLEAR TRIGGERED
        </button>
        <button className="btn" onClick={() => { setAlerts([]); triggeredRef.current.clear(); }} style={{ fontSize: 9, color: 'var(--red)', borderColor: 'var(--red-dim)' }}>
          CLEAR ALL
        </button>
      </div>

      {/* Add alert form */}
      <div style={{ display: 'flex', gap: 6, padding: '6px 8px', background: 'rgba(255,149,0,0.03)', borderBottom: '1px solid var(--border)', flexShrink: 0, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        {[
          { key: 'symbol', label: 'SYMBOL', type: 'text', placeholder: 'RELIANCE', width: 100 },
          { key: 'target', label: 'TARGET PRICE', type: 'number', placeholder: '2500.00', width: 120 },
          { key: 'note',   label: 'NOTE (optional)', type: 'text', placeholder: 'Breakout', width: 140 },
        ].map(f => (
          <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <label style={{ fontSize: 9, color: 'var(--text-muted)' }}>{f.label}</label>
            <input
              type={f.type}
              placeholder={f.placeholder}
              value={(form as any)[f.key]}
              onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
              style={{ width: f.width }}
            />
          </div>
        ))}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <label style={{ fontSize: 9, color: 'var(--text-muted)' }}>DIRECTION</label>
          <select value={form.direction} onChange={e => setForm(prev => ({ ...prev, direction: e.target.value as any }))} style={{ width: 90 }}>
            <option value="above">▲ ABOVE</option>
            <option value="below">▼ BELOW</option>
          </select>
        </div>
        <button className="btn btn-amber" onClick={handleAdd} style={{ height: 24, alignSelf: 'flex-end' }}>+ ADD ALERT</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {alerts.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: 8 }}>
            <div style={{ fontSize: 32 }}>🔔</div>
            <div style={{ fontSize: 13, color: 'var(--amber)' }}>No alerts set</div>
            <div style={{ fontSize: 11 }}>Set price alerts above and get notified when levels are hit</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                {['STATUS','SYMBOL','DIRECTION','TARGET','CURRENT','GAP','NOTE','CREATED','ACTION'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {alerts.map(alert => {
                const q = quotes[alert.symbol];
                const price = q?.price;
                const gap = price != null ? price - alert.target : null;
                const gapPct = (gap != null && alert.target > 0) ? (gap / alert.target) * 100 : null;
                return (
                  <tr key={alert.id} onClick={() => onSelectTicker(alert.symbol)} style={{ cursor: 'pointer', opacity: alert.triggered ? 0.7 : 1 }}>
                    <td>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '1px 4px',
                        color: alert.triggered ? 'var(--green)' : 'var(--amber)',
                        border: `1px solid ${alert.triggered ? 'var(--green-dim)' : 'var(--amber-dim)'}`,
                        background: alert.triggered ? 'rgba(0,200,83,0.1)' : 'rgba(255,149,0,0.05)',
                      }}>
                        {alert.triggered ? '✓ HIT' : '⏳ WATCH'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--amber)', fontWeight: 700 }}>{alert.symbol}</td>
                    <td>
                      <span style={{ color: alert.direction === 'above' ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                        {alert.direction === 'above' ? '▲ ABOVE' : '▼ BELOW'}
                      </span>
                    </td>
                    <td style={{ fontWeight: 700 }}>₹{alert.target.toFixed(2)}</td>
                    <td style={{ fontWeight: 700 }}>
                      {price != null ? `₹${price.toFixed(2)}` : '—'}
                    </td>
                    <td style={{ color: gapPct != null ? (gapPct >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)' }}>
                      {gapPct != null ? `${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(2)}%` : '—'}
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{alert.note || '—'}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 10 }}>{alert.createdAt.slice(0, 10)}</td>
                    <td onClick={e => e.stopPropagation()}>
                      {alert.triggered && (
                        <button className="btn" onClick={() => handleReset(alert.id)} style={{ padding: '1px 4px', fontSize: 9, marginRight: 2 }}>↺ RESET</button>
                      )}
                      <button className="btn" onClick={() => handleDelete(alert.id)} style={{ padding: '1px 4px', fontSize: 9, color: 'var(--red)', borderColor: 'var(--red-dim)' }}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Info bar */}
      {active.length > 0 && (
        <div style={{ padding: '4px 8px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
          Monitoring {active.length} active alert{active.length > 1 ? 's' : ''} — checked on every quote update
        </div>
      )}
    </div>
  );
};
