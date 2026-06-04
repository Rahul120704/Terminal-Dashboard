/**
 * TitleBarContext — shared between App (Provider) and Terminal (Consumer).
 *
 * Lives in its own file to break the circular import that caused the infinite loop:
 *   App.tsx → Terminal.tsx → App.tsx  (circular)
 *
 * Correct dependency graph:
 *   App.tsx → TitleBarContext.ts  (provides)
 *   Terminal.tsx → TitleBarContext.ts  (consumes)
 *   No cycle.
 */

import { createContext } from 'react';

export interface TitleBarCtx {
  setTicker(symbol: string, price: number, changePct: number): void;
  setConnected(v: boolean): void;
}

export const TitleBarContext = createContext<TitleBarCtx>({
  setTicker:    () => {},
  setConnected: () => {},
});
