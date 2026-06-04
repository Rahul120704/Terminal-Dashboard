/**
 * TitleBar — Bloomberg-style frameless window chrome.
 *
 * Bloomberg Terminal's window chrome is rendered in JavaScript (not native OS
 * chrome). This component replicates that pattern.
 *
 * Layout:
 *   [BTI logo] [BLOOMBERG TERMINAL INDIA]  |  [ticker + price]  |  [● conn] [─] [□] [✕]
 *
 * Drag mechanics:
 *   The entire bar has -webkit-app-region: drag  (CSS property that tells
 *   Chromium/Electron to treat this region as the window drag handle).
 *   Interactive elements (buttons, ticker) override with no-drag.
 *
 * In browser mode (no Electron), the title bar renders without window controls
 * so the component is safe to include unconditionally.
 */

import React, { useState, useEffect, useCallback, memo } from 'react';

interface TitleBarProps {
  ticker?:    string;       // currently selected ticker
  price?:     number;
  changePct?: number;
  connected?: boolean;
  onPanelTearOff?: (panelId: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const isElectron = () => typeof window !== 'undefined' && !!window.electron;

const fmt2 = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Window control button ─────────────────────────────────────────────────────
const WinBtn = memo<{
  icon: string;
  title: string;
  hoverColor: string;
  onClick: () => void;
}>(({ icon, title, hoverColor, onClick }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        WebkitAppRegion: 'no-drag' as never,
        width: 46,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: hovered ? hoverColor : 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: hovered && hoverColor === '#e81123' ? '#fff' : '#a0a090',
        fontSize: 12,
        transition: 'background 0.1s, color 0.1s',
        fontFamily: 'Consolas, monospace',
        flexShrink: 0,
      }}
    >
      {icon}
    </button>
  );
});
WinBtn.displayName = 'WinBtn';

// ── Main TitleBar ─────────────────────────────────────────────────────────────
export const TitleBar = memo<TitleBarProps>(({
  ticker, price, changePct, connected = false,
}) => {
  const [maximized,   setMaximized]   = useState(false);
  const [fullscreen,  setFullscreen]  = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const electron = isElectron() ? window.electron! : null;

  // ── Sync window state ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!electron) return;
    electron.isMaximized().then(setMaximized).catch(() => {});
    electron.isFullscreen().then(setFullscreen).catch(() => {});

    const unsub1 = electron.onMaximizeChange(setMaximized);
    const unsub2 = electron.onFullscreenChange(setFullscreen);
    return () => { unsub1(); unsub2(); };
  }, [electron]);

  // ── Window control handlers ────────────────────────────────────────────────
  const handleMinimize = useCallback(() => electron?.minimize(), [electron]);
  const handleMaximize = useCallback(() => electron?.maximize(), [electron]);
  const handleClose    = useCallback(() => electron?.close(),    [electron]);
  const handleFullscreen = useCallback(() => {
    const next = !fullscreen;
    setFullscreen(next);
    electron?.setFullscreen(next);
  }, [electron, fullscreen]);
  const handleAlwaysOnTop = useCallback(() => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    electron?.setAlwaysOnTop(next);
  }, [electron, alwaysOnTop]);

  // ── Colour helpers ─────────────────────────────────────────────────────────
  const changeColor = (changePct ?? 0) >= 0 ? '#00c853' : '#ff3d00';
  const connColor   = connected ? '#00c853' : '#ff3d00';

  const positive = (changePct ?? 0) >= 0;
  const arrow    = positive ? '▲' : '▼';

  return (
    <div
      style={{
        height: 32,
        background: '#111108',
        borderBottom: '1px solid #2a2a1f',
        display: 'flex',
        alignItems: 'center',
        userSelect: 'none',
        WebkitAppRegion: 'drag' as never,
        flexShrink: 0,
        position: 'relative',
        zIndex: 1000,
      }}
    >
      {/* ── Left: Logo + title ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12, minWidth: 220 }}>
        {/* FD amber hexagon logo */}
        <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
          <polygon
            points="9,1 16.8,5 16.8,13 9,17 1.2,13 1.2,5"
            fill="none"
            stroke="#ff9500"
            strokeWidth="1.5"
          />
          <text x="9" y="12.5" textAnchor="middle" fill="#ff9500"
            fontSize="7" fontFamily="Consolas,monospace" fontWeight="bold">
            FD
          </text>
        </svg>
        <span style={{ color: '#ff9500', fontSize: 11, fontFamily: 'Consolas, monospace', fontWeight: 700, letterSpacing: '0.05em' }}>
          FINANCIAL DASHBOARD
        </span>
      </div>

      {/* ── Centre: Live ticker price ─────────────────────────────────────── */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        WebkitAppRegion: 'no-drag' as never,
      }}>
        {ticker && (
          <>
            <span style={{ color: '#e8e8e0', fontSize: 11, fontFamily: 'Consolas, monospace', fontWeight: 600 }}>
              {ticker}
            </span>
            {price != null && price > 0 && (
              <>
                <span style={{ color: '#e8e8e0', fontSize: 11, fontFamily: 'Consolas, monospace' }}>
                  ₹{fmt2(price)}
                </span>
                {changePct != null && (
                  <span style={{ color: changeColor, fontSize: 10, fontFamily: 'Consolas, monospace' }}>
                    {arrow} {Math.abs(changePct).toFixed(2)}%
                  </span>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ── Right: Status + window controls ──────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto' }}>
        {/* Connection indicator */}
        <div
          title={connected ? 'Live — connected to backend' : 'Disconnected'}
          style={{
            WebkitAppRegion: 'no-drag' as never,
            display: 'flex', alignItems: 'center', gap: 4,
            paddingRight: 12, paddingLeft: 8,
            fontSize: 10, fontFamily: 'Consolas, monospace',
            color: connColor,
          }}
        >
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: connColor,
            boxShadow: connected ? `0 0 4px ${connColor}` : 'none',
            display: 'inline-block',
          }} />
          <span>{connected ? 'LIVE' : 'OFF'}</span>
        </div>

        {/* Always-on-top toggle */}
        {electron && (
          <div
            title={alwaysOnTop ? 'Always on top: ON' : 'Always on top: OFF'}
            onClick={handleAlwaysOnTop}
            style={{
              WebkitAppRegion: 'no-drag' as never,
              width: 28, height: 32,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              color: alwaysOnTop ? '#ff9500' : '#444438',
              fontSize: 13,
            }}
          >
            📌
          </div>
        )}

        {/* Fullscreen toggle */}
        {electron && (
          <WinBtn
            icon={fullscreen ? '⊡' : '⛶'}
            title={fullscreen ? 'Exit fullscreen (F11)' : 'Fullscreen (F11)'}
            hoverColor="#2a2a1f"
            onClick={handleFullscreen}
          />
        )}

        {/* Window controls — only in Electron */}
        {electron && (
          <>
            <WinBtn icon="─" title="Minimize"          hoverColor="#2a2a1f" onClick={handleMinimize} />
            <WinBtn icon={maximized ? '❐' : '□'} title={maximized ? 'Restore' : 'Maximize'} hoverColor="#2a2a1f" onClick={handleMaximize} />
            <WinBtn icon="✕" title="Close (minimizes to tray)" hoverColor="#e81123" onClick={handleClose} />
          </>
        )}
      </div>
    </div>
  );
});
TitleBar.displayName = 'TitleBar';
