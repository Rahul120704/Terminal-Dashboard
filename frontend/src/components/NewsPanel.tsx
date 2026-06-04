/**
 * NewsPanel — Bloomberg NI/NS equivalent
 *
 * Three feed tabs:
 *  • MARKET NEWS  — all recent market news (24h)
 *  • STOCK NEWS   — ticker-tagged stories with impact analysis
 *  • EARNINGS     — results, Q-reports, concall, dividend announcements
 *  • SOCIAL       — high-sentiment / buzz-driven stories
 *
 * All feeds are ≤ 24 hours old by default.
 * Impact badge: HIGH / MEDIUM / LOW derived from FinBERT sentiment magnitude.
 * FRESH badge: < 1 hour old.
 */
import React, { useState, useMemo } from 'react';
import { NewsItem } from '../types';
import { useApiData } from '../hooks/useApi';

interface Props {
  ticker?: string;
  category?: string;
  liveItems?: NewsItem[];
  onSelectTicker?: (sym: string) => void;
}

interface TrendingItem {
  ticker: string; count: number; avg_sentiment: number;
  positive: number; negative: number;
}

type FeedTab = 'market' | 'stock' | 'earnings' | 'social';

function sentimentColor(s: number): string {
  if (s > 0.2) return 'var(--green)';
  if (s < -0.2) return 'var(--red)';
  return 'var(--text-secondary)';
}
function sentimentLabel(s: number): string {
  if (s > 0.4) return '▲▲';
  if (s > 0.1) return '▲';
  if (s < -0.4) return '▼▼';
  if (s < -0.1) return '▼';
  return '—';
}
function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  } catch { return ''; }
}

const IMPACT_COLOR: Record<string, string> = {
  HIGH:   '#ff3d00',
  MEDIUM: '#ff9500',
  LOW:    '#555',
};

const TABS: { id: FeedTab; label: string; icon: string }[] = [
  { id: 'market',   label: 'MARKET',   icon: '📰' },
  { id: 'stock',    label: 'STOCK',    icon: '🏷' },
  { id: 'earnings', label: 'EARNINGS', icon: '💰' },
  { id: 'social',   label: 'SOCIAL',   icon: '💬' },
];

export const NewsPanel: React.FC<Props> = ({ ticker, category, liveItems = [], onSelectTicker }) => {
  const [feedTab, setFeedTab]       = useState<FeedTab>(category === 'global' ? 'market' : 'market');
  const [sentFilter, setSentFilter] = useState<string>('all');
  const [search, setSearch]         = useState('');
  const [showTrending, setShowTrending] = useState(false);
  const [maxAge, setMaxAge]         = useState<number>(24);

  // ── REST fetch: single active URL derived from tab + filters ────────────
  // Using one hook that changes URL on tab/filter change is cleaner than 4
  // parallel hooks with null suppression — avoids stale data from inactive hooks.
  const activeUrl = useMemo(() => {
    const t = ticker ? `&ticker=${encodeURIComponent(ticker)}` : '';
    if (feedTab === 'market') {
      const cat = category ? `&category=${encodeURIComponent(category)}` : '';
      return `/api/news?limit=100&max_age_hours=${maxAge}${t}${cat}`;
    }
    if (feedTab === 'stock')    return `/api/news/typed?news_type=stock&limit=100&max_age_hours=${maxAge}${t}`;
    if (feedTab === 'earnings') return `/api/news/typed?news_type=earnings&limit=100&max_age_hours=${Math.max(maxAge, 72)}${t}`;
    if (feedTab === 'social')   return `/api/news/typed?news_type=social&limit=100&max_age_hours=${maxAge}${t}`;
    return `/api/news?limit=100&max_age_hours=${maxAge}${t}`;
  }, [feedTab, ticker, category, maxAge]);

  const { data: restNews, loading: newsLoading } = useApiData<any[]>(activeUrl, 30000, 0); // TTL=0 → always fresh
  const { data: trending } = useApiData<TrendingItem[]>('/api/news/trending', 60000);

  // ── Merge live WS items with REST data ───────────────────────────────────
  const rawFeed = useMemo(() => {
    const base: any[] = restNews || [];
    // prepend live WS items (always fresh)
    const combined = [...liveItems, ...base];
    const seen = new Set<string>();
    return combined.filter(item => {
      const key = (item.headline || '').slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [restNews, liveItems]);

  // ── Local filters ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let items = rawFeed;
    if (sentFilter === 'positive') items = items.filter(n => (n.sentiment || 0) > 0.1);
    else if (sentFilter === 'negative') items = items.filter(n => (n.sentiment || 0) < -0.1);
    if (search) {
      const s = search.toLowerCase();
      items = items.filter(n =>
        (n.headline + ' ' + (n.ticker || '')).toLowerCase().includes(s)
      );
    }
    return items;
  }, [rawFeed, sentFilter, search]);

  // Counts per tab for badges
  const freshCount = useMemo(() => filtered.filter(n => n.fresh).length, [filtered]);

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="panel-header" style={{ flexWrap: 'wrap', height: 'auto', minHeight: 28, gap: 3 }}>
        <span className="panel-title">
          {ticker ? `${ticker} — NEWS` : category ? `${category.toUpperCase()} NEWS` : 'NEWS FEED'}
        </span>
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter news…"
            style={{ fontSize: 10, width: 110, height: 20, background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '0 6px' }}
          />
          <select value={sentFilter} onChange={e => setSentFilter(e.target.value)}
            style={{ fontSize: 9, height: 20, background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            <option value="all">All Sentiment</option>
            <option value="positive">▲ Bullish</option>
            <option value="negative">▼ Bearish</option>
          </select>
          <select value={maxAge} onChange={e => setMaxAge(Number(e.target.value))}
            style={{ fontSize: 9, height: 20, background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            <option value={1}>1h</option>
            <option value={6}>6h</option>
            <option value={24}>24h</option>
            <option value={72}>3d</option>
          </select>
          <button
            className={`btn ${showTrending ? 'btn-amber' : ''}`}
            onClick={() => setShowTrending(v => !v)}
            style={{ padding: '1px 5px', fontSize: 9 }}
          >
            🔥 TRENDING
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {newsLoading && <div className="spinner" style={{ width: 10, height: 10, flexShrink: 0 }} />}
          {freshCount > 0 && (
            <span style={{ fontSize: 8, background: 'var(--green)', color: '#000', padding: '0 4px', fontWeight: 700, borderRadius: 2 }}>
              {freshCount} FRESH
            </span>
          )}
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{filtered.length}</span>
        </div>
      </div>

      {/* ── Feed tabs ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 0, background: '#0d0d0d', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setFeedTab(t.id)}
            style={{
              flex: 1, padding: '5px 4px', border: 'none', cursor: 'pointer',
              fontSize: 9, fontWeight: 700, fontFamily: 'Consolas, monospace',
              background: feedTab === t.id ? 'var(--bg-secondary)' : 'transparent',
              color: feedTab === t.id ? 'var(--amber)' : 'var(--text-muted)',
              borderBottom: feedTab === t.id ? '2px solid var(--amber)' : '2px solid transparent',
              transition: 'color 0.15s',
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab description strip ───────────────────────────────────────── */}
      {feedTab !== 'market' && (
        <div style={{ padding: '3px 8px', background: 'rgba(255,149,0,0.04)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
            {feedTab === 'stock'    && '🏷 Ticker-tagged stock-specific news — impact analysis per item'}
            {feedTab === 'earnings' && '💰 Q-results, EPS surprises, concall, dividend announcements (72h window)'}
            {feedTab === 'social'   && '💬 High-sentiment buzz stories — social noise indicator'}
          </span>
        </div>
      )}

      {/* ── Trending tickers ────────────────────────────────────────────── */}
      {showTrending && trending && (
        <div style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,149,0,0.03)', flexShrink: 0, overflowX: 'auto' }}>
          <div style={{ display: 'flex', padding: '4px 6px', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: 'var(--amber)', fontWeight: 700, whiteSpace: 'nowrap' }}>TRENDING 24H:</span>
            {trending.slice(0, 14).map(t => (
              <div
                key={t.ticker}
                onClick={() => onSelectTicker?.(t.ticker)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', whiteSpace: 'nowrap',
                  padding: '1px 5px', background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                }}
              >
                <span style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700 }}>{t.ticker}</span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{t.count}</span>
                <span style={{ fontSize: 9, color: sentimentColor(t.avg_sentiment) }}>
                  {sentimentLabel(t.avg_sentiment)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── News list ───────────────────────────────────────────────────── */}
      <div className="panel-body" style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 11, textAlign: 'center' }}>
            No {feedTab === 'earnings' ? 'earnings' : feedTab === 'social' ? 'social' : ''} news in the last {maxAge}h matching filters
          </div>
        ) : (
          filtered.map((item, i) => {
            const impact = item.impact || 'LOW';
            return (
              <div
                key={item.id ?? i}
                style={{
                  padding: '5px 8px', borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  borderLeft: `2px solid ${impact === 'HIGH' ? '#ff3d00' : impact === 'MEDIUM' ? '#ff9500' : 'transparent'}`,
                }}
                onClick={() => item.url && window.open(item.url, '_blank')}
              >
                {/* Meta row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
                    {item.fresh && (
                      <span style={{ fontSize: 7, background: 'var(--green)', color: '#000', padding: '0 3px', fontWeight: 900, borderRadius: 1 }}>
                        FRESH
                      </span>
                    )}
                    {item.ticker && (
                      <span
                        style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', background: 'rgba(255,149,0,0.1)', color: 'var(--amber)', border: '1px solid var(--amber-dim)', cursor: 'pointer' }}
                        onClick={e => { e.stopPropagation(); onSelectTicker?.(item.ticker!); }}
                      >
                        {item.ticker}
                      </span>
                    )}
                    {item.category && (
                      <span style={{ fontSize: 8, color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '0 3px' }}>
                        {item.category.toUpperCase()}
                      </span>
                    )}
                    <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{item.source}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    {/* Impact badge */}
                    <span style={{
                      fontSize: 7, fontWeight: 700, padding: '0 3px', borderRadius: 1,
                      color: IMPACT_COLOR[impact] || '#555',
                      border: `1px solid ${IMPACT_COLOR[impact] || '#333'}44`,
                    }}>
                      {impact}
                    </span>
                    <span style={{ color: sentimentColor(item.sentiment), fontSize: 10, fontWeight: 700 }}>
                      {sentimentLabel(item.sentiment)}
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                      {timeAgo(item.created_at || item.published_at)}
                    </span>
                  </div>
                </div>

                {/* Headline */}
                <div style={{ fontSize: 11, lineHeight: 1.4, color: 'var(--text-primary)' }}>
                  {item.headline}
                </div>

                {/* Summary (earnings tab: show more detail) */}
                {item.summary && (
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2, maxHeight: feedTab === 'earnings' ? 48 : 28, overflow: 'hidden' }}>
                    {item.summary.slice(0, feedTab === 'earnings' ? 220 : 140)}
                    {item.summary.length > (feedTab === 'earnings' ? 220 : 140) ? '…' : ''}
                  </div>
                )}

                {/* Earnings tab: show surprise data if available */}
                {feedTab === 'earnings' && (item.eps_surprise != null || item.rev_surprise != null) && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    {item.eps_surprise != null && (
                      <span style={{ fontSize: 9, color: Number(item.eps_surprise) >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                        EPS {Number(item.eps_surprise) >= 0 ? '+' : ''}{Number(item.eps_surprise).toFixed(1)}% vs est.
                      </span>
                    )}
                    {item.rev_surprise != null && (
                      <span style={{ fontSize: 9, color: Number(item.rev_surprise) >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                        Rev {Number(item.rev_surprise) >= 0 ? '+' : ''}{Number(item.rev_surprise).toFixed(1)}% vs est.
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
