export interface StockInfo {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  prev_close: number;
  change: number;
  change_pct: number;
  volume: number;
  day_high: number;
  day_low: number;
  // Unix timestamp (seconds) of the most recent quote tick
  quote_time?: number | null;
  // Extended hours (populated by useRealtimeQuotes, absent on initial /stocks load)
  ext_price?: number | null;
  ext_change_pct?: number | null;
  ext_session?: 'PRE' | 'POST' | null;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Session classification — only present when prepost=true was requested */
  session?: 'pre' | 'regular' | 'post';
}

export interface HistoryResponse {
  ticker: string;
  timeframe: string;
  interval: string;
  /** True when extended-hours (pre/post market) candles are included */
  prepost: boolean;
  candles: Candle[];
}

export type Timeframe = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | '5Y' | 'ALL';

export interface QuoteData {
  price: number;
  prev_close: number;
  change: number;
  change_pct: number;
  day_high: number;
  day_low: number;
  volume: number;
  last_candle: Candle;
  ext_price: number | null;
  ext_change_pct: number | null;
  ext_session: 'PRE' | 'POST' | null;
}

export interface IndicatorSettings {
  sma20: boolean;
  sma50: boolean;
  sma200: boolean;
  bollingerBands: boolean;
  rsi: boolean;
  volume: boolean;
  macd: boolean;
  volumeProfile: boolean;
  supportResistance: boolean;
  relativeStrength: boolean;
  earningsDates: boolean;
  week52HighLow: boolean;
}

export type ChartType = 'candlestick' | 'bar' | 'line' | 'area' | 'baseline';

export type DrawingTool =
  | 'cursor'
  | 'crosshair'
  | 'trendline'
  | 'hline'
  | 'rectangle'
  | 'ellipse'
  | 'text'
  | 'freehand'
  | 'fibonacci'
  | 'alert';

export interface ChartActions {
  zoomIn: () => void;
  zoomOut: () => void;
  fitContent: () => void;
  reset: () => void;
  screenshot: () => void;
}

export interface EarningDate {
  time: number;        // Unix timestamp seconds
  is_upcoming: boolean;
}

export interface StockMeta {
  ticker: string;
  week52_high: number | null;
  week52_low: number | null;
  atr14: number | null;
}

export interface PriceAlert {
  id: string;
  ticker: string;
  price: number;
  triggered: boolean;
}

/** Returned by GET /search/{ticker} */
export interface SearchResult {
  ticker: string;
  name: string;
  sector: string;
  price: number;
}

// ── Quant model types ─────────────────────────────────────────────────────────

export type SignalValue = 'BUY' | 'SELL' | 'NEUTRAL';

/** Returned by GET /signals and GET /signals/{ticker} */
export interface TickerSignal {
  ticker: string;
  /** Strategy A — Dual Momentum */
  strategy_a: SignalValue;
  /** Strategy B — RSI Mean Reversion */
  strategy_b: SignalValue;
  rsi14: number | null;
  /** % above/below SMA50 */
  sma50_rel: number | null;
  /** % above/below SMA200 */
  sma200_rel: number | null;
  /** Unix timestamp of signal computation */
  as_of: number;
}

export interface EquityPoint {
  date: string;  // 'YYYY-MM-DD'
  value: number;
}

/** One walk-forward fold result */
export interface FoldResult {
  fold: number;
  is_start: string;
  is_end: string;
  os_start: string;
  os_end: string;
  is_cagr: number;
  os_cagr: number;
  is_sharpe: number;
  os_sharpe: number;
  os_max_dd: number;
  os_win_rate: number;
  os_trades: number;
  os_benchmark_return: number;
  equity_curve: EquityPoint[];
}

/** Full walk-forward backtest report — returned by GET /backtest/{strategy} */
export interface BacktestReport {
  strategy: string;
  universe: string[];
  folds: FoldResult[];
  combined_os_cagr: number;
  combined_os_sharpe: number;
  combined_os_max_dd: number;
  mean_is_sharpe: number;
  mean_os_sharpe: number;
  sharpe_degradation: number;
  median_os_cagr: number;
  combined_os_equity: EquityPoint[];
  generated_at: number;
}
