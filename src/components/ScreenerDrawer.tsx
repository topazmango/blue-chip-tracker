import { useEffect } from 'react';
import { X, RefreshCw, Loader2, SlidersHorizontal, TrendingUp, AlertTriangle } from 'lucide-react';
import type { ScreenerResult } from '../types';
import { useScreener } from '../hooks/useStockData';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelectTicker: (ticker: string) => void;
}

// ── Colour tokens (matches TradingView dark theme) ──────────────────────────
const C = {
  bg:       '#131722',
  bgCard:   '#1a1e2e',
  border:   '#2a2e39',
  muted:    '#4c525e',
  sub:      '#787b86',
  text:     '#d1d4dc',
  blue:     '#2962ff',
  green:    '#26a69a',
  red:      '#ef5350',
  amber:    '#f59e0b',
};

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function signPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${fmt(n, 1)}%`;
}

function timeAgo(unixSecs: number): string {
  const diff = Math.floor(Date.now() / 1000 - unixSecs);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Table column definitions ─────────────────────────────────────────────────

interface Column {
  key: string;
  label: string;
  tooltip: string;
  align: 'left' | 'right';
  render: (r: ScreenerResult, idx: number) => React.ReactNode;
}

const COLUMNS: Column[] = [
  {
    key: 'rank',
    label: '#',
    tooltip: 'Rank by Rule of 40',
    align: 'right',
    render: (_r, idx) => (
      <span style={{ color: C.muted }}>{idx + 1}</span>
    ),
  },
  {
    key: 'ticker',
    label: 'Symbol',
    tooltip: 'Ticker symbol',
    align: 'left',
    render: (r) => (
      <div>
        <div className="font-semibold" style={{ color: C.text }}>{r.ticker}</div>
        <div className="text-[10px] truncate max-w-[120px]" style={{ color: C.muted }}>{r.name}</div>
      </div>
    ),
  },
  {
    key: 'sector',
    label: 'Sector',
    tooltip: 'GICS sector',
    align: 'left',
    render: (r) => <span style={{ color: C.sub }}>{r.sector}</span>,
  },
  {
    key: 'price',
    label: 'Price',
    tooltip: 'Last regular market price',
    align: 'right',
    render: (r) => <span className="font-mono" style={{ color: C.text }}>${fmt(r.price)}</span>,
  },
  {
    key: 'eps_revision',
    label: 'EPS Rev',
    tooltip: 'Current-quarter EPS estimate change vs 30 days ago',
    align: 'right',
    render: (r) => (
      <span className="font-mono" style={{ color: r.eps_revision_pct > 0 ? C.green : C.red }}>
        {signPct(r.eps_revision_pct)}
      </span>
    ),
  },
  {
    key: 'ev_ebitda',
    label: 'EV/EBITDA',
    tooltip: 'Trailing Enterprise Value / EBITDA (capped at 20x)',
    align: 'right',
    render: (r) => (
      <span className="font-mono" style={{ color: r.ev_ebitda <= 15 ? C.green : C.text }}>
        {fmt(r.ev_ebitda, 1)}x
      </span>
    ),
  },
  {
    key: 'rev_growth',
    label: 'Rev Gr%',
    tooltip: 'TTM revenue growth',
    align: 'right',
    render: (r) => (
      <span className="font-mono" style={{ color: r.revenue_growth > 0 ? C.green : C.red }}>
        {signPct(r.revenue_growth)}
      </span>
    ),
  },
  {
    key: 'op_margin',
    label: 'Op Mgn%',
    tooltip: 'TTM operating margin',
    align: 'right',
    render: (r) => (
      <span className="font-mono" style={{ color: r.operating_margin > 20 ? C.green : r.operating_margin > 0 ? C.text : C.red }}>
        {fmt(r.operating_margin, 1)}%
      </span>
    ),
  },
  {
    key: 'rule_of_40',
    label: 'R40',
    tooltip: 'Rule of 40 = Revenue Growth% + Operating Margin%',
    align: 'right',
    render: (r) => (
      <span
        className="font-mono font-semibold"
        style={{ color: r.rule_of_40 >= 40 ? C.green : r.rule_of_40 >= 20 ? C.amber : C.red }}
      >
        {fmt(r.rule_of_40, 1)}
      </span>
    ),
  },
  {
    key: 'bb_touch',
    label: 'BB Touch',
    tooltip: 'Days since price closed below lower 20-day Bollinger Band (within last 10 trading days)',
    align: 'right',
    render: (r) => (
      <span className="font-mono" style={{ color: r.bb_touch_days_ago <= 2 ? C.amber : C.sub }}>
        {r.bb_touch_days_ago}d ago
      </span>
    ),
  },
];

// ── Main component ──────────────────────────────────────────────────────────

export default function ScreenerDrawer({ open, onClose, onSelectTicker }: Props) {
  const { data, loading, error, refresh } = useScreener();

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const isComputing = data.status === 'computing';
  const hasResults = data.results.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ backgroundColor: C.bg }}
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0"
        style={{ borderColor: C.border, backgroundColor: C.bg }}
      >
        <div className="flex items-center gap-3">
          <SlidersHorizontal size={18} style={{ color: C.blue }} />
          <div>
            <h2 className="text-sm font-semibold" style={{ color: C.text }}>
              S&P 500 Quality Screener
            </h2>
            <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>
              EPS revision up + EV/EBITDA &le; 20x + Bollinger Band touch &middot; sorted by Rule of 40
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {data.generated_at !== null && (
            <span className="text-[10px]" style={{ color: C.muted }}>
              Updated {timeAgo(data.generated_at)}
            </span>
          )}

          <button
            onClick={refresh}
            disabled={loading || isComputing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors"
            style={{
              backgroundColor: C.blue + '20',
              color: C.blue,
              border: `1px solid ${C.blue}40`,
              opacity: loading || isComputing ? 0.5 : 1,
            }}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>

          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded transition-colors"
            style={{ color: C.muted }}
            onMouseEnter={(e) => (e.currentTarget.style.color = C.text)}
            onMouseLeave={(e) => (e.currentTarget.style.color = C.muted)}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ── Filter criteria cards ──────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-5 py-2.5 border-b flex-shrink-0 overflow-x-auto"
        style={{ borderColor: C.border, backgroundColor: '#1a1e2e' }}
      >
        {[
          { icon: TrendingUp, label: 'EPS Estimate', desc: 'Current Qtr consensus raised vs 30d ago' },
          { icon: AlertTriangle, label: 'EV/EBITDA', desc: 'Trailing multiple \u2264 20x' },
          { icon: TrendingUp, label: 'Bollinger Band', desc: 'Price touched lower 20d BB within 10 days' },
          { icon: SlidersHorizontal, label: 'Rule of 40', desc: 'Rev Growth% + Op Margin% \u2014 sorted desc' },
        ].map((c) => (
          <div
            key={c.label}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md flex-shrink-0"
            style={{ backgroundColor: C.bg, border: `1px solid ${C.border}` }}
          >
            <c.icon size={12} style={{ color: C.blue }} />
            <div>
              <div className="text-[10px] font-semibold" style={{ color: C.text }}>{c.label}</div>
              <div className="text-[9px]" style={{ color: C.muted }}>{c.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-5 py-4">
        {/* Error state */}
        {error && (
          <div
            className="flex items-center gap-2 p-3 rounded mb-4"
            style={{ backgroundColor: '#ef535015', border: `1px solid ${C.red}30` }}
          >
            <AlertTriangle size={14} style={{ color: C.red }} />
            <span className="text-xs" style={{ color: C.red }}>{error}</span>
          </div>
        )}

        {/* Computing state */}
        {isComputing && !hasResults && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 size={32} className="animate-spin" style={{ color: C.blue }} />
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: C.text }}>
                Computing screener results...
              </p>
              <p className="text-xs mt-1" style={{ color: C.muted }}>
                Scanning ~150 S&P 500 stocks for EPS revisions, valuations, and technical signals.
                This runs once on server startup and takes ~90 seconds.
              </p>
            </div>
          </div>
        )}

        {/* Empty state (screener done but nothing passed all filters) */}
        {!isComputing && !hasResults && !error && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <SlidersHorizontal size={28} style={{ color: C.muted }} />
            <p className="text-sm" style={{ color: C.sub }}>
              No stocks currently pass all filter criteria.
            </p>
            <p className="text-xs" style={{ color: C.muted }}>
              All three conditions must be met simultaneously. Try again after market hours shift.
            </p>
          </div>
        )}

        {/* Results table */}
        {hasResults && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      title={col.tooltip}
                      className="px-3 py-2 font-semibold uppercase tracking-wider text-[10px] border-b cursor-default"
                      style={{
                        borderColor: C.border,
                        color: C.muted,
                        textAlign: col.align,
                      }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.results.map((row, idx) => (
                  <tr
                    key={row.ticker}
                    className="transition-colors cursor-pointer"
                    style={{ borderBottom: `1px solid ${C.border}` }}
                    onClick={() => {
                      onSelectTicker(row.ticker);
                      onClose();
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#1e222d';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    {COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        className="px-3 py-2.5"
                        style={{ textAlign: col.align }}
                      >
                        {col.render(row, idx)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Bottom note */}
            <div className="mt-4 pt-3 border-t text-[10px]" style={{ borderColor: C.border, color: C.muted }}>
              <strong>Filters applied:</strong> EPS consensus estimate for the current quarter must be higher than 30 days ago
              &nbsp;&middot;&nbsp; Trailing EV/EBITDA &le; 20x &nbsp;&middot;&nbsp; Price crossed below lower 20-day Bollinger Band
              (2&sigma;) within the last 10 trading days &nbsp;&middot;&nbsp; Top 10 results sorted by Rule of 40
              (Revenue Growth% + Operating Margin%) descending &nbsp;&middot;&nbsp; Universe: ~150 liquid S&P 500 names
              &nbsp;&middot;&nbsp; Click any row to open chart
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
