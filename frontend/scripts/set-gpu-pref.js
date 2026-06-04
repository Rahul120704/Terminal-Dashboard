/**
 * set-gpu-pref.js — run BEFORE Electron starts.
 *
 * Windows reads the UserGpuPreferences registry key at process-creation time,
 * so writing it from inside the running app only takes effect on the NEXT launch.
 * Running this script first ensures the CURRENT launch gets the NVIDIA GPU.
 *
 * Usage (called automatically by npm scripts):
 *   node scripts/set-gpu-pref.js
 */

'use strict';
const { execFileSync } = require('child_process');
const { existsSync }   = require('fs');
const path             = require('path');

const REG_KEY = 'HKCU\\SOFTWARE\\Microsoft\\DirectX\\UserGpuPreferences';

// Candidate electron.exe paths — cover dev, global-install, and packaged builds
const candidates = [
  // Dev: local node_modules (most common)
  path.resolve(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
  // Global electron install
  path.resolve(process.env.APPDATA ?? '', 'npm', 'node_modules', 'electron', 'dist', 'electron.exe'),
  // Packaged installer default location
  path.resolve(process.env.LOCALAPPDATA ?? '', 'Programs', 'financial-dashboard', 'Financial Dashboard.exe'),
  path.resolve(process.env.LOCALAPPDATA ?? '', 'Programs', 'Financial Dashboard',  'Financial Dashboard.exe'),
  // process.execPath (node.exe when run via npm — not the electron binary, but harmless)
  process.execPath,
];

let set = 0;
for (const exe of candidates) {
  if (!existsSync(exe)) continue;
  try {
    execFileSync(
      'reg',
      ['add', REG_KEY, '/v', exe, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'],
      { stdio: 'ignore' }
    );
    console.log(`[GPU] High-performance (NVIDIA) set for: ${exe}`);
    set++;
  } catch (e) {
    console.warn(`[GPU] Could not set preference for ${exe}:`, e.message);
  }
}

if (set === 0) {
  console.warn('[GPU] No Electron binary found — GPU preference not set. ' +
               'Open Settings → System → Display → Graphics and set electron.exe to High performance manually.');
} else {
  console.log(`[GPU] Done — ${set} path(s) configured.`);
}
