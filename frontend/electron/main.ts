/**
 * Electron Main Process — Bloomberg Terminal India
 *
 * Bloomberg Terminal architecture:
 *   - Powered by Chromium web browser (same as Electron's renderer)
 *   - Frameless window — custom title bar rendered in JavaScript
 *   - Hardware-accelerated compositing for 60fps price grid updates
 *   - backgroundThrottling = false — prices keep ticking even in background
 *   - Multi-window: any panel can be "torn off" into its own Chromium window
 *   - System tray: terminal persists when "closed", always accessible
 *
 * Chromium performance flags (set before app.ready):
 *   enable-gpu-rasterization, enable-zero-copy, enable-accelerated-2d-canvas
 *   These eliminate software fallbacks for canvas/WebGL chart rendering.
 */

import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, screen } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// ── Environment ───────────────────────────────────────────────────────────────
const isDev      = !app.isPackaged;
const DEV_URL    = 'http://localhost:3000';
const BACKEND    = 'http://localhost:8000';

// ── Window state persistence ──────────────────────────────────────────────────
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

interface WindowState {
  x?: number; y?: number; width: number; height: number; maximized: boolean;
}

function loadWindowState(): WindowState {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { width: 1920, height: 1080, maximized: true };
  }
}

function saveWindowState(win: BrowserWindow) {
  try {
    const b = win.getBounds();
    const s: WindowState = {
      x: b.x, y: b.y, width: b.width, height: b.height,
      maximized: win.isMaximized(),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(s), 'utf-8');
  } catch { /* ignore */ }
}

// ── Force NVIDIA GPU on Windows Optimus (MUXless) ────────────────────────────
// Architecture: Intel iGPU owns the display; NVIDIA does all 3D/WebGL rendering
// then the result is composited onto the Intel framebuffer via cross-adapter copy.
// All switches MUST be set before app.ready.
//
// How this is determined: Win32_VideoController shows Intel with a display
// resolution (display is plugged in), NVIDIA with no resolution (render-only).
// The UserGpuPreferences registry key routes this process to NVIDIA, and the
// --gpu-vendor-id / --gpu-device-id flags pin Chromium's GPU process to the
// exact adapter so there is no ambiguity between adapters.
if (process.platform === 'win32') {
  // ── Step 1: Discover the NVIDIA adapter's PCI vendor + device IDs ───────────
  // Synchronous WMI query runs in < 200ms and must finish before app.ready so
  // the IDs are available when we appendSwitch below.
  let nvVendorId = '0x10de';  // NVIDIA PCI vendor ID (constant)
  let nvDeviceId = '';
  try {
    const { execSync } = require('child_process') as typeof import('child_process');
    // Query all video controllers, grep for NVIDIA, extract PNP ID
    const raw = execSync(
      'powershell -NoProfile -Command "' +
      'Get-CimInstance Win32_VideoController |' +
      ' Where-Object {$_.AdapterCompatibility -like \'*NVIDIA*\'} |' +
      ' Select-Object -First 1 -ExpandProperty PNPDeviceID"',
      { encoding: 'utf8', timeout: 4000, stdio: ['pipe','pipe','ignore'] }
    ).trim();
    // PNP format: PCI\VEN_10DE&DEV_2D19&...
    const devMatch = raw.match(/DEV_([0-9A-Fa-f]{4})/);
    if (devMatch) nvDeviceId = '0x' + devMatch[1].toLowerCase();
  } catch { /* WMI unavailable — fall back to hint-only flags */ }

  // ── Step 2: Pin Chromium's GPU process to the NVIDIA adapter ────────────────
  // --gpu-vendor-id + --gpu-device-id are the definitive flags: Chromium's GPU
  // process will refuse to use any adapter that doesn't match both IDs.
  // This is unambiguous even on MUXless Optimus where the iGPU appears first
  // in the DXGI adapter list (because it owns the display output).
  app.commandLine.appendSwitch('force_high_performance_gpu');
  app.commandLine.appendSwitch('gpu-vendor-id', nvVendorId);
  if (nvDeviceId) app.commandLine.appendSwitch('gpu-device-id', nvDeviceId);

  // ── Step 3: D3D12 ANGLE backend ──────────────────────────────────────────────
  // D3D12 supports cross-adapter resource sharing so the NVIDIA-rendered frames
  // can be composited by Intel without a GPU-process round-trip. D3D11 defaults
  // to the display-connected (Intel) adapter on MUXless systems.
  app.commandLine.appendSwitch('use-angle', 'd3d12');
  app.commandLine.appendSwitch('use-cmd-decoder', 'passthrough');

  // ── Step 4: Persist Windows GPU preference for all Electron binary paths ─────
  // Windows reads UserGpuPreferences at process-creation time. Writing it here
  // ensures the next cold-start also gets NVIDIA. The pre-launch script
  // (scripts/set-gpu-pref.js) handles the current launch.
  try {
    const { execFileSync } = require('child_process') as typeof import('child_process');
    const { existsSync }   = require('fs')             as typeof import('fs');
    const pth              = require('path')            as typeof import('path');
    const REG_KEY = 'HKCU\\SOFTWARE\\Microsoft\\DirectX\\UserGpuPreferences';
    const candidates = [
      process.execPath,
      pth.resolve(__dirname, '..', '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
      pth.resolve(process.env.APPDATA ?? '', 'npm', 'node_modules', 'electron', 'dist', 'electron.exe'),
    ];
    for (const exe of candidates) {
      if (existsSync(exe)) {
        execFileSync('reg', ['add', REG_KEY, '/v', exe, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'], { stdio: 'ignore' });
      }
    }
  } catch { /* non-critical */ }
}

// ── Chromium performance flags (must be before app.ready) ────────────────────
app.commandLine.appendSwitch('enable-gpu-rasterization');          // GPU for 2D canvas (charts)
app.commandLine.appendSwitch('enable-zero-copy');                  // Zero-copy texture uploads
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');      // GPU-accelerated canvas API
app.commandLine.appendSwitch('disable-software-rasterizer');       // Force GPU path only
app.commandLine.appendSwitch('ignore-gpu-blocklist');              // Use GPU even if on blocklist
app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');// Remove perf-hurting workarounds
// Remove Linux-only flags that are no-ops on Windows (VaapiVideoDecoder, UseOzonePlatform)
// Renderer JS heap — 4 GB for 4500-symbol quote store
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

// ── Global references ─────────────────────────────────────────────────────────
let mainWindow:    BrowserWindow | null = null;
let tray:          Tray | null = null;
const tearOffWindows = new Map<string, BrowserWindow>();

// ── Create main window ────────────────────────────────────────────────────────
function createMainWindow(): BrowserWindow {
  const state = loadWindowState();

  // Validate state bounds are still on a screen
  const displays = screen.getAllDisplays();
  const onScreen  = state.x !== undefined && displays.some(d =>
    state.x! >= d.bounds.x && state.x! < d.bounds.x + d.bounds.width &&
    state.y! >= d.bounds.y && state.y! < d.bounds.y + d.bounds.height,
  );

  const win = new BrowserWindow({
    x:        onScreen ? state.x : undefined,
    y:        onScreen ? state.y : undefined,
    width:    state.width  || 1920,
    height:   state.height || 1080,
    minWidth:  1280,
    minHeight: 720,

    // ── Bloomberg-style frameless window ─────────────────────────────────────
    frame:          false,          // No native OS title bar — we render our own
    titleBarStyle:  'hidden',       // macOS: hide native chrome
    backgroundColor: '#0a0a0a',    // Bloomberg dark — no white flash on load

    webPreferences: {
      preload:              path.join(__dirname, 'preload.js'),
      contextIsolation:     true,   // Security: renderer cannot access Node APIs
      nodeIntegration:      false,  // Security: no Node in renderer
      backgroundThrottling: false,  // CRITICAL: prices must tick even in background
      webSecurity:          true,
      allowRunningInsecureContent: false,
      // Allow local file loads (for packaged app assets)
      webviewTag: false,
    },

    show: false,  // Don't show blank window — wait for ready-to-show
    icon: getAppIcon(),
  });

  // Load app
  if (isDev) {
    win.loadURL(DEV_URL);
    // Open devtools in separate window so they don't crowd the terminal
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../build/index.html'));
  }

  // Show after first paint — prevents white flash
  win.once('ready-to-show', () => {
    win.show();
    if (state.maximized) win.maximize();
  });

  // ── Window state events ───────────────────────────────────────────────────
  win.on('maximize',   () => {
    win.webContents.send('window:maximizeChanged', true);
    saveWindowState(win);
  });
  win.on('unmaximize', () => {
    win.webContents.send('window:maximizeChanged', false);
    saveWindowState(win);
  });
  win.on('resize',     () => saveWindowState(win));
  win.on('move',       () => saveWindowState(win));

  // ── Intercept close → minimize to tray ───────────────────────────────────
  win.on('close', (e) => {
    if (tray && !app.quitting) {
      e.preventDefault();
      win.hide();
    }
  });

  // ── Open external links in OS browser, not Electron ──────────────────────
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http') && !url.startsWith(DEV_URL) && !url.startsWith(BACKEND)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  return win;
}

// ── Tear-off panel windows ────────────────────────────────────────────────────
// Bloomberg allows any panel to be "torn off" into a separate Chromium window.
// Each tear-off shares the same backend connection (via its own Worker instance).
function createTearOffWindow(panelId: string, title: string): BrowserWindow {
  const existing = tearOffWindows.get(panelId);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return existing;
  }

  const win = new BrowserWindow({
    width:  1200,
    height: 800,
    minWidth:  800,
    minHeight: 600,
    frame:          false,
    titleBarStyle:  'hidden',
    backgroundColor: '#0a0a0a',
    title,
    webPreferences: {
      preload:              path.join(__dirname, 'preload.js'),
      contextIsolation:     true,
      nodeIntegration:      false,
      backgroundThrottling: false,
    },
    parent: mainWindow ?? undefined,
    show:   false,
  });

  const url = isDev
    ? `${DEV_URL}?panel=${encodeURIComponent(panelId)}`
    : `file://${path.join(__dirname, '../build/index.html')}?panel=${encodeURIComponent(panelId)}`;

  win.loadURL(url);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => tearOffWindows.delete(panelId));
  tearOffWindows.set(panelId, win);
  return win;
}

// ── System Tray ───────────────────────────────────────────────────────────────
function createTray() {
  const icon = getAppIcon() ?? nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Financial Dashboard');

  const menu = Menu.buildFromTemplate([
    { label: 'Show Terminal', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: 'Quit',          click: () => { app.quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ── App icon helper ───────────────────────────────────────────────────────────
function getAppIcon(): string | undefined {
  const iconPaths = [
    path.join(__dirname, '../assets/icon.ico'),    // packaged
    path.join(__dirname, '../public/favicon.ico'), // dev
    path.join(process.cwd(), 'public/favicon.ico'),
  ];
  return iconPaths.find(p => fs.existsSync(p));
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────
function registerIPC() {
  // Window controls
  ipcMain.handle('window:minimize',     () => mainWindow?.minimize());
  ipcMain.handle('window:maximize',     () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.handle('window:close',        () => mainWindow?.close());
  ipcMain.handle('window:isMaximized',  () => mainWindow?.isMaximized() ?? false);
  ipcMain.handle('window:setFullscreen', (_e, flag: boolean) => mainWindow?.setFullScreen(flag));
  ipcMain.handle('window:isFullscreen',  () => mainWindow?.isFullScreen() ?? false);
  ipcMain.handle('window:alwaysOnTop',   (_e, flag: boolean) => mainWindow?.setAlwaysOnTop(flag));

  // Zoom
  ipcMain.handle('window:zoomIn',  () => {
    const factor = mainWindow?.webContents.getZoomFactor() ?? 1;
    mainWindow?.webContents.setZoomFactor(Math.min(factor + 0.1, 2.0));
  });
  ipcMain.handle('window:zoomOut', () => {
    const factor = mainWindow?.webContents.getZoomFactor() ?? 1;
    mainWindow?.webContents.setZoomFactor(Math.max(factor - 0.1, 0.5));
  });
  ipcMain.handle('window:zoomReset', () => mainWindow?.webContents.setZoomFactor(1.0));

  // Tear-off panels
  ipcMain.handle('panel:open', (_e, panelId: string) => {
    const titles: Record<string, string> = {
      chart:       'Financial Dashboard — Chart',
      news:        'Financial Dashboard — News',
      options:     'Financial Dashboard — Options Chain',
      screener:    'Financial Dashboard — Screener',
      macro:       'Financial Dashboard — Macro',
      filings:     'Financial Dashboard — Filings',
    };
    createTearOffWindow(panelId, titles[panelId] ?? `Financial Dashboard — ${panelId}`);
  });

  // Backend URL (so renderer can connect WS)
  ipcMain.handle('app:backendUrl', () => BACKEND);

  // Open external URL
  ipcMain.handle('app:openExternal', (_e, url: string) => shell.openExternal(url));

  // DevTools toggle (dev only)
  ipcMain.handle('app:toggleDevTools', () => {
    if (isDev) mainWindow?.webContents.toggleDevTools();
  });
}

// ── Global keyboard shortcuts ─────────────────────────────────────────────────
function registerGlobalShortcuts() {
  const { globalShortcut } = require('electron');
  if (isDev) {
    globalShortcut.register('CommandOrControl+Shift+I', () =>
      mainWindow?.webContents.toggleDevTools(),
    );
  }
  // F11 fullscreen (Bloomberg uses this)
  globalShortcut.register('F11', () => {
    if (!mainWindow) return;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.on('ready', () => {
  mainWindow = createMainWindow();
  createTray();
  registerIPC();
  registerGlobalShortcuts();
});

app.on('window-all-closed', () => {
  // On macOS keep the app alive; on Windows/Linux quit
  if (process.platform !== 'darwin') {
    // But only if we explicitly quit (not just closing main window to tray)
  }
});

app.on('activate', () => {
  // macOS: re-create window if dock icon clicked with no windows open
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
  } else {
    mainWindow?.show();
  }
});

app.on('before-quit', () => { app.quitting = true; });

// ── Security: restrict new window creation ────────────────────────────────────
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    const allowed = [
      'localhost',
      '127.0.0.1',
    ];
    if (!allowed.includes(parsedUrl.hostname)) {
      event.preventDefault();
    }
  });
});

// ── Augment app type for quitting flag ────────────────────────────────────────
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Electron {
    interface App { quitting?: boolean; }
  }
}
