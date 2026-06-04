/**
 * Type declarations for window.electron (injected by Electron preload script).
 * In browser mode (no Electron), window.electron is undefined — always check
 * with the `isElectron()` helper before calling any method.
 */

interface ElectronBridge {
  // Window controls
  minimize():       Promise<void>;
  maximize():       Promise<void>;
  close():          Promise<void>;
  isMaximized():    Promise<boolean>;
  setFullscreen(flag: boolean): Promise<void>;
  isFullscreen():   Promise<boolean>;
  setAlwaysOnTop(flag: boolean): Promise<void>;

  // Zoom
  zoomIn():    Promise<void>;
  zoomOut():   Promise<void>;
  zoomReset(): Promise<void>;

  // Tear-off panels
  openPanel(panelId: string): Promise<void>;

  // Events — return cleanup fn
  onMaximizeChange(cb: (maximized: boolean) => void): () => void;
  onFullscreenChange(cb: (fullscreen: boolean) => void): () => void;

  // System
  platform:   string;    // 'win32' | 'darwin' | 'linux'
  isElectron: true;

  // Backend
  getBackendUrl(): Promise<string>;

  // Utilities
  openExternal(url: string): Promise<void>;
  toggleDevTools(): Promise<void>;
}

declare global {
  interface Window {
    electron?: ElectronBridge;
  }
}

export {};

// ── Electron-specific CSS property ────────────────────────────────────────────
// -webkit-app-region: drag | no-drag  — tells Chromium which regions drag the window.
// React's CSSProperties type doesn't include this because it's not in the CSS spec;
// it's a Chromium/Electron extension. Augment the type so TypeScript accepts it.
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}
