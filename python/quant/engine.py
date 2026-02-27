"""
quant/engine.py — Data layer for the quant model.

Responsibilities:
  - Fetch daily OHLCV data for the universe + SPY via yfinance (2015-01-01 → today)
  - Compute rolling SMA(50), SMA(200), RSI(14) on each ticker's close series
  - Generate live entry/exit signals for both strategies
  - TTL cache: raw OHLCV cached 1 hour; live signals cached 60 seconds
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Literal, TypedDict

import numpy as np
import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

# ── Universe ────────────────────────────────────────────────────────────────
UNIVERSE: list[str] = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL",
    "META", "AVGO", "AMD", "CRM", "ORCL", "NOW",
]
BACKTEST_START = "2015-01-01"

# ── Cache ────────────────────────────────────────────────────────────────────
_ohlcv_cache: dict[str, tuple[float, pd.DataFrame]] = {}   # ticker → (ts, df)
_signals_cache: tuple[float, list[dict]] | None = None

OHLCV_TTL   = 3600.0   # 1 hour
SIGNALS_TTL = 60.0     # 60 seconds


# ── Types ────────────────────────────────────────────────────────────────────
SignalValue = Literal["BUY", "SELL", "NEUTRAL"]


class IndicatorRow(TypedDict):
    close: float
    sma50: float | None
    sma200: float | None
    rsi14: float | None
    rsi14_prev: float | None


# ── Indicator helpers ────────────────────────────────────────────────────────

def _rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Wilder smoothed RSI.  Returns a Series aligned to `series`."""
    delta = series.diff()
    gain  = delta.clip(lower=0.0)
    loss  = (-delta).clip(lower=0.0)

    # First average: simple mean of first `period` values
    avg_gain = gain.ewm(com=period - 1, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100.0 - (100.0 / (1.0 + rs))


def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Given a raw OHLCV DataFrame (DatetimeIndex, columns include 'Close'),
    append SMA50, SMA200, RSI14 columns and return the enriched DataFrame.
    """
    close = df["Close"].astype(float)
    df = df.copy()
    df["sma50"]  = close.rolling(50,  min_periods=50).mean()
    df["sma200"] = close.rolling(200, min_periods=200).mean()
    df["rsi14"]  = _rsi(close, 14)
    return df


# ── Data fetch ───────────────────────────────────────────────────────────────

def _fetch_ohlcv(ticker: str, start: str = BACKTEST_START) -> pd.DataFrame:
    """
    Fetch daily OHLCV for `ticker` from `start` to today.
    Returns a DataFrame with columns: Open, High, Low, Close, Volume.
    Index is DatetimeIndex (UTC).
    Uses a 1-hour TTL in-memory cache to avoid hammering yfinance.
    """
    now = time.monotonic()
    cached = _ohlcv_cache.get(ticker)
    if cached is not None:
        ts, df = cached
        if now - ts < OHLCV_TTL:
            return df

    try:
        t  = yf.Ticker(ticker)
        df = t.history(start=start, interval="1d", auto_adjust=True)
    except Exception as exc:
        logger.error(f"engine: fetch failed for {ticker}: {exc}")
        return pd.DataFrame()

    if df.empty:
        logger.warning(f"engine: empty data for {ticker}")
        return pd.DataFrame()

    df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
    df = df.dropna(subset=["Close"])
    df.index = pd.DatetimeIndex(df.index).tz_convert("UTC")

    _ohlcv_cache[ticker] = (now, df)
    logger.info(f"engine: fetched {len(df)} rows for {ticker}")
    return df


def fetch_universe(start: str = BACKTEST_START) -> dict[str, pd.DataFrame]:
    """
    Return dict {ticker: enriched_df} for every ticker in UNIVERSE + SPY.
    Uses a single batched yf.download() call for all uncached tickers,
    then falls back to individual _fetch_ohlcv() for cached ones.
    """
    all_tickers = UNIVERSE + ["SPY"]
    now = time.monotonic()

    # Split into cached (still fresh) and stale/missing
    fresh: dict[str, pd.DataFrame] = {}
    stale: list[str] = []
    for ticker in all_tickers:
        cached = _ohlcv_cache.get(ticker)
        if cached is not None:
            ts, df = cached
            if now - ts < OHLCV_TTL:
                fresh[ticker] = df
                continue
        stale.append(ticker)

    # Batch-fetch all stale tickers in one request
    if stale:
        try:
            raw = yf.download(
                stale,
                start=start,
                interval="1d",
                group_by="ticker",
                auto_adjust=True,
                progress=False,
                threads=True,
            )
            fetch_ts = time.monotonic()
            for ticker in stale:
                try:
                    td = raw[ticker] if len(stale) > 1 else raw
                    if td is None or td.empty:
                        logger.warning(f"engine: empty batch data for {ticker}")
                        continue
                    df = td[["Open", "High", "Low", "Close", "Volume"]].copy()
                    df = df.dropna(subset=["Close"])
                    df.index = pd.DatetimeIndex(df.index).tz_convert("UTC")
                    _ohlcv_cache[ticker] = (fetch_ts, df)
                    fresh[ticker] = df
                    logger.info(f"engine: batch-fetched {len(df)} rows for {ticker}")
                except Exception as exc:
                    logger.warning(f"engine: batch parse error for {ticker}: {exc}")
        except Exception as exc:
            logger.error(f"engine: batch fetch failed: {exc}")
            # Fall back to individual fetches for any still-missing tickers
            for ticker in stale:
                if ticker not in fresh:
                    df = _fetch_ohlcv(ticker, start=start)
                    if not df.empty:
                        fresh[ticker] = df

    result: dict[str, pd.DataFrame] = {}
    for ticker in all_tickers:
        df = fresh.get(ticker)
        if df is not None and not df.empty:
            result[ticker] = compute_indicators(df)
    return result


# ── Live signal generation ───────────────────────────────────────────────────

def _signal_momentum(df: pd.DataFrame) -> SignalValue:
    """
    Strategy A — Dual Momentum (live signal only; entry/exit for backtesting
    is in strategies/momentum.py).

    BUY  : close > SMA200 AND close > SMA50
            AND rsi14[t-1] < 50 AND rsi14[t] >= 50  (RSI crosses above midline)
    SELL : close < SMA50 OR rsi14 < 40
    else : NEUTRAL
    """
    if len(df) < 2:
        return "NEUTRAL"
    row  = df.iloc[-1]
    prev = df.iloc[-2]

    close   = float(row["Close"])
    sma50   = row.get("sma50")
    sma200  = row.get("sma200")
    rsi     = row.get("rsi14")
    rsi_prev = prev.get("rsi14")

    if any(pd.isna(v) or v is None for v in [sma50, sma200, rsi, rsi_prev]):
        return "NEUTRAL"

    sma50_f  = float(sma50)   # type: ignore[arg-type]
    sma200_f = float(sma200)  # type: ignore[arg-type]
    rsi_f    = float(rsi)     # type: ignore[arg-type]
    rsi_prev_f = float(rsi_prev)  # type: ignore[arg-type]

    if close < sma50_f or rsi_f < 40:
        return "SELL"
    if close > sma200_f and close > sma50_f and rsi_prev_f < 50 and rsi_f >= 50:
        return "BUY"
    return "NEUTRAL"


def _signal_mean_rev(df: pd.DataFrame) -> SignalValue:
    """
    Strategy B — RSI Mean Reversion (live signal only).

    BUY  : rsi14 < 30 AND close > SMA200 AND close < close[t-1]  (falling into dip)
    SELL : rsi14 > 55
    else : NEUTRAL
    """
    if len(df) < 2:
        return "NEUTRAL"
    row  = df.iloc[-1]
    prev = df.iloc[-2]

    close      = float(row["Close"])
    close_prev = float(prev["Close"])
    sma200     = row.get("sma200")
    rsi        = row.get("rsi14")

    if any(pd.isna(v) or v is None for v in [sma200, rsi]):
        return "NEUTRAL"

    sma200_f = float(sma200)  # type: ignore[arg-type]
    rsi_f    = float(rsi)     # type: ignore[arg-type]

    if rsi_f > 55:
        return "SELL"
    if rsi_f < 30 and close > sma200_f and close < close_prev:
        return "BUY"
    return "NEUTRAL"


def get_live_signals() -> list[dict]:
    """
    Return live signals for every ticker in UNIVERSE.
    Result is cached for SIGNALS_TTL seconds.

    Each entry:
        ticker, strategy_a, strategy_b,
        rsi14, sma50_rel, sma200_rel, as_of
    """
    global _signals_cache

    now = time.monotonic()
    if _signals_cache is not None:
        ts, data = _signals_cache
        if now - ts < SIGNALS_TTL:
            return data

    data_map = fetch_universe()
    results: list[dict] = []

    for ticker in UNIVERSE:
        df = data_map.get(ticker)
        if df is None or df.empty:
            results.append({
                "ticker":     ticker,
                "strategy_a": "NEUTRAL",
                "strategy_b": "NEUTRAL",
                "rsi14":      None,
                "sma50_rel":  None,
                "sma200_rel": None,
                "as_of":      int(datetime.now(timezone.utc).timestamp()),
            })
            continue

        row   = df.iloc[-1]
        close = float(row["Close"])
        rsi   = row.get("rsi14")
        sma50 = row.get("sma50")
        sma200 = row.get("sma200")

        rsi_val    = round(float(rsi),   2) if rsi   is not None and not pd.isna(rsi)   else None
        sma50_rel  = round((close / float(sma50)  - 1) * 100, 2) if sma50  is not None and not pd.isna(sma50)  else None
        sma200_rel = round((close / float(sma200) - 1) * 100, 2) if sma200 is not None and not pd.isna(sma200) else None

        results.append({
            "ticker":     ticker,
            "strategy_a": _signal_momentum(df),
            "strategy_b": _signal_mean_rev(df),
            "rsi14":      rsi_val,
            "sma50_rel":  sma50_rel,
            "sma200_rel": sma200_rel,
            "as_of":      int(datetime.now(timezone.utc).timestamp()),
        })

    _signals_cache = (now, results)
    return results
