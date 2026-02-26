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
}
