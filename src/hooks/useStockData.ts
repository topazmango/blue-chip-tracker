import { useState, useEffect, useCallback, useRef } from 'react';
import type { StockInfo, HistoryResponse, Timeframe, QuoteData, EarningDate, StockMeta } from '../types';

// Electron: window.electronAPI present → local Python server
// Web (Vercel): VITE_API_URL env var set to Railway URL
const API_BASE =
  typeof window !== 'undefined' && (window as any).electronAPI
    ? 'http://localhost:8765'
    : (import.meta.env.VITE_API_URL ?? 'http://localhost:8765');

export function useStockList(refreshInterval = 60000) {
  const [stocks, setStocks] = useState<StockInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStocks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/stocks`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: StockInfo[] = await res.json();
      setStocks(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch stocks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStocks();
    const interval = setInterval(fetchStocks, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchStocks, refreshInterval]);

  return { stocks, loading, error, lastUpdated, refresh: fetchStocks };
}

export function useStockHistory(ticker: string | null, timeframe: Timeframe) {
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!ticker) return;

    if (abortRef.current) {
      abortRef.current.abort();
    }
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/history/${ticker}?timeframe=${timeframe}`, {
      signal: abortRef.current.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: HistoryResponse) => {
        setHistory(data);
        setLoading(false);
      })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setError(e.message);
        setLoading(false);
      });

    return () => abortRef.current?.abort();
  }, [ticker, timeframe]);

  return { history, loading, error };
}

/**
 * Polls /quotes every `interval` ms and returns:
 *  - merged stock list with live prices
 *  - live status flag
 *  - lastCandle for the given focusTicker (only relevant on 1D timeframe)
 */
export function useRealtimeQuotes(
  baseStocks: StockInfo[],
  focusTicker: string | null,
  interval = 5000,
) {
  const [stocks, setStocks] = useState<StockInfo[]>(baseStocks);
  const [liveCandle, setLiveCandle] = useState<QuoteData['last_candle'] | null>(null);
  const [isLive, setIsLive] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep a ref to baseStocks so the polling callback always sees latest value
  const baseRef = useRef(baseStocks);
  useEffect(() => { baseRef.current = baseStocks; }, [baseStocks]);

  // When baseStocks first arrives (initial load), seed state
  useEffect(() => {
    if (baseStocks.length > 0) setStocks(baseStocks);
  }, [baseStocks]);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/quotes`);
      if (!res.ok) return;
      const quotes: Record<string, QuoteData> = await res.json();

      setStocks((prev) =>
        prev.map((s) => {
          const q = quotes[s.ticker];
          if (!q) return s;
          return {
            ...s,
            price:          q.price,
            prev_close:     q.prev_close,
            change:         q.change,
            change_pct:     q.change_pct,
            day_high:       q.day_high,
            day_low:        q.day_low,
            volume:         q.volume,
            ext_price:      q.ext_price,
            ext_change_pct: q.ext_change_pct,
            ext_session:    q.ext_session,
          };
        }),
      );

      if (focusTicker && quotes[focusTicker]) {
        setLiveCandle(quotes[focusTicker].last_candle);
      }

      setIsLive(true);
    } catch {
      setIsLive(false);
    }
  }, [focusTicker]);

  const focusRef = useRef(focusTicker);
  useEffect(() => { focusRef.current = focusTicker; }, [focusTicker]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(poll, interval);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [poll, interval]);

  return { stocks, liveCandle, isLive };
}

/** Fetch earnings dates for a ticker. Re-fetches when ticker changes. */
export function useEarnings(ticker: string | null) {
  const [earnings, setEarnings] = useState<EarningDate[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    if (!ticker) {
      Promise.resolve().then(() => setEarnings([]));
      return () => abortRef.current?.abort();
    }
    fetch(`${API_BASE}/earnings/${ticker}`, { signal: abortRef.current.signal })
      .then((r) => r.json())
      .then((data: EarningDate[]) => setEarnings(data))
      .catch((e) => { if (e.name !== 'AbortError') setEarnings([]); });
    return () => abortRef.current?.abort();
  }, [ticker]);

  return earnings;
}

/** Fetch SPY history for relative-strength overlay. */
export function useSpyHistory(timeframe: Timeframe) {
  const [candles, setCandles] = useState<{ time: number; close: number }[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    fetch(`${API_BASE}/spy-history?timeframe=${timeframe}`, { signal: abortRef.current.signal })
      .then((r) => r.json())
      .then((data: { candles: { time: number; close: number }[] }) => setCandles(data.candles ?? []))
      .catch((e) => { if (e.name !== 'AbortError') setCandles([]); });
    return () => abortRef.current?.abort();
  }, [timeframe]);

  return candles;
}

/** Fetch stock meta (52-week hi/lo, ATR14). */
export function useStockMeta(ticker: string | null) {
  const [meta, setMeta] = useState<StockMeta | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    if (!ticker) {
      Promise.resolve().then(() => setMeta(null));
      return () => abortRef.current?.abort();
    }
    fetch(`${API_BASE}/meta/${ticker}`, { signal: abortRef.current.signal })
      .then((r) => r.json())
      .then((data: StockMeta) => setMeta(data))
      .catch((e) => { if (e.name !== 'AbortError') setMeta(null); });
    return () => abortRef.current?.abort();
  }, [ticker]);

  return meta;
}
