import { useState, useMemo } from 'react';
import type { StockInfo } from '../types';
import StockCard from './StockCard';
import { Search, AlertCircle } from 'lucide-react';

interface Props {
  stocks: StockInfo[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  selectedTicker: string | null;
  onSelect: (ticker: string) => void;
  onRefresh: () => void;
}

export default function StockList({
  stocks,
  loading,
  error,
  selectedTicker,
  onSelect,
}: Props) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'default' | 'change' | 'price'>('default');

  const filtered = useMemo(() => {
    let list = [...stocks];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (s) => s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
      );
    }
    if (sortBy === 'change') list.sort((a, b) => b.change_pct - a.change_pct);
    else if (sortBy === 'price') list.sort((a, b) => b.price - a.price);
    return list;
  }, [stocks, search, sortBy]);

  return (
    <aside
      className="w-[220px] flex-shrink-0 flex flex-col h-full border-r"
      style={{ backgroundColor: '#131722', borderColor: '#2a2e39' }}
    >
      {/* Search bar */}
      <div className="px-2 py-2 border-b" style={{ borderColor: '#2a2e39' }}>
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#4c525e' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full pl-7 pr-2 py-1.5 rounded text-xs focus:outline-none transition-all"
            style={{
              backgroundColor: '#1e222d',
              border: '1px solid #2a2e39',
              color: '#d1d4dc',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = '#2962ff')}
            onBlur={e => (e.currentTarget.style.borderColor = '#2a2e39')}
          />
        </div>
      </div>

      {/* Column headers */}
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
        <div className="mx-2 mt-2 p-2 rounded flex items-start gap-1.5" style={{ backgroundColor: '#ef535015', border: '1px solid #ef535030' }}>
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
            <p className="text-center text-xs mt-8" style={{ color: '#4c525e' }}>No results for "{search}"</p>
          ) : (
            filtered.map((stock) => (
              <StockCard
                key={stock.ticker}
                stock={stock}
                selected={selectedTicker === stock.ticker}
                onClick={() => onSelect(stock.ticker)}
              />
            ))
          )}
        </div>
      )}
    </aside>
  );
}
