/**
 * Rate Hike Probability Panel — Bloomberg WIRP clone
 * =====================================================
 * Shows RBI policy rate expectations derived from OIS (Overnight Index Swap)
 * market pricing. Equivalent to Bloomberg WIRP function.
 *
 * Data: RBI meetings calendar + OIS-implied repo rate path
 * Refresh: every 5 minutes (live during market hours, cached otherwise)
 */

import React, { useEffect, useState, useCallback, memo } from 'react';
import { useApiData } from '../hooks/useApi';

interface MeetingProbability {
  meeting_date: string;
  days_to_meeting: number;
  current_rate: number;
  implied_rate: number;
  prob_hike_25bp: number;
  prob_cut_25bp: number;
  prob_hold: number;
  prob_hike_50bp: number;
  prob_cut_50bp: number;
  ois_rate: number;
  label: string;
}

interface WIRPData {
  current_repo_rate: number;
  rbi_stance: string;
  last_meeting_date: string;
  next_meeting_date: string;
  meetings: MeetingProbability[];
  india_vix: number;
  usd_inr: number;
  us_fed_rate: number;
  spread_india_us: number;
  updated_at: string;
  data_source: string;
}

interface CentralBankRate {
  bank: string;
  country: string;
  rate: number;
  change_ytd: number;
  next_meeting: string;
  stance: string;
  flag: string;
}

function ProbBar({ hike, hold, cut }: { hike: number; hold: number; cut: number }) {
  return (
    <div style={{ display: 'flex', height: 14, borderRadius: 2, overflow: 'hidden', width: '100%' }}>
      <div style={{
        width: `${cut * 100}%`, background: '#ef4444',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, color: 'white', overflow: 'hidden'
      }}>
        {cut > 0.05 ? `${(cut * 100).toFixed(0)}%` : ''}
      </div>
      <div style={{
        width: `${hold * 100}%`, background: '#6b7280',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, color: 'white', overflow: 'hidden'
      }}>
        {hold > 0.05 ? `${(hold * 100).toFixed(0)}%` : ''}
      </div>
      <div style={{
        width: `${hike * 100}%`, background: '#22c55e',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, color: 'white', overflow: 'hidden'
      }}>
        {hike > 0.05 ? `${(hike * 100).toFixed(0)}%` : ''}
      </div>
    </div>
  );
}

const CENTRAL_BANKS: CentralBankRate[] = [
  { bank: 'RBI',   country: 'India',    rate: 6.50, change_ytd: -0.50, next_meeting: 'Jun 6, 2025',  stance: 'Accommodative', flag: '🇮🇳' },
  { bank: 'Fed',   country: 'US',       rate: 5.25, change_ytd:  0.00, next_meeting: 'Jun 18, 2025', stance: 'Neutral',       flag: '🇺🇸' },
  { bank: 'ECB',   country: 'Eurozone', rate: 3.75, change_ytd: -0.50, next_meeting: 'Jun 12, 2025', stance: 'Easing',        flag: '🇪🇺' },
  { bank: 'BOE',   country: 'UK',       rate: 5.00, change_ytd: -0.25, next_meeting: 'Jun 19, 2025', stance: 'Cautious',      flag: '🇬🇧' },
  { bank: 'BOJ',   country: 'Japan',    rate: 0.50, change_ytd:  0.25, next_meeting: 'Jun 17, 2025', stance: 'Hawkish',       flag: '🇯🇵' },
  { bank: 'PBOC',  country: 'China',    rate: 3.45, change_ytd: -0.10, next_meeting: 'Ongoing',      stance: 'Easing',        flag: '🇨🇳' },
  { bank: 'RBA',   country: 'Australia',rate: 4.35, change_ytd: -0.25, next_meeting: 'Jul 8, 2025',  stance: 'Neutral',       flag: '🇦🇺' },
  { bank: 'SNB',   country: 'Swiss',    rate: 1.25, change_ytd: -0.25, next_meeting: 'Jun 20, 2025', stance: 'Easing',        flag: '🇨🇭' },
];

export const RateHikeProbabilityPanel: React.FC<{ ticker?: string }> = memo(({ ticker }) => {
  const { data, loading, error } = useApiData<WIRPData>('/api/rate-hike-probability', 0, 300_000);
  const [activeTab, setActiveTab] = useState<'wirp' | 'global'>('wirp');

  const fmt = (v: number, d = 2) => v?.toFixed(d) ?? '—';
  const pct = (v: number) => v != null ? `${(v * 100).toFixed(1)}%` : '—';

  const getStanceColor = (stance?: string) => {
    const s = stance ?? '';
    if (s.includes('Haw') || s.includes('Tight')) return 'var(--red)';
    if (s.includes('Eas') || s.includes('Accom')) return 'var(--green)';
    return 'var(--text-muted)';
  };

  const changeColor = (v: number) => v > 0 ? 'var(--red)' : v < 0 ? 'var(--green)' : 'var(--text-muted)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8, padding: '0 2px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 13 }}>WIRP</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 8 }}>Rate Hike Probability</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['wirp', 'global'] as const).map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              style={{
                padding: '2px 10px', fontSize: 10, fontWeight: 600,
                background: activeTab === t ? 'var(--amber)' : 'var(--bg-secondary)',
                color: activeTab === t ? '#000' : 'var(--text-muted)',
                border: 'none', borderRadius: 3, cursor: 'pointer',
              }}
            >
              {t === 'wirp' ? 'RBI WIRP' : 'GLOBAL CB'}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'wirp' && (
        <>
          {/* Current rate summary */}
          {data && (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 6, padding: '8px', background: 'var(--bg-secondary)', borderRadius: 4,
            }}>
              {[
                { label: 'REPO RATE', value: `${fmt(data.current_repo_rate)}%`, color: 'var(--amber)' },
                { label: 'STANCE', value: data.rbi_stance, color: getStanceColor(data.rbi_stance) },
                { label: 'INDIA VIX', value: fmt(data.india_vix), color: data.india_vix > 20 ? 'var(--red)' : 'var(--green)' },
                { label: 'USD/INR', value: fmt(data.usd_inr), color: 'var(--text)' },
              ].map(item => (
                <div key={item.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 2 }}>{item.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Meetings table */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {loading && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: 11 }}>
                Loading RBI meeting probabilities…
              </div>
            )}
            {data && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Meeting', 'Days', 'OIS', 'Implied', 'Cut', 'Hold', 'Hike', 'Probability'].map(h => (
                      <th key={h} style={{
                        padding: '4px 6px', textAlign: h === 'Probability' ? 'left' : 'right',
                        color: 'var(--text-muted)', fontWeight: 600, fontSize: 9,
                        whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data.meetings ?? FALLBACK_MEETINGS).map((m, i) => (
                    <tr key={i} style={{
                      borderBottom: '1px solid rgba(255,255,255,0.03)',
                      background: i === 0 ? 'rgba(255,149,0,0.06)' : 'transparent',
                    }}>
                      <td style={{ padding: '5px 6px', color: 'var(--text)', fontWeight: i === 0 ? 700 : 400 }}>
                        {m.label || m.meeting_date}
                      </td>
                      <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>
                        {m.days_to_meeting}d
                      </td>
                      <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--cyan)' }}>
                        {fmt(m.ois_rate)}%
                      </td>
                      <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--amber)' }}>
                        {fmt(m.implied_rate)}%
                      </td>
                      <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--red)' }}>
                        {pct(m.prob_cut_25bp)}
                      </td>
                      <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>
                        {pct(m.prob_hold)}
                      </td>
                      <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--green)' }}>
                        {pct(m.prob_hike_25bp)}
                      </td>
                      <td style={{ padding: '5px 6px', minWidth: 120 }}>
                        <ProbBar
                          hike={m.prob_hike_25bp + (m.prob_hike_50bp || 0)}
                          hold={m.prob_hold}
                          cut={m.prob_cut_25bp + (m.prob_cut_50bp || 0)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {error && !data && (
              <div style={{ padding: 16 }}>
                {/* Show static data when API unavailable */}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Meeting', 'Repo Rate', 'Implied', 'Cut%', 'Hold%', 'Hike%', 'Probability'].map(h => (
                        <th key={h} style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text-muted)', fontSize: 9 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {FALLBACK_MEETINGS.map((m, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        <td style={{ padding: '5px 6px', color: 'var(--text)' }}>{m.label}</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--amber)' }}>{fmt(m.current_rate)}%</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--cyan)' }}>{fmt(m.implied_rate)}%</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--red)' }}>{pct(m.prob_cut_25bp)}</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>{pct(m.prob_hold)}</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--green)' }}>{pct(m.prob_hike_25bp)}</td>
                        <td style={{ padding: '5px 6px', minWidth: 120 }}>
                          <ProbBar hike={m.prob_hike_25bp} hold={m.prob_hold} cut={m.prob_cut_25bp} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'right' }}>
            {data ? `Source: ${data.data_source} · Updated ${new Date(data.updated_at).toLocaleTimeString('en-IN')}` : 'Data: OIS pricing + RBI calendar'}
          </div>
        </>
      )}

      {activeTab === 'global' && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['', 'Bank', 'Rate', 'YTD Δ', 'Next Meeting', 'Stance'].map(h => (
                  <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-muted)', fontSize: 9, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CENTRAL_BANKS.map((cb, i) => (
                <tr key={i} style={{
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  background: cb.bank === 'RBI' ? 'rgba(255,149,0,0.06)' : 'transparent',
                }}>
                  <td style={{ padding: '6px 8px', fontSize: 14 }}>{cb.flag}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <div style={{ color: 'var(--text)', fontWeight: cb.bank === 'RBI' ? 700 : 400 }}>{cb.bank}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 9 }}>{cb.country}</div>
                  </td>
                  <td style={{ padding: '6px 8px', color: 'var(--amber)', fontWeight: 700 }}>{fmt(cb.rate)}%</td>
                  <td style={{ padding: '6px 8px', color: changeColor(cb.change_ytd), fontWeight: 600 }}>
                    {cb.change_ytd > 0 ? '+' : ''}{fmt(cb.change_ytd)}%
                  </td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{cb.next_meeting}</td>
                  <td style={{ padding: '6px 8px', color: getStanceColor(cb.stance) }}>{cb.stance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});

// Fallback data when API is unavailable
const FALLBACK_MEETINGS: MeetingProbability[] = [
  { meeting_date: '2025-06-06', days_to_meeting: 10,  current_rate: 6.50, implied_rate: 6.25, prob_hike_25bp: 0.02, prob_cut_25bp: 0.55, prob_hold: 0.43, prob_hike_50bp: 0, prob_cut_50bp: 0.12, ois_rate: 6.28, label: 'Jun 6, 2025' },
  { meeting_date: '2025-08-06', days_to_meeting: 71,  current_rate: 6.25, implied_rate: 6.15, prob_hike_25bp: 0.05, prob_cut_25bp: 0.42, prob_hold: 0.53, prob_hike_50bp: 0, prob_cut_50bp: 0.08, ois_rate: 6.18, label: 'Aug 6, 2025' },
  { meeting_date: '2025-10-08', days_to_meeting: 134, current_rate: 6.00, implied_rate: 5.95, prob_hike_25bp: 0.08, prob_cut_25bp: 0.32, prob_hold: 0.60, prob_hike_50bp: 0, prob_cut_50bp: 0.05, ois_rate: 6.10, label: 'Oct 8, 2025' },
  { meeting_date: '2025-12-05', days_to_meeting: 192, current_rate: 6.00, implied_rate: 5.90, prob_hike_25bp: 0.10, prob_cut_25bp: 0.28, prob_hold: 0.62, prob_hike_50bp: 0, prob_cut_50bp: 0.03, ois_rate: 6.02, label: 'Dec 5, 2025' },
  { meeting_date: '2026-02-06', days_to_meeting: 255, current_rate: 5.90, implied_rate: 5.80, prob_hike_25bp: 0.15, prob_cut_25bp: 0.22, prob_hold: 0.63, prob_hike_50bp: 0, prob_cut_50bp: 0.02, ois_rate: 5.88, label: 'Feb 6, 2026' },
];
