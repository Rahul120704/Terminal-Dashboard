import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'mfe_gp',
      filename: 'remoteEntry.js',
      exposes: {
        './GP': './src/GP',
      },
      shared: {
        react:         { singleton: true, requiredVersion: '^18.3.1', eager: false },
        'react-dom':   { singleton: true, requiredVersion: '^18.3.1', eager: false },
        'lightweight-charts': { singleton: true, requiredVersion: '^4.2.0', eager: false },
      },
    }),
  ],
  server:  { port: 3002, cors: true, headers: { 'Access-Control-Allow-Origin': '*' } },
  preview: { port: 3002, cors: true, headers: { 'Access-Control-Allow-Origin': '*' } },
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
    rollupOptions: { output: { minifyInternalExports: false } },
  },
});
