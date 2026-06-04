import React, { useMemo, useState } from 'react';
import { useApiData } from '../hooks/useApi';
import { useHedgeFundState } from '../store/liveDataStore';

interface AgentState {
  status: string;
  output: Record<string, any>;
  last_run: string | null;
}

interface TeamState {
  research:    AgentState;
  analyst:     AgentState;
  risk:        AgentState;
  datascience: AgentState;
  sentiment:   AgentState;
  news_finder: AgentState;
  macro:       AgentState;
  pm?:         AgentState;
}

const STATUS_COLOR: Record<string, string> = {
  running:      'var(--green)',
  starting:     'var(--amber)',
  initializing: 'var(--amber)',
  error:        'var(--red)',
};

const AgentCard: React.FC<{
  name: string; label: string; icon: string; state?: AgentState; children: React.ReactNode;
  accent?: string;
}> = React.memo(({ name, label, icon, state, children, accent = 'var(--amber)' }) => {
  const status = state?.status || 'starting';
  const lastRun = state?.last_run
    ? new Date(state.last_run).toLocaleTimeString('en-IN', { hour12: false })
    : '—';

  return (
    <div style={{
      background: '#141414', border: `1px solid ${accent === 'var(--amber)' ? '#222' : accent + '44'}`,
      borderRadius: 3, display: 'flex', flexDirection: 'column', minHeight: 160, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
        background: '#0e0e0e', borderBottom: '1px solid #1a1a1a',
      }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ color: accent, fontWeight: 700, fontSize: 11, flex: 1 }}>{label}</span>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[status] || 'var(--text-muted)', display: 'inline-block' }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>{lastRun}</span>
      </div>
      <div style={{ flex: 1, padding: 8, overflowY: 'auto', fontSize: 10 }}>
        {children}
      </div>
    </div>
  );
});

const SignalBadge: React.FC<{ action?: string; score?: number; size?: number }> = ({ action, score, size = 10 }) => {
  const a = (action ?? '').toUpperCase();
  const color = a.includes('BUY') || a.includes('LONG') || a.includes('APPROVED')
    ? 'var(--green)' : a.includes('SELL') || a.includes('AVOID') || a.includes('SHORT')
    ? 'var(--red)' : 'var(--amber)';
  return (
    <span style={{
      color, border: `1px solid ${color}`, padding: '1px 5px', borderRadius: 2,
      fontSize: size, fontWeight: 700, marginRight: 4, whiteSpace: 'nowrap',
    }}>
      {action}{score !== undefined ? ` ${score}` : ''}
    </span>
  );
};

const MiniBar: React.FC<{ value: number; max?: number; color?: string }> = ({ value, max = 100, color = 'var(--green)' }) => (
  <div style={{ flex: 1, background: '#222', height: 4, borderRadius: 2, overflow: 'hidden', minWidth: 30 }}>
    <div style={{ width: `${Math.max(2, Math.min(100, (value / max) * 100))}%`, height: '100%', background: color }} />
  </div>
);

const MetricPill: React.FC<{ label: string; value: string | number; color?: string }> = ({ label, value, color }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3px 6px', background: '#0e0e0e', border: '1px solid #222', borderRadius: 2, minWidth: 50 }}>
    <span style={{ color: 'var(--text-muted)', fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
    <span style={{ color: color || 'var(--text-primary)', fontWeight: 700, fontSize: 11 }}>{value}</span>
  </div>
);

// ── PM Summary Card ────────────────────────────────────────────────────────────
const PMSummaryBar: React.FC<{ state: TeamState | null }> = ({ state }) => {
  const macro    = state?.macro?.output;
  const risk     = state?.risk?.output;
  const sent     = state?.sentiment?.output;
  const analyst  = state?.analyst?.output;
  const pm       = state?.pm?.output;
  const dataSci  = state?.datascience?.output;

  const riskColor = risk?.risk_level === 'HIGH' ? 'var(--red)'
    : risk?.risk_level === 'ELEVATED' ? 'var(--amber)' : 'var(--green)';
  const macroColor = macro?.regime === 'RISK_ON' ? 'var(--green)'
    : macro?.regime === 'RISK_OFF' ? 'var(--red)' : 'var(--amber)';
  const sentColor  = sent?.regime === 'BULLISH' ? 'var(--green)'
    : sent?.regime === 'BEARISH' ? 'var(--red)' : 'var(--amber)';

  const pmBias = pm?.market_bias || 'NEUTRAL';
  const biasColor = pmBias === 'BULLISH' ? 'var(--green)' : pmBias === 'BEARISH' ? 'var(--red)' : 'var(--amber)';

  return (
    <div style={{ display: 'flex', gap: 6, padding: '6px 10px', background: '#0a0a0a', borderBottom: '1px solid #222', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
      {/* PM Bias */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>PM BIAS:</span>
        <span style={{ color: biasColor, fontWeight: 700, fontSize: 11 }}>{pmBias}</span>
      </div>
      <div style={{ width: 1, height: 14, background: '#333' }} />
      {/* Macro Regime */}
      {macro?.regime && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>MACRO:</span>
          <span style={{ color: macroColor, fontWeight: 700, fontSize: 10 }}>{macro.regime}</span>
        </div>
      )}
      {/* Risk */}
      {risk?.risk_level && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>RISK:</span>
          <span style={{ color: riskColor, fontWeight: 700, fontSize: 10 }}>{risk.risk_level}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>({risk.risk_score}/100)</span>
        </div>
      )}
      {/* Sentiment */}
      {sent?.regime && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>SENTIMENT:</span>
          <span style={{ color: sentColor, fontWeight: 700, fontSize: 10 }}>{sent.regime}</span>
        </div>
      )}
      {/* Analyst summary */}
      {analyst?.summary && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: 'var(--cyan)', fontSize: 10, fontWeight: 700 }}>{analyst.summary}</span>
        </div>
      )}
      {/* XGBoost flag */}
      {dataSci?.xgb_trained && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(0,200,83,0.08)', border: '1px solid rgba(0,200,83,0.3)', padding: '1px 6px', borderRadius: 2 }}>
          <span style={{ color: 'var(--green)', fontSize: 9, fontWeight: 700 }}>⚡ XGBoost GPU ACTIVE</span>
        </div>
      )}
      {/* Critical alerts */}
      {(state?.news_finder?.output?.critical || 0) > 0 && (
        <div style={{ background: 'rgba(255,61,0,0.15)', border: '1px solid var(--red)', padding: '1px 6px', borderRadius: 2 }}>
          <span style={{ color: 'var(--red)', fontSize: 9, fontWeight: 700 }}>
            ⚠ {state.news_finder.output.critical} CRITICAL ALERT{state.news_finder.output.critical > 1 ? 'S' : ''}
          </span>
        </div>
      )}
    </div>
  );
};

// ── PM Top Picks Card ──────────────────────────────────────────────────────────
const PMPicksCard: React.FC<{ state?: AgentState }> = ({ state }) => {
  const pm = state?.output;
  if (!pm?.top_picks?.length) {
    return (
      <AgentCard name="pm" label="PORTFOLIO MANAGER (ORCHESTRATOR)" icon="🎯" state={state} accent="var(--cyan)">
        <span style={{ color: 'var(--text-muted)' }}>Waiting for agents to initialise…</span>
      </AgentCard>
    );
  }
  return (
    <AgentCard name="pm" label="PORTFOLIO MANAGER (ORCHESTRATOR)" icon="🎯" state={state} accent="var(--cyan)">
      <div style={{ marginBottom: 6 }}>
        <span style={{ color: 'var(--cyan)', fontSize: 9, fontWeight: 700 }}>APPROVED PICKS</span>
      </div>
      {pm.top_picks.slice(0, 4).map((p: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
          <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 10, minWidth: 75 }}>{p.symbol}</span>
          <SignalBadge action={p.pm_action} size={9} />
          <MiniBar value={p.blended} color={p.blended >= 65 ? 'var(--green)' : p.blended >= 50 ? 'var(--amber)' : 'var(--red)'} />
          <span style={{ color: 'var(--text-muted)', fontSize: 9, minWidth: 25 }}>{p.blended}</span>
        </div>
      ))}
      {pm.avoid_list?.length > 0 && (
        <div style={{ borderTop: '1px solid #222', paddingTop: 4, marginTop: 4 }}>
          <span style={{ color: 'var(--red)', fontSize: 9, fontWeight: 700 }}>AVOID/REDUCE</span>
          {pm.avoid_list.slice(0, 2).map((p: any, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 10, minWidth: 75 }}>{p.symbol}</span>
              <SignalBadge action={p.pm_action} size={9} />
              <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>{p.blended}</span>
            </div>
          ))}
        </div>
      )}
    </AgentCard>
  );
};

export const HedgeFundPanel: React.FC<{ liveState?: any }> = React.memo(({ liveState: propState }) => {
  const { data: apiState } = useApiData<TeamState>('/api/hedge-fund/state', 10000);
  // Store takes priority — re-renders only when hedge fund state changes
  const storeState = useHedgeFundState();
  const state: TeamState | null = storeState ?? propState ?? apiState;
  const [expandedView, setExpandedView] = useState<string | null>(null);

  const analyst   = state?.analyst?.output;
  const risk      = state?.risk?.output;
  const macro     = state?.macro?.output;
  const dataSci   = state?.datascience?.output;
  const sent      = state?.sentiment?.output;
  const newsF     = state?.news_finder?.output;
  const research  = state?.research?.output;
  const pm        = state?.pm;

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="panel-title" style={{ color: 'var(--amber)' }}>🤖 AI HEDGE FUND TEAM</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>8 AGENTS • ALWAYS ON</span>
          {state && (
            <span style={{ color: 'var(--green)', fontSize: 9 }}>
              ● LIVE
            </span>
          )}
        </div>
      </div>

      {/* PM Summary Bar */}
      <PMSummaryBar state={state} />

      <div style={{ flex: 1, overflow: 'auto', padding: 6 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 6 }}>

          {/* Portfolio Manager */}
          <PMPicksCard state={pm} />

          {/* Analyst */}
          <AgentCard name="analyst" label="ANALYST & RECOMMENDATIONS" icon="📊" state={state?.analyst}>
            {analyst?.top_buys?.slice(0, 3).map((s: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <SignalBadge action={s.action} />
                <span style={{ color: 'var(--amber)', fontWeight: 700, minWidth: 75, fontSize: 10 }}>{s.symbol}</span>
                <MiniBar value={s.score} color={s.score >= 65 ? 'var(--green)' : s.score >= 50 ? 'var(--amber)' : 'var(--red)'} />
                <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>
                  {s.momentum_3m > 0 ? '+' : ''}{s.momentum_3m}%
                </span>
              </div>
            ))}
            {analyst?.top_sells?.slice(0, 2).map((s: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <SignalBadge action={s.action} />
                <span style={{ color: 'var(--amber)', fontWeight: 700, minWidth: 75, fontSize: 10 }}>{s.symbol}</span>
                <span style={{ color: 'var(--red)', fontSize: 10 }}>{s.score}</span>
              </div>
            ))}
            {!analyst?.top_buys?.length && <span style={{ color: 'var(--text-muted)' }}>Computing signals…</span>}
          </AgentCard>

          {/* Data Scientist (XGBoost) */}
          <AgentCard name="datascience" label="DATA SCIENTIST (QUANT / XGB)" icon="🔬" state={state?.datascience}>
            {dataSci?.top_longs?.length > 0 ? (
              <>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {dataSci.model}
                  {dataSci.xgb_trained && (
                    <span style={{ color: 'var(--green)', fontWeight: 700 }}>• GPU</span>
                  )}
                </div>
                <div style={{ marginBottom: 5 }}>
                  <div style={{ color: 'var(--green)', fontSize: 9, fontWeight: 700, marginBottom: 2 }}>⬆ TOP LONGS</div>
                  {dataSci.top_longs?.slice(0, 3).map((s: any, i: number) => (
                    <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 3 }}>
                      <span style={{ color: 'var(--amber)', fontWeight: 700, minWidth: 75, fontSize: 10 }}>{s.symbol}</span>
                      {s.xgb_proba_up != null && (
                        <span style={{ color: 'var(--cyan)', fontSize: 9 }}>P↑:{(s.xgb_proba_up * 100).toFixed(0)}%</span>
                      )}
                      <span style={{ color: 'var(--text-secondary)', fontSize: 9 }}>RSI:{s.rsi14}</span>
                      <MiniBar value={s.composite} color="var(--green)" />
                      <span style={{ color: 'var(--text-muted)', fontSize: 9, minWidth: 25 }}>{s.composite}</span>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: '1px solid #222', paddingTop: 4 }}>
                  <div style={{ color: 'var(--red)', fontSize: 9, fontWeight: 700, marginBottom: 2 }}>⬇ TOP SHORTS</div>
                  {dataSci.top_shorts?.slice(0, 2).map((s: any, i: number) => (
                    <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 2 }}>
                      <span style={{ color: 'var(--amber)', fontWeight: 700, minWidth: 75, fontSize: 10 }}>{s.symbol}</span>
                      {s.xgb_proba_up != null && (
                        <span style={{ color: 'var(--red)', fontSize: 9 }}>P↑:{(s.xgb_proba_up * 100).toFixed(0)}%</span>
                      )}
                      <MiniBar value={100 - s.composite} color="var(--red)" />
                    </div>
                  ))}
                </div>
              </>
            ) : <span style={{ color: 'var(--text-muted)' }}>Running XGBoost factor model…</span>}
          </AgentCard>

          {/* Risk Analyst */}
          <AgentCard name="risk" label="RISK ANALYST" icon="🛡️" state={state?.risk}>
            {risk ? (
              <>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                  <MetricPill label="Risk Level" value={risk.risk_level}
                    color={risk.risk_level === 'HIGH' ? 'var(--red)' : risk.risk_level === 'ELEVATED' ? 'var(--amber)' : 'var(--green)'} />
                  <MetricPill label="India VIX" value={risk.india_vix?.toFixed(1) || '—'}
                    color={(risk.india_vix || 0) > 20 ? 'var(--red)' : 'var(--green)'} />
                  <MetricPill label="US VIX" value={risk.us_vix?.toFixed(1) || '—'}
                    color={(risk.us_vix || 0) > 20 ? 'var(--red)' : 'var(--text-primary)'} />
                  <MetricPill label="Score" value={`${risk.risk_score}/100`}
                    color={risk.risk_score >= 75 ? 'var(--red)' : risk.risk_score >= 50 ? 'var(--amber)' : 'var(--green)'} />
                </div>
                {risk.signals?.slice(0, 3).map((s: string, i: number) => (
                  <div key={i} style={{ color: 'var(--text-secondary)', fontSize: 9, marginBottom: 2 }}>• {s}</div>
                ))}
                <div style={{ marginTop: 4, borderTop: '1px solid #222', paddingTop: 4 }}>
                  {risk.recommendations?.slice(0, 2).map((r: string, i: number) => (
                    <div key={i} style={{ color: 'var(--cyan)', fontSize: 9, marginBottom: 2 }}>→ {r}</div>
                  ))}
                </div>
              </>
            ) : <span style={{ color: 'var(--text-muted)' }}>Assessing risk…</span>}
          </AgentCard>

          {/* Global Macro */}
          <AgentCard name="macro" label="GLOBAL MACRO ECONOMIST" icon="🌍" state={state?.macro}>
            {macro ? (
              <>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                  <MetricPill label="Regime" value={macro.regime}
                    color={macro.regime === 'RISK_ON' ? 'var(--green)' : macro.regime === 'RISK_OFF' ? 'var(--red)' : 'var(--amber)'} />
                  <MetricPill label="RBI Repo" value={`${macro.repo_rate}%`} />
                  <MetricPill label="CPI" value={`${(macro.cpi || 0).toFixed(1)}%`}
                    color={(macro.cpi || 0) > 6 ? 'var(--red)' : 'var(--green)'} />
                  {macro.gold_price && <MetricPill label="Gold" value={`$${Math.round(macro.gold_price)}`} />}
                  {macro.fii_5d_avg !== undefined && (
                    <MetricPill label="FII 5D" value={`₹${Math.round(macro.fii_5d_avg)}Cr`}
                      color={(macro.fii_5d_avg || 0) >= 0 ? 'var(--green)' : 'var(--red)'} />
                  )}
                </div>
                {macro.signals?.slice(0, 3).map((s: string, i: number) => (
                  <div key={i} style={{ color: 'var(--text-secondary)', fontSize: 9, marginBottom: 1 }}>• {s}</div>
                ))}
                {macro.sector_tilts?.LONG?.length > 0 && (
                  <div style={{ marginTop: 4, fontSize: 9 }}>
                    <span style={{ color: 'var(--green)' }}>LONG: </span>
                    <span style={{ color: 'var(--text-secondary)' }}>{macro.sector_tilts.LONG.join(', ')}</span>
                  </div>
                )}
              </>
            ) : <span style={{ color: 'var(--text-muted)' }}>Fetching macro data…</span>}
          </AgentCard>

          {/* Sentiment */}
          <AgentCard name="sentiment" label="SENTIMENT ANALYST (FinBERT)" icon="📡" state={state?.sentiment}>
            {sent ? (
              <>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                  <MetricPill label="Score" value={((sent.overall_score || 0) * 100).toFixed(0)}
                    color={(sent.overall_score || 0) > 0 ? 'var(--green)' : 'var(--red)'} />
                  <MetricPill label="Regime" value={sent.regime}
                    color={sent.regime === 'BULLISH' ? 'var(--green)' : sent.regime === 'BEARISH' ? 'var(--red)' : 'var(--amber)'} />
                  <MetricPill label="News" value={sent.news_count} />
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 2 }}>BULLISH STOCKS</div>
                {sent.bullish_stocks?.slice(0, 3).map((s: any, i: number) => (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 2, alignItems: 'center' }}>
                    <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 10, minWidth: 75 }}>{s.ticker}</span>
                    <MiniBar value={(s.avg || 0) * 100} max={100} color="var(--green)" />
                    <span style={{ color: 'var(--green)', fontSize: 9 }}>+{((s.avg || 0) * 100).toFixed(0)} ({s.count})</span>
                  </div>
                ))}
                {sent.trending?.length > 0 && (
                  <div style={{ marginTop: 4, borderTop: '1px solid #222', paddingTop: 4 }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>TRENDING: </span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 9 }}>
                      {sent.trending?.slice(0, 8).map((t: any) => t.word).join(', ')}
                    </span>
                  </div>
                )}
              </>
            ) : <span style={{ color: 'var(--text-muted)' }}>Analysing sentiment…</span>}
          </AgentCard>

          {/* News Finder */}
          <AgentCard name="news_finder" label="NEWS FINDER (ALERTS)" icon="🔔" state={state?.news_finder}>
            {newsF?.alerts?.length > 0 ? (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <MetricPill label="Critical" value={newsF.critical || 0}
                    color={(newsF.critical || 0) > 0 ? 'var(--red)' : 'var(--text-muted)'} />
                  <MetricPill label="High" value={newsF.high || 0}
                    color={(newsF.high || 0) > 0 ? 'var(--amber)' : 'var(--text-muted)'} />
                  <MetricPill label="Medium" value={newsF.medium || 0} />
                  <MetricPill label="Monitored" value={newsF.recent_count || 0} />
                </div>
                {newsF.alerts.slice(0, 4).map((a: any, i: number) => (
                  <div key={i} style={{
                    marginBottom: 5, borderLeft: `2px solid ${a.urgency === 'CRITICAL' ? 'var(--red)' : 'var(--amber)'}`,
                    paddingLeft: 6,
                  }}>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 1, alignItems: 'center' }}>
                      {a.ticker && <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 10 }}>{a.ticker}</span>}
                      <span style={{ color: a.urgency === 'CRITICAL' ? 'var(--red)' : 'var(--amber)', fontSize: 9, fontWeight: 700 }}>[{a.urgency}]</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 8 }}>{a.source}</span>
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 9, lineHeight: 1.4 }}>
                      {a.headline?.slice(0, 100)}{a.headline?.length > 100 ? '…' : ''}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div>
                <div style={{ color: 'var(--green)', fontSize: 10 }}>No critical alerts</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 9, marginTop: 4 }}>
                  Monitoring {newsF?.recent_count || 0} recent news items across 500+ sources
                </div>
              </div>
            )}
          </AgentCard>

          {/* Researcher */}
          <AgentCard name="research" label="RESEARCH AGENT" icon="🔍" state={state?.research}>
            {research?.stocks ? (
              <>
                <div style={{ color: 'var(--text-muted)', fontSize: 9, marginBottom: 4 }}>
                  {research.count} stocks analysed (quality scores)
                </div>
                {Object.values(research.stocks as Record<string, any>)
                  .sort((a: any, b: any) => b.quality_score - a.quality_score)
                  .slice(0, 5)
                  .map((s: any, i: number) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ color: 'var(--amber)', fontWeight: 700, minWidth: 75, fontSize: 10 }}>{s.symbol}</span>
                      <MiniBar value={s.quality_score}
                        color={s.quality_score > 60 ? 'var(--green)' : s.quality_score > 40 ? 'var(--amber)' : 'var(--red)'} />
                      <span style={{ color: 'var(--text-secondary)', fontSize: 9, minWidth: 25 }}>{s.quality_score}</span>
                      {s.live_price && (
                        <span style={{ color: 'var(--text-muted)', fontSize: 8 }}>₹{s.live_price?.toFixed(0)}</span>
                      )}
                    </div>
                  ))}
              </>
            ) : <span style={{ color: 'var(--text-muted)' }}>Researching stocks…</span>}
          </AgentCard>

        </div>
      </div>
    </div>
  );
});
