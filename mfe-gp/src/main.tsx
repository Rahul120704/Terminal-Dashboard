import React from 'react';
import ReactDOM from 'react-dom/client';
import GP from './GP';

class StubBus {
  emit() {}
  subscribe(_: string, __: (e: any) => void) { return () => {}; }
  on(_: string) { return { subscribe: () => ({ unsubscribe: () => {} }) }; }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GP
      ticker="RELIANCE"
      theme="dark"
      apiBase="http://localhost:8000"
      bus={new StubBus() as any}
      onTickerChange={(t) => console.log('[GP standalone] ticker →', t)}
      onNavigate={(m, t) => console.log('[GP standalone] navigate →', m, t)}
    />
  </React.StrictMode>,
);
