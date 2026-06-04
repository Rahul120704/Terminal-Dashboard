/**
 * mfe-des standalone dev entry-point.
 * Only used when running `npm run dev` inside mfe-des/ directly.
 * The shell loads DES.tsx via the container API — this file is not part of the remote bundle.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import DES from './DES';
import { EventBus } from './shim/bus-shim';

const bus = new EventBus();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DES
      ticker="RELIANCE"
      theme="dark"
      apiBase="http://localhost:8000"
      bus={bus as any}
      onTickerChange={(t) => console.log('[DES standalone] ticker change →', t)}
      onNavigate={(m, t) => console.log('[DES standalone] navigate →', m, t)}
    />
  </React.StrictMode>,
);
