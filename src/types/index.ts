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
}

export interface HistoryResponse {
  ticker: string;
  timeframe: string;
  interval: string;
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
