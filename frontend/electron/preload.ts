/**
 * Electron Preload Script — Bloomberg Terminal India
 *
 * This script runs in a privileged context BEFORE the renderer page loads.
 * It uses contextBridge to expose a safe, narrow API to the renderer.
 *
 * Security model (Electron best-practice):
 *   - contextIsolation: true  — renderer cannot access Node globals directly
 *   - nodeIntegration: false  — renderer is a pure browser environment
 *   - Only explicitly listed APIs are accessible via window.electron
 *
 * Exposed API surface (window.electron):
 *   Window controls  — minimize, maximize, close, fullscreen, alwaysOnTop
 *   Zoom             — zoomIn, zoomOut, zoomReset
 *   Tear-off panels  — openPanel(panelId)
 *   Events           — onMaximizeChange, onFullscreenChange
 *   System           — platform, backendUrl, openExternal
 */

import { contextBridge, ipcRenderer } from 'electron';

// ── Type-safe invoke wrapper ───────────────────────────────────────────────────
const invoke = <T = void>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

// ── ElectronBridge — exposed to renderer as window.electron ──────────────────
const bridge = {
  // ── Window controls ────────────────────────────────────────────────────────
  minimize:     () => invoke('window:minimize'),
  maximize:     () => invoke('window:maximize'),   // toggles max/restore
  close:        () => invoke('window:close'),
  isMaximized:  () => invoke<boolean>('window:isMaximized'),
  setFullscreen:(flag: boolean) => invoke('window:setFullscreen', flag),
  isFullscreen: () => invoke<boolean>('window:isFullscreen'),
  setAlwaysOnTop:(flag: boolean) => invoke('window:alwaysOnTop', flag),

  // ── Zoom ───────────────────────────────────────────────────────────────────
  zoomIn:    () => invoke('window:zoomIn'),
  zoomOut:   () => invoke('window:zoomOut'),
  zoomReset: () => invoke('window:zoomReset'),

  // ── Tear-off panels ────────────────────────────────────────────────────────
  openPanel: (panelId: string) => invoke('panel:open', panelId),

  // ── Events (returns cleanup function) ─────────────────────────────────────
  onMaximizeChange: (cb: (maximized: boolean) => void) => {
    const handler = (_: Electron.IpcRendererEvent, val: boolean) => cb(val);
    ipcRenderer.on('window:maximizeChanged', handler);
    return () => ipcRenderer.removeListener('window:maximizeChanged', handler);
  },

  onFullscreenChange: (cb: (fullscreen: boolean) => void) => {
    const handler = (_: Electron.IpcRendererEvent, val: boolean) => cb(val);
    ipcRenderer.on('window:fullscreenChanged', handler);
    return () => ipcRenderer.removeListener('window:fullscreenChanged', handler);
  },

  // ── System info ────────────────────────────────────────────────────────────
  platform:   process.platform as string,
  isElectron: true as const,

  // ── Backend URL ────────────────────────────────────────────────────────────
  getBackendUrl: () => invoke<string>('app:backendUrl'),

  // ── Open external links in OS browser ─────────────────────────────────────
  openExternal: (url: string) => invoke('app:openExternal', url),

  // ── DevTools (dev only) ────────────────────────────────────────────────────
  toggleDevTools: () => invoke('app:toggleDevTools'),
};

contextBridge.exposeInMainWorld('electron', bridge);

// ── Type declaration (also in src/types/electron.d.ts) ───────────────────────
export type ElectronBridge = typeof bridge;
