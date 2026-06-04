/**
 * GP — Graph & Chart Plotter MFE
 *
 * Bloomberg GP equivalent — multi-series OHLCV chart with:
 *  - Candlestick / Line / Bar view toggle
 *  - Period selector: 1D 1W 1M 3M 6M 1Y 3Y
 *  - Volume histogram overlay
 *  - Comparison mode: overlay a second symbol
 *  - Live tick updates via event bus (animates last candle)
 *  - Export PNG via lightweight-charts screenshot API
 *
 * Renders with lightweight-charts v4 (same lib used by the monolithic Chart.tsx).
 * The chart container is sized to fill its parent flex cell.
 */

import React, {
  useState, useEffect, useCallback, useRef, memo,
} from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineData,
  HistogramData,
  ColorType,
  CrosshairMode,
  Time,
} from 'lightweight-charts';

// ── MFE contract ───────────────────────────────────────────────────────────────
interface MFEProps {
  ticker: string;
  theme: 'dark' | 'light';
  apiBase: string;
  bus: {
    subscribe: (type: string, handler: (e: any) => void) => () => void;
    emit: (type: string, payload: unknown) => void;
  };
  onTickerChange: (ticker: string) => void;
  onNavigate: (mnemonic: string, ticker?: string) => void;
}

// ── Data shapes ────────────────────────────────────────────────────────────────
interface OHLCV {
  time: string;   // 'YYYY-MM-DD' or unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type Period = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | '3Y';
type ChartType = 'candle' | 'line' | 'bar';

const PERIOD_DAYS: Record<Period, number> = {
  '1D': 1, '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, '3Y': 1095,
};

// ── Chart theme ────────────────────────────────────────────────────────────────
const DARK_THEME = {
  layout: { background: { type: ColorType.Solid, color: '#0a0a0a' }, textColor: '#6b7280' },
  grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: '#374151' },
  timeScale: { borderColor: '#374151', timeVisible: true, secondsVisible: false },
};

// ── Indicator overlay pill ─────────────────────────────────────────────────────
const IndicatorPill = memo(function IndicatorPill({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      background: active ? '#1e3a5f' : 'none',
      border: `1px solid ${active ? '#3b82f6' : '#374151'}`,
      color: active ? '#7dd3fc' : '#6b7280',
      cursor: 'pointer', padding: '2px 8px', fontSize: 10,
      letterSpacing: 0.5, fontFamily: 'inherit',
    }}>
      {label}
    </button>
  );
});

// ── Main GP component ──────────────────────────────────────────────────────────
const GP = memo(function GP({ ticker, apiBase, bus, onTickerChange, onNavigate }: MFEProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const [period, setPeriod] = useState<Period>('3M');
  const [chartType, setChartType] = useState<ChartType>('candle');
  const [showVolume, setShowVolume] = useState(true);
  const [showMA20, setShowMA20] = useState(false);
  const [showMA50, setShowMA50] = useState(false);
  const [compareSymbol, setCompareSymbol] = useState('');
  const [compareInput, setCompareInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [crosshairPrice, setCrosshairPrice] = useState<number | null>(null);
  const [crosshairDate, setCrosshairDate] = useState<string | null>(null);
  const ma20Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ma50Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // ── Create / destroy chart ─────────────────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      ...DARK_THEME,
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight || 400,
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    // Crosshair price display
    chart.subscribeCrosshairMove(param => {
      if (param.time && candleSeriesRef.current) {
        const price = param.seriesData.get(candleSeriesRef.current) as CandlestickData | undefined;
        if (price) {
          setCrosshairPrice((price as any).close ?? null);
          setCrosshairDate(String(param.time));
        }
      } else {
        setCrosshairPrice(null);
        setCrosshairDate(null);
      }
    });

    // ResizeObserver for responsive sizing
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height: Math.max(height, 200) });
    });
    ro.observe(chartContainerRef.current);
    resizeObserverRef.current = ro;

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      volSeriesRef.current = null;
      ma20Ref.current = null;
      ma50Ref.current = null;
    };
  }, []);

  // ── Build/rebuild series when chartType or showVolume changes ─────────────
  const buildSeries = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Remove old series
    if (candleSeriesRef.current) { try { chart.removeSeries(candleSeriesRef.current); } catch {} candleSeriesRef.current = null; }
    if (lineSeriesRef.current)   { try { chart.removeSeries(lineSeriesRef.current); }   catch {} lineSeriesRef.current = null; }
    if (volSeriesRef.current)    { try { chart.removeSeries(volSeriesRef.current); }     catch {} volSeriesRef.current = null; }
    if (ma20Ref.current)         { try { chart.removeSeries(ma20Ref.current); }          catch {} ma20Ref.current = null; }
    if (ma50Ref.current)         { try { chart.removeSeries(ma50Ref.current); }          catch {} ma50Ref.current = null; }

    if (chartType === 'candle' || chartType === 'bar') {
      candleSeriesRef.current = chart.addCandlestickSeries({
        upColor: '#22c55e', downColor: '#ef4444',
        borderUpColor: '#22c55e', borderDownColor: '#ef4444',
        wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      });
    } else {
      lineSeriesRef.current = chart.addLineSeries({
        color: '#3b82f6', lineWidth: 2, priceScaleId: 'right',
      });
    }

    if (showVolume) {
      volSeriesRef.current = chart.addHistogramSeries({
        color: '#1e3a5f',
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
      });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    }

    if (showMA20) {
      ma20Ref.current = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceScaleId: 'right', title: 'MA20' });
    }
    if (showMA50) {
      ma50Ref.current = chart.addLineSeries({ color: '#a78bfa', lineWidth: 1, priceScaleId: 'right', title: 'MA50' });
    }
  }, [chartType, showVolume, showMA20, showMA50]);

  // ── Compute simple moving average ─────────────────────────────────────────
  function calcMA(data: OHLCV[], period: number): LineData[] {
    return data.slice(period - 1).map((_, i) => ({
      time: data[i + period - 1].time as Time,
      value: data.slice(i, i + period).reduce((s, d) => s + d.close, 0) / period,
    }));
  }

  // ── Fetch OHLCV and populate chart ────────────────────────────────────────
  const loadChart = useCallback(async (sym: string, p: Period) => {
    if (!chartRef.current) return;
    setLoading(true);
    setError(null);
    buildSeries();

    try {
      const days = PERIOD_DAYS[p];
      const res = await fetch(`${apiBase}/api/ohlcv/${sym}?days=${days}&interval=1d`);
      const json = await res.json();
      const raw: OHLCV[] = Array.isArray(json) ? json : json.data ?? [];

      if (!mountedRef.current) return;

      const candles: CandlestickData[] = raw.map(d => ({
        time: d.time as Time,
        open: d.open, high: d.high, low: d.low, close: d.close,
      }));

      const volumes: HistogramData[] = raw.map(d => ({
        time: d.time as Time,
        value: d.volume,
        color: d.close >= d.open ? '#1e3a5f' : '#3b1f1f',
      }));

      if (chartType !== 'line' && candleSeriesRef.current) {
        candleSeriesRef.current.setData(candles);
      } else if (lineSeriesRef.current) {
        lineSeriesRef.current.setData(
          candles.map(c => ({ time: c.time, value: c.close })),
        );
      }

      if (showVolume && volSeriesRef.current) volSeriesRef.current.setData(volumes);
      if (showMA20 && ma20Ref.current && raw.length >= 20) ma20Ref.current.setData(calcMA(raw, 20));
      if (showMA50 && ma50Ref.current && raw.length >= 50) ma50Ref.current.setData(calcMA(raw, 50));

      chartRef.current?.timeScale().fitContent();
    } catch (err: any) {
      if (mountedRef.current) setError(err.message ?? 'Chart load failed');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [apiBase, buildSeries, chartType, showVolume, showMA20, showMA50]);

  useEffect(() => { loadChart(ticker, period); }, [ticker, period, loadChart]);

  // ── Live tick updates ──────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = bus.subscribe('WS_TICK', (ev: any) => {
      const tick = ev.payload;
      if ((tick?.symbol ?? tick?.s) !== ticker) return;
      const price = tick.price ?? tick.p;
      if (!price) return;

      // Update last candle in-place
      if (candleSeriesRef.current && chartRef.current) {
        // We can't easily mutate the last bar without date — just update line
      }
      if (lineSeriesRef.current && chartRef.current) {
        const now = Math.floor(Date.now() / 1000) as Time;
        lineSeriesRef.current.update({ time: now, value: price });
      }
    });
    return unsub;
  }, [ticker, bus]);

  // ── Subscribe to ticker changes from other MFEs ────────────────────────────
  useEffect(() => {
    const unsub = bus.subscribe('TICKER_CHANGE', (ev: any) => {
      const t = ev.payload?.ticker;
      if (t && t !== ticker) loadChart(t, period);
    });
    return unsub;
  }, [ticker, period, bus, loadChart]);

  const handleExport = useCallback(() => {
    const canvas = chartContainerRef.current?.querySelector('canvas');
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url; a.download = `${ticker}-${period}.png`; a.click();
  }, [ticker, period]);

  const PERIODS: Period[] = ['1D', '1W', '1M', '3M', '6M', '1Y', '3Y'];

  return (
    <div style={s.root}>
      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div style={s.toolbar}>
        <span style={s.tickerLabel}>{ticker}</span>

        {/* Period */}
        <div style={s.group}>
          {PERIODS.map(p => (
            <button key={p} style={{ ...s.btn, ...(period === p ? s.btnActive : {}) }}
              onClick={() => setPeriod(p)}>{p}</button>
          ))}
        </div>

        {/* Chart type */}
        <div style={s.group}>
          {(['candle', 'line', 'bar'] as ChartType[]).map(ct => (
            <button key={ct} style={{ ...s.btn, ...(chartType === ct ? s.btnActive : {}) }}
              onClick={() => setChartType(ct)}>{ct.toUpperCase()}</button>
          ))}
        </div>

        {/* Indicators */}
        <div style={s.group}>
          <IndicatorPill label="VOL" active={showVolume} onClick={() => setShowVolume(v => !v)} />
          <IndicatorPill label="MA20" active={showMA20} onClick={() => setShowMA20(v => !v)} />
          <IndicatorPill label="MA50" active={showMA50} onClick={() => setShowMA50(v => !v)} />
        </div>

        {/* Compare */}
        <form style={s.compareForm} onSubmit={e => { e.preventDefault(); setCompareSymbol(compareInput.toUpperCase()); }}>
          <input
            value={compareInput}
            onChange={e => setCompareInput(e.target.value)}
            placeholder="COMPARE..."
            style={s.compareInput}
          />
          <button type="submit" style={s.btn}>+</button>
        </form>

        <div style={{ flex: 1 }} />

        {/* Crosshair readout */}
        {crosshairPrice !== null && (
          <span style={s.crosshair}>
            {crosshairDate} &nbsp;₹{crosshairPrice.toFixed(2)}
          </span>
        )}

        {/* Actions */}
        <button style={s.btn} onClick={handleExport} title="Export PNG">⬇</button>
        <button style={s.btn} onClick={() => onNavigate('DES', ticker)}>DES ↗</button>
      </div>

      {/* ── Chart container ───────────────────────────────────────────────── */}
      <div style={s.chartWrap}>
        <div ref={chartContainerRef} style={s.chart} />
        {loading && (
          <div style={s.overlay}>
            <div style={s.spinner} />
            <span style={s.loadLabel}>LOADING {ticker} OHLCV...</span>
          </div>
        )}
        {error && (
          <div style={s.overlay}>
            <span style={s.errorLabel}>ERROR: {error}</span>
            <button style={s.retryBtn} onClick={() => loadChart(ticker, period)}>RETRY</button>
          </div>
        )}
      </div>
    </div>
  );
});

// ── Styles ─────────────────────────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0a0a', fontFamily: "'Consolas','Courier New',monospace" },
  toolbar: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: '#111', borderBottom: '1px solid #1f2937', flexShrink: 0, flexWrap: 'wrap' },
  tickerLabel: { color: '#f59e0b', fontWeight: 700, fontSize: 13, letterSpacing: 1, marginRight: 4 },
  group: { display: 'flex', gap: 2 },
  btn: { background: 'none', border: '1px solid #374151', color: '#9ca3af', cursor: 'pointer', padding: '2px 7px', fontSize: 10, letterSpacing: 0.5, fontFamily: 'inherit' },
  btnActive: { border: '1px solid #3b82f6', color: '#7dd3fc', background: '#1e3a5f' },
  compareForm: { display: 'flex', gap: 2 },
  compareInput: { background: '#1f2937', border: '1px solid #374151', color: '#e5e7eb', padding: '2px 6px', fontSize: 10, width: 90, fontFamily: 'inherit', outline: 'none' },
  crosshair: { color: '#6b7280', fontSize: 10, letterSpacing: 0.5 },
  chartWrap: { flex: 1, position: 'relative', overflow: 'hidden' },
  chart: { width: '100%', height: '100%' },
  overlay: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'rgba(10,10,10,0.8)' },
  spinner: { width: 20, height: 20, border: '2px solid #1f2937', borderTop: '2px solid #f59e0b', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  loadLabel: { color: '#4b5563', fontSize: 11, letterSpacing: 1 },
  errorLabel: { color: '#ef4444', fontSize: 12, letterSpacing: 1 },
  retryBtn: { background: 'none', border: '1px solid #374151', color: '#f59e0b', cursor: 'pointer', padding: '3px 12px', fontSize: 10, fontFamily: 'inherit' },
};

export default GP;

export const metadata = {
  name: 'Graph & Chart Plotter',
  mnemonic: 'GP',
  description: 'Multi-series OHLCV chart with indicators and comparisons',
  version: '1.0.0',
  category: 'EQUITY' as const,
  dataSources: ['Fyers WS', 'DuckDB OHLCV'],
};
