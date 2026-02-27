import { useState, useEffect, useRef, useCallback } from 'react';
import { createChart, ColorType, LineStyle, LineSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import { X, TrendingUp, RotateCcw, BarChart2 } from 'lucide-react';
import type { BacktestReport, FoldResult, EquityPoint } from '../types';
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

// ── Metric helpers ─────────────────────────────────────────────────────────

function pct(n: number, decimals = 1): string {
  return `${(n * 100).toFixed(decimals)}%`;
}

function sign(n: number, decimals = 2): string {
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(decimals)}%`;
}

// ── Equity chart ────────────────────────────────────────────────────────────

interface EquityChartProps {
  points: EquityPoint[];
  color: string;
  comparePoints?: EquityPoint[];
  compareColor?: string;
  compareLabel?: string;
  label: string;
}

function EquityChart({ points, color, comparePoints, compareColor, compareLabel, label }: EquityChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<'Line'> | null>(null);
  const cmpSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const buildChart = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    // Destroy old chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current   = null;
      seriesRef.current  = null;
      cmpSeriesRef.current = null;
    }

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#131722' },
        textColor:  '#787b86',
        fontSize:   10,
      },
      grid: {
        vertLines: { color: '#1e222d', style: LineStyle.Dotted },
        horzLines: { color: '#1e222d', style: LineStyle.Dotted },
      },
      rightPriceScale: { borderColor: '#2a2e39' },
      timeScale:       { borderColor: '#2a2e39', timeVisible: true },
      crosshair:       { mode: 1 },
      width:           el.clientWidth,
      height:          el.clientHeight,
    });

    const toSeries = (pts: EquityPoint[]) =>
      pts
        .filter(p => p.value > 0)
        .map(p => ({
          time:  p.date as Time,
          value: p.value,
        }));

    const mainSeries = chart.addSeries(LineSeries, {
      color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: label,
    });
    mainSeries.setData(toSeries(points));
    seriesRef.current = mainSeries;

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
  }, [points, color, comparePoints, compareColor, compareLabel, label]);

  useEffect(() => {
    buildChart();
    return () => {
      chartRef.current?.remove();
      chartRef.current = null;
    };
  }, [buildChart]);

  // Handle resize
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

// ── Stats table ─────────────────────────────────────────────────────────────

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: '#1e222d' }}>
      <span className="text-[11px]" style={{ color: '#787b86' }}>{label}</span>
      <div className="text-right">
        <span className="text-[11px] font-mono font-medium" style={{ color: '#d1d4dc' }}>{value}</span>
        {sub && <span className="text-[10px] ml-1.5" style={{ color: '#4c525e' }}>{sub}</span>}
      </div>
    </div>
  );
}

function SummaryStats({ report }: { report: BacktestReport }) {
  const degraded = report.sharpe_degradation > 0.3;
  return (
    <div className="px-3 py-2">
      <div className="text-[10px] font-semibold mb-2 uppercase tracking-wide" style={{ color: '#4c525e' }}>
        Walk-Forward Summary ({report.folds.length} folds)
      </div>
      <StatRow label="Combined OS CAGR"    value={sign(report.combined_os_cagr)} />
      <StatRow label="Combined OS Sharpe"  value={report.combined_os_sharpe.toFixed(2)} />
      <StatRow label="Combined OS Max DD"  value={pct(report.combined_os_max_dd)} />
      <StatRow label="Mean IS Sharpe"      value={report.mean_is_sharpe.toFixed(2)} />
      <StatRow label="Mean OS Sharpe"      value={report.mean_os_sharpe.toFixed(2)} />
      <StatRow
        label="Sharpe Degradation"
        value={report.sharpe_degradation.toFixed(2)}
        sub={degraded ? '⚠ high' : 'ok'}
      />
      <StatRow label="Median OS CAGR"      value={sign(report.median_os_cagr)} />
    </div>
  );
}

function FoldTable({ folds }: { folds: FoldResult[] }) {
  return (
    <div className="px-3 pb-3">
      <div className="text-[10px] font-semibold mb-2 uppercase tracking-wide" style={{ color: '#4c525e' }}>
        Fold Detail
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr style={{ color: '#4c525e' }}>
              <th className="text-left pb-1 pr-2">#</th>
              <th className="text-left pb-1 pr-2">OS Window</th>
              <th className="text-right pb-1 pr-2">IS Sh</th>
              <th className="text-right pb-1 pr-2">OS Sh</th>
              <th className="text-right pb-1 pr-2">OS CAGR</th>
              <th className="text-right pb-1 pr-2">OS DD</th>
              <th className="text-right pb-1 pr-2">Win%</th>
              <th className="text-right pb-1">Trades</th>
            </tr>
          </thead>
          <tbody>
            {folds.map(f => (
              <tr key={f.fold} style={{ color: '#d1d4dc' }}>
                <td className="pr-2 py-1" style={{ color: '#787b86' }}>{f.fold}</td>
                <td className="pr-2 py-1 whitespace-nowrap" style={{ color: '#787b86' }}>
                  {f.os_start.slice(0, 7)} → {f.os_end.slice(0, 7)}
                </td>
                <td className="text-right pr-2 py-1 font-mono">{f.is_sharpe.toFixed(2)}</td>
                <td
                  className="text-right pr-2 py-1 font-mono"
                  style={{ color: f.os_sharpe >= 0 ? '#26a69a' : '#ef5350' }}
                >
                  {f.os_sharpe.toFixed(2)}
                </td>
                <td
                  className="text-right pr-2 py-1 font-mono"
                  style={{ color: f.os_cagr >= 0 ? '#26a69a' : '#ef5350' }}
                >
                  {sign(f.os_cagr, 1)}
                </td>
                <td className="text-right pr-2 py-1 font-mono" style={{ color: '#ef5350' }}>
                  {pct(f.os_max_dd, 1)}
                </td>
                <td className="text-right pr-2 py-1 font-mono">
                  {(f.os_win_rate * 100).toFixed(0)}%
                </td>
                <td className="text-right py-1 font-mono">{f.os_trades}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── SPY buy-and-hold equity builder ─────────────────────────────────────────

function buildSpyEquity(report: BacktestReport): EquityPoint[] {
  // Normalise SPY to start at same $100k as strategy
  const curve = report.combined_os_equity;
  if (curve.length === 0) return [];
  const startVal = 100_000;
  // Use benchmark returns per fold to reconstruct a SPY equity curve
  const spyPts: EquityPoint[] = [];
  let runVal = startVal;
  for (const fold of report.folds) {
    const n = fold.equity_curve.length;
    if (n === 0) continue;
    const spyEnd = runVal * (1 + fold.os_benchmark_return);
    // Linearly interpolate between runVal and spyEnd over n points
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 1;
      spyPts.push({
        date:  fold.equity_curve[i].date,
        value: runVal + (spyEnd - runVal) * t,
      });
    }
    runVal = spyEnd;
  }
  return spyPts;
}

// ── Strategy tab content ─────────────────────────────────────────────────────

function StrategyTab({
  strategyKey,
  momReport,
  revReport,
}: {
  strategyKey: 'momentum' | 'mean_rev';
  momReport: BacktestReport | null;
  revReport: BacktestReport | null;
}) {
  const report = strategyKey === 'momentum' ? momReport : revReport;
  if (!report) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Equity chart */}
      <div className="flex-shrink-0" style={{ height: 200 }}>
        <EquityChart
          points={report.combined_os_equity}
          color={strategyKey === 'momentum' ? '#2962ff' : '#14b8a6'}
          label="Portfolio"
        />
      </div>
      {/* Scrollable stats */}
      <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
        <SummaryStats report={report} />
        <FoldTable folds={report.folds} />
      </div>
    </div>
  );
}

function CompareTab({
  momReport,
  revReport,
}: {
  momReport: BacktestReport | null;
  revReport: BacktestReport | null;
}) {
  const report = momReport ?? revReport;
  if (!report) return null;

  const spyEquity = buildSpyEquity(report);

  const momEquity = momReport?.combined_os_equity ?? [];
  const revEquity = revReport?.combined_os_equity ?? [];

  // Show whichever strategies we have
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Equity chart with overlay */}
      <div className="flex-shrink-0" style={{ height: 220 }}>
        {momEquity.length > 0 ? (
          <EquityChart
            points={momEquity}
            color="#2962ff"
            label="Momentum"
            comparePoints={revEquity.length > 0 ? revEquity : spyEquity}
            compareColor={revEquity.length > 0 ? '#14b8a6' : '#f59e0b'}
            compareLabel={revEquity.length > 0 ? 'Mean Rev' : 'SPY'}
          />
        ) : (
          <EquityChart
            points={revEquity}
            color="#14b8a6"
            label="Mean Rev"
            comparePoints={spyEquity}
            compareColor="#f59e0b"
            compareLabel="SPY"
          />
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3" style={{ minHeight: 0 }}>
        {/* Side-by-side summary */}
        <div className="grid grid-cols-2 gap-3">
          {[momReport, revReport].map((r, i) => {
            if (!r) return null;
            const name = i === 0 ? 'Momentum' : 'Mean Rev';
            const col  = i === 0 ? '#2962ff' : '#14b8a6';
            return (
              <div key={r.strategy}>
                <div className="text-[10px] font-semibold mb-2 uppercase" style={{ color: col }}>
                  {name}
                </div>
                <div className="space-y-1">
                  {[
                    ['CAGR',     sign(r.combined_os_cagr)],
                    ['Sharpe',   r.combined_os_sharpe.toFixed(2)],
                    ['Max DD',   pct(r.combined_os_max_dd, 1)],
                    ['Degrad.',  r.sharpe_degradation.toFixed(2)],
                  ].map(([lbl, val]) => (
                    <div key={lbl} className="flex justify-between">
                      <span className="text-[10px]" style={{ color: '#4c525e' }}>{lbl}</span>
                      <span className="text-[10px] font-mono" style={{ color: '#d1d4dc' }}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3">
          <div className="text-[10px] font-semibold mb-2 uppercase tracking-wide" style={{ color: '#4c525e' }}>
            SPY Benchmark (per fold)
          </div>
          <div className="space-y-0.5">
            {(momReport ?? revReport)!.folds.map(f => (
              <div key={f.fold} className="flex justify-between text-[10px]">
                <span style={{ color: '#4c525e' }}>
                  {f.os_start.slice(0, 7)} – {f.os_end.slice(0, 7)}
                </span>
                <span
                  className="font-mono"
                  style={{ color: f.os_benchmark_return >= 0 ? '#26a69a' : '#ef5350' }}
                >
                  {sign(f.os_benchmark_return, 1)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main drawer ──────────────────────────────────────────────────────────────

export default function BacktestDrawer({ ticker, open, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('momentum');
  const [hasRunMom, setHasRunMom] = useState(false);
  const [hasRunRev, setHasRunRev] = useState(false);

  const mom = useBacktest('momentum');
  const rev = useBacktest('mean_rev');

  // When drawer opens for first time, auto-run both strategies
  useEffect(() => {
    if (!open) return;
    if (!hasRunMom) {
      mom.run();
      setHasRunMom(true);
    }
    if (!hasRunRev) {
      rev.run();
      setHasRunRev(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isLoading = mom.loading || rev.loading;
  const hasError  = mom.error ?? rev.error;

  const handleRerun = () => {
    mom.run();
    rev.run();
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="absolute inset-0 z-10"
          style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
          onClick={onClose}
        />
      )}

      {/* Drawer panel */}
      <div
        className="absolute top-0 right-0 h-full z-20 flex flex-col"
        style={{
          width:      400,
          backgroundColor: '#131722',
          borderLeft: '1px solid #2a2e39',
          transform:  open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.22s cubic-bezier(0.4,0,0.2,1)',
          overflow:   'hidden',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 flex-shrink-0"
          style={{ height: 36, borderBottom: '1px solid #2a2e39' }}
        >
          <div className="flex items-center gap-2">
            <BarChart2 size={13} style={{ color: '#787b86' }} />
            <span className="text-[11px] font-semibold" style={{ color: '#d1d4dc' }}>
              Backtest · {ticker}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleRerun}
              className="p-1 rounded"
              style={{ color: '#787b86' }}
              title="Re-run backtest"
            >
              <RotateCcw size={12} />
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded"
              style={{ color: '#787b86' }}
              title="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div
          className="flex flex-shrink-0"
          style={{ borderBottom: '1px solid #2a2e39' }}
        >
          {(Object.keys(TAB_LABELS) as TabId[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="flex-1 text-[10px] font-medium py-1.5 transition-colors"
              style={{
                color:           activeTab === tab ? '#d1d4dc' : '#4c525e',
                borderBottom:    activeTab === tab ? '2px solid #2962ff' : '2px solid transparent',
                backgroundColor: 'transparent',
              }}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 relative overflow-hidden" style={{ minHeight: 0 }}>
          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10"
              style={{ backgroundColor: '#131722' }}>
              <div className="mb-3">
                <TrendingUp size={24} style={{ color: '#2962ff' }} className="animate-pulse" />
              </div>
              <div className="text-[11px]" style={{ color: '#787b86' }}>Running backtest...</div>
              <div className="text-[10px] mt-1" style={{ color: '#4c525e' }}>
                10-year walk-forward · may take ~30s
              </div>
            </div>
          )}

          {!isLoading && hasError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[11px] text-center px-4" style={{ color: '#ef5350' }}>
                Backtest error
              </div>
              <div className="text-[10px] mt-1 text-center px-4" style={{ color: '#4c525e' }}>
                {hasError}
              </div>
              <button
                onClick={handleRerun}
                className="mt-3 px-3 py-1 rounded text-[10px]"
                style={{ backgroundColor: '#1e222d', color: '#d1d4dc' }}
              >
                Retry
              </button>
            </div>
          )}

          {!isLoading && !hasError && (
            <div className="h-full">
              {activeTab === 'momentum' && (
                <StrategyTab strategyKey="momentum" momReport={mom.report} revReport={rev.report} />
              )}
              {activeTab === 'mean_rev' && (
                <StrategyTab strategyKey="mean_rev" momReport={mom.report} revReport={rev.report} />
              )}
              {activeTab === 'compare' && (
                <CompareTab momReport={mom.report} revReport={rev.report} />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
