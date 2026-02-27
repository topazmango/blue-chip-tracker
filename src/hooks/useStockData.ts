import { useState, useEffect, useCallback, useRef } from 'react';
import type { StockInfo, HistoryResponse, Timeframe, QuoteData, EarningDate, StockMeta, SearchResult, TickerSignal, BacktestReport } from '../types';

// Electron: window.electronAPI present → local Python server
// Web (Vercel): VITE_API_URL env var set to Railway URL
const API_BASE =
  typeof window !== 'undefined' && (window as unknown as { electronAPI?: unknown }).electronAPI
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

export function useStockHistory(ticker: string | null, timeframe: Timeframe, prepost = false) {
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

    const url = `${API_BASE}/history/${ticker}?timeframe=${timeframe}&prepost=${prepost}`;
    fetch(url, {
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
  }, [ticker, timeframe, prepost]);

  return { history, loading, error };
}

/**
 * Polls /quotes (batch, DEFAULT_STOCKS) every `interval` ms.
 * For any tickers in `customTickers` that are NOT in the batch response,
 * individually polls /quote/{ticker}.
 *
 * Returns:
 *  - merged stock list with live prices
 *  - live status flag
 *  - lastCandle for the given focusTicker (only relevant on 1D timeframe)
 */
export function useRealtimeQuotes(
  baseStocks: StockInfo[],
  focusTicker: string | null,
  interval = 5000,
  customTickers: string[] = [],
) {
  const [stocks, setStocks] = useState<StockInfo[]>(baseStocks);
  const [liveCandle, setLiveCandle] = useState<QuoteData['last_candle'] | null>(null);
  const [isLive, setIsLive] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep refs so polling callback always sees latest values without re-creating
  const baseRef = useRef(baseStocks);
  useEffect(() => { baseRef.current = baseStocks; }, [baseStocks]);

  const focusRef = useRef(focusTicker);
  useEffect(() => { focusRef.current = focusTicker; }, [focusTicker]);

  const customRef = useRef(customTickers);
  useEffect(() => { customRef.current = customTickers; }, [customTickers]);

  // When baseStocks first arrives (initial load), seed state
  useEffect(() => {
    if (baseStocks.length > 0) setStocks(baseStocks);
  }, [baseStocks]);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/quotes`);
      if (!res.ok) return;
      const quotes: Record<string, QuoteData> = await res.json();

      // For any custom tickers not in the batch, fetch individually
      const missing = customRef.current.filter((t) => !quotes[t]);
      if (missing.length > 0) {
        await Promise.all(
          missing.map(async (t) => {
            try {
              const r = await fetch(`${API_BASE}/quote/${t}`);
              if (r.ok) {
                const q: QuoteData = await r.json();
                quotes[t] = q;
              }
            } catch { /* ignore per-ticker errors */ }
          }),
        );
      }

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
            quote_time:     q.last_candle?.time ?? null,
            ext_price:      q.ext_price,
            ext_change_pct: q.ext_change_pct,
            ext_session:    q.ext_session,
          };
        }),
      );

      const focus = focusRef.current;
      if (focus && quotes[focus]) {
        setLiveCandle(quotes[focus].last_candle);
      }

      setIsLive(true);
    } catch {
      setIsLive(false);
    }
  }, []);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(poll, interval);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [poll, interval]);

  return { stocks, setStocks, liveCandle, isLive };
}

/** Fetch earnings dates for a ticker. Re-fetches when ticker changes. */
export function useEarnings(ticker: string | null) {
  const [earnings, setEarnings] = useState<EarningDate[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    if (!ticker) {
      setEarnings([]);
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
      setMeta(null);
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

/**
 * Validates a ticker against the backend and returns its info.
 * `query` should be a raw ticker string typed by the user.
 * Returns null while loading, a SearchResult on success, or 'not-found' on failure.
 */
export function useTickerSearch(query: string) {
  const [result, setResult] = useState<SearchResult | 'not-found' | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear previous debounce + abort
    if (timerRef.current) clearTimeout(timerRef.current);
    abortRef.current?.abort();

    const q = query.trim().toUpperCase();
    if (q.length < 1) {
      setResult(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setResult(null);

    // Debounce 400ms so we don't hammer the server on every keystroke
    timerRef.current = setTimeout(() => {
      abortRef.current = new AbortController();
      fetch(`${API_BASE}/search/${q}`, { signal: abortRef.current.signal })
        .then((r) => {
          if (r.status === 404) return null;
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<SearchResult>;
        })
        .then((data) => {
          setResult(data ?? 'not-found');
          setLoading(false);
        })
        .catch((e) => {
          if (e.name === 'AbortError') return;
          setResult('not-found');
          setLoading(false);
        });
    }, 400);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [query]);

  return { result, loading };
}

/**
 * Polls GET /signals every 60 seconds.
 * Returns live TickerSignal[] for all 11 universe tickers.
 */
export function useSignals() {
  const [signals, setSignals] = useState<TickerSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSignals = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/signals`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TickerSignal[] = await res.json();
      setSignals(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch signals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSignals();
    const interval = setInterval(fetchSignals, 60_000);
    return () => clearInterval(interval);
  }, [fetchSignals]);

  return { signals, loading, error };
}

/**
 * Fetches GET /backtest/{strategy} on demand.
 * Call `run()` to trigger the fetch (it is intentionally NOT automatic).
 * strategy: 'momentum' | 'mean_rev' | 'both'
 */
export function useBacktest(strategy: 'momentum' | 'mean_rev' | 'both') {
  const [report, setReport] = useState<BacktestReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch(`${API_BASE}/backtest/${strategy}`, {
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: BacktestReport = await res.json();
      setReport(data);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Backtest failed');
    } finally {
      setLoading(false);
    }
  }, [strategy]);

  // Abort on unmount
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return { report, loading, error, run };
}
