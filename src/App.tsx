import { useState, useEffect, useRef, useCallback } from 'react';
import { useStockList, useRealtimeQuotes } from './hooks/useStockData';
import StockList from './components/StockList';
import StockChart from './components/StockChart';
import TitleBar from './components/TitleBar';
import DrawingToolbar from './components/DrawingToolbar';
import ChartToolbar from './components/ChartToolbar';
import type { StockInfo, ChartType, DrawingTool, ChartActions, PriceAlert } from './types';

export default function App() {
  const { stocks: baseStocks, loading, error, lastUpdated, refresh } = useStockList(60000);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const [chartType, setChartType]   = useState<ChartType>('candlestick');
  const [activeTool, setActiveTool] = useState<DrawingTool>('cursor');
  const chartActionsRef             = useRef<ChartActions | null>(null);

  const { stocks, liveCandle, isLive } = useRealtimeQuotes(baseStocks, selectedTicker, 5000);

  const selectedStock: StockInfo | null =
    selectedTicker ? (stocks.find((s) => s.ticker === selectedTicker) ?? null) : null;

  // ── Price alerts ─────────────────────────────────────────────────────────────
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);

  const handleAlertAdd = useCallback((ticker: string, price: number) => {
    const id = `${ticker}-${price}-${Date.now()}`;
    setAlerts((prev) => [...prev, { id, ticker, price, triggered: false }]);
  }, []);

  const handleAlertTriggered = useCallback((id: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, triggered: true } : a)),
    );
    const alert = alerts.find((a) => a.id === id);
    if (alert && window.electronAPI) {
      // Fire a native OS notification via Electron (if available)
      try {
        new Notification(`Price Alert — ${alert.ticker}`, {
          body: `Price crossed $${alert.price.toFixed(2)}`,
        });
      } catch { /* browser Notification API may not be available */ }
    }
  }, [alerts]);

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
        <DrawingToolbar
          activeTool={activeTool}
          onToolChange={setActiveTool}
          chartActionsRef={chartActionsRef}
        />

        {/* Chart */}
        <StockChart
          stock={selectedStock}
          liveCandle={liveCandle}
          isLive={isLive}
          chartType={chartType}
          activeTool={activeTool}
          onToolChange={setActiveTool}
          chartActionsRef={chartActionsRef}
          alerts={alerts}
          onAlertAdd={handleAlertAdd}
          onAlertTriggered={handleAlertTriggered}
        />

        {/* Right chart tools */}
        <ChartToolbar
          chartType={chartType}
          onChartTypeChange={setChartType}
          chartActionsRef={chartActionsRef}
        />
      </div>
    </div>
  );
}
