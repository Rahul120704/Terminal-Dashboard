/**
 * Command Palette — Cmd+K style mnemonic launcher
 *
 * Replaces the inline CLI bar with a floating overlay that opens
 * on Cmd+K, Ctrl+K, or programmatically via the `open` prop.
 *
 * Usage: <CommandPalette open={open} onClose={onClose} ... />
 */

import React, {
  useState, useRef, useEffect, useCallback, memo, useMemo,
} from 'react';
import { ALL_MNEMONICS, search, resolve, REGISTRY } from '../mfe/registry';
import { eventBus } from '../mfe/bus';

// ── Types ─────────────────────────────────────────────────────────────────────
interface CommandPaletteProps {
  open: boolean;
  activeTicker: string;
  activeMnemonic: string;
  onClose: () => void;
  onMnemonicExec: (mnemonic: string, ticker?: string) => void;
  onTickerChange: (ticker: string) => void;
}

interface PaletteItem {
  mnemonic: string;
  name: string;
  description: string;
  category: string;
}

// ── Category display names ─────────────────────────────────────────────────
const CAT_LABELS: Record<string, string> = {
  EQUITY:        'Equities',
  DERIVATIVES:   'Derivatives',
  FIXED_INCOME:  'Fixed Income',
  MACRO:         'Macro',
  FX:            'FX & Commodities',
  ALT_DATA:      'Alternative Data',
  CORP_GOVERNANCE:'Corporate',
  PORTFOLIO:     'Portfolio',
  RISK:          'Risk & Quant',
};

// ── Parser (same logic as before) ─────────────────────────────────────────────
interface ParseResult { mnemonic?: string; ticker?: string; args: string[]; raw: string; }

function parseInput(raw: string): ParseResult {
  const parts = raw.trim().toUpperCase().split(/\s+/);
  if (!parts.length || !parts[0]) return { args: [], raw };
  const first = parts[0];
  const isMnemonic = !!REGISTRY[first];
  if (isMnemonic) {
    const ticker = parts[1] && !REGISTRY[parts[1]] ? parts[1] : undefined;
    return { mnemonic: first, ticker, args: parts.slice(1), raw };
  }
  return { ticker: parts[0], args: parts.slice(1), raw };
}

// ── Build flat item list from registry ────────────────────────────────────────
const ALL_ITEMS: PaletteItem[] = Object.values(REGISTRY).map(e => ({
  mnemonic:    e.metadata.mnemonic,
  name:        e.metadata.name,
  description: e.metadata.description,
  category:    e.metadata.category,
}));

// ── Main component ────────────────────────────────────────────────────────────
export const MnemonicCLI = memo(function CommandPalette({
  open,
  activeTicker,
  onClose,
  onMnemonicExec,
  onTickerChange,
}: CommandPaletteProps) {
  const [inputValue, setInputValue] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setInputValue('');
      setSelectedIdx(0);
      setHistoryIdx(-1);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Filtered results
  const results = useMemo<PaletteItem[]>(() => {
    const q = inputValue.trim().toUpperCase();
    if (!q) return ALL_ITEMS.slice(0, 16);
    return search(q).slice(0, 20).map(e => ({
      mnemonic:    e.metadata.mnemonic,
      name:        e.metadata.name,
      description: e.metadata.description,
      category:    e.metadata.category,
    }));
  }, [inputValue]);

  // Reset selection when results change
  useEffect(() => { setSelectedIdx(0); }, [results.length]);

  const execute = useCallback((raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

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
        eventBus.emit('TICKER_CHANGE', { ticker: parsed.ticker, source: 'CLI' });
      }
    } else if (parsed.ticker) {
      onTickerChange(parsed.ticker);
      eventBus.emit('TICKER_CHANGE', { ticker: parsed.ticker, source: 'CLI' });
    }

    setHistory(h => [trimmed, ...h.slice(0, 49)]);
    onClose();
  }, [activeTicker, onMnemonicExec, onTickerChange, onClose]);

  const executeItem = useCallback((item: PaletteItem) => {
    execute(item.mnemonic);
  }, [execute]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { onClose(); return; }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIdx]) executeItem(results[selectedIdx]);
      else execute(inputValue);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, results.length - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (selectedIdx > 0) { setSelectedIdx(i => i - 1); return; }
      // History navigation at top
      const nextIdx = historyIdx + 1;
      if (nextIdx < history.length) {
        setHistoryIdx(nextIdx);
        setInputValue(history[nextIdx]);
      }
      return;
    }

    if (e.key === 'Tab' && results.length > 0) {
      e.preventDefault();
      setInputValue(results[selectedIdx]?.mnemonic ?? inputValue);
      return;
    }
  }, [execute, executeItem, inputValue, results, selectedIdx, historyIdx, history, onClose]);

  if (!open) return null;

  // Group results by category for display
  const grouped: Record<string, PaletteItem[]> = {};
  results.forEach(item => {
    const cat = CAT_LABELS[item.category] ?? item.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  });

  const flatItems: PaletteItem[] = [];
  Object.values(grouped).forEach(g => g.forEach(i => flatItems.push(i)));

  let cursor = 0;

  return (
    <div
      className="cmd-palette-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="cmd-palette">
        {/* Input row */}
        <div className="cmd-palette-input-row">
          <span className="cmd-palette-icon">⌘</span>
          <input
            ref={inputRef}
            className="cmd-palette-input"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a mnemonic (DES, GP, FA…) or ticker symbol"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            aria-label="Command palette input"
          />
          <button className="cmd-palette-esc" onClick={onClose}>ESC</button>
        </div>

        {/* Results */}
        <div className="cmd-palette-results">
          {results.length === 0 ? (
            <div className="cmd-palette-empty">
              No results — press Enter to change ticker to "{inputValue}"
            </div>
          ) : (
            Object.entries(grouped).map(([cat, items]) => (
              <div key={cat}>
                <div className="cmd-palette-group-label">{cat}</div>
                {items.map(item => {
                  const idx = flatItems.indexOf(item);
                  const isSelected = idx === selectedIdx;
                  return (
                    <div
                      key={item.mnemonic}
                      className={`cmd-palette-item${isSelected ? ' selected' : ''}`}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      onMouseDown={(e) => { e.preventDefault(); executeItem(item); }}
                    >
                      <span className="cmd-palette-item-mnemonic">{item.mnemonic}</span>
                      <span className="cmd-palette-item-name">{item.name}</span>
                      <span className="cmd-palette-item-desc">{item.description}</span>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div className="cmd-palette-footer">
          <span><kbd>↑↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Open</span>
          <span><kbd>Tab</kbd> Complete</span>
          <span><kbd>Esc</kbd> Close</span>
          <span style={{ marginLeft: 'auto' }}>
            Active: <strong style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
              {activeTicker}
            </strong>
          </span>
        </div>
      </div>
    </div>
  );
});

export default MnemonicCLI;
