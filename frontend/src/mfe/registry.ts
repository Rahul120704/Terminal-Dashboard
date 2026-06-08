/**
 * MFE Mnemonic Registry
 *
 * Maps Bloomberg-style mnemonics to their remote bundle URLs and exposed modules.
 * The registry is the single source of truth for the CLI parser.
 *
 * For panels that are still monolithic (not yet split into separate remotes),
 * set `internalRoute` instead of `url/scope/module`.  The loader honours this
 * and routes internally without any network fetch.
 *
 * ── Remote hosting ──────────────────────────────────────────────────────────
 * Remotes are built independently (separate mfe-<slug> projects) and served
 * same-origin from `/mfe/<slug>/assets/remoteEntry.js`. Two hosts, one path:
 *   • DEV:  a custom Vite middleware (see vite.config.ts `mfeHostPlugin`) streams
 *           the bundles from D:\BB\mfe-host, running BEFORE Vite's module
 *           transform so the JS is served verbatim (Vite otherwise mangles
 *           dynamically-imported modules with a ?import suffix and breaks them).
 *   • PROD: the FastAPI backend's StaticFiles mount at /mfe (see main.py).
 * Same-origin → no CORS, and the path is identical in both environments.
 * Rebuild + redeploy a remote with `npm run mfe:deploy`.
 *
 * Override with VITE_MFE_BASE_URL for a CDN / separate origin, e.g.
 * "https://cdn.example.com/mfe" — the slug + entry are appended.
 */

import type { RegistryEntry, MFECategory } from './types';

// Default: same-origin `/mfe`. Override with a full base (CDN) via env.
const MFE_BASE: string = (import.meta as any).env?.VITE_MFE_BASE_URL ?? '/mfe';

/**
 * Build a remote entry URL for a given slug.
 *  - slug: stable path segment under the host (e.g. 'des', 'gp')
 *  - _port: legacy dev-server port — retained for call-site clarity, unused.
 */
function remoteUrl(slug: string, _port?: number, entry = 'assets/remoteEntry.js'): string {
  const base = MFE_BASE.replace(/\/+$/, '');
  return `${base}/${slug}/${entry}`;
}

// ── Full registry ──────────────────────────────────────────────────────────────
export const REGISTRY: Record<string, RegistryEntry> = {
  // ── Equities ──────────────────────────────────────────────────────────────────
  DES: {
    url: remoteUrl('des', 3001),
    scope: 'mfe_des',
    module: './DES',
    metadata: {
      name: 'Security Description',
      mnemonic: 'DES',
      description: 'Company overview, financials, filings & corporate actions',
      version: '1.0.0',
      category: 'EQUITY',
      dataSources: ['NSE', 'Screener.in', 'BSE Corporate Announcements'],
    },
  },
  GP: {
    url: remoteUrl('gp', 3002),
    scope: 'mfe_gp',
    module: './GP',
    metadata: {
      name: 'Graph & Chart Plotter',
      mnemonic: 'GP',
      description: 'Multi-series OHLCV chart with indicators and comparisons',
      version: '1.0.0',
      category: 'EQUITY',
      dataSources: ['Fyers WS', 'DuckDB OHLCV'],
    },
  },

  // ── Internal fallbacks (monolithic panels) ─────────────────────────────────
  // These use internalRoute → shell switches panel directly, no network fetch
  CHART: {
    url: '', scope: '', module: '',
    internalRoute: 'chart',
    metadata: { name: 'Chart', mnemonic: 'CHART', description: 'OHLCV chart', version: '1.0.0', category: 'EQUITY' },
  },
  NEWS: {
    url: '', scope: '', module: '',
    internalRoute: 'news',
    metadata: { name: 'News Feed', mnemonic: 'NEWS', description: 'Live financial news', version: '1.0.0', category: 'EQUITY' },
  },
  FA: {
    url: '', scope: '', module: '',
    internalRoute: 'fundamentals',
    metadata: { name: 'Fundamental Analysis', mnemonic: 'FA', description: 'P/E, ROE, ROCE, DCF', version: '1.0.0', category: 'EQUITY' },
  },
  EQS: {
    url: '', scope: '', module: '',
    internalRoute: 'screener',
    metadata: { name: 'Equity Screener', mnemonic: 'EQS', description: 'Multi-factor stock screener', version: '1.0.0', category: 'EQUITY' },
  },
  OPT: {
    url: '', scope: '', module: '',
    internalRoute: 'options',
    metadata: { name: 'Options Chain', mnemonic: 'OPT', description: 'NSE F&O options chain', version: '1.0.0', category: 'DERIVATIVES' },
  },
  OVME: {
    url: '', scope: '', module: '',
    internalRoute: 'ivsurf',
    metadata: { name: 'Option Valuation', mnemonic: 'OVME', description: 'BSM pricing & IV surface', version: '1.0.0', category: 'DERIVATIVES' },
  },
  YCRV: {
    url: '', scope: '', module: '',
    internalRoute: 'yield-curve',
    metadata: { name: 'Yield Curve', mnemonic: 'YCRV', description: 'G-Sec yield curve, SDLs & spread', version: '1.0.0', category: 'FIXED_INCOME' },
  },
  CBR: {
    url: '', scope: '', module: '',
    internalRoute: 'wirp',
    metadata: { name: 'RBI Rate Monitor', mnemonic: 'CBR', description: 'MPC rate decisions & implied repo', version: '1.0.0', category: 'FIXED_INCOME' },
  },
  WIRP: {
    url: '', scope: '', module: '',
    internalRoute: 'wirp',
    metadata: { name: 'Rate Hike Probability', mnemonic: 'WIRP', description: 'Implied probability of RBI rate changes', version: '1.0.0', category: 'FIXED_INCOME' },
  },
  ECO: {
    url: '', scope: '', module: '',
    internalRoute: 'calendar',
    metadata: { name: 'Economic Calendar', mnemonic: 'ECO', description: 'MOSPI CPI/IIP/GDP releases & global events', version: '1.0.0', category: 'MACRO' },
  },
  BTMM: {
    url: '', scope: '', module: '',
    internalRoute: 'macro',
    metadata: { name: 'Macro Dashboard', mnemonic: 'BTMM', description: 'Inflation, rates, GDP & monetary aggregates', version: '1.0.0', category: 'MACRO' },
  },
  WFX: {
    url: '', scope: '', module: '',
    internalRoute: 'fx-matrix',
    metadata: { name: 'FX Matrix', mnemonic: 'WFX', description: 'USDINR/EURINR cross rates & OTC forwards', version: '1.0.0', category: 'FX' },
  },
  BETA: {
    url: '', scope: '', module: '',
    internalRoute: 'beta',
    metadata: { name: 'Beta Analysis', mnemonic: 'BETA', description: 'Rolling beta vs Nifty & sector', version: '1.0.0', category: 'EQUITY' },
  },
  WACC: {
    url: '', scope: '', module: '',
    internalRoute: 'wacc',
    metadata: { name: 'WACC Calculator', mnemonic: 'WACC', description: 'Weighted avg cost of capital', version: '1.0.0', category: 'EQUITY' },
  },
  DCF: {
    url: '', scope: '', module: '',
    internalRoute: 'dcf',
    metadata: { name: 'DCF Valuation', mnemonic: 'DCF', description: 'Discounted cash flow model', version: '1.0.0', category: 'EQUITY' },
  },
  ESG: {
    url: '', scope: '', module: '',
    internalRoute: 'esg',
    metadata: { name: 'ESG / BRSR', mnemonic: 'ESG', description: 'SEBI BRSR compliance & sustainability scores', version: '1.0.0', category: 'ALT_DATA' },
  },
  MA: {
    url: '', scope: '', module: '',
    internalRoute: 'mna',
    metadata: { name: 'M&A Tracker', mnemonic: 'MA', description: 'Deal flow, rumours & event analytics', version: '1.0.0', category: 'CORP_GOVERNANCE' },
  },
  CGOV: {
    url: '', scope: '', module: '',
    internalRoute: 'company-overview',  // rendered in PanelRouter as v === 'company-overview'
    metadata: { name: 'Corporate Governance', mnemonic: 'CGOV', description: 'Board structure, promoter stakes & MCA filings', version: '1.0.0', category: 'CORP_GOVERNANCE' },
  },
  CACS: {
    url: '', scope: '', module: '',
    internalRoute: 'corporate-actions',
    metadata: { name: 'Corporate Actions', mnemonic: 'CACS', description: 'Splits, bonuses, dividends & rights issues', version: '1.0.0', category: 'CORP_GOVERNANCE' },
  },
  HF: {
    url: '', scope: '', module: '',
    internalRoute: 'hf',
    metadata: { name: 'Hedge Fund Signals', mnemonic: 'HF', description: 'AI-driven positioning & signal attribution', version: '1.0.0', category: 'PORTFOLIO' },
  },
  PORT: {
    url: '', scope: '', module: '',
    internalRoute: 'portfolio',
    metadata: { name: 'Portfolio', mnemonic: 'PORT', description: 'Watchlist P&L and positions', version: '1.0.0', category: 'PORTFOLIO' },
  },
  AI: {
    url: '', scope: '', module: '',
    internalRoute: 'copilot',
    metadata: { name: 'AI Copilot', mnemonic: 'AI', description: 'Claude-powered terminal assistant', version: '1.0.0', category: 'ALT_DATA' },
  },
  CLIM: {
    url: '', scope: '', module: '',
    internalRoute: 'esg',
    metadata: { name: 'Climate Risk', mnemonic: 'CLIM', description: 'Physical climate risk for Indian manufacturing hubs', version: '1.0.0', category: 'ALT_DATA' },
  },
  SUPP: {
    url: '', scope: '', module: '',
    internalRoute: 'splc',
    metadata: { name: 'Supply Chain', mnemonic: 'SUPP', description: 'Tier 1/2 dependency mapping', version: '1.0.0', category: 'ALT_DATA' },
  },
  BT: {
    url: '', scope: '', module: '',
    internalRoute: 'backtest',
    metadata: { name: 'Backtester', mnemonic: 'BT', description: 'Polars vectorized strategy backtest', version: '1.0.0', category: 'RISK' },
  },
};

// ── Lookup helpers ─────────────────────────────────────────────────────────────

/** Resolve an entry — case-insensitive */
export function resolve(mnemonic: string): RegistryEntry | undefined {
  return REGISTRY[mnemonic.toUpperCase()];
}

/** All entries for a given category */
export function byCategory(cat: MFECategory): RegistryEntry[] {
  return Object.values(REGISTRY).filter(e => e.metadata.category === cat);
}

/** Fuzzy search by mnemonic prefix or name fragment */
export function search(query: string): RegistryEntry[] {
  const q = query.toUpperCase();
  return Object.values(REGISTRY).filter(
    e =>
      e.metadata.mnemonic.startsWith(q) ||
      e.metadata.name.toUpperCase().includes(q) ||
      e.metadata.description.toUpperCase().includes(q),
  );
}

/** All known mnemonics (for autocomplete) */
export const ALL_MNEMONICS = Object.keys(REGISTRY);
