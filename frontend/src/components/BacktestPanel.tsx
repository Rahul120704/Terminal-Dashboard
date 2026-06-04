/**
 * BTI Backtest Panel — Polars-powered vectorized backtesting UI
 * Strategies: dual_ma, momentum, mean_reversion, rsi
 * Shows: equity curve, metrics table, trade log
 */

import React, { useState, useRef } from 'react';

interface BacktestResult {
  symbol: string;
  strategy: string;
  start_date: string;
  end_date: string;
  initial_capital: number;
  final_capital: number;
  total_return_pct: number;
  cagr_pct: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  max_drawdown_pct: number;
  calmar_ratio: number;
  win_rate_pct: number;
  profit_factor: number;
  total_trades: number;
  annual_volatility_pct: number;
  avg_trade_duration_days: number;
  elapsed_ms: number;
  equity_curve: Array<{ date: string; equity: number }>;
  trades: Array<{
    date: string;
    action: string;
    price: number;
    quantity: number;
    pnl: number;
    cum_capital: number;
  }>;
  error?: string;
}

const STRATEGIES = [
  { value: 'dual_ma', label: 'Dual MA Crossover', desc: 'Fast/slow moving average crossover' },
  { value: 'momentum', label: 'Momentum', desc: 'Trend-following momentum signal' },
  { value: 'mean_reversion', label: 'Mean Reversion', desc: 'Z-score reversion to mean' },
  { value: 'rsi', label: 'RSI Oscillator', desc: 'Oversold/overbought RSI signals' },
];

const POPULAR_TICKERS = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'NIFTY50'];

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/40 rounded p-2">
      <div className="text-gray-500 text-xs mb-0.5">{label}</div>
      <div className={`text-lg font-bold font-mono ${color || 'text-gray-200'}`}>{value}</div>
      {sub && <div className="text-gray-600 text-xs">{sub}</div>}
    </div>
  );
}

function MiniEquityCurve({ curve, initial }: { curve: BacktestResult['equity_curve']; initial: number }) {
  if (curve.length < 2) return null;

  const values = curve.map((p) => p.equity);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  const W = 600;
  const H = 120;
  const pts = curve.map((p, i) => {
    const x = (i / (curve.length - 1)) * W;
    const y = H - ((p.equity - minV) / range) * H * 0.85 - H * 0.075;
    return `${x},${y}`;
  });

  const pathD = `M ${pts.join(' L ')}`;
  const fillD = `M 0,${H} L ${pts.join(' L ')} L ${W},${H} Z`;
  const finalColor = values[values.length - 1] >= initial ? '#22c55e' : '#ef4444';

  // Find max drawdown troughs
  const peak = values.reduce((acc, v, i) => {
    acc.push(i === 0 ? v : Math.max(acc[i - 1], v));
    return acc;
  }, [] as number[]);

  return (
    <div className="border border-gray-700/40 rounded p-2 bg-gray-800/30">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>Equity Curve ({curve.length} days)</span>
        <span>
          ₹{(minV / 1000).toFixed(0)}k → ₹{(maxV / 1000).toFixed(0)}k
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        <defs>
          <linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={finalColor} stopOpacity="0.3" />
            <stop offset="100%" stopColor={finalColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Zero line (initial capital) */}
        <line
          x1="0"
          x2={W}
          y1={H - ((initial - minV) / range) * H * 0.85 - H * 0.075}
          y2={H - ((initial - minV) / range) * H * 0.85 - H * 0.075}
          stroke="#4b5563"
          strokeDasharray="4,4"
          strokeWidth="1"
        />
        <path d={fillD} fill="url(#curveGrad)" />
        <path d={pathD} stroke={finalColor} strokeWidth="1.5" fill="none" />
      </svg>

      {/* Date labels */}
      <div className="flex justify-between text-gray-600 text-xs mt-0.5 font-mono">
        <span>{curve[0]?.date?.slice(0, 10)}</span>
        <span>{curve[Math.floor(curve.length / 2)]?.date?.slice(0, 10)}</span>
        <span>{curve[curve.length - 1]?.date?.slice(0, 10)}</span>
      </div>
    </div>
  );
}

export default function BacktestPanel() {
  const [symbol, setSymbol] = useState('RELIANCE');
  const [strategy, setStrategy] = useState('dual_ma');
  const [startDate, setStartDate] = useState('2022-01-01');
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [initialCapital, setInitialCapital] = useState(100000);
  const [fastMa, setFastMa] = useState(20);
  const [slowMa, setSlowMa] = useState(50);
  const [rsiPeriod, setRsiPeriod] = useState(14);
  const [momentumLookback, setMomentumLookback] = useState(20);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'chart' | 'trades' | 'metrics'>('chart');

  const runBacktest = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const sym = symbol.trim().toUpperCase();
      const resp = await fetch('/api/quant/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: sym.includes('.NS') ? sym : sym,
          strategy,
          start_date: startDate,
          end_date: endDate,
          initial_capital: initialCapital,
          fast_ma: fastMa,
          slow_ma: slowMa,
          rsi_period: rsiPeriod,
          momentum_lookback: momentumLookback,
        }),
      });
      const data: BacktestResult = await resp.json();
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
        setActiveTab('chart');
      }
    } catch (e) {
      setError('Failed to run backtest — check backend connection');
    } finally {
      setRunning(false);
    }
  };

  const returnColor =
    result && result.total_return_pct >= 0 ? 'text-green-400' : 'text-red-400';
  const sharpeColor =
    result && result.sharpe_ratio >= 1.5
      ? 'text-green-400'
      : result && result.sharpe_ratio >= 0.5
      ? 'text-yellow-400'
      : 'text-red-400';

  return (
    <div className="flex flex-col h-full bg-gray-900/50 font-mono text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/50">
        <span className="text-amber-400 font-bold">◆ BACKTEST ENGINE</span>
        <span className="text-gray-500 text-xs">Polars vectorized • DuckDB data</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Config panel */}
        <div className="w-64 border-r border-gray-700/40 p-3 overflow-y-auto flex-shrink-0">
          <div className="space-y-3">
            {/* Symbol */}
            <div>
              <label className="text-gray-500 text-xs block mb-1">SYMBOL</label>
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                className="w-full bg-gray-800/70 border border-gray-600/50 rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-amber-600/60 text-sm"
                placeholder="RELIANCE"
              />
              <div className="flex flex-wrap gap-1 mt-1">
                {POPULAR_TICKERS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setSymbol(t)}
                    className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${
                      symbol === t
                        ? 'border-amber-700/60 text-amber-400 bg-amber-900/30'
                        : 'border-gray-600/40 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Strategy */}
            <div>
              <label className="text-gray-500 text-xs block mb-1">STRATEGY</label>
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                className="w-full bg-gray-800/70 border border-gray-600/50 rounded px-2 py-1.5 text-gray-200 focus:outline-none text-sm"
              >
                {STRATEGIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <div className="text-gray-600 text-xs mt-1">
                {STRATEGIES.find((s) => s.value === strategy)?.desc}
              </div>
            </div>

            {/* Date range */}
            <div>
              <label className="text-gray-500 text-xs block mb-1">DATE RANGE</label>
              <div className="flex flex-col gap-1">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-gray-800/70 border border-gray-600/50 rounded px-2 py-1 text-gray-200 focus:outline-none text-xs"
                />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-gray-800/70 border border-gray-600/50 rounded px-2 py-1 text-gray-200 focus:outline-none text-xs"
                />
              </div>
            </div>

            {/* Capital */}
            <div>
              <label className="text-gray-500 text-xs block mb-1">CAPITAL (₹)</label>
              <input
                type="number"
                value={initialCapital}
                onChange={(e) => setInitialCapital(Number(e.target.value))}
                className="w-full bg-gray-800/70 border border-gray-600/50 rounded px-2 py-1.5 text-gray-200 focus:outline-none text-sm"
              />
            </div>

            {/* Strategy params */}
            {strategy === 'dual_ma' && (
              <div>
                <label className="text-gray-500 text-xs block mb-1">MA PERIODS</label>
                <div className="flex gap-2">
                  <div>
                    <div className="text-gray-600 text-xs mb-0.5">Fast</div>
                    <input
                      type="number"
                      value={fastMa}
                      onChange={(e) => setFastMa(Number(e.target.value))}
                      className="w-full bg-gray-800/70 border border-gray-600/50 rounded px-2 py-1 text-gray-200 focus:outline-none text-xs"
                    />
                  </div>
                  <div>
                    <div className="text-gray-600 text-xs mb-0.5">Slow</div>
                    <input
                      type="number"
                      value={slowMa}
                      onChange={(e) => setSlowMa(Number(e.target.value))}
                      className="w-full bg-gray-800/70 border border-gray-600/50 rounded px-2 py-1 text-gray-200 focus:outline-none text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            {strategy === 'rsi' && (
              <div>
                <label className="text-gray-500 text-xs block mb-1">RSI PERIOD</label>
                <input
                  type="number"
                  value={rsiPeriod}
                  onChange={(e) => setRsiPeriod(Number(e.target.value))}
                  className="w-full bg-gray-800/70 border border-gray-600/50 rounded px-2 py-1 text-gray-200 text-xs"
                />
              </div>
            )}

            {(strategy === 'momentum' || strategy === 'mean_reversion') && (
              <div>
                <label className="text-gray-500 text-xs block mb-1">LOOKBACK</label>
                <input
                  type="number"
                  value={momentumLookback}
                  onChange={(e) => setMomentumLookback(Number(e.target.value))}
                  className="w-full bg-gray-800/70 border border-gray-600/50 rounded px-2 py-1 text-gray-200 text-xs"
                />
              </div>
            )}

            <button
              onClick={runBacktest}
              disabled={running}
              className="w-full bg-amber-800/60 hover:bg-amber-700/60 disabled:bg-gray-700/40 border border-amber-700/50 disabled:border-gray-600/30 text-amber-200 disabled:text-gray-500 py-2 rounded font-bold text-sm transition-colors"
            >
              {running ? '⟳ RUNNING…' : '▶ RUN BACKTEST'}
            </button>

            {result && (
              <div className="text-gray-600 text-xs text-center">
                Completed in {result.elapsed_ms}ms
              </div>
            )}
          </div>
        </div>

        {/* Results panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {error && (
            <div className="m-3 bg-red-900/30 border border-red-700/50 rounded p-3 text-red-300 text-sm">
              ⚠️ {error}
            </div>
          )}

          {!result && !error && !running && (
            <div className="flex-1 flex items-center justify-center text-gray-600">
              <div className="text-center">
                <div className="text-4xl mb-3">📊</div>
                <div>Configure and run a backtest</div>
                <div className="text-xs mt-1">Polars vectorized engine • DuckDB OHLCV</div>
              </div>
            </div>
          )}

          {running && (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <div className="text-2xl mb-3 animate-spin">⟳</div>
                <div>Running {strategy} strategy on {symbol}…</div>
              </div>
            </div>
          )}

          {result && !error && (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Summary bar */}
              <div className="flex items-center gap-4 px-3 py-2 border-b border-gray-700/40 text-xs flex-wrap">
                <span className="font-bold text-gray-300">{result.symbol}</span>
                <span className="text-gray-500">{STRATEGIES.find((s) => s.value === result.strategy)?.label}</span>
                <span className="text-gray-500">{result.start_date} → {result.end_date}</span>
                <span className={`font-bold ${returnColor}`}>
                  {result.total_return_pct > 0 ? '+' : ''}{result.total_return_pct.toFixed(1)}%
                </span>
                <span className="text-gray-500">
                  {result.total_trades} trades
                </span>
              </div>

              {/* Tab selector */}
              <div className="flex gap-1 px-3 pt-2 pb-0 border-b border-gray-700/40">
                {(['chart', 'metrics', 'trades'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1 text-xs rounded-t border-b-2 transition-colors ${
                      activeTab === tab
                        ? 'border-amber-500 text-amber-300'
                        : 'border-transparent text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {tab.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                {activeTab === 'chart' && (
                  <div className="space-y-4">
                    {/* Quick metrics */}
                    <div className="grid grid-cols-4 gap-2">
                      <MetricCard
                        label="Total Return"
                        value={`${result.total_return_pct > 0 ? '+' : ''}${result.total_return_pct.toFixed(1)}%`}
                        color={returnColor}
                      />
                      <MetricCard
                        label="CAGR"
                        value={`${result.cagr_pct.toFixed(1)}%`}
                        sub="annualized"
                        color={result.cagr_pct > 0 ? 'text-green-400' : 'text-red-400'}
                      />
                      <MetricCard
                        label="Sharpe Ratio"
                        value={result.sharpe_ratio.toFixed(2)}
                        sub="risk-adjusted"
                        color={sharpeColor}
                      />
                      <MetricCard
                        label="Max Drawdown"
                        value={`-${result.max_drawdown_pct.toFixed(1)}%`}
                        color="text-red-400"
                      />
                    </div>

                    <MiniEquityCurve curve={result.equity_curve} initial={result.initial_capital} />

                    {/* Capital summary */}
                    <div className="flex gap-4 text-xs text-gray-500 border-t border-gray-700/30 pt-2">
                      <span>Capital: ₹{(result.initial_capital / 1000).toFixed(0)}k → <span className={returnColor}>₹{(result.final_capital / 1000).toFixed(0)}k</span></span>
                      <span>Win Rate: <span className="text-gray-300">{result.win_rate_pct.toFixed(0)}%</span></span>
                      <span>Profit Factor: <span className="text-gray-300">{result.profit_factor.toFixed(2)}</span></span>
                      <span>Avg Trade: <span className="text-gray-300">{result.avg_trade_duration_days.toFixed(0)}d</span></span>
                    </div>
                  </div>
                )}

                {activeTab === 'metrics' && (
                  <div className="grid grid-cols-3 gap-2">
                    <MetricCard label="Total Return" value={`${result.total_return_pct.toFixed(2)}%`} color={returnColor} />
                    <MetricCard label="CAGR" value={`${result.cagr_pct.toFixed(2)}%`} color={result.cagr_pct > 0 ? 'text-green-400' : 'text-red-400'} />
                    <MetricCard label="Sharpe Ratio" value={result.sharpe_ratio.toFixed(3)} color={sharpeColor} />
                    <MetricCard label="Sortino Ratio" value={result.sortino_ratio.toFixed(3)} />
                    <MetricCard label="Max Drawdown" value={`-${result.max_drawdown_pct.toFixed(2)}%`} color="text-red-400" />
                    <MetricCard label="Calmar Ratio" value={result.calmar_ratio.toFixed(3)} />
                    <MetricCard label="Win Rate" value={`${result.win_rate_pct.toFixed(1)}%`} />
                    <MetricCard label="Profit Factor" value={result.profit_factor.toFixed(3)} />
                    <MetricCard label="Total Trades" value={String(result.total_trades)} />
                    <MetricCard label="Annual Vol" value={`${result.annual_volatility_pct.toFixed(2)}%`} />
                    <MetricCard label="Avg Trade Dur" value={`${result.avg_trade_duration_days.toFixed(1)}d`} />
                    <MetricCard label="Final Capital" value={`₹${(result.final_capital / 1000).toFixed(1)}k`} />
                  </div>
                )}

                {activeTab === 'trades' && (
                  <div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-700/40">
                          <th className="text-left py-1">Date</th>
                          <th className="text-left py-1">Action</th>
                          <th className="text-right py-1">Price</th>
                          <th className="text-right py-1">Qty</th>
                          <th className="text-right py-1">P&L</th>
                          <th className="text-right py-1">Capital</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.trades.map((t, i) => (
                          <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                            <td className="py-0.5 text-gray-400">{t.date.slice(0, 10)}</td>
                            <td className={`py-0.5 font-bold ${t.action === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                              {t.action}
                            </td>
                            <td className="py-0.5 text-right text-gray-300">₹{t.price.toFixed(1)}</td>
                            <td className="py-0.5 text-right text-gray-400">{t.quantity}</td>
                            <td className={`py-0.5 text-right ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {t.pnl !== 0 ? (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(0) : '—'}
                            </td>
                            <td className="py-0.5 text-right text-gray-400">
                              ₹{(t.cum_capital / 1000).toFixed(1)}k
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="text-gray-600 text-xs mt-2 text-center">
                      Showing last 100 trades of {result.total_trades} total
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
