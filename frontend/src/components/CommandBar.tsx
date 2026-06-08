/**
 * Bloomberg-style Command Bar
 * Hotkey: Press ` (backtick) or click the CMD> prompt to activate.
 * Commands: "RELIANCE <EQUITY> FA", "NIFTY <INDEX> GP", etc.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

interface CommandBarProps {
  onSelectTicker: (sym: string) => void;
  onNavigate: (view: string) => void;
  selectedTicker: string;
}

interface CommandHistory {
  cmd: string;
  result: string;
  time: string;
}

// Bloomberg-style command routing
// Pattern: [SYMBOL] <ASSET_CLASS> [FUNCTION]
// e.g. "RELIANCE <EQUITY> FA" → fundamentals for RELIANCE
// e.g. "NIFTY <INDEX> GP" → chart for NIFTY

type Cmd = {
  pattern: RegExp;
  handler: (match: RegExpMatchArray, ctx: { ticker: string }) => { view: string; ticker?: string; desc: string };
};

const COMMANDS: Cmd[] = [
  // FA — Financial Analysis
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*fa$/i, handler: (m) => ({ view: 'fundamentals', ticker: m[1], desc: 'Financial Analysis' }) },
  // DES — Company Description
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*des$/i, handler: (m) => ({ view: 'company-overview', ticker: m[1], desc: 'Company Overview (DES)' }) },
  // CN — Company News
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*cn$/i, handler: (m) => ({ view: 'news', ticker: m[1], desc: 'Company News' }) },
  // GP — Chart/Graph
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq|<index>|idx)?\s*gp$/i, handler: (m) => ({ view: 'chart', ticker: m[1], desc: 'Graph/Chart' }) },
  // RV — Relative Value (Peers)
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*rv$/i, handler: (m) => ({ view: 'peers', ticker: m[1], desc: 'Relative Value (Peers)' }) },
  // OMON — Options Monitor
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*omon$/i, handler: (m) => ({ view: 'options', ticker: m[1], desc: 'Options Monitor' }) },
  // EV — Earnings/Events
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*ev$/i, handler: (m) => ({ view: 'earnings', ticker: m[1], desc: 'Events/Earnings' }) },
  // FISC — Filings
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*fisc$/i, handler: (m) => ({ view: 'filings', ticker: m[1], desc: 'Filings' }) },
  // OWN — Ownership/Shareholding
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*own$/i, handler: (m) => ({ view: 'shareholding', ticker: m[1], desc: 'Ownership/Shareholding' }) },
  // MGMT — Management
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*mgmt$/i, handler: (m) => ({ view: 'company-overview', ticker: m[1], desc: 'Management' }) },
  // DDIS — Dividend/Corporate Actions
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*ddis$/i, handler: (m) => ({ view: 'corp-actions', ticker: m[1], desc: 'Dividends & Corporate Actions' }) },
  // DCF — Discounted Cash Flow
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*dcf$/i, handler: (m) => ({ view: 'dcf', ticker: m[1], desc: 'DCF Valuation' }) },
  // SRCH / EQS — Screener
  { pattern: /^(?:srch|eqs)$/i, handler: () => ({ view: 'screener', desc: 'Equity Screener' }) },
  // NEWS — News Feed
  { pattern: /^(?:news|n)$/i, handler: () => ({ view: 'news', desc: 'News Feed' }) },
  // MACRO — Macro Dashboard
  { pattern: /^(?:macro|macro\s+dashboard)$/i, handler: () => ({ view: 'macro', desc: 'Macro Dashboard' }) },
  // YIELD — Yield Curve
  { pattern: /^(?:yield|yc|gcurve)$/i, handler: () => ({ view: 'yield-curve', desc: 'Yield Curve' }) },
  // FII / DII
  { pattern: /^(?:fii|dii|fiidii)$/i, handler: () => ({ view: 'fii-dii', desc: 'FII/DII Flows' }) },
  // VOL — Volume
  { pattern: /^(?:vol|volume|vshock)$/i, handler: () => ({ view: 'volume', desc: 'Volume Shockers' }) },
  // HM — Heatmap
  { pattern: /^(?:hm|heat|sector)$/i, handler: () => ({ view: 'sector', desc: 'Sector Heatmap' }) },
  // PORT — Portfolio
  { pattern: /^(?:port|portfolio)$/i, handler: () => ({ view: 'portfolio', desc: 'Portfolio' }) },
  // WLST — Watchlist
  { pattern: /^(?:wlst|watchlist|watch)$/i, handler: () => ({ view: 'watchlist', desc: 'Watchlist' }) },
  // INSIDER
  { pattern: /^(?:inside|insider|insiders)$/i, handler: () => ({ view: 'insider', desc: 'Insider Activity' }) },
  // DASH — Dashboard
  { pattern: /^(?:dash|home|start)$/i, handler: () => ({ view: 'dashboard', desc: 'Dashboard' }) },
  // AI — Copilot
  { pattern: /^(?:ai|copilot|gpt|llm)$/i, handler: () => ({ view: 'copilot', desc: 'AI Copilot' }) },
  // TECH — Technicals
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*(?:tech|ta|rsi)$/i, handler: (m) => ({ view: 'technicals', ticker: m[1], desc: 'Technical Analysis' }) },
  // IV — IV Surface
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*(?:iv|ivol|surface)$/i, handler: (m) => ({ view: 'ivsurf', ticker: m[1], desc: 'IV Surface' }) },
  // DELIVERY
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*(?:del|delivery)$/i, handler: (m) => ({ view: 'delivery', ticker: m[1], desc: 'Delivery Volume' }) },
  // BLOCK
  { pattern: /^(?:block|bulk|deals)$/i, handler: () => ({ view: 'block-deals', desc: 'Block/Bulk Deals' }) },
  // BEST / ANALYST — Analyst Estimates
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*(?:best|ee|analyst|estimates?)$/i, handler: (m) => ({ view: 'analyst', ticker: m[1], desc: 'Analyst Estimates (BEST)' }) },
  // BMAP / BREADTH — Market Breadth
  { pattern: /^(?:bmap|breadth|mmap|advance|ad\s*line)$/i, handler: () => ({ view: 'breadth', desc: 'Market Breadth (BMAP)' }) },
  // EVTS / CONCALL — Earnings Events & Concalls
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*(?:evts?|concall|ev2|results?)$/i, handler: (m) => ({ view: 'concall', ticker: m[1], desc: 'Earnings Events (EVTS)' }) },
  // CRYP — Crypto Dashboard
  { pattern: /^(?:cryp|crypto|btc|bitcoin|defi)$/i, handler: () => ({ view: 'crypto', desc: 'Crypto Dashboard (CRYP)' }) },
  // WFX / FXC — FX Cross Matrix
  { pattern: /^(?:wfx|fxc|fxmatrix|fx\s*matrix|forex)$/i, handler: () => ({ view: 'fx-matrix', desc: 'FX Cross-Currency Matrix (WFX)' }) },
  // ESG — ESG Scores
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*(?:esg|sustain|green)$/i, handler: (m) => ({ view: 'esg', ticker: m[1], desc: 'ESG Scores' }) },
  // WACC — WACC Calculator
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*(?:wacc|capm|cost.of.capital)$/i, handler: (m) => ({ view: 'wacc', ticker: m[1], desc: 'WACC Calculator' }) },
  // SPLC — Supply Chain
  { pattern: /^(\w[\w&.-]*)?\s*(?:<equity>|eq)?\s*(?:splc|supply|chain|supplier)$/i, handler: (m) => ({ view: 'splc', ticker: m[1], desc: 'Supply Chain (SPLC)' }) },
];

const QUICK_CMDS = [
  { label: 'FA', desc: 'Financials' },
  { label: 'DES', desc: 'Company' },
  { label: 'RV', desc: 'Peers' },
  { label: 'GP', desc: 'Chart' },
  { label: 'OMON', desc: 'Options' },
  { label: 'OWN', desc: 'Shareholding' },
  { label: 'DCF', desc: 'DCF' },
  { label: 'EV', desc: 'Earnings' },
  { label: 'SRCH', desc: 'Screener' },
  { label: 'NEWS', desc: 'News' },
  { label: 'YIELD', desc: 'Yield Curve' },
  { label: 'FII', desc: 'FII/DII' },
  { label: 'MACRO', desc: 'Macro' },
  { label: 'CRYP', desc: 'Crypto' },
  { label: 'WFX', desc: 'FX Matrix' },
  { label: 'ESG', desc: 'ESG' },
  { label: 'WACC', desc: 'WACC' },
  { label: 'SPLC', desc: 'Supply Chain' },
  { label: 'INSIDER', desc: 'Insiders' },
  { label: 'BEST', desc: 'Analyst Est.' },
  { label: 'TECH', desc: 'Technicals' },
  { label: 'DDIS', desc: 'Corp Actions' },
  { label: 'BLOCK', desc: 'Block Deals' },
];

function parseCommand(input: string, currentTicker: string): { view: string; ticker: string; desc: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  for (const cmd of COMMANDS) {
    const match = trimmed.match(cmd.pattern);
    if (match) {
      const result = cmd.handler(match, { ticker: currentTicker });
      return {
        view: result.view,
        ticker: result.ticker?.toUpperCase() || currentTicker,
        desc: result.desc,
      };
    }
  }

  // If just a ticker symbol, navigate to chart
  if (/^[A-Z0-9&.-]{1,20}$/i.test(trimmed) && trimmed.length <= 20) {
    return { view: 'chart', ticker: trimmed.toUpperCase(), desc: `Chart: ${trimmed.toUpperCase()}` };
  }

  return null;
}

interface SearchResult {
  symbol: string;
  name: string;
  exchange?: string;
  price?: number;
  change_pct?: number;
  sector?: string;
}

export const CommandBar: React.FC<CommandBarProps> = ({ onSelectTicker, onNavigate, selectedTicker }) => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<CommandHistory[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [preview, setPreview] = useState<{ view: string; ticker: string; desc: string } | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedResult, setSelectedResult] = useState(-1);
  const [searchLoading, setSearchLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hotkey: backtick to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '`' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        setInput('');
        setPreview(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Live preview as user types
  useEffect(() => {
    const parsed = parseCommand(input, selectedTicker);
    setPreview(parsed);
  }, [input, selectedTicker]);

  // Ticker autocomplete search — debounced 200ms
  // Only fires when input looks like a bare ticker (no command suffix, no spaces mid-word)
  const isTickerSearch = useMemo(() => {
    const t = input.trim();
    return t.length >= 1 && /^[A-Z0-9&.-]{1,20}$/i.test(t) && !parseCommand(t, selectedTicker);
  }, [input, selectedTicker]);

  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (!isTickerSearch || input.trim().length < 1) {
      setSearchResults([]);
      setSelectedResult(-1);
      return;
    }
    setSearchLoading(true);
    searchDebounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(input.trim())}&limit=8`);
        if (res.ok) {
          const data: SearchResult[] = await res.json();
          setSearchResults(data);
        }
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
        setSelectedResult(-1);
      }
    }, 200);
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
  }, [input, isTickerSearch]);

  const selectSearchResult = useCallback((result: SearchResult) => {
    onSelectTicker(result.symbol);
    setHistory(prev => [{
      cmd: result.symbol,
      result: `→ Chart [${result.symbol}] ${result.name}`,
      time: new Date().toLocaleTimeString('en-IN', { hour12: false }),
    }, ...prev].slice(0, 50));
    setTimeout(() => onNavigate('chart'), 80);
    setInput('');
    setSearchResults([]);
    setPreview(null);
    setSelectedResult(-1);
    setOpen(false);
  }, [onSelectTicker, onNavigate]);

  const execute = useCallback(() => {
    // If a search result is highlighted, select it
    if (searchResults.length > 0 && selectedResult >= 0) {
      selectSearchResult(searchResults[selectedResult]);
      return;
    }
    // If search results visible and no highlight, pick first
    if (searchResults.length > 0 && isTickerSearch) {
      selectSearchResult(searchResults[0]);
      return;
    }
    if (!preview) return;
    const { view, ticker, desc } = preview;

    if (ticker && ticker !== selectedTicker) {
      onSelectTicker(ticker);
    }
    // Small delay if ticker changed so component rerenders
    setTimeout(() => onNavigate(view), ticker !== selectedTicker ? 100 : 0);

    setHistory(prev => [{
      cmd: input,
      result: `→ ${desc}${ticker ? ` [${ticker}]` : ''}`,
      time: new Date().toLocaleTimeString('en-IN', { hour12: false }),
    }, ...prev].slice(0, 50));
    setInput('');
    setPreview(null);
    setHistoryIdx(-1);
    setOpen(false);
  }, [preview, input, selectedTicker, onSelectTicker, onNavigate, searchResults, selectedResult, isTickerSearch, selectSearchResult]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Arrow navigation in search results
    if (searchResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedResult(i => Math.min(i + 1, searchResults.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedResult(i => Math.max(i - 1, -1));
        return;
      }
      if (e.key === 'Tab' && searchResults[0]) {
        e.preventDefault();
        setInput(searchResults[selectedResult >= 0 ? selectedResult : 0].symbol + ' ');
        setSearchResults([]);
        return;
      }
    }
    if (e.key === 'Enter') {
      execute();
    } else if (e.key === 'ArrowUp' && searchResults.length === 0) {
      e.preventDefault();
      const newIdx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(newIdx);
      if (history[newIdx]) setInput(history[newIdx].cmd);
    } else if (e.key === 'ArrowDown' && searchResults.length === 0) {
      e.preventDefault();
      const newIdx = Math.max(historyIdx - 1, -1);
      setHistoryIdx(newIdx);
      setInput(newIdx === -1 ? '' : (history[newIdx]?.cmd || ''));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setInput('');
    }
  };

  const quickCmd = (label: string) => {
    const cmd = `${selectedTicker} ${label}`;
    setInput(cmd);
    const parsed = parseCommand(cmd, selectedTicker);
    if (parsed) {
      if (parsed.ticker && parsed.ticker !== selectedTicker) onSelectTicker(parsed.ticker);
      setTimeout(() => onNavigate(parsed.view), 50);
    }
    setOpen(false);
  };

  if (!open) {
    return (
      <div
        onClick={() => setOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, cursor: 'text',
          background: 'rgba(255,149,0,0.06)', border: '1px solid rgba(255,149,0,0.2)',
          borderRadius: 2, padding: '2px 8px', userSelect: 'none',
        }}
        title="Click or press ` to open Bloomberg command bar"
      >
        <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 11, fontFamily: 'monospace' }}>CMD&gt;</span>
        <span style={{ color: '#555', fontSize: 10, fontFamily: 'monospace' }}>
          {selectedTicker} <span style={{ color: '#444' }}>_ type or press `</span>
        </span>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.85)', zIndex: 9999,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: 80,
    }}
      onClick={(e) => { if (e.target === e.currentTarget) { setOpen(false); setInput(''); } }}
    >
      <div style={{
        background: '#0a0a0a', border: '1px solid #ff9500',
        borderRadius: 3, width: 700, maxWidth: '95vw',
        boxShadow: '0 0 60px rgba(255,149,0,0.3)',
        overflow: 'hidden',
      }}>
        {/* Command input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid #222' }}>
          <span style={{ color: 'var(--amber)', fontWeight: 900, fontFamily: 'monospace', fontSize: 14, flexShrink: 0 }}>CMD&gt;</span>
          <input
            ref={inputRef}
            value={input}
            onChange={e => { setInput(e.target.value.toUpperCase()); setHistoryIdx(-1); }}
            onKeyDown={handleKeyDown}
            placeholder={`${selectedTicker} FA  |  SRCH  |  YIELD  |  FII  |  type any command…`}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: '#fff', fontFamily: 'monospace', fontSize: 15, letterSpacing: 1,
            }}
          />
          {preview && (
            <button onClick={execute} style={{
              background: 'var(--amber)', color: '#000', border: 'none',
              padding: '3px 10px', fontFamily: 'monospace', fontSize: 11,
              fontWeight: 700, cursor: 'pointer', borderRadius: 2,
            }}>GO</button>
          )}
        </div>

        {/* Preview */}
        {preview && (
          <div style={{
            padding: '6px 14px', background: 'rgba(255,149,0,0.07)',
            borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ color: '#555', fontSize: 10 }}>→</span>
            <span style={{ color: 'var(--amber)', fontSize: 12, fontWeight: 700 }}>{preview.desc}</span>
            {preview.ticker && (
              <span style={{ color: '#aaa', fontSize: 11, fontFamily: 'monospace' }}>[{preview.ticker}]</span>
            )}
            <span style={{ marginLeft: 'auto', color: '#555', fontSize: 10 }}>↵ ENTER to execute</span>
          </div>
        )}

        {/* Ticker Search Results */}
        {(searchResults.length > 0 || searchLoading) && (
          <div style={{ borderBottom: '1px solid #222' }}>
            {searchLoading && searchResults.length === 0 && (
              <div style={{ padding: '6px 14px', color: '#555', fontSize: 10, fontFamily: 'monospace' }}>Searching…</div>
            )}
            {searchResults.map((r, i) => {
              const chg = r.change_pct ?? 0;
              const color = chg > 0 ? '#26d97f' : chg < 0 ? '#ff453a' : '#888';
              return (
                <div
                  key={r.symbol}
                  onClick={() => selectSearchResult(r)}
                  onMouseEnter={() => setSelectedResult(i)}
                  style={{
                    padding: '6px 14px',
                    display: 'flex', alignItems: 'center', gap: 10,
                    cursor: 'pointer',
                    background: selectedResult === i ? 'rgba(255,149,0,0.12)' : 'transparent',
                    borderLeft: selectedResult === i ? '2px solid var(--amber)' : '2px solid transparent',
                    transition: 'background 0.1s',
                  }}
                >
                  <span style={{ color: 'var(--amber)', fontWeight: 800, fontFamily: 'monospace', fontSize: 12, width: 120, flexShrink: 0 }}>{r.symbol}</span>
                  <span style={{ color: '#bbb', fontSize: 11, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                  {r.exchange && <span style={{ color: '#555', fontSize: 9, flexShrink: 0 }}>{r.exchange}</span>}
                  {r.price != null && (
                    <span style={{ color: '#ddd', fontFamily: 'monospace', fontSize: 11, flexShrink: 0 }}>
                      ₹{r.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  )}
                  {r.change_pct != null && (
                    <span style={{ color, fontFamily: 'monospace', fontSize: 11, fontWeight: 700, flexShrink: 0, width: 60, textAlign: 'right' }}>
                      {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
                    </span>
                  )}
                </div>
              );
            })}
            <div style={{ padding: '3px 14px', fontSize: 9, color: '#444', fontFamily: 'monospace' }}>
              ↵ select · TAB autocomplete · ↑↓ navigate
            </div>
          </div>
        )}

        {/* Quick commands */}
        <div style={{ padding: '8px 14px', borderBottom: '1px solid #1a1a1a' }}>
          <div style={{ fontSize: 9, color: '#555', marginBottom: 5, fontFamily: 'monospace' }}>
            QUICK COMMANDS FOR {selectedTicker}:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {QUICK_CMDS.map(({ label, desc }) => (
              <button
                key={label}
                onClick={() => quickCmd(label)}
                style={{
                  background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.2)',
                  color: 'var(--amber)', fontFamily: 'monospace', fontSize: 10,
                  padding: '2px 7px', cursor: 'pointer', borderRadius: 2,
                }}
                title={desc}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Command history */}
        {history.length > 0 && (
          <div style={{ maxHeight: 200, overflowY: 'auto', padding: '6px 0' }}>
            {history.slice(0, 8).map((h, i) => (
              <div
                key={i}
                onClick={() => setInput(h.cmd)}
                style={{
                  padding: '3px 14px', display: 'flex', alignItems: 'center', gap: 10,
                  cursor: 'pointer', transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#111')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <span style={{ color: '#444', fontSize: 9, fontFamily: 'monospace', flexShrink: 0 }}>{h.time}</span>
                <span style={{ color: '#888', fontFamily: 'monospace', fontSize: 11 }}>{h.cmd}</span>
                <span style={{ color: '#555', fontSize: 10, marginLeft: 'auto' }}>{h.result}</span>
              </div>
            ))}
          </div>
        )}

        {/* Help footer */}
        <div style={{
          padding: '6px 14px', borderTop: '1px solid #111', fontSize: 9,
          color: '#444', fontFamily: 'monospace',
          display: 'flex', gap: 16,
        }}>
          <span>ESC close</span>
          <span>↑↓ history</span>
          <span>ENTER execute</span>
          <span style={{ marginLeft: 'auto' }}>RELIANCE FA · NIFTY GP · SRCH · YIELD · FII · MACRO</span>
        </div>
      </div>
    </div>
  );
};

export default CommandBar;
