/**
 * mfe-des — Vite Module Federation Remote
 *
 * Runs on port 3001. Exposes:
 *   './DES'  → src/DES.tsx  (React component default export)
 *
 * The shell loads this bundle at runtime via loader.ts when the user types "DES".
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'mfe_des',
      filename: 'remoteEntry.js',
      exposes: {
        './DES': './src/DES',
      },
      shared: {
        react:     { singleton: true, requiredVersion: '^18.3.1', eager: false },
        'react-dom': { singleton: true, requiredVersion: '^18.3.1', eager: false },
      },
    }),
  ],

  server: {
    port: 3001,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },

  preview: {
    port: 3001,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },

  build: {
    // Module Federation requires target esnext + modulePreload disabled
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        minifyInternalExports: false,
      },
    },
  },
});
