import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── MFE host middleware ───────────────────────────────────────────────────────
// Serves independently-built remote bundles from D:\BB\mfe-host at /mfe/<slug>/…
// This middleware is registered in the configureServer BODY (not a returned
// hook), so it runs BEFORE Vite's module-transform middleware. That matters:
// Vite rewrites any dynamically-imported JS it serves with a ?import suffix and
// runs it through its transform pipeline, which corrupts a pre-built federation
// remoteEntry.js. By intercepting /mfe first and streaming the raw file, the
// bundle reaches the browser byte-for-byte. Same-origin, so no CORS needed.
// In production the FastAPI backend serves the identical /mfe path (see main.py).
const MFE_HOST_DIR = fileURLToPath(new URL('../mfe-host', import.meta.url));

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

function mfeHostPlugin(): Plugin {
  return {
    name: 'bti-mfe-host',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/mfe/')) return next();

        // Strip query (?import, ?t=…, ?v=…) and decode, then prevent traversal.
        const rel = decodeURIComponent(url.split('?')[0]).replace(/^\/mfe\//, '');
        const filePath = normalize(join(MFE_HOST_DIR, rel));
        if (!filePath.startsWith(MFE_HOST_DIR)) { res.statusCode = 403; return res.end('Forbidden'); }

        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
          res.statusCode = 404;
          return res.end(`MFE asset not found: ${rel}\nRun "npm run mfe:deploy" to (re)build the remotes.`);
        }

        res.setHeader('Content-Type', MIME[extname(filePath)] ?? 'application/octet-stream');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    mfeHostPlugin(),
    react(),
    // ── Module Federation (Host / Shell) ──────────────────────────────────────
    // Remotes are listed here for build-time optimisation.
    // At runtime the registry + loader.ts can load ANY remote dynamically
    // via script injection — these entries are optional hints only.
    federation({
      name: 'bti_shell',
      // Remote entries known at build time (port numbers from .env or defaults)
      remotes: {
        mfe_des: {
          external: `Promise.resolve('${
            process.env.VITE_MFE_DES_URL ?? 'http://localhost:3001/assets/remoteEntry.js'
          }')`,
          externalType: 'promise',
          format: 'esm',
        },
        mfe_gp: {
          external: `Promise.resolve('${
            process.env.VITE_MFE_GP_URL ?? 'http://localhost:3002/assets/remoteEntry.js'
          }')`,
          externalType: 'promise',
          format: 'esm',
        },
      },
      // Singletons shared with all remotes — prevents duplicate React instances
      shared: {
        react: {
          singleton: true,
          requiredVersion: '^18.3.1',
          eager: true,
        },
        'react-dom': {
          singleton: true,
          requiredVersion: '^18.3.1',
          eager: true,
        },
        rxjs: {
          singleton: true,
          requiredVersion: '^7.8.1',
        },
      },
    }),
  ],

  // base: './' is required for Electron's file:// protocol.
  // With base: '/', built assets use absolute paths like /assets/xxx.js
  // which don't resolve when loaded via file:// in the packaged app.
  // './' makes all asset references relative — works for both file:// and http://.
  base: './',

  server: {
    port: 3000,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/ws':  { target: 'ws://localhost:8000',   ws: true, changeOrigin: true },
    },
  },

  build: {
    outDir:    'build',
    sourcemap: mode === 'development',
    rollupOptions: {
      output: {
        // Separate chunk for the Web Worker (already auto-split by Vite ?worker)
        // Keep React in a stable named chunk for better caching
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },

  resolve: {
    alias: { src: '/src' },
  },

  // Electron renderer: allow access to Node built-ins via polyfill if needed
  optimizeDeps: {
    exclude: ['electron'],   // Never bundle the 'electron' module into renderer
  },
}));
