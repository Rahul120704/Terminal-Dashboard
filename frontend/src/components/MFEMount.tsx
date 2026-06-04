/**
 * MFEMount — Dynamic MFE mount point
 *
 * Wraps a dynamically-loaded remote component with:
 *  - Suspense (loading skeleton)
 *  - Error boundary (catches network failures or bad MFE code)
 *  - Props injection (ticker, theme, bus, apiBase)
 *
 * Usage:
 *   <MFEMount mnemonic="DES" ticker="RELIANCE" />
 */

import React, {
  useState, useEffect, useRef, Component, Suspense, memo,
} from 'react';
import { loadRemoteComponent } from '../mfe/loader';
import { resolve } from '../mfe/registry';
import { eventBus } from '../mfe/bus';
import type { MFEProps } from '../mfe/types';

// ── Props ──────────────────────────────────────────────────────────────────────
interface MFEMountProps {
  mnemonic: string;
  ticker: string;
  theme?: 'dark' | 'light';
  apiBase?: string;
  onTickerChange: (ticker: string) => void;
  onNavigate: (mnemonic: string, ticker?: string) => void;
}

// ── Error boundary ─────────────────────────────────────────────────────────────
interface EBState { error: Error | null }
class MFEErrorBoundary extends Component<
  { mnemonic: string; children: React.ReactNode },
  EBState
> {
  state: EBState = { error: null };

  static getDerivedStateFromError(error: Error): EBState {
    return { error };
  }

  componentDidCatch(error: Error) {
    eventBus.emit('MFE_ERROR', {
      mnemonic: this.props.mnemonic,
      error: error.message,
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div style={errStyles.container}>
          <div style={errStyles.header}>
            MFE LOAD ERROR — {this.props.mnemonic}
          </div>
          <div style={errStyles.message}>{this.state.error.message}</div>
          <div style={errStyles.hint}>
            Ensure the remote is running on its assigned port.
            Check browser console for CORS / network details.
          </div>
          <button
            style={errStyles.retry}
            onClick={() => this.setState({ error: null })}
          >
            RETRY
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Loading skeleton ───────────────────────────────────────────────────────────
const MFELoadingSkeleton = memo(function MFELoadingSkeleton({
  mnemonic,
}: { mnemonic: string }) {
  return (
    <div style={skeletonStyles.container}>
      <div style={skeletonStyles.header}>
        <div style={skeletonStyles.mnemonicBadge}>{mnemonic}</div>
        <div style={skeletonStyles.spinner} />
        <span style={skeletonStyles.label}>Loading remote module...</span>
      </div>
      <div style={skeletonStyles.lines}>
        {[100, 70, 85, 55, 90].map((w, i) => (
          <div
            key={i}
            style={{ ...skeletonStyles.line, width: `${w}%`, opacity: 1 - i * 0.12 }}
          />
        ))}
      </div>
    </div>
  );
});

// ── Main mount component ───────────────────────────────────────────────────────
export const MFEMount = memo(function MFEMount({
  mnemonic,
  ticker,
  theme = 'dark',
  apiBase = 'http://localhost:8000',
  onTickerChange,
  onNavigate,
}: MFEMountProps) {
  const [RemoteComponent, setRemoteComponent] =
    useState<React.ComponentType<MFEProps> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const entry = resolve(mnemonic);
    if (!entry) {
      setLoadError(`Unknown mnemonic: ${mnemonic}`);
      setLoading(false);
      return;
    }

    // Internal panel — shell handles routing, MFEMount not used for these
    if (entry.internalRoute) {
      setLoadError(`${mnemonic} is an internal panel (route: ${entry.internalRoute})`);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    setRemoteComponent(null);

    loadRemoteComponent(entry.url, entry.scope, entry.module)
      .then(Comp => {
        if (mountedRef.current) {
          setRemoteComponent(() => Comp);
          setLoading(false);
        }
      })
      .catch(err => {
        if (mountedRef.current) {
          setLoadError(err.message);
          setLoading(false);
          eventBus.emit('MFE_ERROR', { mnemonic, error: err.message });
        }
      });
  }, [mnemonic]);

  if (loadError) {
    return (
      <div style={errStyles.container}>
        <div style={errStyles.header}>MFE ERROR — {mnemonic}</div>
        <div style={errStyles.message}>{loadError}</div>
      </div>
    );
  }

  if (loading || !RemoteComponent) {
    return <MFELoadingSkeleton mnemonic={mnemonic} />;
  }

  const mfeProps: MFEProps = {
    ticker,
    theme,
    apiBase,
    bus: eventBus,
    onTickerChange,
    onNavigate,
  };

  return (
    <MFEErrorBoundary mnemonic={mnemonic}>
      <Suspense fallback={<MFELoadingSkeleton mnemonic={mnemonic} />}>
        <RemoteComponent {...mfeProps} />
      </Suspense>
    </MFEErrorBoundary>
  );
});

// ── Styles ─────────────────────────────────────────────────────────────────────
const errStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: 40,
    background: '#0a0a0a',
    fontFamily: "'Consolas', 'Courier New', monospace",
  },
  header: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 2,
    marginBottom: 12,
  },
  message: {
    color: '#9ca3af',
    fontSize: 12,
    maxWidth: 480,
    textAlign: 'center',
    marginBottom: 8,
  },
  hint: {
    color: '#4b5563',
    fontSize: 11,
    maxWidth: 480,
    textAlign: 'center',
    marginBottom: 20,
  },
  retry: {
    background: 'none',
    border: '1px solid #374151',
    color: '#f59e0b',
    cursor: 'pointer',
    padding: '4px 16px',
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: 'inherit',
  },
};

const skeletonStyles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    padding: 20,
    background: '#0a0a0a',
    fontFamily: "'Consolas', 'Courier New', monospace",
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 24,
  },
  mnemonicBadge: {
    background: '#1e3a5f',
    color: '#7dd3fc',
    padding: '2px 8px',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: 700,
  },
  spinner: {
    width: 14,
    height: 14,
    border: '2px solid #1f2937',
    borderTop: '2px solid #f59e0b',
    borderRadius: '50%',
    animation: 'mfe-spin 0.8s linear infinite',
  },
  label: {
    color: '#4b5563',
    fontSize: 11,
    letterSpacing: 1,
  },
  lines: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  line: {
    height: 8,
    background: '#1f2937',
    borderRadius: 2,
    animation: 'mfe-pulse 1.5s ease-in-out infinite',
  },
};
