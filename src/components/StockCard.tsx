import type { StockInfo } from '../types';

interface Props {
  stock: StockInfo;
  selected: boolean;
  onClick: () => void;
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTime(ts: number): string {
  // ts is a Unix timestamp in seconds (ET market time from yfinance)
  return new Date(ts * 1000).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'America/New_York',
  });
}

export default function StockCard({ stock, selected, onClick }: Props) {
  const isUp = stock.change_pct > 0;
  const isDown = stock.change_pct < 0;
  const changeColor = isUp ? '#26a69a' : isDown ? '#ef5350' : '#787b86';

  const hasExt = stock.ext_session && stock.ext_price != null;
  const extUp   = (stock.ext_change_pct ?? 0) >= 0;
  const extColor = extUp ? '#26a69a' : '#ef5350';
  const extLabel = stock.ext_session === 'PRE' ? '#f59e0b' : '#7c3aed';

  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center justify-between px-3 py-2 transition-colors"
      style={{
        backgroundColor: selected ? '#1e222d' : 'transparent',
        borderLeft: selected ? '2px solid #2962ff' : '2px solid transparent',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.backgroundColor = '#1a1e2a'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.backgroundColor = 'transparent'; }}
    >
      {/* Ticker + name + timestamp */}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold tracking-wide truncate" style={{ color: selected ? '#d1d4dc' : '#b2b5be' }}>
          {stock.ticker}
        </div>
        <div className="text-[10px] truncate mt-0.5" style={{ color: '#4c525e' }}>
          {stock.name}
        </div>
        {stock.quote_time != null && (
          <div className="text-[9px] tabular-nums mt-0.5" style={{ color: '#363a45' }}>
            {fmtTime(stock.quote_time)} ET
          </div>
        )}
      </div>

      {/* Price + change + optional extended hours */}
      <div className="text-right flex-shrink-0 ml-2">
        <div className="text-xs font-medium tabular-nums" style={{ color: '#d1d4dc' }}>
          {stock.price === 0 ? '—' : `$${fmt(stock.price)}`}
        </div>
        <div className="text-[10px] tabular-nums font-medium mt-0.5" style={{ color: changeColor }}>
          {stock.change_pct >= 0 ? '+' : ''}{stock.change_pct.toFixed(2)}%
        </div>
        {hasExt && (
          <div className="flex items-center justify-end gap-1 mt-0.5">
            <span className="text-[9px] font-semibold px-1 rounded" style={{ backgroundColor: '#1e222d', color: extLabel }}>
              {stock.ext_session}
            </span>
            <span className="text-[10px] tabular-nums" style={{ color: extColor }}>
              ${fmt(stock.ext_price!)}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}
