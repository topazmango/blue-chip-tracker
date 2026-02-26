import { useState, useEffect } from 'react';
import { useStockList, useRealtimeQuotes } from './hooks/useStockData';
import StockList from './components/StockList';
import StockChart from './components/StockChart';
import TitleBar from './components/TitleBar';
import DrawingToolbar from './components/DrawingToolbar';
import ChartToolbar from './components/ChartToolbar';
import type { StockInfo } from './types';

export default function App() {
  const { stocks: baseStocks, loading, error, lastUpdated, refresh } = useStockList(60000);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const { stocks, liveCandle, isLive } = useRealtimeQuotes(baseStocks, selectedTicker, 5000);

  const selectedStock: StockInfo | null =
    selectedTicker ? (stocks.find((s) => s.ticker === selectedTicker) ?? null) : null;

  useEffect(() => {
    if (!selectedTicker && stocks.length > 0) setSelectedTicker(stocks[0].ticker);
  }, [stocks, selectedTicker]);

  useEffect(() => {
    window.electronAPI?.onStateChange(({ maximized: m, fullscreen: f }) => {
      setMaximized(m);
      setFullscreen(f);
    });
  }, []);

  const isWin = window.electronAPI?.platform === 'win32';
  const needsPadding = isWin && maximized && !fullscreen;

  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden"
      style={{
        backgroundColor: '#131722',
        color: '#d1d4dc',
        ...(needsPadding ? { padding: '8px', boxSizing: 'border-box' } : {}),
      }}
    >
      <TitleBar maximized={maximized} fullscreen={fullscreen} onRefresh={refresh} loading={loading} />

      {/* Main body */}
      <div className="flex flex-1 min-h-0">
        {/* Watchlist */}
        <StockList
          stocks={stocks}
          loading={loading}
          error={error}
          lastUpdated={lastUpdated}
          selectedTicker={selectedTicker}
          onSelect={setSelectedTicker}
          onRefresh={refresh}
        />

        {/* Drawing toolbar */}
        <DrawingToolbar />

        {/* Chart */}
        <StockChart stock={selectedStock} liveCandle={liveCandle} isLive={isLive} />

        {/* Right chart tools */}
        <ChartToolbar />
      </div>
    </div>
  );
}
