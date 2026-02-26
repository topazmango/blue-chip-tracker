import { useState } from 'react';
import type { StockInfo, Timeframe, IndicatorSettings, Candle } from '../types';
import { useStockHistory } from '../hooks/useStockData';
import ChartPane from './ChartPane';
import TimeframeSelector from './TimeframeSelector';
import IndicatorPanel from './IndicatorPanel';
import { Loader2, AlertTriangle, BarChart2 } from 'lucide-react';

interface Props {
  stock: StockInfo | null;
  liveCandle?: Candle | null;
  isLive?: boolean;
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

export default function StockChart({ stock, liveCandle, isLive }: Props) {
  const [timeframe, setTimeframe] = useState<Timeframe>('3M');
  const [indicators, setIndicators] = useState<IndicatorSettings>({
    sma20: false, sma50: true, sma200: false, bollingerBands: false, rsi: false, volume: true,
  });

  const { history, loading, error } = useStockHistory(stock?.ticker ?? null, timeframe);

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

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full" style={{ backgroundColor: '#131722' }}>

      {/* ── Top symbol bar (like TV's symbol header) ── */}
      <div
        className="flex items-center gap-4 px-4 h-[42px] flex-shrink-0 border-b"
        style={{ borderColor: '#2a2e39', backgroundColor: '#131722' }}
      >
        {/* Symbol + name */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tracking-wide" style={{ color: '#d1d4dc' }}>{stock.ticker}</span>
          <span className="text-xs" style={{ color: '#787b86' }}>{stock.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: '#1e222d', color: '#787b86' }}>
            {stock.sector}
          </span>
          {isLive && (
            <span className="flex items-center gap-1 text-[10px]" style={{ color: '#26a69a' }}>
              <span className="live-dot" />
              LIVE
            </span>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-4" style={{ backgroundColor: '#2a2e39' }} />

        {/* Regular session price info */}
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
        </div>

        {/* Extended hours block — only shown when pre/post data is available */}
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
        <IndicatorPanel settings={indicators} onChange={setIndicators} />
      </div>

      {/* ── Chart area ── */}
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
            candles={history.candles}
            indicators={indicators}
            timeframe={timeframe}
            liveCandle={timeframe === '1D' ? liveCandle : null}
          />
        )}

        {!loading && !error && (!history || history.candles.length === 0) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-xs" style={{ color: '#4c525e' }}>No data available</p>
          </div>
        )}
      </div>
    </div>
  );
}
