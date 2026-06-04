import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ColorType, CrosshairMode, LineStyle } from 'lightweight-charts';
import { OHLCVBar, TechnicalSignal } from '../types';
import { apiFetch } from '../hooks/useApi';

interface Props {
  symbol: string;
  onSendWS: (msg: object) => void;
  technicals?: TechnicalSignal;
  lastTick?: { symbol: string; price: number; volume?: number; time?: number } | null;
}

type Interval  = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1wk' | '1mo';
type Period    = '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y';
type ChartType = 'candle' | 'heikin-ashi' | 'line' | 'area' | 'bar';

const INTERVALS: Interval[] = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d', '1wk', '1mo'];
const PERIODS:   Period[]   = ['5d', '1mo', '3mo', '6mo', '1y', '2y', '5y'];
const CHART_TYPES: { key: ChartType; label: string }[] = [
  { key: 'candle',      label: 'C'  },
  { key: 'heikin-ashi', label: 'HA' },
  { key: 'line',        label: 'L'  },
  { key: 'area',        label: 'A'  },
  { key: 'bar',         label: 'B'  },
];

const THEME = {
  bg:      '#0a0a0a',
  grid:    'rgba(34,34,34,0.8)',
  text:    '#8a8a7a',
  up:      '#00c853',
  down:    '#ff3d00',
  volUp:   'rgba(0,200,83,0.3)',
  volDown: 'rgba(255,61,0,0.3)',
};

// ── Technical indicator math ───────────────────────────────────────────────────

function computeEMA(closes: number[], period: number): (number | null)[] {
  if (closes.length < period) return closes.map(() => null);
  const k = 2 / (period + 1);
  const result: (number | null)[] = new Array(period - 1).fill(null);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(ema);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

function computeSMA(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) =>
    i < period - 1 ? null : closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
  );
}

function computeRSI(closes: number[], period = 14): (number | null)[] {
  if (closes.length <= period) return closes.map(() => null);
  const result: (number | null)[] = new Array(period).fill(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d / period;
    else avgLoss += -d / period;
  }
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function computeMACD(closes: number[], fast = 12, slow = 26, sig = 9) {
  const ema12 = computeEMA(closes, fast);
  const ema26 = computeEMA(closes, slow);
  const macdLine: (number | null)[] = ema12.map((v, i) =>
    v !== null && ema26[i] !== null ? v - ema26[i]! : null
  );
  const validMacd = macdLine.filter(v => v !== null) as number[];
  const sigEMA = computeEMA(validMacd, sig);
  const firstValid = macdLine.findIndex(v => v !== null);
  const signalLine: (number | null)[] = new Array(firstValid + sig - 1).fill(null);
  sigEMA.slice(sig - 1).forEach(v => signalLine.push(v));
  while (signalLine.length < closes.length) signalLine.push(null);
  const hist: (number | null)[] = macdLine.map((v, i) =>
    v !== null && signalLine[i] !== null ? v - signalLine[i]! : null
  );
  return { macdLine, signalLine, hist };
}

function computeBollingerBands(closes: number[], period = 20, stddev = 2) {
  const sma = computeSMA(closes, period);
  return closes.map((_, i) => {
    if (i < period - 1) return { upper: null, mid: null, lower: null };
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = sma[i]!;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance) * stddev;
    return { upper: mean + sd, mid: mean, lower: mean - sd };
  });
}

function computeVWAP(bars: OHLCVBar[]): (number | null)[] {
  let cumPV = 0, cumVol = 0;
  return bars.map(b => {
    const typ = (b.high + b.low + b.close) / 3;
    cumPV += typ * b.volume;
    cumVol += b.volume;
    return cumVol > 0 ? cumPV / cumVol : null;
  });
}

/** Heikin-Ashi OHLC transformation — smooths noise, easier trend reading. */
function toHeikinAshi(bars: OHLCVBar[]): OHLCVBar[] {
  const ha: OHLCVBar[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b       = bars[i];
    const haClose = (b.open + b.high + b.low + b.close) / 4;
    const haOpen  = i === 0
      ? (b.open + b.close) / 2
      : (ha[i - 1].open + ha[i - 1].close) / 2;
    const haHigh  = Math.max(b.high, haOpen, haClose);
    const haLow   = Math.min(b.low,  haOpen, haClose);
    ha.push({ time: b.time, open: haOpen, high: haHigh, low: haLow, close: haClose, volume: b.volume });
  }
  return ha;
}

/** Wilder's ATR — used by Fyers, TradingView, and every institutional system. */
function computeATR(bars: OHLCVBar[], period = 14): (number | null)[] {
  if (bars.length < 2) return bars.map(() => null);
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const hl = bars[i].high  - bars[i].low;
    const hc = Math.abs(bars[i].high - bars[i - 1].close);
    const lc = Math.abs(bars[i].low  - bars[i - 1].close);
    trs.push(Math.max(hl, hc, lc));
  }
  if (trs.length < period) return bars.map(() => null);
  const result: (number | null)[] = new Array(period).fill(null);
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(atr);
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    result.push(atr);
  }
  return result;
}

/** Stochastic %K and %D (same formula Fyers uses). */
function computeStochastic(bars: OHLCVBar[], kPeriod = 14, dPeriod = 3)
  : { k: (number | null)[], d: (number | null)[] } {
  const k: (number | null)[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < kPeriod - 1) { k.push(null); continue; }
    const slice = bars.slice(i - kPeriod + 1, i + 1);
    const hh    = Math.max(...slice.map(b => b.high));
    const ll    = Math.min(...slice.map(b => b.low));
    k.push(hh === ll ? 50 : ((bars[i].close - ll) / (hh - ll)) * 100);
  }
  const kFill = k.map(v => v ?? 0);
  const dRaw  = computeSMA(kFill, dPeriod);
  const d     = dRaw.map((v, i) => k[i] !== null && i >= kPeriod + dPeriod - 2 ? v : null);
  return { k, d };
}

/** Williams %R — momentum oscillator, range [-100, 0]. */
function computeWilliamsR(bars: OHLCVBar[], period = 14): (number | null)[] {
  return bars.map((_, i) => {
    if (i < period - 1) return null;
    const slice = bars.slice(i - period + 1, i + 1);
    const hh    = Math.max(...slice.map(b => b.high));
    const ll    = Math.min(...slice.map(b => b.low));
    return hh === ll ? -50 : ((hh - bars[i].close) / (hh - ll)) * -100;
  });
}

/** Commodity Channel Index — identifies cyclical trends. */
function computeCCI(bars: OHLCVBar[], period = 20): (number | null)[] {
  return bars.map((_, i) => {
    if (i < period - 1) return null;
    const slice    = bars.slice(i - period + 1, i + 1);
    const typicals = slice.map(b => (b.high + b.low + b.close) / 3);
    const mean     = typicals.reduce((s, v) => s + v, 0) / period;
    const meanDev  = typicals.reduce((s, v) => s + Math.abs(v - mean), 0) / period;
    return meanDev === 0 ? 0 : (typicals[typicals.length - 1] - mean) / (0.015 * meanDev);
  });
}

/** Parabolic SAR — trend-following stop-and-reverse. */
function computeParabolicSAR(bars: OHLCVBar[], step = 0.02, max = 0.2): (number | null)[] {
  if (bars.length < 2) return bars.map(() => null);
  const result: (number | null)[] = [null];
  let bull = true;
  let af   = step;
  let ep   = bars[0].high;
  let sar  = bars[0].low;

  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const curr = bars[i];
    sar = sar + af * (ep - sar);
    if (bull) {
      sar = Math.min(sar, prev.low, i > 1 ? bars[i - 2].low : prev.low);
      if (curr.low < sar) {
        bull = false; sar = ep; ep = curr.low; af = step;
      } else {
        if (curr.high > ep) { ep = curr.high; af = Math.min(af + step, max); }
      }
    } else {
      sar = Math.max(sar, prev.high, i > 1 ? bars[i - 2].high : prev.high);
      if (curr.high > sar) {
        bull = true; sar = ep; ep = curr.high; af = step;
      } else {
        if (curr.low < ep) { ep = curr.low; af = Math.min(af + step, max); }
      }
    }
    result.push(sar);
  }
  return result;
}

/** On-Balance Volume — cumulative volume trend. */
function computeOBV(bars: OHLCVBar[]): number[] {
  let obv = 0;
  return bars.map((b, i) => {
    if (i === 0) return obv;
    if (b.close > bars[i - 1].close)      obv += b.volume;
    else if (b.close < bars[i - 1].close) obv -= b.volume;
    return obv;
  });
}

// ── Chart component ───────────────────────────────────────────────────────────

export const Chart: React.FC<Props> = ({ symbol, onSendWS, technicals, lastTick }) => {
  const mainRef  = useRef<HTMLDivElement>(null);
  const rsiRef   = useRef<HTMLDivElement>(null);
  const macdRef  = useRef<HTMLDivElement>(null);
  const atrRef   = useRef<HTMLDivElement>(null);
  const stochRef = useRef<HTMLDivElement>(null);
  const obvRef   = useRef<HTMLDivElement>(null);

  const chartRef   = useRef<IChartApi | null>(null);
  const rsiChart   = useRef<IChartApi | null>(null);
  const macdChart  = useRef<IChartApi | null>(null);
  const atrChart   = useRef<IChartApi | null>(null);
  const stochChart = useRef<IChartApi | null>(null);
  const obvChart   = useRef<IChartApi | null>(null);

  const seriesRef   = useRef<any>({});
  const rsiSerRef   = useRef<any>({});
  const macdSerRef  = useRef<any>({});
  const atrSerRef   = useRef<any>({});
  const stochSerRef = useRef<any>({});
  const obvSerRef   = useRef<any>({});
  const barsRef     = useRef<OHLCVBar[]>([]);

  const [interval,   setInterval]   = useState<Interval>('1d');
  const [period,     setPeriod]     = useState<Period>('1y');
  const [chartType,  setChartType]  = useState<ChartType>('candle');
  const [showEMA,    setShowEMA]    = useState(true);
  const [showSMA,    setShowSMA]    = useState(false);
  const [showBB,     setShowBB]     = useState(false);
  const [showVWAP,   setShowVWAP]   = useState(false);
  const [showPSAR,   setShowPSAR]   = useState(false);
  const [showRSI,    setShowRSI]    = useState(true);
  const [showMACD,   setShowMACD]   = useState(false);
  const [showATR,    setShowATR]    = useState(false);
  const [showStoch,  setShowStoch]  = useState(false);
  const [showOBV,    setShowOBV]    = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [depthData,  setDepthData]  = useState<any>(null);
  const [showDepth,  setShowDepth]  = useState(false);

  /** Fyers resolution string from our interval type. */
  const toFyersResolution = (iv: Interval): string => {
    const map: Record<string, string> = {
      '1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m',
      '1h':'1h','4h':'4h','1d':'D','1wk':'W','1mo':'M',
    };
    return map[iv] || 'D';
  };

  const toFyersDays = (p: Period): number => {
    const map: Record<string, number> = {
      '5d':5,'1mo':30,'3mo':90,'6mo':180,'1y':365,'2y':730,'5y':1825,
    };
    return map[p] || 365;
  };

  const createChartOpts = (el: HTMLDivElement, h: number, showAxis: boolean) => createChart(el, {
    width: el.clientWidth || 900,
    height: h,
    layout: {
      background: { type: ColorType.Solid, color: THEME.bg },
      textColor: THEME.text,
      fontFamily: 'Consolas, monospace',
      fontSize: 11,
    },
    grid: {
      vertLines: { color: THEME.grid, style: LineStyle.Dotted },
      horzLines: { color: THEME.grid, style: LineStyle.Dotted },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: 'rgba(255,149,0,0.5)', width: 1, style: LineStyle.Dashed },
      horzLine: { color: 'rgba(255,149,0,0.5)', width: 1, style: LineStyle.Dashed },
    },
    rightPriceScale: { borderColor: '#222222', visible: showAxis },
    timeScale: { borderColor: '#222222', timeVisible: true, visible: showAxis },
  });

  // ── Build / rebuild all chart panes ─────────────────────────────────────────
  const buildCharts = useCallback(() => {
    if (!mainRef.current) return;

    // Destroy all existing charts cleanly
    try { chartRef.current?.remove(); }   catch (_) {}
    try { rsiChart.current?.remove(); }   catch (_) {}
    try { macdChart.current?.remove(); }  catch (_) {}
    try { atrChart.current?.remove(); }   catch (_) {}
    try { stochChart.current?.remove(); } catch (_) {}
    try { obvChart.current?.remove(); }   catch (_) {}
    seriesRef.current   = {};
    rsiSerRef.current   = {};
    macdSerRef.current  = {};
    atrSerRef.current   = {};
    stochSerRef.current = {};
    obvSerRef.current   = {};

    const totalH = mainRef.current.parentElement?.clientHeight || 600;
    const rsiH   = showRSI   ? 100 : 0;
    const macdH  = showMACD  ? 100 : 0;
    const atrH   = showATR   ? 80  : 0;
    const stochH = showStoch ? 80  : 0;
    const obvH   = showOBV   ? 80  : 0;
    const mainH  = Math.max(120, totalH - rsiH - macdH - atrH - stochH - obvH - 2);

    // ── Main chart ────────────────────────────────────────────────────────────
    const chart = createChartOpts(mainRef.current, mainH, true);
    chartRef.current = chart;

    // Primary price series — depends on chartType
    if (chartType === 'candle' || chartType === 'heikin-ashi') {
      seriesRef.current.candle = chart.addCandlestickSeries({
        upColor:        THEME.up,   downColor:        THEME.down,
        borderUpColor:  THEME.up,   borderDownColor:  THEME.down,
        wickUpColor:    THEME.up,   wickDownColor:    THEME.down,
      });
    } else if (chartType === 'line') {
      seriesRef.current.line = chart.addLineSeries({
        color: '#00b8d4', lineWidth: 2,
        priceLineVisible: true, lastValueVisible: true,
      });
    } else if (chartType === 'area') {
      seriesRef.current.area = chart.addAreaSeries({
        topColor:    'rgba(0,184,212,0.4)',
        bottomColor: 'rgba(0,184,212,0.0)',
        lineColor:   '#00b8d4', lineWidth: 2,
        priceLineVisible: true, lastValueVisible: true,
      });
    } else if (chartType === 'bar') {
      seriesRef.current.bar = chart.addBarSeries({
        upColor: THEME.up, downColor: THEME.down,
      });
    }

    // Volume histogram (always shown)
    seriesRef.current.volume = chart.addHistogramSeries({
      color: THEME.volUp, priceFormat: { type: 'volume' }, priceScaleId: 'vol',
    });
    seriesRef.current.volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    // Overlay indicator series (price scale)
    seriesRef.current.ema20   = chart.addLineSeries({ color: '#ff9500',              lineWidth: 1, title: 'EMA20',  priceLineVisible: false, lastValueVisible: false });
    seriesRef.current.ema50   = chart.addLineSeries({ color: '#2979ff',              lineWidth: 1, title: 'EMA50',  priceLineVisible: false, lastValueVisible: false });
    seriesRef.current.ema200  = chart.addLineSeries({ color: '#ff3d00',              lineWidth: 1, title: 'EMA200', priceLineVisible: false, lastValueVisible: false });
    seriesRef.current.sma20   = chart.addLineSeries({ color: '#e91e63',              lineWidth: 1, title: 'SMA20',  priceLineVisible: false, lastValueVisible: false });
    seriesRef.current.sma50   = chart.addLineSeries({ color: '#9c27b0',              lineWidth: 1, title: 'SMA50',  priceLineVisible: false, lastValueVisible: false });
    seriesRef.current.bbUpper = chart.addLineSeries({ color: 'rgba(0,184,212,0.5)',  lineWidth: 1, title: 'BB+',    priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dashed });
    seriesRef.current.bbMid   = chart.addLineSeries({ color: 'rgba(0,184,212,0.3)',  lineWidth: 1, title: 'BB~',    priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dashed });
    seriesRef.current.bbLower = chart.addLineSeries({ color: 'rgba(0,184,212,0.5)',  lineWidth: 1, title: 'BB-',    priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dashed });
    seriesRef.current.vwap    = chart.addLineSeries({ color: '#ffd600',              lineWidth: 1, title: 'VWAP',   priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dashed });
    seriesRef.current.psar    = chart.addLineSeries({ color: '#ffd600',              lineWidth: 1, title: 'PSAR',   priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dotted });

    // Time-scale sync helper
    const syncRange = (sub: IChartApi) =>
      chart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r) sub.timeScale().setVisibleLogicalRange(r); });

    // ── RSI sub-chart ─────────────────────────────────────────────────────────
    if (showRSI && rsiRef.current) {
      const rc = createChartOpts(rsiRef.current, rsiH, false);
      rsiChart.current = rc;
      rc.applyOptions({ timeScale: { visible: false } });
      rsiSerRef.current.rsi = rc.addLineSeries({ color: '#00b8d4', lineWidth: 1, title: 'RSI14', priceLineVisible: false });
      rsiSerRef.current.ob  = rc.addLineSeries({ color: 'rgba(255,61,0,0.4)',  lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false });
      rsiSerRef.current.os  = rc.addLineSeries({ color: 'rgba(0,200,83,0.4)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false });
      syncRange(rc);
    }

    // ── MACD sub-chart ────────────────────────────────────────────────────────
    if (showMACD && macdRef.current) {
      const mc = createChartOpts(macdRef.current, macdH, false);
      macdChart.current = mc;
      mc.applyOptions({ timeScale: { visible: false } });
      macdSerRef.current.hist   = mc.addHistogramSeries({ color: '#00c853', priceScaleId: 'right', priceLineVisible: false });
      macdSerRef.current.macd   = mc.addLineSeries({ color: '#ff9500', lineWidth: 1, priceLineVisible: false });
      macdSerRef.current.signal = mc.addLineSeries({ color: '#2979ff', lineWidth: 1, priceLineVisible: false });
      syncRange(mc);
    }

    // ── ATR sub-chart ─────────────────────────────────────────────────────────
    if (showATR && atrRef.current) {
      const ac = createChartOpts(atrRef.current, atrH, false);
      atrChart.current = ac;
      ac.applyOptions({ timeScale: { visible: false } });
      atrSerRef.current.atr = ac.addLineSeries({ color: '#ab47bc', lineWidth: 1, title: 'ATR14', priceLineVisible: false });
      syncRange(ac);
    }

    // ── Stochastic sub-chart ──────────────────────────────────────────────────
    if (showStoch && stochRef.current) {
      const sc = createChartOpts(stochRef.current, stochH, false);
      stochChart.current = sc;
      sc.applyOptions({ timeScale: { visible: false } });
      stochSerRef.current.k  = sc.addLineSeries({ color: '#00b8d4', lineWidth: 1, title: '%K',  priceLineVisible: false });
      stochSerRef.current.d  = sc.addLineSeries({ color: '#ff9500', lineWidth: 1, title: '%D',  priceLineVisible: false, lineStyle: LineStyle.Dashed });
      stochSerRef.current.ob = sc.addLineSeries({ color: 'rgba(255,61,0,0.4)',  lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false });
      stochSerRef.current.os = sc.addLineSeries({ color: 'rgba(0,200,83,0.4)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false });
      syncRange(sc);
    }

    // ── OBV sub-chart ─────────────────────────────────────────────────────────
    if (showOBV && obvRef.current) {
      const oc = createChartOpts(obvRef.current, obvH, false);
      obvChart.current = oc;
      oc.applyOptions({ timeScale: { visible: false } });
      obvSerRef.current.obv = oc.addLineSeries({ color: '#26c6da', lineWidth: 1, title: 'OBV', priceLineVisible: false });
      syncRange(oc);
    }

    // ResizeObserver — keeps all panes the right width
    const ro = new ResizeObserver(() => {
      if (!mainRef.current || !chartRef.current) return;
      const w = mainRef.current.clientWidth;
      chartRef.current.resize(w, mainH);
      if (showRSI   && rsiRef.current   && rsiChart.current)   rsiChart.current.resize(w, rsiH);
      if (showMACD  && macdRef.current  && macdChart.current)  macdChart.current.resize(w, macdH);
      if (showATR   && atrRef.current   && atrChart.current)   atrChart.current.resize(w, atrH);
      if (showStoch && stochRef.current && stochChart.current) stochChart.current.resize(w, stochH);
      if (showOBV   && obvRef.current   && obvChart.current)   obvChart.current.resize(w, obvH);
    });
    if (mainRef.current.parentElement) ro.observe(mainRef.current.parentElement);
    return () => ro.disconnect();
  }, [showRSI, showMACD, showATR, showStoch, showOBV, chartType]);

  // ── Render all indicators onto existing series ───────────────────────────────
  const renderIndicators = useCallback((bars: OHLCVBar[]) => {
    const closes = bars.map(b => b.close);
    const times  = bars.map(b => b.time);

    const toSeries = (vals: (number | null)[], ts: number[]) =>
      vals.map((v, i) => v !== null ? { time: ts[i] as any, value: v } : null).filter(Boolean) as any[];

    // EMA overlays
    if (showEMA) {
      seriesRef.current.ema20?.setData(toSeries(computeEMA(closes, 20),  times));
      seriesRef.current.ema50?.setData(toSeries(computeEMA(closes, 50),  times));
      seriesRef.current.ema200?.setData(toSeries(computeEMA(closes, 200), times));
    } else {
      seriesRef.current.ema20?.setData([]);
      seriesRef.current.ema50?.setData([]);
      seriesRef.current.ema200?.setData([]);
    }

    // SMA overlays
    if (showSMA) {
      seriesRef.current.sma20?.setData(toSeries(computeSMA(closes, 20), times));
      seriesRef.current.sma50?.setData(toSeries(computeSMA(closes, 50), times));
    } else {
      seriesRef.current.sma20?.setData([]);
      seriesRef.current.sma50?.setData([]);
    }

    // Bollinger Bands
    if (showBB) {
      const bb = computeBollingerBands(closes, 20, 2);
      seriesRef.current.bbUpper?.setData(bb.map((v, i) => v.upper !== null ? { time: times[i] as any, value: v.upper } : null).filter(Boolean));
      seriesRef.current.bbMid?.setData(bb.map((v, i)   => v.mid   !== null ? { time: times[i] as any, value: v.mid   } : null).filter(Boolean));
      seriesRef.current.bbLower?.setData(bb.map((v, i) => v.lower !== null ? { time: times[i] as any, value: v.lower } : null).filter(Boolean));
    } else {
      ['bbUpper', 'bbMid', 'bbLower'].forEach(k => seriesRef.current[k]?.setData([]));
    }

    // VWAP
    if (showVWAP) {
      seriesRef.current.vwap?.setData(toSeries(computeVWAP(bars), times));
    } else {
      seriesRef.current.vwap?.setData([]);
    }

    // Parabolic SAR (overlay on price)
    if (showPSAR) {
      seriesRef.current.psar?.setData(toSeries(computeParabolicSAR(bars), times));
    } else {
      seriesRef.current.psar?.setData([]);
    }

    // RSI sub-chart
    if (showRSI && rsiSerRef.current.rsi) {
      const rsiVals = computeRSI(closes, 14);
      rsiSerRef.current.rsi.setData(toSeries(rsiVals, times));
      rsiSerRef.current.ob?.setData(times.map(t => ({ time: t as any, value: 70 })));
      rsiSerRef.current.os?.setData(times.map(t => ({ time: t as any, value: 30 })));
    }

    // MACD sub-chart
    if (showMACD && macdSerRef.current.macd) {
      const { macdLine, signalLine, hist } = computeMACD(closes);
      macdSerRef.current.macd.setData(toSeries(macdLine, times));
      macdSerRef.current.signal.setData(toSeries(signalLine, times));
      macdSerRef.current.hist.setData(
        hist.map((v, i) => v !== null ? { time: times[i] as any, value: v, color: v >= 0 ? THEME.up : THEME.down } : null).filter(Boolean)
      );
    }

    // ATR sub-chart
    if (showATR && atrSerRef.current.atr) {
      atrSerRef.current.atr.setData(toSeries(computeATR(bars, 14), times));
    }

    // Stochastic sub-chart
    if (showStoch && stochSerRef.current.k) {
      const { k, d } = computeStochastic(bars, 14, 3);
      stochSerRef.current.k.setData(toSeries(k, times));
      stochSerRef.current.d.setData(toSeries(d, times));
      stochSerRef.current.ob?.setData(times.map(t => ({ time: t as any, value: 80 })));
      stochSerRef.current.os?.setData(times.map(t => ({ time: t as any, value: 20 })));
    }

    // OBV sub-chart
    if (showOBV && obvSerRef.current.obv) {
      const obvVals = computeOBV(bars);
      obvSerRef.current.obv.setData(bars.map((b, i) => ({ time: b.time as any, value: obvVals[i] })));
    }
  }, [showEMA, showSMA, showBB, showVWAP, showPSAR, showRSI, showMACD, showATR, showStoch, showOBV]);

  // ── Load historical data from Fyers ─────────────────────────────────────────
  const loadData = useCallback(async () => {
    const hasSeries = seriesRef.current.candle || seriesRef.current.line ||
                      seriesRef.current.area   || seriesRef.current.bar;
    if (!symbol || !hasSeries) return;
    setLoading(true);
    setError(null);
    try {
      // Fyers-only — no yfinance fallback for charts
      const fyersStatus = await apiFetch<{ authenticated: boolean }>('/api/fyers/status');
      if (!fyersStatus?.authenticated) {
        setError('FYERS_OFFLINE');
        setLoading(false);
        return;
      }

      // Fyers intraday data availability limits — requesting beyond these causes API errors
      const INTERVAL_MAX_DAYS: Partial<Record<Interval, number>> = {
        '1m':  60,   // Fyers caps 1-min data at ~60 days
        '3m':  60,
        '5m':  100,
        '15m': 200,
        '30m': 200,
        '1h':  365,
        '4h':  365,
        // daily / weekly / monthly: unlimited
      };
      const cap         = INTERVAL_MAX_DAYS[interval];
      const effectiveDays = cap !== undefined ? Math.min(toFyersDays(period), cap) : toFyersDays(period);

      const bars = await apiFetch<OHLCVBar[]>(
        `/api/fyers/history/${symbol}?resolution=${toFyersResolution(interval)}&days=${effectiveDays}`
      );
      if (!bars?.length) { setError('No data from Fyers for this symbol/interval'); return; }

      const sorted = [...bars].sort((a, b) => a.time - b.time);
      barsRef.current = sorted;

      // Apply Heikin-Ashi transformation for HA chart type
      const displayBars = chartType === 'heikin-ashi' ? toHeikinAshi(sorted) : sorted;

      // Set primary series data
      if (chartType === 'candle' || chartType === 'heikin-ashi') {
        seriesRef.current.candle?.setData(displayBars);
      } else if (chartType === 'line') {
        seriesRef.current.line?.setData(displayBars.map(b => ({ time: b.time as any, value: b.close })));
      } else if (chartType === 'area') {
        seriesRef.current.area?.setData(displayBars.map(b => ({ time: b.time as any, value: b.close })));
      } else if (chartType === 'bar') {
        seriesRef.current.bar?.setData(displayBars);
      }

      // Volume always uses real OHLCV (not HA-transformed) for accurate volume display
      seriesRef.current.volume?.setData(
        sorted.map(b => ({ time: b.time as any, value: b.volume, color: b.close >= b.open ? THEME.volUp : THEME.volDown }))
      );

      renderIndicators(sorted);
      chartRef.current?.timeScale().fitContent();
    } catch (e: any) {
      setError(e?.message || 'Failed to load chart data');
    } finally {
      setLoading(false);
    }
  }, [symbol, period, interval, chartType, renderIndicators]);

  // Rebuild chart panes when layout config changes
  useEffect(() => {
    const cleanup = buildCharts();
    return cleanup;
  }, [buildCharts]);

  // Load data whenever symbol/period/interval/chartType changes
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Re-render indicators when toggles change without full reload
  useEffect(() => {
    if (barsRef.current.length) renderIndicators(barsRef.current);
  }, [renderIndicators]);

  // Real-time tick → update last candle sub-millisecond
  useEffect(() => {
    if (!lastTick || lastTick.symbol !== symbol) return;
    if (!barsRef.current.length) return;
    const mainSeries = seriesRef.current.candle || seriesRef.current.line ||
                       seriesRef.current.area   || seriesRef.current.bar;
    if (!mainSeries) return;

    const last = barsRef.current[barsRef.current.length - 1];
    const now  = lastTick.time || Math.floor(Date.now() / 1000);
    const isSameBar = now - last.time < 300; // within 5-min window
    if (isSameBar) {
      const updated: OHLCVBar = {
        ...last,
        close:  lastTick.price,
        high:   Math.max(last.high, lastTick.price),
        low:    Math.min(last.low,  lastTick.price),
        volume: last.volume + (lastTick.volume || 0),
      };
      if (chartType === 'candle' || chartType === 'heikin-ashi') {
        seriesRef.current.candle?.update({ time: last.time as any, ...updated });
      } else {
        mainSeries.update({ time: last.time as any, value: updated.close });
      }
      seriesRef.current.volume?.update({
        time: last.time as any,
        value: updated.volume,
        color: updated.close >= updated.open ? THEME.volUp : THEME.volDown,
      });
    }
  }, [lastTick, symbol, chartType]);

  // Fetch depth data periodically when showDepth is on
  useEffect(() => {
    if (!showDepth) { setDepthData(null); return; }
    const load = async () => {
      const d = await apiFetch<any>(`/api/market-depth/${symbol}`);
      setDepthData(d);
    };
    load();
    const t = window.setInterval(load, 3000);
    return () => window.clearInterval(t);
  }, [showDepth, symbol]);

  // Sub-chart heights for JSX
  const rsiH   = showRSI   ? 100 : 0;
  const macdH  = showMACD  ? 100 : 0;
  const atrH   = showATR   ? 80  : 0;
  const stochH = showStoch ? 80  : 0;
  const obvH   = showOBV   ? 80  : 0;

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <div className="panel-header" style={{ flexWrap: 'wrap', height: 'auto', minHeight: 28, gap: 2, padding: '3px 6px' }}>
        <span className="panel-title">{symbol}</span>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>

          {/* Chart type switcher */}
          {CHART_TYPES.map(({ key, label }) => (
            <button key={key} className={`btn ${chartType === key ? 'btn-amber' : ''}`}
              onClick={() => setChartType(key)} style={{ padding: '1px 5px', fontSize: 10 }}>
              {label}
            </button>
          ))}
          <span style={{ color: 'var(--border-bright)' }}>|</span>

          {/* Interval selector */}
          {INTERVALS.map(iv => (
            <button key={iv} className={`btn ${interval === iv ? 'btn-amber' : ''}`}
              onClick={() => setInterval(iv)} style={{ padding: '1px 5px', fontSize: 10 }}>
              {iv.toUpperCase()}
            </button>
          ))}
          <span style={{ color: 'var(--border-bright)' }}>|</span>

          {/* Period selector */}
          {PERIODS.map(p => (
            <button key={p} className={`btn ${period === p ? 'btn-amber' : ''}`}
              onClick={() => setPeriod(p)} style={{ padding: '1px 5px', fontSize: 10 }}>
              {p}
            </button>
          ))}
          <span style={{ color: 'var(--border-bright)' }}>|</span>

          {/* Indicator toggles */}
          {([
            { key: 'showEMA',   label: 'EMA',   val: showEMA,   fn: setShowEMA   },
            { key: 'showSMA',   label: 'SMA',   val: showSMA,   fn: setShowSMA   },
            { key: 'showBB',    label: 'BB',    val: showBB,    fn: setShowBB    },
            { key: 'showVWAP',  label: 'VWAP',  val: showVWAP,  fn: setShowVWAP  },
            { key: 'showPSAR',  label: 'PSAR',  val: showPSAR,  fn: setShowPSAR  },
            { key: 'showRSI',   label: 'RSI',   val: showRSI,   fn: setShowRSI   },
            { key: 'showMACD',  label: 'MACD',  val: showMACD,  fn: setShowMACD  },
            { key: 'showATR',   label: 'ATR',   val: showATR,   fn: setShowATR   },
            { key: 'showStoch', label: 'STOCH', val: showStoch, fn: setShowStoch },
            { key: 'showOBV',   label: 'OBV',   val: showOBV,   fn: setShowOBV   },
            { key: 'showDepth', label: 'DEPTH', val: showDepth, fn: setShowDepth },
          ] as const).map(({ key, label, val, fn }) => (
            <button key={key} className={`btn ${val ? 'btn-amber' : ''}`}
              onClick={() => (fn as any)((v: boolean) => !v)} style={{ padding: '1px 5px', fontSize: 10 }}>
              {label}
            </button>
          ))}

          {loading && <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>loading…</span>}
          {lastTick?.symbol === symbol && (
            <span style={{ color: 'var(--green)', fontSize: 9, marginLeft: 4 }}>● LIVE</span>
          )}
        </div>
      </div>

      {/* Fyers offline splash */}
      {error === 'FYERS_OFFLINE' ? (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 12, background: '#0a0a0a', padding: 24,
        }}>
          <div style={{ fontSize: 28, color: 'var(--amber)' }}>⚡</div>
          <div style={{ color: 'var(--amber)', fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>FYERS NOT CONNECTED</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center', maxWidth: 280 }}>
            Charts use Fyers API for live &amp; historical data. Connect your Fyers account to view charts.
          </div>
          <a
            href="http://127.0.0.1:8000/api/fyers/login"
            target="_blank"
            rel="noreferrer"
            style={{
              background: 'var(--amber)', color: '#000', fontWeight: 700, fontSize: 11,
              padding: '6px 18px', borderRadius: 3, textDecoration: 'none', letterSpacing: 0.5,
            }}
          >
            CONNECT FYERS →
          </a>
        </div>
      ) : error ? (
        <div style={{ color: 'var(--red)', fontSize: 10, padding: '2px 8px', background: 'rgba(255,61,0,0.08)' }}>{error}</div>
      ) : null}

      {/* ── Chart area ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: error === 'FYERS_OFFLINE' ? 'none' : 'flex', overflow: 'hidden' }}>

        {/* Chart column (all panes stacked) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Main price chart */}
          <div ref={mainRef} style={{ flex: 1 }} />

          {/* RSI pane */}
          {showRSI && (
            <div style={{ borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 9, color: 'var(--cyan)', padding: '1px 4px' }}>RSI(14)</div>
              <div ref={rsiRef} style={{ height: rsiH - 16 }} />
            </div>
          )}

          {/* MACD pane */}
          {showMACD && (
            <div style={{ borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 9, color: 'var(--amber)', padding: '1px 4px' }}>MACD(12,26,9)</div>
              <div ref={macdRef} style={{ height: macdH - 16 }} />
            </div>
          )}

          {/* ATR pane */}
          {showATR && (
            <div style={{ borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 9, color: '#ab47bc', padding: '1px 4px' }}>ATR(14)</div>
              <div ref={atrRef} style={{ height: atrH - 16 }} />
            </div>
          )}

          {/* Stochastic pane */}
          {showStoch && (
            <div style={{ borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 9, color: 'var(--cyan)', padding: '1px 4px' }}>STOCH(14,3) — %K cyan · %D amber</div>
              <div ref={stochRef} style={{ height: stochH - 16 }} />
            </div>
          )}

          {/* OBV pane */}
          {showOBV && (
            <div style={{ borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 9, color: '#26c6da', padding: '1px 4px' }}>OBV</div>
              <div ref={obvRef} style={{ height: obvH - 16 }} />
            </div>
          )}
        </div>

        {/* Market depth side panel */}
        {showDepth && (
          <div style={{ width: 200, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '3px 6px', background: 'var(--bg-secondary)', fontSize: 9, color: 'var(--amber)', borderBottom: '1px solid var(--border)' }}>
              MARKET DEPTH
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
              {depthData ? <DepthView data={depthData} /> : (
                <div style={{ color: 'var(--text-muted)', fontSize: 10, padding: 8, textAlign: 'center' }}>
                  {depthData === null ? 'Loading…' : 'No depth data'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Market Depth sub-component ─────────────────────────────────────────────────

const DepthView: React.FC<{ data: any }> = ({ data }) => {
  if (!data || data.source === 'unavailable') {
    return (
      <div style={{ padding: 12, textAlign: 'center', color: '#555', fontSize: 10 }}>
        <div style={{ marginBottom: 4 }}>Depth requires Fyers connection</div>
        <a href="http://127.0.0.1:8000/api/fyers/login" target="_blank" rel="noreferrer"
          style={{ color: 'var(--amber)', fontSize: 9 }}>Connect Fyers →</a>
      </div>
    );
  }

  const buys  = (data.buy  || data.bids || []).slice(0, 5);
  const sells = (data.sell || data.asks || []).slice(0, 5);
  const maxQty = Math.max(
    ...buys.map((b: any) => b.qty || b.volume || 0),
    ...sells.map((s: any) => s.qty || s.volume || 0),
    1
  );

  const LevelRow = ({ item, side }: { item: any; side: 'buy' | 'sell' }) => {
    const qty     = item.qty || item.volume || 0;
    const pct     = Math.min(100, (qty / maxQty) * 100);
    const color   = side === 'buy' ? 'var(--green)' : 'var(--red)';
    const bgColor = side === 'buy' ? 'rgba(0,200,83,0.10)' : 'rgba(255,61,0,0.10)';
    return (
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 6px', fontSize: 10, marginBottom: 1, minHeight: 18 }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: bgColor,
          width: `${pct}%`,
          // buy bar grows right→left (bid pressure from right), ask grows left→right
          ...(side === 'buy' ? { right: 0, left: 'auto' } : { left: 0 }),
        }} />
        <span style={{ color, zIndex: 1, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {(item.price || 0).toFixed(2)}
        </span>
        <span style={{ color: 'var(--text-secondary)', zIndex: 1, fontVariantNumeric: 'tabular-nums' }}>
          {qty.toLocaleString('en-IN')}
        </span>
        {item.orders != null && (
          <span style={{ color: '#555', zIndex: 1, fontSize: 8 }}>({item.orders})</span>
        )}
      </div>
    );
  };

  const spread     = data.spread     ?? (sells[0]?.price && buys[0]?.price ? sells[0].price - buys[0].price : 0);
  const spreadPct  = data.spread_pct ?? (buys[0]?.price && spread ? (spread / buys[0].price * 100) : 0);
  const imbalance  = data.total_buy_qty && data.total_sell_qty
    ? ((data.total_buy_qty - data.total_sell_qty) / (data.total_buy_qty + data.total_sell_qty) * 100).toFixed(1)
    : null;

  return (
    <div style={{ fontFamily: 'Consolas, monospace' }}>
      {/* Sell levels (asks) — displayed in reverse so best ask is closest to spread */}
      <div style={{ fontSize: 9, color: 'var(--red)', padding: '2px 6px', fontWeight: 700 }}>
        SELL (ASK) — {sells.length} levels
      </div>
      {[...sells].reverse().map((s: any, i: number) => <LevelRow key={i} item={s} side="sell" />)}

      {/* Spread row */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '3px 6px', background: '#0d0d0d',
        borderTop: '1px solid var(--amber-dim)', borderBottom: '1px solid var(--amber-dim)',
        margin: '2px 0', fontSize: 10,
      }}>
        <span style={{ color: 'var(--amber)', fontWeight: 700 }}>SPREAD</span>
        <span style={{ color: 'var(--amber)' }}>{spread.toFixed(2)} ({spreadPct.toFixed(3)}%)</span>
      </div>

      {/* Buy levels (bids) */}
      <div style={{ fontSize: 9, color: 'var(--green)', padding: '2px 6px', fontWeight: 700 }}>
        BUY (BID) — {buys.length} levels
      </div>
      {buys.map((b: any, i: number) => <LevelRow key={i} item={b} side="buy" />)}

      {/* Totals + imbalance */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px', marginTop: 4, borderTop: '1px solid var(--border)', fontSize: 9 }}>
        <span style={{ color: 'var(--green)' }}>
          ▲ {(data.total_buy_qty || 0).toLocaleString('en-IN')}
        </span>
        {imbalance != null && (
          <span style={{ color: Number(imbalance) > 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
            {Number(imbalance) > 0 ? 'BUY' : 'SELL'} {Math.abs(Number(imbalance))}%
          </span>
        )}
        <span style={{ color: 'var(--red)' }}>
          ▼ {(data.total_sell_qty || 0).toLocaleString('en-IN')}
        </span>
      </div>
    </div>
  );
};
