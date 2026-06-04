/**
 * MnemonicCLI — Bloomberg Terminal-style command input bar
 *
 * Parses inputs of the form:
 *   DES                      → load DES panel, current ticker
 *   GP RELIANCE              → load GP panel, change ticker to RELIANCE
 *   RELIANCE IN Equity       → change ticker only
 *   YCRV                     → load yield curve panel
 *   HELP                     → show command help overlay
 *
 * Grammar (case-insensitive):
 *   command := MNEMONIC [TICKER] | TICKER | HELP
 *   TICKER  := NSE_SYMBOL [" IN" [" Equity"|" Index"]]
 */

import React, {
  useState, useRef, useEffect, useCallback, memo,
} from 'react';
import { ALL_MNEMONICS, search, resolve, REGISTRY } from '../mfe/registry';
import { eventBus } from '../mfe/bus';

// ── Types ──────────────────────────────────────────────────────────────────────
interface MnemonicCLIProps {
  activeTicker: string;
  activeMnemonic: string;
  onMnemonicExec: (mnemonic: string, ticker?: string) => void;
  onTickerChange: (ticker: string) => void;
  className?: string;
}

interface Suggestion {
  type: 'mnemonic' | 'ticker';
  value: string;
  label: string;
  description?: string;
}

// ── Parser ─────────────────────────────────────────────────────────────────────
interface ParseResult {
  mnemonic?: string;
  ticker?: string;
  args: string[];
  raw: string;
}

function parseInput(raw: string): ParseResult {
  const parts = raw.trim().toUpperCase().split(/\s+/);
  if (!parts.length || !parts[0]) return { args: [], raw };

  const first = parts[0];
  const isMnemonic = !!REGISTRY[first];

  if (isMnemonic) {
    // DES RELIANCE  |  DES
    const ticker = parts[1] && !REGISTRY[parts[1]] ? parts[1] : undefined;
    return { mnemonic: first, ticker, args: parts.slice(1), raw };
  }

  // RELIANCE IN EQUITY → ticker-only change
  const ticker = parts[0];
  return { ticker, args: parts.slice(1), raw };
}

// ── Main component ─────────────────────────────────────────────────────────────
export const MnemonicCLI = memo(function MnemonicCLI({
  activeTicker,
  activeMnemonic,
  onMnemonicExec,
  onTickerChange,
  className = '',
}: MnemonicCLIProps) {
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [showHelp, setShowHelp] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global keyboard shortcut: Enter anywhere in the terminal focuses the CLI
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setInputValue('');
        setSuggestions([]);
        setShowHelp(false);
        (document.activeElement as HTMLElement)?.blur();
        return;
      }
      // Any printable key refocuses CLI (Bloomberg UX)
      const target = e.target as HTMLElement;
      const isEditable =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;
      if (!isEditable && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Build suggestions from current input
  const updateSuggestions = useCallback((val: string) => {
    if (!val.trim()) { setSuggestions([]); return; }
    const q = val.toUpperCase().trim();
    const matches = search(q).slice(0, 8).map<Suggestion>(e => ({
      type: 'mnemonic',
      value: e.metadata.mnemonic,
      label: e.metadata.mnemonic,
      description: e.metadata.description,
    }));
    setSuggestions(matches);
    setSelectedIdx(-1);
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    setHistoryIdx(-1);
    updateSuggestions(val);
    setShowHelp(false);
  }, [updateSuggestions]);

  const execute = useCallback((raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    if (trimmed.toUpperCase() === 'HELP') {
      setShowHelp(s => !s);
      setInputValue('');
      setSuggestions([]);
      return;
    }

    const parsed = parseInput(trimmed);

    if (parsed.mnemonic) {
      const targetTicker = parsed.ticker ?? activeTicker;
      onMnemonicExec(parsed.mnemonic, targetTicker);
      eventBus.emit('MNEMONIC_EXEC', {
        mnemonic: parsed.mnemonic,
        args: parsed.args,
        rawInput: trimmed,
      });
      if (parsed.ticker) {
        onTickerChange(parsed.ticker);
        eventBus.emit('TICKER_CHANGE', {
          ticker: parsed.ticker,
          source: 'CLI',
        });
      }
    } else if (parsed.ticker) {
      onTickerChange(parsed.ticker);
      eventBus.emit('TICKER_CHANGE', {
        ticker: parsed.ticker,
        source: 'CLI',
      });
    }

    setHistory(h => [trimmed, ...h.slice(0, 49)]);
    setHistoryIdx(-1);
    setInputValue('');
    setSuggestions([]);
    setShowHelp(false);
  }, [activeTicker, onMnemonicExec, onTickerChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val =
        selectedIdx >= 0 && suggestions[selectedIdx]
          ? suggestions[selectedIdx].value
          : inputValue;
      execute(val);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, suggestions.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestions.length > 0) {
        setSelectedIdx(i => Math.max(i - 1, -1));
      } else {
        // History navigation
        const nextIdx = historyIdx + 1;
        if (nextIdx < history.length) {
          setHistoryIdx(nextIdx);
          setInputValue(history[nextIdx]);
        }
      }
      return;
    }
    if (e.key === 'Tab' && suggestions.length > 0) {
      e.preventDefault();
      const idx = selectedIdx >= 0 ? selectedIdx : 0;
      setInputValue(suggestions[idx].value);
      setSuggestions([]);
      return;
    }
    if (e.key === 'Escape') {
      if (suggestions.length > 0) { setSuggestions([]); return; }
      setInputValue('');
    }
  }, [execute, inputValue, suggestions, selectedIdx, historyIdx, history]);

  const handleSuggestionClick = useCallback((val: string) => {
    execute(val);
  }, [execute]);

  return (
    <div className={`mnemonic-cli ${className}`} style={styles.container}>
      {/* ── Breadcrumb context ─────────────────────────────────────────────── */}
      <div style={styles.context}>
        <span style={styles.ctxTicker}>{activeTicker}</span>
        {activeMnemonic && (
          <>
            <span style={styles.ctxSep}>&lt;GO&gt;</span>
            <span style={styles.ctxMnemonic}>{activeMnemonic}</span>
          </>
        )}
      </div>

      {/* ── Input ──────────────────────────────────────────────────────────── */}
      <div style={styles.inputWrap}>
        <span style={styles.prompt}>▶</span>
        <input
          ref={inputRef}
          value={inputValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="TYPE MNEMONIC OR TICKER..."
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          style={styles.input}
          aria-label="Bloomberg command input"
          aria-haspopup="listbox"
          aria-expanded={suggestions.length > 0}
        />
        {inputValue && (
          <button
            onClick={() => { setInputValue(''); setSuggestions([]); }}
            style={styles.clear}
            tabIndex={-1}
            aria-label="Clear input"
          >
            ×
          </button>
        )}
      </div>

      {/* ── Autocomplete dropdown ──────────────────────────────────────────── */}
      {suggestions.length > 0 && (
        <ul style={styles.suggestions} role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={s.value}
              role="option"
              aria-selected={i === selectedIdx}
              style={{
                ...styles.suggItem,
                ...(i === selectedIdx ? styles.suggItemActive : {}),
              }}
              onMouseDown={(e) => { e.preventDefault(); handleSuggestionClick(s.value); }}
            >
              <span style={styles.suggMnemonic}>{s.label}</span>
              {s.description && (
                <span style={styles.suggDesc}>{s.description}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ── Help overlay ───────────────────────────────────────────────────── */}
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  );
});

// ── Help overlay ───────────────────────────────────────────────────────────────
const HELP_CATEGORIES: Array<{ label: string; mnemonics: string[] }> = [
  { label: 'EQUITIES',     mnemonics: ['DES', 'FA', 'EQS', 'BETA', 'WACC', 'DCF', 'CGOV', 'CACS'] },
  { label: 'CHARTS',       mnemonics: ['GP', 'CHART', 'BT'] },
  { label: 'DERIVATIVES',  mnemonics: ['OPT', 'OVME'] },
  { label: 'FIXED INCOME', mnemonics: ['YCRV', 'CBR', 'WIRP'] },
  { label: 'MACRO',        mnemonics: ['BTMM', 'ECO'] },
  { label: 'FX / COMMOD',  mnemonics: ['WFX'] },
  { label: 'CORP GOV',     mnemonics: ['MA'] },
  { label: 'ALT DATA',     mnemonics: ['ESG', 'CLIM', 'SUPP'] },
  { label: 'PORTFOLIO',    mnemonics: ['PORT', 'HF'] },
  { label: 'AI',           mnemonics: ['AI'] },
];

const HelpOverlay = memo(function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div style={styles.helpOverlay} role="dialog" aria-label="Command Help">
      <div style={styles.helpHeader}>
        <span style={{ color: '#f59e0b', fontWeight: 700 }}>BLOOMBERG TERMINAL INDIA — COMMAND REFERENCE</span>
        <button onClick={onClose} style={styles.helpClose}>× CLOSE</button>
      </div>
      <div style={styles.helpGrid}>
        {HELP_CATEGORIES.map(({ label, mnemonics }) => (
          <div key={label} style={styles.helpSection}>
            <div style={styles.helpSectionLabel}>{label}</div>
            {mnemonics.map(m => {
              const entry = resolve(m);
              return entry ? (
                <div key={m} style={styles.helpRow}>
                  <span style={styles.helpMnemonic}>{m}</span>
                  <span style={styles.helpDesc}>{entry.metadata.description}</span>
                </div>
              ) : null;
            })}
          </div>
        ))}
      </div>
      <div style={styles.helpFooter}>
        TYPE MNEMONIC + ENTER — ESC TO DISMISS — ARROWS TO NAVIGATE HISTORY
      </div>
    </div>
  );
});

// ── Styles (inline — no CSS dependency) ───────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    background: '#0a0a0a',
    borderBottom: '1px solid #222',
    borderTop: '1px solid #222',
    padding: '0 8px',
    height: 32,
    flexShrink: 0,
    gap: 8,
    zIndex: 100,
    fontFamily: "'Consolas', 'Courier New', monospace",
  },
  context: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
    fontSize: 11,
  },
  ctxTicker: {
    color: '#f59e0b',
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: 1,
  },
  ctxSep: {
    color: '#555',
    fontSize: 10,
  },
  ctxMnemonic: {
    color: '#7dd3fc',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  inputWrap: {
    display: 'flex',
    alignItems: 'center',
    flex: 1,
    gap: 4,
  },
  prompt: {
    color: '#f59e0b',
    fontSize: 10,
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#f59e0b',
    fontSize: 12,
    letterSpacing: 1,
    fontFamily: 'inherit',
    caretColor: '#f59e0b',
    textTransform: 'uppercase',
  },
  clear: {
    background: 'none',
    border: 'none',
    color: '#666',
    cursor: 'pointer',
    fontSize: 16,
    lineHeight: 1,
    padding: '0 4px',
    flexShrink: 0,
  },
  suggestions: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    background: '#111',
    border: '1px solid #333',
    borderTop: 'none',
    listStyle: 'none',
    margin: 0,
    padding: 0,
    zIndex: 200,
    maxHeight: 320,
    overflowY: 'auto',
  },
  suggItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 10px',
    cursor: 'pointer',
    gap: 12,
    fontSize: 11,
  },
  suggItemActive: {
    background: '#1e3a5f',
  },
  suggMnemonic: {
    color: '#f59e0b',
    fontWeight: 700,
    minWidth: 60,
    letterSpacing: 1,
  },
  suggDesc: {
    color: '#9ca3af',
    fontSize: 11,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  helpOverlay: {
    position: 'fixed',
    top: 40,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.97)',
    zIndex: 500,
    padding: 20,
    overflowY: 'auto',
    fontFamily: "'Consolas', 'Courier New', monospace",
  },
  helpHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #f59e0b',
    paddingBottom: 10,
    marginBottom: 16,
  },
  helpClose: {
    background: 'none',
    border: '1px solid #666',
    color: '#9ca3af',
    cursor: 'pointer',
    padding: '2px 8px',
    fontSize: 11,
    fontFamily: 'inherit',
  },
  helpGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: 20,
  },
  helpSection: {
    border: '1px solid #222',
    padding: 10,
  },
  helpSectionLabel: {
    color: '#7dd3fc',
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: 8,
    borderBottom: '1px solid #222',
    paddingBottom: 4,
  },
  helpRow: {
    display: 'flex',
    gap: 10,
    padding: '2px 0',
    alignItems: 'baseline',
  },
  helpMnemonic: {
    color: '#f59e0b',
    fontWeight: 700,
    minWidth: 52,
    fontSize: 11,
    letterSpacing: 1,
  },
  helpDesc: {
    color: '#6b7280',
    fontSize: 10,
  },
  helpFooter: {
    marginTop: 20,
    color: '#374151',
    fontSize: 10,
    letterSpacing: 1,
    textAlign: 'center',
    borderTop: '1px solid #1f2937',
    paddingTop: 10,
  },
};
