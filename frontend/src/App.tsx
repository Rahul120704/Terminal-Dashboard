import React, { Component, ErrorInfo } from 'react';
import './index.css';
import { Terminal } from './components/Terminal';
import { TitleBar } from './components/TitleBar';
import { TitleBarContext, TitleBarCtx } from './context/TitleBarContext';

// ── ErrorBoundary ─────────────────────────────────────────────────────────────
interface EBState { hasError: boolean; error: string }
class ErrorBoundary extends Component<{ children: React.ReactNode }, EBState> {
  state: EBState = { hasError: false, error: '' };

  static getDerivedStateFromError(e: Error): EBState {
    return { hasError: true, error: e.message };
  }
  componentDidCatch(e: Error, info: ErrorInfo) {
    console.error('BTI render error:', e, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', background: '#0a0a0a',
          color: '#e8e8e0', fontFamily: 'Consolas, monospace',
        }}>
          <div style={{ color: '#ff9500', fontSize: 24, fontWeight: 700, marginBottom: 16 }}>BTI</div>
          <div style={{ color: '#ff3d00', marginBottom: 8 }}>Render error — check console</div>
          <div style={{ color: '#555548', fontSize: 11, maxWidth: 600, textAlign: 'center', marginBottom: 24 }}>
            {this.state.error}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: '' })}
            style={{
              background: 'transparent', border: '1px solid #ff9500',
              color: '#ff9500', padding: '6px 16px', cursor: 'pointer',
              fontFamily: 'Consolas, monospace',
            }}
          >
            RETRY
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [ticker,    setTickerState]    = React.useState<string | undefined>();
  const [price,     setPriceState]     = React.useState<number | undefined>();
  const [changePct, setChangePctState] = React.useState<number | undefined>();
  const [connected, setConnectedState] = React.useState(false);

  // useMemo with stable deps — ctx object never changes reference between renders,
  // so Terminal's useContext(TitleBarContext) never triggers unnecessary re-renders.
  const ctx: TitleBarCtx = React.useMemo(() => ({
    setTicker:    (sym: string, p: number, cp: number) => {
      setTickerState(sym);
      setPriceState(p);
      setChangePctState(cp);
    },
    setConnected: (v: boolean) => setConnectedState(v),
  }), []); // ← empty deps: state setters from useState are stable forever

  return (
    <TitleBarContext.Provider value={ctx}>
      <ErrorBoundary>
        {/* Bloomberg-style: Chromium renders the entire chrome, including title bar */}
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
          <TitleBar
            ticker={ticker}
            price={price}
            changePct={changePct}
            connected={connected}
          />
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <Terminal />
          </div>
        </div>
      </ErrorBoundary>
    </TitleBarContext.Provider>
  );
}
