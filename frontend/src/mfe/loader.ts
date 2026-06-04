/**
 * Dynamic MFE Loader
 *
 * Loads remote MFE bundles at runtime using ES dynamic import().
 * Compatible with @originjs/vite-plugin-federation v1.3.x output, which
 * emits remoteEntry.js as an ES module exporting { init, get } — NOT a
 * UMD global. Script-tag injection + window[scope] only works for Webpack.
 *
 * Protocol:
 *  1. import(remoteEntryUrl) → { init, get }
 *  2. container.init(sharedScope) — registers our React singleton so the
 *     remote reuses it instead of bundling a second copy
 *  3. container.get('./DES') → factory() → module.default (React component)
 *
 * The remote's vite.config must set:  preview: { cors: true } and
 * headers: { 'Access-Control-Allow-Origin': '*' } so the browser permits
 * the cross-origin dynamic import from localhost:3000 → localhost:3001+.
 */

import React from 'react';
import type { MFEProps } from './types';
import { eventBus } from './bus';

// ── Internal cache ─────────────────────────────────────────────────────────────
const _initedScopes = new Set<string>();
const _componentCache = new Map<string, React.ComponentType<MFEProps>>();
const _inflight = new Map<string, Promise<React.ComponentType<MFEProps>>>();

// vite-plugin-federation container interface (ESM named exports)
interface MFEContainer {
  init(shareScope: Record<string, unknown>): Promise<void> | void;
  get(module: string): Promise<() => { default?: React.ComponentType<MFEProps>; [k: string]: unknown }>;
}

// ── Share scope ────────────────────────────────────────────────────────────────
// Registers the host's React instance as the singleton for all remotes.
// Remotes that declare react as a shared singleton will reuse this.
function buildShareScope(): Record<string, unknown> {
  return {
    react: {
      [React.version]: {
        get: () => Promise.resolve(() => React),
        loaded: 1,
        eager: true,
        from: 'bti-shell',
        shareConfig: { singleton: true, requiredVersion: '^18.3.1' },
      },
    },
  };
}

// ── Core loader ────────────────────────────────────────────────────────────────
export async function loadRemoteComponent(
  url: string,
  scope: string,
  module: string,
): Promise<React.ComponentType<MFEProps>> {
  const cacheKey = `${scope}/${module}`;

  if (_componentCache.has(cacheKey)) return _componentCache.get(cacheKey)!;
  if (_inflight.has(cacheKey)) return _inflight.get(cacheKey)!;

  const t0 = performance.now();

  const load = (async () => {
    // 1. Dynamic import of the remote entry (ESM, requires CORS headers on remote)
    let container: MFEContainer;
    try {
      // @vite-ignore suppresses Vite's dynamic-import analysis warning
      container = await import(/* @vite-ignore */ url) as MFEContainer;
    } catch (e: any) {
      throw new Error(`MFE bundle load failed: ${url} — ${e?.message ?? e}`);
    }

    if (typeof container?.get !== 'function') {
      throw new Error(
        `Remote "${scope}" remoteEntry at ${url} does not export { init, get }. ` +
        'Ensure the remote was built with @originjs/vite-plugin-federation.',
      );
    }

    // 2. Init with shared React singleton (once per scope)
    if (!_initedScopes.has(scope)) {
      await container.init?.(buildShareScope());
      _initedScopes.add(scope);
    }

    // 3. Get the exposed module factory
    const factory = await container.get(module);
    const mod = factory();
    // mod.default can be a plain function OR a React.memo / forwardRef / lazy
    // object ($$typeof symbol) — both are valid renderable component types.
    const raw = mod.default ?? mod;
    const Component = raw as React.ComponentType<MFEProps>;

    const isValidComponent =
      typeof raw === 'function' ||
      (typeof raw === 'object' && raw !== null && !!(raw as any).$$typeof);

    if (!isValidComponent) {
      throw new Error(
        `Remote "${scope}" module "${module}" default export is not a React component ` +
        `(got ${typeof raw}).`,
      );
    }

    _componentCache.set(cacheKey, Component);
    _inflight.delete(cacheKey);

    eventBus.emit('MFE_LOADED', {
      mnemonic: scope,
      scope,
      durationMs: Math.round(performance.now() - t0),
    });

    return Component;
  })();

  _inflight.set(cacheKey, load);
  load.catch(() => _inflight.delete(cacheKey));
  return load;
}

// ── React.lazy-compatible wrapper ──────────────────────────────────────────────
export function lazyRemote(
  url: string,
  scope: string,
  module: string,
): React.LazyExoticComponent<React.ComponentType<MFEProps>> {
  return React.lazy(() =>
    loadRemoteComponent(url, scope, module).then(Component => ({ default: Component })),
  );
}

// ── Cache management ───────────────────────────────────────────────────────────

/** Force-reload a scope (e.g. after a hot-deploy of the remote) */
export function invalidateRemote(scope: string): void {
  for (const key of _componentCache.keys()) {
    if (key.startsWith(`${scope}/`)) _componentCache.delete(key);
  }
  _initedScopes.delete(scope);
}

export function isRemoteLoaded(scope: string, module: string): boolean {
  return _componentCache.has(`${scope}/${module}`);
}
