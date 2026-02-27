import { useState, useEffect, useRef, useCallback } from 'react';
import { createChart, ColorType, LineStyle, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, Time, SeriesMarker } from 'lightweight-charts';
import { X, TrendingUp, RotateCcw, BarChart2, Info } from 'lucide-react';
import type { BacktestReport, FoldResult, EquityPoint, Trade } from '../types';
import { useBacktest } from '../hooks/useStockData';

interface Props {
  ticker: string;
  open: boolean;
  onClose: () => void;
}

type TabId = 'momentum' | 'mean_rev' | 'compare';

const TAB_LABELS: Record<TabId, string> = {
  momentum: 'Dual Momentum',
  mean_rev: 'Mean Reversion',
  compare:  'Compare vs SPY',
};

// ── Colour tokens ────────────────────────────────────────────────────────────
const C = {
  bg:       '#131722',
  bgCard:   '#1a1e2e',
  border:   '#2a2e39',
  muted:    '#4c525e',
  sub:      '#787b86',
  text:     '#d1d4dc',
  blue:     '#2962ff',
  teal:     '#14b8a6',
  green:    '#26a69a',
  red:      '#ef5350',
  amber:    '#f59e0b',
  purple:   '#a78bfa',
};

// Strategy definitions shown in the header info panel
const STRATEGY_INFO: Record<'momentum' | 'mean_rev', { entry: string[]; exit: string[]; color: string }> = {
  momentum: {
    color: C.blue,
    entry: [
      'Close > SMA(200) and Close > SMA(50)',
      'RSI(14) crosses above 50 (was below prev day)',
    ],
    exit: [
      'Close drops below SMA(50)',
      'RSI(14) falls below 40',
    ],
  },
  mean_rev: {
    color: C.teal,
    entry: [
      'RSI(14) < 30  (oversold)',
      'Close > SMA(200)  (long-term uptrend)',
      'Close < prev Close  (still falling)',
    ],
    exit: [
      'RSI(14) rises above 55  (recovered)',
      'Held for 10 days  (time-stop)',
    ],
  },
};

// ── Metric helpers ────────────────────────────────────────────────────────────

function pct(n: number, decimals = 1): string {
  return `${(n * 100).toFixed(decimals)}%`;
}

function sign(n: number, decimals = 2): string {
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(decimals)}%`;
}

function usd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Equity chart with buy/sell markers ──────────────────────────────────────

interface EquityChartProps {
  points: EquityPoint[];
  color: string;
  comparePoints?: EquityPoint[];
  compareColor?: string;
  compareLabel?: string;
  label: string;
  /** All trades across all folds for this strategy — used for entry/exit markers */
  trades?: Trade[];
}

function EquityChart({
  points, color, comparePoints, compareColor, compareLabel, label, trades,
}: EquityChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<'Line'> | null>(null);
  const cmpSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const buildChart = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current     = null;
      seriesRef.current    = null;
      cmpSeriesRef.current = null;
    }

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: C.bgCard },
        textColor:  C.sub,
        fontSize:   11,
      },
      grid: {
        vertLines: { color: C.border, style: LineStyle.Dotted },
        horzLines: { color: C.border, style: LineStyle.Dotted },
      },
      rightPriceScale: { borderColor: C.border },
      timeScale:       { borderColor: C.border, timeVisible: true },
      crosshair:       { mode: 1 },
      width:           el.clientWidth,
      height:          el.clientHeight,
    });

    const toSeries = (pts: EquityPoint[]) =>
      pts
        .filter(p => p.value > 0)
        .map(p => ({ time: p.date as Time, value: p.value }));

    const mainSeries = chart.addSeries(LineSeries, {
      color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: label,
    });
    mainSeries.setData(toSeries(points));
    seriesRef.current = mainSeries;

    // Buy/sell markers on the main equity curve
    if (trades && trades.length > 0) {
      const markers: SeriesMarker<Time>[] = [];
      for (const t of trades) {
        markers.push({
          time:     t.entry_date as Time,
          position: 'belowBar',
          color:    C.green,
          shape:    'arrowUp',
          text:     `▲ ${t.ticker}`,
          size:     1,
        });
        markers.push({
          time:     t.exit_date as Time,
          position: 'aboveBar',
          color:    t.pnl >= 0 ? C.blue : C.red,
          shape:    'arrowDown',
          text:     `▼ ${t.ticker}`,
          size:     1,
        });
      }
      // lightweight-charts requires markers sorted by time
      markers.sort((a, b) => (a.time as string) < (b.time as string) ? -1 : 1);
      createSeriesMarkers(mainSeries, markers);
    }

    if (comparePoints && comparePoints.length > 0 && compareColor) {
      const cmpSeries = chart.addSeries(LineSeries, {
        color: compareColor,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: true,
        title: compareLabel ?? 'SPY',
      });
      cmpSeries.setData(toSeries(comparePoints));
      cmpSeriesRef.current = cmpSeries;
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;
  }, [points, color, comparePoints, compareColor, compareLabel, label, trades]);

  useEffect(() => {
    buildChart();
    return () => { chartRef.current?.remove(); chartRef.current = null; };
  }, [buildChart]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      chartRef.current?.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
}

// ── Signal entry/exit conditions card ────────────────────────────────────────

function SignalConditions({ strategy }: { strategy: 'momentum' | 'mean_rev' }) {
  const info = STRATEGY_INFO[strategy];
  return (
    <div
      className="rounded-lg p-3 text-[11px]"
      style={{ backgroundColor: C.bgCard, border: `1px solid ${C.border}` }}
    >
      <div className="flex items-center gap-1.5 mb-2.5">
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: info.color }} />
        <span className="font-semibold uppercase tracking-wide text-[10px]" style={{ color: C.sub }}>
          {strategy === 'momentum' ? 'Dual Momentum' : 'RSI Mean Reversion'} — Signal Conditions
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div
            className="text-[10px] font-semibold mb-1.5 uppercase tracking-wider"
            style={{ color: C.green }}
          >
            ▲ BUY (Entry)
          </div>
          <ul className="space-y-1">
            {info.entry.map((c, i) => (
              <li key={i} className="flex gap-1.5">
                <span style={{ color: C.green }} className="flex-shrink-0">•</span>
                <span style={{ color: C.text }}>{c}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div
            className="text-[10px] font-semibold mb-1.5 uppercase tracking-wider"
            style={{ color: C.red }}
          >
            ▼ SELL (Exit)
          </div>
          <ul className="space-y-1">
            {info.exit.map((c, i) => (
              <li key={i} className="flex gap-1.5">
                <span style={{ color: C.red }} className="flex-shrink-0">•</span>
                <span style={{ color: C.text }}>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-2.5 pt-2 border-t text-[10px]" style={{ borderColor: C.border, color: C.muted }}>
        Markers on chart:&nbsp;
        <span style={{ color: C.green }}>▲ green arrow = buy entry</span>
        &nbsp;·&nbsp;
        <span style={{ color: C.blue }}>▼ blue arrow = profitable exit</span>
        &nbsp;·&nbsp;
        <span style={{ color: C.red }}>▼ red arrow = losing exit</span>
      </div>
    </div>
  );
}

// ── Summary metric cards ──────────────────────────────────────────────────────

function MetricCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: string;
}) {
  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-1"
      style={{ backgroundColor: C.bgCard, border: `1px solid ${C.border}` }}
    >
      <span className="text-[10px] uppercase tracking-wider" style={{ color: C.muted }}>{label}</span>
      <span className="text-lg font-mono font-semibold" style={{ color: accent ?? C.text }}>{value}</span>
      {sub && <span className="text-[10px]" style={{ color: C.muted }}>{sub}</span>}
    </div>
  );
}

function SummaryCards({ report }: { report: BacktestReport }) {
  const degraded = report.sharpe_degradation > 0.3;
  return (
    <div className="grid grid-cols-4 gap-2">
      <MetricCard
        label="OS CAGR"
        value={sign(report.combined_os_cagr, 1)}
        sub="annualised, out-of-sample"
        accent={report.combined_os_cagr >= 0 ? C.green : C.red}
      />
      <MetricCard
        label="OS Sharpe"
        value={report.combined_os_sharpe.toFixed(2)}
        sub="rf = 4.5%/yr"
        accent={report.combined_os_sharpe >= 1 ? C.green : report.combined_os_sharpe >= 0 ? C.amber : C.red}
      />
      <MetricCard
        label="Max Drawdown"
        value={pct(report.combined_os_max_dd)}
        sub="worst peak-to-trough"
        accent={C.red}
      />
      <MetricCard
        label="Sharpe Degrad."
        value={report.sharpe_degradation.toFixed(2)}
        sub={degraded ? '⚠ possible overfit' : 'IS→OS, lower = better'}
        accent={degraded ? C.amber : C.green}
      />
    </div>
  );
}

// ── Fold summary bar ──────────────────────────────────────────────────────────

function FoldBar({ folds }: { folds: FoldResult[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr style={{ color: C.muted, borderBottom: `1px solid ${C.border}` }}>
            <th className="text-left py-1.5 pr-3 font-medium">#</th>
            <th className="text-left py-1.5 pr-3 font-medium">OS Window</th>
            <th className="text-right py-1.5 pr-3 font-medium">IS Sharpe</th>
            <th className="text-right py-1.5 pr-3 font-medium">OS Sharpe</th>
            <th className="text-right py-1.5 pr-3 font-medium">OS CAGR</th>
            <th className="text-right py-1.5 pr-3 font-medium">Max DD</th>
            <th className="text-right py-1.5 pr-3 font-medium">Win%</th>
            <th className="text-right py-1.5 pr-3 font-medium">Trades</th>
            <th className="text-right py-1.5 font-medium">vs SPY</th>
          </tr>
        </thead>
        <tbody>
          {folds.map(f => {
            const alpha = f.os_cagr - f.os_benchmark_return;
            return (
              <tr
                key={f.fold}
                style={{ borderBottom: `1px solid ${C.border}` }}
              >
                <td className="pr-3 py-1.5" style={{ color: C.sub }}>{f.fold}</td>
                <td className="pr-3 py-1.5 whitespace-nowrap font-mono text-[10px]" style={{ color: C.sub }}>
                  {f.os_start.slice(0, 7)} – {f.os_end.slice(0, 7)}
                </td>
                <td className="text-right pr-3 py-1.5 font-mono" style={{ color: C.sub }}>
                  {f.is_sharpe.toFixed(2)}
                </td>
                <td
                  className="text-right pr-3 py-1.5 font-mono font-semibold"
                  style={{ color: f.os_sharpe >= 0 ? C.green : C.red }}
                >
                  {f.os_sharpe.toFixed(2)}
                </td>
                <td
                  className="text-right pr-3 py-1.5 font-mono"
                  style={{ color: f.os_cagr >= 0 ? C.green : C.red }}
                >
                  {sign(f.os_cagr, 1)}
                </td>
                <td className="text-right pr-3 py-1.5 font-mono" style={{ color: C.red }}>
                  {pct(f.os_max_dd, 1)}
                </td>
                <td className="text-right pr-3 py-1.5 font-mono" style={{ color: C.text }}>
                  {(f.os_win_rate * 100).toFixed(0)}%
                </td>
                <td className="text-right pr-3 py-1.5 font-mono" style={{ color: C.sub }}>
                  {f.os_trades}
                </td>
                <td
                  className="text-right py-1.5 font-mono"
                  style={{ color: alpha >= 0 ? C.green : C.red }}
                >
                  {sign(alpha, 1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Trade log ─────────────────────────────────────────────────────────────────

function TradeLog({ folds }: { folds: FoldResult[] }) {
  const allTrades = folds.flatMap(f => f.trades ?? []);
  if (allTrades.length === 0) {
    return (
      <p className="text-[11px] py-4 text-center" style={{ color: C.muted }}>No trades recorded</p>
    );
  }

  const wins  = allTrades.filter(t => t.pnl > 0).length;
  const total = allTrades.length;

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: C.muted }}>
          Trade Log
        </span>
        <span className="text-[10px]" style={{ color: C.sub }}>
          {total} trades · {wins}W / {total - wins}L ·{' '}
          <span style={{ color: C.green }}>{((wins / total) * 100).toFixed(0)}% win rate</span>
        </span>
      </div>
      <div className="overflow-x-auto max-h-48 overflow-y-auto">
        <table className="w-full text-[10px] border-collapse">
          <thead className="sticky top-0" style={{ backgroundColor: C.bg }}>
            <tr style={{ color: C.muted, borderBottom: `1px solid ${C.border}` }}>
              <th className="text-left py-1 pr-2 font-medium">Ticker</th>
              <th className="text-left py-1 pr-2 font-medium">Entry</th>
              <th className="text-left py-1 pr-2 font-medium">Exit</th>
              <th className="text-right py-1 pr-2 font-medium">Entry $</th>
              <th className="text-right py-1 pr-2 font-medium">Exit $</th>
              <th className="text-right py-1 pr-2 font-medium">PnL $</th>
              <th className="text-right py-1 font-medium">PnL %</th>
            </tr>
          </thead>
          <tbody>
            {allTrades.map((t, i) => (
              <tr
                key={i}
                style={{ borderBottom: `1px solid ${C.border}` }}
              >
                <td className="pr-2 py-1 font-semibold" style={{ color: C.text }}>{t.ticker}</td>
                <td className="pr-2 py-1 font-mono" style={{ color: C.sub }}>{t.entry_date}</td>
                <td className="pr-2 py-1 font-mono" style={{ color: C.sub }}>{t.exit_date}</td>
                <td className="text-right pr-2 py-1 font-mono" style={{ color: C.sub }}>
                  {usd(t.entry_price)}
                </td>
                <td className="text-right pr-2 py-1 font-mono" style={{ color: C.sub }}>
                  {usd(t.exit_price)}
                </td>
                <td
                  className="text-right pr-2 py-1 font-mono font-semibold"
                  style={{ color: t.pnl >= 0 ? C.green : C.red }}
                >
                  {t.pnl >= 0 ? '+' : ''}{usd(t.pnl)}
                </td>
                <td
                  className="text-right py-1 font-mono font-semibold"
                  style={{ color: t.pnl_pct >= 0 ? C.green : C.red }}
                >
                  {t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── SPY equity reconstruction ─────────────────────────────────────────────────

function buildSpyEquity(report: BacktestReport): EquityPoint[] {
  const curve = report.combined_os_equity;
  if (curve.length === 0) return [];
  const spyPts: EquityPoint[] = [];
  let runVal = 100_000;
  for (const fold of report.folds) {
    const n = fold.equity_curve.length;
    if (n === 0) continue;
    const spyEnd = runVal * (1 + fold.os_benchmark_return);
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 1;
      spyPts.push({ date: fold.equity_curve[i].date, value: runVal + (spyEnd - runVal) * t });
    }
    runVal = spyEnd;
  }
  return spyPts;
}

// ── Strategy tab ──────────────────────────────────────────────────────────────

function StrategyTab({
  strategyKey, report,
}: {
  strategyKey: 'momentum' | 'mean_rev';
  report: BacktestReport | null;
}) {
  if (!report) return null;

  const allTrades = report.folds.flatMap(f => f.trades ?? []);
  const chartColor = strategyKey === 'momentum' ? C.blue : C.teal;

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto px-1">
      {/* Signal conditions */}
      <SignalConditions strategy={strategyKey} />

      {/* Summary KPI cards */}
      <SummaryCards report={report} />

      {/* Equity curve — full width, tall */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.muted }}>
            Out-of-Sample Equity Curve
          </span>
          <span className="text-[10px]" style={{ color: C.muted }}>
            · $100k start · ▲ = buy entry, ▼ = exit
          </span>
        </div>
        <div
          className="w-full rounded-lg overflow-hidden"
          style={{ height: 320, border: `1px solid ${C.border}` }}
        >
          <EquityChart
            points={report.combined_os_equity}
            color={chartColor}
            label="Portfolio"
            trades={allTrades}
          />
        </div>
      </div>

      {/* Fold table */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: C.muted }}>
          Walk-Forward Fold Results ({report.folds.length} folds · vs SPY = alpha per fold)
        </div>
        <div
          className="rounded-lg p-3"
          style={{ backgroundColor: C.bgCard, border: `1px solid ${C.border}` }}
        >
          <FoldBar folds={report.folds} />
        </div>
      </div>

      {/* Trade log */}
      <div
        className="rounded-lg p-3"
        style={{ backgroundColor: C.bgCard, border: `1px solid ${C.border}` }}
      >
        <TradeLog folds={report.folds} />
      </div>
    </div>
  );
}

// ── Compare tab ───────────────────────────────────────────────────────────────

function CompareTab({
  momReport, revReport,
}: {
  momReport: BacktestReport | null;
  revReport: BacktestReport | null;
}) {
  const report = momReport ?? revReport;
  if (!report) return null;

  const spyEquity  = buildSpyEquity(report);
  const momEquity  = momReport?.combined_os_equity ?? [];
  const revEquity  = revReport?.combined_os_equity ?? [];
  const momTrades  = momReport?.folds.flatMap(f => f.trades ?? []) ?? [];

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto px-1">
      {/* Overlay chart */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.muted }}>
            Strategy Comparison vs SPY
          </span>
          <div className="flex items-center gap-3 ml-2 text-[10px]">
            {momEquity.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 inline-block" style={{ backgroundColor: C.blue }} />
                <span style={{ color: C.sub }}>Momentum</span>
              </span>
            )}
            {revEquity.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 inline-block" style={{ backgroundColor: C.teal }} />
                <span style={{ color: C.sub }}>Mean Rev</span>
              </span>
            )}
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 inline-block border-b border-dashed" style={{ borderColor: C.amber }} />
              <span style={{ color: C.sub }}>SPY B&H</span>
            </span>
          </div>
        </div>
        <div
          className="w-full rounded-lg overflow-hidden"
          style={{ height: 340, border: `1px solid ${C.border}` }}
        >
          {momEquity.length > 0 ? (
            <EquityChart
              points={momEquity}
              color={C.blue}
              label="Momentum"
              comparePoints={revEquity.length > 0 ? revEquity : spyEquity}
              compareColor={revEquity.length > 0 ? C.teal : C.amber}
              compareLabel={revEquity.length > 0 ? 'Mean Rev' : 'SPY'}
              trades={momTrades}
            />
          ) : (
            <EquityChart
              points={revEquity}
              color={C.teal}
              label="Mean Rev"
              comparePoints={spyEquity}
              compareColor={C.amber}
              compareLabel="SPY"
            />
          )}
        </div>
      </div>

      {/* Side-by-side metric cards */}
      <div className="grid grid-cols-2 gap-3">
        {([momReport, revReport] as const).map((r, i) => {
          if (!r) return null;
          const name  = i === 0 ? 'Dual Momentum' : 'Mean Reversion';
          const color = i === 0 ? C.blue : C.teal;
          return (
            <div
              key={r.strategy}
              className="rounded-lg p-3"
              style={{ backgroundColor: C.bgCard, border: `1px solid ${C.border}` }}
            >
              <div className="flex items-center gap-1.5 mb-3">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[11px] font-semibold" style={{ color }}>{name}</span>
              </div>
              <div className="space-y-1.5">
                {([
                  ['OS CAGR',    sign(r.combined_os_cagr, 1), r.combined_os_cagr >= 0 ? C.green : C.red],
                  ['OS Sharpe',  r.combined_os_sharpe.toFixed(2), r.combined_os_sharpe >= 1 ? C.green : C.amber],
                  ['Max DD',     pct(r.combined_os_max_dd, 1), C.red],
                  ['Degrad.',    r.sharpe_degradation.toFixed(2), r.sharpe_degradation > 0.3 ? C.amber : C.green],
                  ['Median CAGR', sign(r.median_os_cagr, 1), r.median_os_cagr >= 0 ? C.green : C.red],
                ] as [string, string, string][]).map(([lbl, val, col]) => (
                  <div key={lbl} className="flex justify-between items-baseline">
                    <span className="text-[10px]" style={{ color: C.muted }}>{lbl}</span>
                    <span className="text-[11px] font-mono font-semibold" style={{ color: col }}>{val}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Per-fold SPY alpha table */}
      <div
        className="rounded-lg p-3"
        style={{ backgroundColor: C.bgCard, border: `1px solid ${C.border}` }}
      >
        <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: C.muted }}>
          SPY Alpha Per Fold (Momentum)
        </div>
        <div className="grid grid-cols-3 gap-1">
          {(momReport ?? revReport)!.folds.map(f => {
            const alpha = f.os_cagr - f.os_benchmark_return;
            return (
              <div
                key={f.fold}
                className="flex justify-between items-center px-2 py-1 rounded text-[10px]"
                style={{ backgroundColor: C.bg }}
              >
                <span style={{ color: C.sub }}>{f.os_start.slice(0, 7)}</span>
                <span
                  className="font-mono font-semibold"
                  style={{ color: alpha >= 0 ? C.green : C.red }}
                >
                  {sign(alpha, 1)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Loading / error states ────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <TrendingUp size={32} style={{ color: C.blue }} className="animate-pulse" />
      <div className="text-center">
        <div className="text-sm font-medium" style={{ color: C.text }}>Running walk-forward backtest…</div>
        <div className="text-[11px] mt-1" style={{ color: C.sub }}>10 years · 7 folds · may take ~30s</div>
      </div>
      <div className="flex gap-1 mt-2">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full animate-bounce"
            style={{ backgroundColor: C.blue, animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main drawer (full-screen modal) ──────────────────────────────────────────

export default function BacktestDrawer({ ticker, open, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('momentum');
  const [hasRun, setHasRun] = useState(false);

  const mom = useBacktest('momentum');
  const rev = useBacktest('mean_rev');

  useEffect(() => {
    if (!open || hasRun) return;
    mom.run();
    rev.run();
    setHasRun(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isLoading = mom.loading || rev.loading;
  const hasError  = mom.error ?? rev.error;

  const handleRerun = () => { mom.run(); rev.run(); };

  if (!open) return null;

  return (
    /* Full-screen overlay — rendered as a portal-style fixed layer */
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ backgroundColor: C.bg }}
    >
      {/* ── Top bar ── */}
      <div
        className="flex items-center justify-between px-4 flex-shrink-0"
        style={{ height: 44, borderBottom: `1px solid ${C.border}`, backgroundColor: '#0f1117' }}
      >
        {/* Left: icon + title */}
        <div className="flex items-center gap-2">
          <BarChart2 size={16} style={{ color: C.blue }} />
          <span className="text-sm font-semibold" style={{ color: C.text }}>
            Quant Backtest
          </span>
          <span
            className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold"
            style={{ backgroundColor: '#1a2040', color: C.blue }}
          >
            {ticker}
          </span>
          <span className="text-[10px]" style={{ color: C.muted }}>
            · Walk-forward 2015 – 2024 · $100k · 0.05% costs · next-open fill
          </span>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleRerun}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] transition-colors"
            style={{ backgroundColor: C.bgCard, border: `1px solid ${C.border}`, color: C.sub }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.sub; }}
            title="Re-run backtest"
          >
            <RotateCcw size={11} />
            Re-run
          </button>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded transition-colors"
            style={{ backgroundColor: C.bgCard, border: `1px solid ${C.border}`, color: C.sub }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.sub; }}
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div
        className="flex flex-shrink-0 px-4"
        style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: '#0f1117' }}
      >
        {(Object.keys(TAB_LABELS) as TabId[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="text-[12px] font-medium px-4 py-2.5 transition-colors"
            style={{
              color:        activeTab === tab ? C.text : C.muted,
              borderBottom: activeTab === tab ? `2px solid ${C.blue}` : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}

        {/* Info tooltip */}
        <div className="ml-auto flex items-center gap-1.5 text-[10px]" style={{ color: C.muted }}>
          <Info size={11} />
          IS = in-sample training · OS = out-of-sample test · all metrics on OS data
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-hidden relative" style={{ minHeight: 0 }}>
        {isLoading && <LoadingState />}

        {!isLoading && hasError && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="text-sm" style={{ color: C.red }}>Backtest error</div>
            <div className="text-[11px] text-center px-8 max-w-md" style={{ color: C.sub }}>{hasError}</div>
            <button
              onClick={handleRerun}
              className="px-4 py-1.5 rounded text-[12px] mt-1"
              style={{ backgroundColor: C.bgCard, border: `1px solid ${C.border}`, color: C.text }}
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !hasError && (
          <div className="h-full overflow-hidden p-4">
            {activeTab === 'momentum' && (
              <StrategyTab strategyKey="momentum" report={mom.report} />
            )}
            {activeTab === 'mean_rev' && (
              <StrategyTab strategyKey="mean_rev" report={rev.report} />
            )}
            {activeTab === 'compare' && (
              <CompareTab momReport={mom.report} revReport={rev.report} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
