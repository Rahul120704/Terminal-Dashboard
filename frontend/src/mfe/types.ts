/**
 * MFE Contract Types
 *
 * Every remote micro-frontend must export a component satisfying MFEProps.
 * The shell passes these props at mount time and re-passes when context changes.
 */

import type { EventBus } from './bus';

// ── MFE categories (drives sidebar grouping) ──────────────────────────────────
export type MFECategory =
  | 'EQUITY'
  | 'FIXED_INCOME'
  | 'DERIVATIVES'
  | 'FX'
  | 'COMMODITIES'
  | 'MACRO'
  | 'CORP_GOVERNANCE'
  | 'ALT_DATA'
  | 'RISK'
  | 'PORTFOLIO';

// ── Props every MFE receives from the shell ───────────────────────────────────
export interface MFEProps {
  /** Current active security (NSE symbol, e.g. "RELIANCE") */
  ticker: string;
  /** ISO currency code for the active instrument */
  currency?: string;
  /** Terminal color theme */
  theme: 'dark' | 'light';
  /** Backend REST base, e.g. "http://localhost:8000" */
  apiBase: string;
  /** Global pub/sub bus — subscribe to TICKER_CHANGE, WS_TICK, etc. */
  bus: EventBus;
  /** Request the shell to navigate to a different ticker */
  onTickerChange: (ticker: string) => void;
  /** Request the shell to mount a different mnemonic panel */
  onNavigate: (mnemonic: string, ticker?: string) => void;
}

// ── What a remote bundle must export at its default export ────────────────────
export interface MFEModule {
  default: React.ComponentType<MFEProps>;
  /** Optional static metadata (used for help/autocomplete) */
  metadata?: MFEMetadata;
}

export interface MFEMetadata {
  name: string;
  mnemonic: string;
  description: string;
  version: string;
  category: MFECategory;
  /** Data sources this MFE reads (for transparency) */
  dataSources?: string[];
}

// ── Registry entry ─────────────────────────────────────────────────────────────
export interface RegistryEntry {
  /** URL to the remote's remoteEntry.js (or bundled UMD) */
  url: string;
  /** window[scope] set by the remote's remoteEntry.js */
  scope: string;
  /** Exposed module name, e.g. "./DES" */
  module: string;
  /** For internal (monolithic) panels: skip remote loading, use this */
  internalRoute?: string;
  metadata: MFEMetadata;
}

// ── Shell → MFE init handshake ────────────────────────────────────────────────
export interface SharedDependencies {
  react: unknown;
  'react-dom': unknown;
}
