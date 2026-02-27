import { useState, useRef, useEffect } from 'react';
import type { StockInfo, Timeframe, IndicatorSettings, Candle, ChartType, DrawingTool, ChartActions, PriceAlert } from '../types';
import { useStockHistory, useEarnings, useSpyHistory, useStockMeta } from '../hooks/useStockData';
import ChartPane from './ChartPane';
import TimeframeSelector from './TimeframeSelector';
import IndicatorPanel from './IndicatorPanel';
import BacktestDrawer from './BacktestDrawer';
import { Loader2, AlertTriangle, BarChart2, FlaskConical } from 'lucide-react';

// Universe tickers that have backtest data available
const QUANT_UNIVERSE = new Set([
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL',
  'META', 'AVGO', 'AMD', 'CRM', 'ORCL', 'NOW',
]);

interface Props {
  stock: StockInfo | null;
  liveCandle?: Candle | null;
  isLive?: boolean;
  chartType: ChartType;
  activeTool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
  chartActionsRef: React.RefObject<ChartActions | null>;
  alerts: PriceAlert[];
  onAlertAdd: (ticker: string, price: number) => void;
  onAlertTriggered: (id: string) => void;
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtLarge(n: number) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3)  return (n / 1e3).toFixed(0) + 'K';
  return n.toString();
}

/** Visual tick-rate indicator.
 *  Shows a pulsing dot + a decaying arc/bar that refills on each new tick,
 *  giving an intuitive sense of how fast/fresh the price updates are.
 */
function TickCamera({ tickAge, pollMs }: { tickAge: number; pollMs: number }) {
  // freshness: 1.0 = just updated, 0.0 = full interval elapsed
  const freshness = Math.max(0, 1 - tickAge / pollMs);

  // Color transitions green → amber → red as data goes stale
  const r = freshness > 0.5
    ? Math.round(38 + (239 - 38) * (1 - freshness) * 2)   // 38→239 in upper half
    : 239;
  const g = freshness > 0.5
    ? 166
    : Math.round(166 * freshness * 2);                     // 166→0 in lower half
  const dotColor = `rgb(${r},${g},83)`;

  // seconds-ago label
  const secsAgo = Math.round(tickAge / 1000);
  const label = tickAge < 800 ? 'NOW' : `${secsAgo}s ago`;

  // Arc SVG: a thin ring that drains clockwise as the tick ages
  const SIZE = 14;
  const R = 5.5;
  const circ = 2 * Math.PI * R;
  const dash = freshness * circ;

  return (
    <span
      className="flex items-center gap-1 text-[10px] tabular-nums"
      title={`Live price feed — last tick ${label} · updates every ${pollMs / 1000}s`}
      style={{ color: dotColor }}
    >
      {/* Circular progress arc */}
      <svg width={SIZE} height={SIZE} style={{ flexShrink: 0, transform: 'rotate(-90deg)' }}>
        {/* track */}
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#2a2e39" strokeWidth="1.8" />
        {/* fill arc */}
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R}
          fill="none"
          stroke={dotColor}
          strokeWidth="1.8"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.1s linear, stroke 0.2s' }}
        />
      </svg>
      LIVE&nbsp;{label}
    </span>
  );
}

export default function StockChart({ stock, liveCandle, isLive, chartType, activeTool, onToolChange, chartActionsRef, alerts, onAlertAdd, onAlertTriggered }: Props) {
  const [timeframe, setTimeframe] = useState<Timeframe>('3M');
  const [showPrePost, setShowPrePost] = useState(false);
  const [showBacktest, setShowBacktest] = useState(false);
  const [indicators, setIndicators] = useState<IndicatorSettings>({
    sma20: false, sma50: true, sma200: false, bollingerBands: false,
    rsi: false, volume: true,
    macd: false, volumeProfile: false, supportResistance: false,
    relativeStrength: false, earningsDates: false, week52HighLow: false,
  });

  // Close backtest drawer when ticker changes
  useEffect(() => {
    setShowBacktest(false);
  }, [stock?.ticker]);

  // ChartPane exposes actions via forwardRef; wire to the shared ref
  const chartPaneRef = useRef<ChartActions | null>(null);
  const setRef = (actions: ChartActions | null) => {
    chartPaneRef.current = actions;
    // chartActionsRef is a MutableRefObject passed from App — safe to write
    const mutableRef = chartActionsRef as { current: ChartActions | null };
    mutableRef.current = actions;
  };

  // Track when the last tick arrived so we can show update freshness
  const [tickAge, setTickAge] = useState<number>(0);        // ms since last tick
  const lastTickRef = useRef<number>(0);
  const POLL_MS = 5000;

  // Flash on every new liveCandle
  useEffect(() => {
    if (!liveCandle) return;
    lastTickRef.current = performance.now();
    setTickAge(0);
  }, [liveCandle]);

  // Fast counter to animate decay between ticks
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => {
      const age = performance.now() - lastTickRef.current;
      setTickAge(Math.min(age, POLL_MS));
    }, 100);
    return () => clearInterval(id);
  }, [isLive]);

  // Pre/post only makes sense for intraday timeframes (1D = 5m, 1W = 30m)
  const intradayTimeframes: Timeframe[] = ['1D', '1W'];
  const prepostActive = showPrePost && intradayTimeframes.includes(timeframe);
  const { history, loading, error } = useStockHistory(stock?.ticker ?? null, timeframe, prepostActive);
  const spyCandles  = useSpyHistory(timeframe);
  const earningsDates = useEarnings(stock?.ticker ?? null);
  const meta = useStockMeta(stock?.ticker ?? null);

  const inQuantUniverse = stock != null && QUANT_UNIVERSE.has(stock.ticker);

  if (!stock) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: '#131722' }}>
        <div className="text-center">
          <BarChart2 size={40} className="mx-auto mb-3" style={{ color: '#2a2e39' }} />
          <p className="text-sm font-medium" style={{ color: '#4c525e' }}>Select a symbol</p>
        </div>
      </div>
    );
  }

  const isUp = stock.change_pct >= 0;
  const changeColor = isUp ? '#26a69a' : '#ef5350';

  const hasExt = stock.ext_session && stock.ext_price != null;
  const extUp   = (stock.ext_change_pct ?? 0) >= 0;
  const extColor = extUp ? '#26a69a' : '#ef5350';

  // Alerts scoped to the current ticker only
  const tickerAlerts = alerts.filter((a) => a.ticker === stock.ticker);

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full" style={{ backgroundColor: '#131722' }}>

      {/* ── Top symbol bar ── */}
      <div
        className="flex items-center gap-4 px-4 h-[42px] flex-shrink-0 border-b"
        style={{ borderColor: '#2a2e39', backgroundColor: '#131722' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tracking-wide" style={{ color: '#d1d4dc' }}>{stock.ticker}</span>
          <span className="text-xs" style={{ color: '#787b86' }}>{stock.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: '#1e222d', color: '#787b86' }}>
            {stock.sector}
          </span>
          {isLive && (
            <TickCamera tickAge={tickAge} pollMs={POLL_MS} />
          )}
        </div>

        <div className="w-px h-4" style={{ backgroundColor: '#2a2e39' }} />

        <div className="flex items-center gap-3 text-xs tabular-nums">
          <span className="font-semibold text-sm" style={{ color: '#d1d4dc' }}>${fmt(stock.price)}</span>
          <span className="font-medium" style={{ color: changeColor }}>
            {isUp ? '+' : ''}{fmt(stock.change)} ({isUp ? '+' : ''}{stock.change_pct.toFixed(2)}%)
          </span>
          <span style={{ color: '#4c525e' }}>H</span>
          <span style={{ color: '#d1d4dc' }}>{fmt(stock.day_high)}</span>
          <span style={{ color: '#4c525e' }}>L</span>
          <span style={{ color: '#d1d4dc' }}>{fmt(stock.day_low)}</span>
          <span style={{ color: '#4c525e' }}>Vol</span>
          <span style={{ color: '#d1d4dc' }}>{fmtLarge(stock.volume)}</span>
          <span style={{ color: '#4c525e' }}>PC</span>
          <span style={{ color: '#d1d4dc' }}>{fmt(stock.prev_close)}</span>
          {meta?.week52_high != null && (
            <>
              <span style={{ color: '#4c525e' }}>52H</span>
              <span style={{ color: '#26a69a' }}>{fmt(meta.week52_high)}</span>
              <span style={{ color: '#4c525e' }}>52L</span>
              <span style={{ color: '#ef5350' }}>{fmt(meta.week52_low!)}</span>
            </>
          )}
        </div>

        {hasExt && (
          <>
            <div className="w-px h-4" style={{ backgroundColor: '#2a2e39' }} />
            <div className="flex items-center gap-2 text-xs tabular-nums">
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                style={{ backgroundColor: '#1e222d', color: stock.ext_session === 'PRE' ? '#f59e0b' : '#7c3aed' }}
              >
                {stock.ext_session}
              </span>
              <span className="font-semibold" style={{ color: '#d1d4dc' }}>${fmt(stock.ext_price!)}</span>
              <span style={{ color: extColor }}>
                {extUp ? '+' : ''}{(stock.ext_change_pct! * 1).toFixed(4)}%
              </span>
            </div>
          </>
        )}
      </div>

      {/* ── Toolbar: timeframes + indicators ── */}
      <div
        className="flex items-center gap-3 px-3 h-[36px] flex-shrink-0 border-b"
        style={{ borderColor: '#2a2e39', backgroundColor: '#131722' }}
      >
        <TimeframeSelector selected={timeframe} onChange={setTimeframe} />
        <div className="w-px h-4 flex-shrink-0" style={{ backgroundColor: '#2a2e39' }} />
        {/* Pre/Post market toggle — only shown for intraday timeframes */}
        {intradayTimeframes.includes(timeframe) && (
          <button
            onClick={() => setShowPrePost((v) => !v)}
            title="Toggle pre-market and after-hours candles"
            className="text-[11px] font-medium px-2 py-0.5 rounded transition-colors"
            style={{
              backgroundColor: prepostActive ? '#f59e0b22' : 'transparent',
              color: prepostActive ? '#f59e0b' : '#4c525e',
              border: `1px solid ${prepostActive ? '#f59e0b55' : '#2a2e39'}`,
            }}
          >
            EXT
          </button>
        )}
        <div className="w-px h-4 flex-shrink-0" style={{ backgroundColor: '#2a2e39' }} />
        <IndicatorPanel settings={indicators} onChange={setIndicators} meta={meta} />

        {/* Spacer pushes backtest button to the right */}
        <div className="flex-1" />

        {/* Backtest button — only shown for universe tickers */}
        {inQuantUniverse && (
          <button
            onClick={() => setShowBacktest((v) => !v)}
            title="Open walk-forward backtest drawer"
            className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded transition-colors"
            style={{
              backgroundColor: showBacktest ? '#2962ff22' : 'transparent',
              color: showBacktest ? '#2962ff' : '#4c525e',
              border: `1px solid ${showBacktest ? '#2962ff55' : '#2a2e39'}`,
            }}
          >
            <FlaskConical size={11} />
            Backtest
          </button>
        )}
      </div>

      {/* ── Chart area (relative so BacktestDrawer can position absolutely) ── */}
      <div className="flex-1 relative min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10" style={{ backgroundColor: '#13172290' }}>
            <div className="flex items-center gap-2" style={{ color: '#787b86' }}>
              <Loader2 size={16} className="animate-spin" />
              <span className="text-xs">Loading...</span>
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="text-center">
              <AlertTriangle size={28} className="mx-auto mb-2" style={{ color: '#ef5350' }} />
              <p className="text-sm" style={{ color: '#ef5350' }}>Failed to load chart</p>
              <p className="text-xs mt-1" style={{ color: '#787b86' }}>{error}</p>
            </div>
          </div>
        )}

        {history && history.candles.length > 0 && (
          <ChartPane
            ref={setRef}
            candles={history.candles}
            indicators={indicators}
            timeframe={timeframe}
            chartType={chartType}
            activeTool={activeTool}
            onToolChange={onToolChange}
            liveCandle={timeframe === '1D' ? liveCandle : null}
            ticker={stock.ticker}
            spyCandles={spyCandles}
            earningsDates={earningsDates}
            meta={meta}
            alerts={tickerAlerts}
            onAlertAdd={(price) => onAlertAdd(stock.ticker, price)}
            onAlertTriggered={onAlertTriggered}
            prepost={prepostActive}
          />
        )}

        {!loading && !error && (!history || history.candles.length === 0) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-xs" style={{ color: '#4c525e' }}>No data available</p>
          </div>
        )}

        {/* Backtest slide-out drawer — rendered inside the chart area */}
        {inQuantUniverse && (
          <BacktestDrawer
            ticker={stock.ticker}
            open={showBacktest}
            onClose={() => setShowBacktest(false)}
          />
        )}
      </div>
    </div>
  );
}
