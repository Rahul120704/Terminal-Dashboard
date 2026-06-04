import React, { useState } from 'react';
import { useApiData } from '../hooks/useApi';

interface EconEvent {
  date: string;
  event: string;
  category: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  country: string;
  company?: string;
  actual?: number;
  forecast?: number;
  previous?: number;
}

interface CalendarData {
  events: EconEvent[];
  macro_schedule: EconEvent[];
  updated_at: string;
}

const IMPACT_COLOR: Record<string, string> = {
  HIGH: 'var(--red)',
  MEDIUM: 'var(--amber)',
  LOW: 'var(--green)',
};
const COUNTRY_FLAG: Record<string, string> = {
  India: '🇮🇳', USA: '🇺🇸', EU: '🇪🇺', UK: '🇬🇧', China: '🇨🇳', Japan: '🇯🇵',
};
const CAT_LABEL: Record<string, string> = {
  earnings: 'EARNINGS', derivatives: 'F&O', monetary_policy: 'MONETARY',
  inflation: 'INFLATION', gdp: 'GDP', employment: 'JOBS', industrial: 'IIP',
};

export const EconomicCalendar: React.FC = () => {
  const { data, loading } = useApiData<CalendarData>('/api/economic-calendar', 300000);
  const [filter, setFilter] = useState<string>('all');
  const [countryFilter, setCountryFilter] = useState<string>('all');

  const all = [
    ...(data?.events || []),
    ...(data?.macro_schedule || []),
  ].sort((a, b) => (a.date || '9999') < (b.date || '9999') ? -1 : 1);

  const filtered = all.filter(e => {
    if (filter !== 'all' && e.impact !== filter) return false;
    if (countryFilter !== 'all' && e.country !== countryFilter) return false;
    return true;
  });

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const groupByDate = (events: EconEvent[]) => {
    const groups: Record<string, EconEvent[]> = {};
    events.forEach(e => {
      const d = e.date || 'Scheduled';
      groups[d] = groups[d] || [];
      groups[d].push(e);
    });
    return groups;
  };

  const groups = groupByDate(filtered);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '4px 8px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 11 }}>ECONOMIC CALENDAR — ECOW</span>
        <div style={{ flex: 1 }} />
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{ fontSize: 10 }}>
          <option value="all">ALL IMPACT</option>
          <option value="HIGH">HIGH</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="LOW">LOW</option>
        </select>
        <select value={countryFilter} onChange={e => setCountryFilter(e.target.value)} style={{ fontSize: 10 }}>
          <option value="all">ALL COUNTRIES</option>
          <option value="India">India 🇮🇳</option>
          <option value="USA">USA 🇺🇸</option>
          <option value="EU">EU 🇪🇺</option>
        </select>
        {loading && <span className="spinner" />}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, padding: '3px 8px', borderBottom: '1px solid var(--border)', fontSize: 9, flexShrink: 0 }}>
        {Object.entries(IMPACT_COLOR).map(([k, c]) => (
          <span key={k}><span style={{ color: c, marginRight: 3 }}>●</span>{k} IMPACT</span>
        ))}
        <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{filtered.length} events</span>
      </div>

      {/* Calendar */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {Object.entries(groups).map(([date, events]) => {
          const isToday = date === today;
          const isTomorrow = date === tomorrow;
          const isPast = date < today;
          return (
            <div key={date}>
              {/* Date header */}
              <div style={{
                padding: '4px 8px', background: isToday ? 'rgba(255,149,0,0.1)' : 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 8,
                position: 'sticky', top: 0, zIndex: 2,
              }}>
                <span style={{ color: isToday ? 'var(--amber)' : isPast ? 'var(--text-muted)' : 'var(--text-primary)', fontWeight: 700, fontSize: 11 }}>
                  {isToday ? '▶ TODAY' : isTomorrow ? '▷ TOMORROW' : date || 'TBD'}
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                  {date && date !== 'Scheduled' ? new Date(date).toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric' }) : ''}
                </span>
                <span style={{ fontSize: 9, color: 'var(--red)' }}>
                  {events.filter(e => e.impact === 'HIGH').length > 0 ? `${events.filter(e => e.impact === 'HIGH').length} HIGH` : ''}
                </span>
              </div>

              {/* Events */}
              {events.map((e, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 8px', borderBottom: '1px solid var(--border)',
                  opacity: isPast ? 0.6 : 1,
                  background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                }}>
                  {/* Impact dot */}
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: IMPACT_COLOR[e.impact] || 'var(--text-muted)', flexShrink: 0 }} />

                  {/* Category badge */}
                  <span style={{
                    fontSize: 9, padding: '1px 4px', background: 'var(--bg-secondary)',
                    border: `1px solid ${IMPACT_COLOR[e.impact] || 'var(--border)'}`,
                    color: IMPACT_COLOR[e.impact] || 'var(--text-muted)',
                    minWidth: 60, textAlign: 'center',
                  }}>
                    {CAT_LABEL[e.category] || e.category.toUpperCase()}
                  </span>

                  {/* Country */}
                  <span style={{ fontSize: 12 }} title={e.country}>{COUNTRY_FLAG[e.country] || '🌐'}</span>

                  {/* Event name */}
                  <span style={{ flex: 1, fontSize: 11, color: e.impact === 'HIGH' ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: e.impact === 'HIGH' ? 600 : 400 }}>
                    {e.event}
                  </span>

                  {/* Company if earnings */}
                  {e.company && (
                    <span style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700 }}>{e.company}</span>
                  )}

                  {/* Forecast / Actual if available */}
                  {e.actual != null && (
                    <span style={{ fontSize: 10, color: 'var(--green)' }}>A:{e.actual}</span>
                  )}
                  {e.forecast != null && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>F:{e.forecast}</span>
                  )}
                  {e.previous != null && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>P:{e.previous}</span>
                  )}
                </div>
              ))}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60%', color: 'var(--text-muted)', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 24 }}>📅</div>
            <div>No events matching filter</div>
          </div>
        )}
      </div>

      {data?.updated_at && (
        <div style={{ padding: '2px 8px', borderTop: '1px solid var(--border)', fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>
          Updated: {new Date(data.updated_at).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
};
