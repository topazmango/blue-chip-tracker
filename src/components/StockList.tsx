import { useState, useMemo, useRef, useEffect } from 'react';
import type { StockInfo, SearchResult } from '../types';
import StockCard from './StockCard';
import { Search, AlertCircle, Plus, X, Loader2 } from 'lucide-react';
import { useTickerSearch, useSignals } from '../hooks/useStockData';

interface Props {
  stocks: StockInfo[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  selectedTicker: string | null;
  onSelect: (ticker: string) => void;
  onRefresh: () => void;
  onAddStock: (stock: SearchResult) => void;
  onRemoveStock: (ticker: string) => void;
  customTickers: string[];
}

export default function StockList({
  stocks,
  loading,
  error,
  selectedTicker,
  onSelect,
  onAddStock,
  onRemoveStock,
  customTickers,
}: Props) {
  const [filterQuery, setFilterQuery] = useState('');
  const [sortBy, setSortBy] = useState<'default' | 'change' | 'price'>('default');

  // Quant signals for universe tickers
  const { signals } = useSignals();
  const signalMap = useMemo(
    () => Object.fromEntries(signals.map((s) => [s.ticker, s])),
    [signals],
  );

  // Add-symbol search state
  const [addQuery, setAddQuery] = useState('');
  const [addOpen, setAddOpen]   = useState(false);
  const addInputRef             = useRef<HTMLInputElement>(null);

  const { result: searchResult, loading: searchLoading } = useTickerSearch(addOpen ? addQuery : '');

  const openAdd = () => {
    setAddQuery('');
    setAddOpen(true);
    setTimeout(() => addInputRef.current?.focus(), 50);
  };

  const closeAdd = () => {
    setAddOpen(false);
    setAddQuery('');
  };

  // Close on Escape
  useEffect(() => {
    if (!addOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAdd(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [addOpen]);

  const handleAdd = (res: SearchResult) => {
    onAddStock(res);
    onSelect(res.ticker);
    closeAdd();
  };

  const filtered = useMemo(() => {
    let list = [...stocks];
    if (filterQuery.trim()) {
      const q = filterQuery.trim().toLowerCase();
      list = list.filter(
        (s) => s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
      );
    }
    if (sortBy === 'change') list.sort((a, b) => b.change_pct - a.change_pct);
    else if (sortBy === 'price') list.sort((a, b) => b.price - a.price);
    return list;
  }, [stocks, filterQuery, sortBy]);

  const isCustom = (ticker: string) => customTickers.includes(ticker);

  return (
    <aside
      className="w-[220px] flex-shrink-0 flex flex-col h-full border-r"
      style={{ backgroundColor: '#131722', borderColor: '#2a2e39' }}
    >
      {/* ── Add-symbol input (shown when + is clicked) ── */}
      {addOpen ? (
        <div className="px-2 py-2 border-b" style={{ borderColor: '#2a2e39' }}>
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#4c525e' }} />
            <input
              ref={addInputRef}
              type="text"
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value.toUpperCase())}
              placeholder="Ticker, e.g. PLTR, BTC-USD"
              className="w-full pl-7 pr-6 py-1.5 rounded text-xs focus:outline-none"
              style={{
                backgroundColor: '#1e222d',
                border: '1px solid #2962ff',
                color: '#d1d4dc',
              }}
            />
            <button
              onClick={closeAdd}
              className="absolute right-1.5 top-1/2 -translate-y-1/2"
              style={{ color: '#4c525e' }}
            >
              <X size={11} />
            </button>
          </div>

          {/* Search result */}
          <div className="mt-1">
            {searchLoading && addQuery.trim().length > 0 && (
              <div
                className="flex items-center gap-2 px-2 py-2 rounded text-xs"
                style={{ color: '#787b86', backgroundColor: '#1e222d' }}
              >
                <Loader2 size={11} className="animate-spin flex-shrink-0" />
                Looking up {addQuery.trim()}…
              </div>
            )}

            {!searchLoading && searchResult && searchResult !== 'not-found' && (
              <button
                onClick={() => handleAdd(searchResult)}
                className="w-full text-left px-2 py-2 rounded flex items-center gap-2 transition-colors"
                style={{ backgroundColor: '#1e222d', border: '1px solid #2a2e39' }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#2962ff')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#2a2e39')}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold" style={{ color: '#d1d4dc' }}>
                    {searchResult.ticker}
                  </div>
                  <div className="text-[10px] truncate" style={{ color: '#4c525e' }}>
                    {searchResult.name}
                  </div>
                  <div className="text-[10px]" style={{ color: '#787b86' }}>
                    {searchResult.sector}
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="text-xs tabular-nums font-medium" style={{ color: '#d1d4dc' }}>
                    ${searchResult.price.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                  <div
                    className="flex items-center gap-1 mt-1 text-[10px] font-semibold justify-end"
                    style={{ color: '#26a69a' }}
                  >
                    <Plus size={10} />
                    Add
                  </div>
                </div>
              </button>
            )}

            {!searchLoading && searchResult === 'not-found' && addQuery.trim().length > 0 && (
              <div
                className="px-2 py-2 rounded text-xs"
                style={{ color: '#ef5350', backgroundColor: '#1e222d' }}
              >
                Symbol "{addQuery.trim()}" not found
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Normal filter bar ── */
        <div className="px-2 py-2 border-b flex items-center gap-1.5" style={{ borderColor: '#2a2e39' }}>
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#4c525e' }} />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter…"
              className="w-full pl-7 pr-2 py-1.5 rounded text-xs focus:outline-none transition-all"
              style={{
                backgroundColor: '#1e222d',
                border: '1px solid #2a2e39',
                color: '#d1d4dc',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#2962ff')}
              onBlur={(e) => (e.currentTarget.style.borderColor = '#2a2e39')}
            />
          </div>
          <button
            onClick={openAdd}
            title="Add any symbol to watchlist"
            className="flex items-center justify-center w-6 h-6 rounded flex-shrink-0 transition-colors"
            style={{ backgroundColor: '#1e222d', border: '1px solid #2a2e39', color: '#787b86' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#2962ff';
              e.currentTarget.style.color = '#2962ff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#2a2e39';
              e.currentTarget.style.color = '#787b86';
            }}
          >
            <Plus size={12} />
          </button>
        </div>
      )}

      {/* Column headers / sort buttons */}
      <div
        className="flex items-center justify-between px-3 py-1 border-b"
        style={{ borderColor: '#2a2e39', backgroundColor: '#1e222d' }}
      >
        {(['default', 'change', 'price'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className="text-[10px] font-medium uppercase tracking-wider transition-colors"
            style={{ color: sortBy === s ? '#d1d4dc' : '#4c525e' }}
          >
            {s === 'default' ? 'Symbol' : s === 'change' ? 'Chg%' : 'Price'}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div
          className="mx-2 mt-2 p-2 rounded flex items-start gap-1.5"
          style={{ backgroundColor: '#ef535015', border: '1px solid #ef535030' }}
        >
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" style={{ color: '#ef5350' }} />
          <p className="text-[10px]" style={{ color: '#ef5350' }}>Server unavailable</p>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && stocks.length === 0 && (
        <div className="flex-1 px-2 pt-2 space-y-px overflow-y-auto">
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className="h-9 rounded animate-pulse" style={{ backgroundColor: '#1e222d' }} />
          ))}
        </div>
      )}

      {/* Stock list */}
      {stocks.length > 0 && (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {filtered.length === 0 ? (
            <p className="text-center text-xs mt-8" style={{ color: '#4c525e' }}>
              No results for "{filterQuery}"
            </p>
          ) : (
            filtered.map((stock) => (
              <div key={stock.ticker} className="relative group">
                <StockCard
                  stock={stock}
                  selected={selectedTicker === stock.ticker}
                  onClick={() => onSelect(stock.ticker)}
                  signal={signalMap[stock.ticker] ?? null}
                />
                {/* Remove button — only for user-added custom symbols */}
                {isCustom(stock.ticker) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveStock(stock.ticker);
                    }}
                    title="Remove from watchlist"
                    className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex items-center justify-center w-4 h-4 rounded transition-opacity"
                    style={{ color: '#ef5350', backgroundColor: '#131722' }}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </aside>
  );
}
