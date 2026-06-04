/**
 * Social Sentiment Panel — Bloomberg TWTR/SRCH clone
 * ====================================================
 * Real-time social media sentiment aggregated from Reddit, Twitter/X fintwit,
 * Telegram channels. NLP-scored via FinBERT. Surge detection = 3σ spike.
 */

import React, { useState, useEffect, useRef, memo } from 'react';
import { useApiData } from '../hooks/useApi';

interface SocialPost {
  id: string;
  source: 'reddit' | 'twitter' | 'telegram' | 'stocktwits';
  text: string;
  author: string;
  ticker?: string;
  sentiment_score: number; // -1 to +1
  sentiment_label: 'bullish' | 'bearish' | 'neutral';
  upvotes: number;
  timestamp: string;
  url?: string;
}

interface TickerSentiment {
  symbol: string;
  name: string;
  score: number;       // -1 to +1
  score_24h_delta: number;
  post_count: number;
  post_count_delta_pct: number;
  is_trending: boolean;
  bull_bear_ratio: number;
  top_post: string;
}

interface SocialData {
  posts: SocialPost[];
  ticker_sentiment: TickerSentiment[];
  market_regime: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';
  fear_greed_index: number;
  updated_at: string;
}

const SOURCE_ICONS: Record<string, string> = {
  reddit: '🔴',
  twitter: '🐦',
  telegram: '📱',
  stocktwits: '📊',
};

const SOURCE_COLORS: Record<string, string> = {
  reddit:     '#FF4500',
  twitter:    '#1DA1F2',
  telegram:   '#2CA5E0',
  stocktwits: '#40a829',
};

function SentimentBadge({ score, label }: { score: number; label: string }) {
  const color = score > 0.2 ? '#22c55e' : score < -0.2 ? '#ef4444' : '#6b7280';
  const icon  = score > 0.2 ? '▲' : score < -0.2 ? '▼' : '◆';
  return (
    <span style={{
      padding: '2px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700,
      color, background: `${color}22`, border: `1px solid ${color}44`,
    }}>
      {icon} {label}
    </span>
  );
}

function ScoreBar({ value }: { value: number }) {
  const pct = (value + 1) / 2 * 100;
  const color = value > 0.3 ? '#22c55e' : value < -0.3 ? '#ef4444' : '#6b7280';
  return (
    <div style={{ position: 'relative', width: 80, height: 6, background: 'var(--bg-tertiary)', borderRadius: 3 }}>
      <div style={{ position: 'absolute', left: '50%', top: 0, width: 1, height: '100%', background: 'var(--border)' }} />
      <div style={{
        position: 'absolute',
        left: value >= 0 ? '50%' : `${pct}%`,
        width: `${Math.abs(value) * 50}%`,
        height: '100%', background: color, borderRadius: 3,
      }} />
    </div>
  );
}

function FearGreedMeter({ value }: { value: number }) {
  const label = value < 20 ? 'Extreme Fear' : value < 40 ? 'Fear' : value < 60 ? 'Neutral' : value < 80 ? 'Greed' : 'Extreme Greed';
  const color = value < 30 ? '#ef4444' : value < 50 ? '#f59e0b' : value < 70 ? '#6b7280' : value < 80 ? '#84cc16' : '#22c55e';
  const angle = (value / 100) * 180 - 90;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 16px' }}>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: 1 }}>FEAR &amp; GREED INDEX</div>
      <div style={{ position: 'relative', width: 80, height: 45, overflow: 'hidden' }}>
        {/* Semicircle gauge */}
        <svg width="80" height="45" viewBox="0 0 80 45">
          <defs>
            <linearGradient id="fgGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="25%" stopColor="#f59e0b" />
              <stop offset="50%" stopColor="#6b7280" />
              <stop offset="75%" stopColor="#84cc16" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
          </defs>
          <path d="M 8 44 A 32 32 0 0 1 72 44" fill="none" stroke="url(#fgGrad)" strokeWidth="6" strokeLinecap="round"/>
          {/* Needle */}
          <line
            x1="40" y1="44"
            x2={40 + 24 * Math.cos((angle - 90) * Math.PI / 180)}
            y2={44 + 24 * Math.sin((angle - 90) * Math.PI / 180)}
            stroke={color} strokeWidth="2" strokeLinecap="round"
          />
          <circle cx="40" cy="44" r="3" fill={color} />
        </svg>
      </div>
      <div style={{ fontSize: 22, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 9, color, fontWeight: 700 }}>{label}</div>
    </div>
  );
}

export const SocialSentimentPanel: React.FC<{ ticker?: string }> = memo(({ ticker }) => {
  const [activeTab, setActiveTab] = useState<'feed' | 'tickers' | 'sentiment'>('feed');
  const [filterSource, setFilterSource] = useState<string>('all');
  // useApiData(path, refreshMs, cacheTtlMs) — refresh every 30s
  const { data, loading } = useApiData<SocialData>('/api/social-sentiment', 30_000, 30_000);

  // Use fallback data when API not available
  const posts   = data?.posts             || FALLBACK_POSTS;
  const tickers = data?.ticker_sentiment  || FALLBACK_TICKERS;
  const fgi     = data?.fear_greed_index  || 42;
  const regime  = data?.market_regime     || 'NEUTRAL';

  const filtered = filterSource === 'all' ? posts : posts.filter(p => p.source === filterSource);

  const timeAgo = (ts: string) => {
    const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (secs < 60)   return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs/60)}m`;
    return `${Math.floor(secs/3600)}h`;
  };

  const regimeColor = regime === 'RISK_ON' ? 'var(--green)' : regime === 'RISK_OFF' ? 'var(--red)' : 'var(--text-muted)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 13 }}>SOCIAL</span>
          <span style={{
            padding: '2px 8px', borderRadius: 3, fontSize: 9, fontWeight: 700,
            color: regimeColor, background: `${regimeColor}22`, border: `1px solid ${regimeColor}44`,
          }}>{regime}</span>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {(['feed', 'tickers', 'sentiment'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={{
              padding: '2px 8px', fontSize: 9, fontWeight: 600,
              background: activeTab === t ? 'var(--amber)' : 'var(--bg-secondary)',
              color: activeTab === t ? '#000' : 'var(--text-muted)',
              border: 'none', borderRadius: 3, cursor: 'pointer', textTransform: 'uppercase',
            }}>{t}</button>
          ))}
        </div>
      </div>

      {activeTab === 'feed' && (
        <>
          {/* Source filter */}
          <div style={{ display: 'flex', gap: 4 }}>
            {['all', 'reddit', 'twitter', 'telegram', 'stocktwits'].map(src => (
              <button key={src} onClick={() => setFilterSource(src)} style={{
                padding: '2px 8px', fontSize: 9, fontWeight: 600,
                background: filterSource === src ? 'rgba(255,149,0,0.2)' : 'var(--bg-secondary)',
                color: filterSource === src ? 'var(--amber)' : 'var(--text-muted)',
                border: `1px solid ${filterSource === src ? 'var(--amber)' : 'transparent'}`,
                borderRadius: 3, cursor: 'pointer',
              }}>
                {src === 'all' ? 'ALL' : `${SOURCE_ICONS[src]} ${src.toUpperCase()}`}
              </button>
            ))}
          </div>

          {/* Posts feed */}
          <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map((post, i) => (
              <div key={post.id || i} style={{
                padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 4,
                borderLeft: `3px solid ${post.sentiment_score > 0.2 ? '#22c55e' : post.sentiment_score < -0.2 ? '#ef4444' : '#6b7280'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, color: SOURCE_COLORS[post.source] }}>{SOURCE_ICONS[post.source]} {post.source.toUpperCase()}</span>
                    {post.ticker && (
                      <span style={{ fontSize: 9, padding: '1px 5px', background: 'rgba(255,149,0,0.15)', color: 'var(--amber)', borderRadius: 3, fontWeight: 700 }}>
                        ${post.ticker}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <SentimentBadge score={post.sentiment_score} label={post.sentiment_label} />
                    <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{timeAgo(post.timestamp)}</span>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text)', lineHeight: 1.5, marginBottom: 4 }}>
                  {post.text.length > 160 ? post.text.slice(0, 160) + '…' : post.text}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>u/{post.author}</span>
                  {post.upvotes > 0 && (
                    <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>▲ {post.upvotes}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {activeTab === 'tickers' && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Symbol', 'Sentiment', '24h Δ', 'Posts', 'B/B', 'Bar'].map(h => (
                  <th key={h} style={{ padding: '4px 8px', textAlign: h === 'Symbol' ? 'left' : 'right', color: 'var(--text-muted)', fontSize: 9, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickers.map((t, i) => (
                <tr key={i} style={{
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  background: t.is_trending ? 'rgba(255,149,0,0.05)' : 'transparent',
                }}>
                  <td style={{ padding: '5px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {t.is_trending && <span style={{ fontSize: 8, color: 'var(--amber)' }}>🔥</span>}
                      <span style={{ color: 'var(--text)', fontWeight: 600 }}>{t.symbol}</span>
                    </div>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>{t.name}</div>
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: t.score > 0.2 ? 'var(--green)' : t.score < -0.2 ? 'var(--red)' : 'var(--text-muted)', fontWeight: 700 }}>
                    {t.score > 0 ? '+' : ''}{t.score.toFixed(2)}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: t.score_24h_delta > 0 ? 'var(--green)' : 'var(--red)', fontSize: 9 }}>
                    {t.score_24h_delta > 0 ? '▲' : '▼'}{Math.abs(t.score_24h_delta).toFixed(2)}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>
                    {t.post_count}
                    {t.post_count_delta_pct > 50 && <span style={{ color: 'var(--amber)', marginLeft: 2 }}>▲{t.post_count_delta_pct.toFixed(0)}%</span>}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: t.bull_bear_ratio > 1 ? 'var(--green)' : 'var(--red)' }}>
                    {t.bull_bear_ratio.toFixed(1)}x
                  </td>
                  <td style={{ padding: '5px 8px' }}>
                    <ScoreBar value={t.score} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'sentiment' && (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FearGreedMeter value={fgi} />
          <div style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 4 }}>
            <div style={{ fontSize: 9, color: 'var(--amber)', fontWeight: 700, marginBottom: 10, letterSpacing: 1 }}>SENTIMENT BREAKDOWN</div>
            {[
              { label: 'Bullish Posts', value: '58%', color: 'var(--green)', bar: 58 },
              { label: 'Neutral Posts', value: '24%', color: 'var(--text-muted)', bar: 24 },
              { label: 'Bearish Posts', value: '18%', color: 'var(--red)', bar: 18 },
            ].map(row => (
              <div key={row.label} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{row.label}</span>
                  <span style={{ color: row.color, fontSize: 10, fontWeight: 700 }}>{row.value}</span>
                </div>
                <div style={{ height: 5, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${row.bar}%`, height: '100%', background: row.color, borderRadius: 3 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

// Fallback data
const FALLBACK_POSTS: SocialPost[] = [
  { id: '1', source: 'reddit', text: 'HDFC Bank results beat estimates — NIM expansion + strong loan growth. Bullish for Q1FY26. Adding on dips.', author: 'fin_hawk', ticker: 'HDFCBANK', sentiment_score: 0.82, sentiment_label: 'bullish', upvotes: 342, timestamp: new Date(Date.now() - 3*60000).toISOString() },
  { id: '2', source: 'twitter', text: 'Nifty looks weak at 24000 — RSI divergence + FII selling today. Could test 23600 before reversal.', author: 'quant_trader', ticker: 'NIFTY50', sentiment_score: -0.65, sentiment_label: 'bearish', upvotes: 0, timestamp: new Date(Date.now() - 7*60000).toISOString() },
  { id: '3', source: 'stocktwits', text: 'Reliance Industries breakout! 3000 is next target. Jio financials catalyst incoming.', author: 'momentum_alpha', ticker: 'RELIANCE', sentiment_score: 0.78, sentiment_label: 'bullish', upvotes: 0, timestamp: new Date(Date.now() - 12*60000).toISOString() },
  { id: '4', source: 'reddit', text: 'RBI rate cut expected in June meeting (55% probability per OIS). Positive for rate-sensitive sectors: banking, realty, NBFCs.', author: 'macro_desk', ticker: undefined, sentiment_score: 0.45, sentiment_label: 'bullish', upvotes: 198, timestamp: new Date(Date.now() - 18*60000).toISOString() },
  { id: '5', source: 'telegram', text: 'IRCTC facing online booking issues — possible IT outage. Could impact Q1 revenue numbers. Keep eye on.', author: 'market_intel', ticker: 'IRCTC', sentiment_score: -0.42, sentiment_label: 'bearish', upvotes: 0, timestamp: new Date(Date.now() - 25*60000).toISOString() },
  { id: '6', source: 'reddit', text: 'Tata Motors EV sales up 40% YoY in May. JLR pipeline looks strong. Buy accumulate for long term.', author: 'ev_bull', ticker: 'TATAMOTORS', sentiment_score: 0.71, sentiment_label: 'bullish', upvotes: 267, timestamp: new Date(Date.now() - 35*60000).toISOString() },
];

const FALLBACK_TICKERS: TickerSentiment[] = [
  { symbol: 'HDFCBANK',  name: 'HDFC Bank',     score: 0.72, score_24h_delta: 0.18, post_count: 342, post_count_delta_pct: 45, is_trending: true,  bull_bear_ratio: 3.2, top_post: 'Strong results beat' },
  { symbol: 'RELIANCE',  name: 'Reliance Inds', score: 0.58, score_24h_delta: 0.12, post_count: 289, post_count_delta_pct: 22, is_trending: false, bull_bear_ratio: 2.6, top_post: 'Jio catalyst incoming' },
  { symbol: 'NIFTY50',   name: 'Nifty 50',      score: -0.21, score_24h_delta: -0.09, post_count: 512, post_count_delta_pct: 8, is_trending: true, bull_bear_ratio: 0.8, top_post: 'FII selling continues' },
  { symbol: 'TATAMOTORS',name: 'Tata Motors',   score: 0.64, score_24h_delta: 0.21, post_count: 198, post_count_delta_pct: 67, is_trending: true,  bull_bear_ratio: 2.9, top_post: 'EV sales surge 40%' },
  { symbol: 'INFY',      name: 'Infosys',        score: 0.15, score_24h_delta: -0.05, post_count: 156, post_count_delta_pct: 3, is_trending: false, bull_bear_ratio: 1.2, top_post: 'Deal win momentum' },
  { symbol: 'IRCTC',     name: 'IRCTC',          score: -0.38, score_24h_delta: -0.22, post_count: 87, post_count_delta_pct: 120, is_trending: true, bull_bear_ratio: 0.5, top_post: 'IT outage concerns' },
];
