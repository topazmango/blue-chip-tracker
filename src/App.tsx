import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useStockList, useRealtimeQuotes } from './hooks/useStockData';
import StockList from './components/StockList';
import StockChart from './components/StockChart';
import TitleBar from './components/TitleBar';
import DrawingToolbar from './components/DrawingToolbar';
import ChartToolbar from './components/ChartToolbar';
import ScreenerDrawer from './components/ScreenerDrawer';
import type { StockInfo, ChartType, DrawingTool, ChartActions, PriceAlert, SearchResult } from './types';

export default function App() {
  const { stocks: baseStocks, loading, error, lastUpdated, refresh } = useStockList(60000);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [screenerOpen, setScreenerOpen] = useState(false);

  const [chartType, setChartType]   = useState<ChartType>('candlestick');
  const [activeTool, setActiveTool] = useState<DrawingTool>('cursor');
  const chartActionsRef             = useRef<ChartActions | null>(null);

  // User-added custom stocks (not in DEFAULT_STOCKS)
  const [customStocks, setCustomStocks] = useState<StockInfo[]>([]);
  const customTickers = useMemo(() => customStocks.map((s) => s.ticker), [customStocks]);

  // Merge base + custom, deduplicating by ticker.
  // Must be memoized — an inline array literal would be a new reference on every render,
  // causing useRealtimeQuotes' seeding effect to fire every render and overwrite live prices.
  const allBaseStocks = useMemo<StockInfo[]>(() => [
    ...baseStocks,
    ...customStocks.filter((c) => !baseStocks.some((b) => b.ticker === c.ticker)),
  ], [baseStocks, customStocks]);

  const { stocks, setStocks, liveCandle, isLive } = useRealtimeQuotes(
    allBaseStocks,
    selectedTicker,
    5000,
    customTickers,
  );

  const selectedStock: StockInfo | null =
    selectedTicker ? (stocks.find((s) => s.ticker === selectedTicker) ?? null) : null;

  // ── Add / remove custom stocks ─────────────────────────────────────────────
  const handleAddStock = useCallback((result: SearchResult) => {
    const newStock: StockInfo = {
      ticker:     result.ticker,
      name:       result.name,
      sector:     result.sector,
      price:      result.price,
      prev_close: result.price,
      change:     0,
      change_pct: 0,
      volume:     0,
      day_high:   result.price,
      day_low:    result.price,
    };
    // Use functional updater to avoid closing over stale `stocks`
    setStocks((prev) => {
      if (prev.some((s) => s.ticker === result.ticker)) return prev;
      return [...prev, newStock];
    });
    setCustomStocks((prev) => {
      if (prev.some((s) => s.ticker === result.ticker)) return prev;
      return [...prev, newStock];
    });
  }, [setStocks]);

  const handleRemoveStock = useCallback((ticker: string) => {
    setCustomStocks((prev) => prev.filter((s) => s.ticker !== ticker));
    setStocks((prev) => prev.filter((s) => s.ticker !== ticker));
    setSelectedTicker((current) => {
      if (current !== ticker) return current;
      // Pick the first remaining stock that isn't the one being removed
      return null; // will be picked up by the auto-select effect below
    });
  }, [setStocks]);

  // ── Price alerts ──────────────────────────────────────────────────────────
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const alertsRef = useRef<PriceAlert[]>(alerts);
  useEffect(() => { alertsRef.current = alerts; }, [alerts]);

  const handleAlertAdd = useCallback((ticker: string, price: number) => {
    const id = `${ticker}-${price}-${Date.now()}`;
    setAlerts((prev) => [...prev, { id, ticker, price, triggered: false }]);
  }, []);

  const handleAlertTriggered = useCallback((id: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, triggered: true } : a)),
    );
    // Use the ref to avoid a stale closure over `alerts`
    const alert = alertsRef.current.find((a) => a.id === id);
    if (alert && window.electronAPI) {
      try {
        new Notification(`Price Alert — ${alert.ticker}`, {
          body: `Price crossed $${alert.price.toFixed(2)}`,
        });
      } catch { /* browser Notification API may not be available */ }
    }
  }, []);

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

      <div className="flex flex-1 min-h-0">
        <StockList
          stocks={stocks}
          loading={loading}
          error={error}
          lastUpdated={lastUpdated}
          selectedTicker={selectedTicker}
          onSelect={setSelectedTicker}
          onRefresh={refresh}
          onAddStock={handleAddStock}
          onRemoveStock={handleRemoveStock}
          customTickers={customTickers}
          onOpenScreener={() => setScreenerOpen(true)}
        />
        <DrawingToolbar
          activeTool={activeTool}
          onToolChange={setActiveTool}
          chartActionsRef={chartActionsRef}
        />
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
        <ChartToolbar
          chartType={chartType}
          onChartTypeChange={setChartType}
          chartActionsRef={chartActionsRef}
        />
      </div>

      <ScreenerDrawer
        open={screenerOpen}
        onClose={() => setScreenerOpen(false)}
        onSelectTicker={setSelectedTicker}
      />
    </div>
  );
}
