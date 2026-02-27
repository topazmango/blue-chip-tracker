"""
quant/backtest.py — Event-driven backtester + walk-forward harness.

Design
------
* Universe   : UNIVERSE tickers from engine.py
* Benchmark  : SPY (buy-and-hold over each OS window)
* Start cash : $100,000
* Costs      : 0.05 % per trade (one-way)
* Slippage   : fills at next-day open
* Position   : equal-weight across active longs; max_positions cap enforced

Walk-forward schedule
---------------------
  IS = 3 years, OS = 1 year, step = 1 year → 7 folds covering 2015-2024

Each fold returns a FoldResult dict.  The full run returns a BacktestReport.

The `_backtest_cache` avoids re-running when the server is called multiple
times in the same calendar day (cache keyed by strategy + today's date string).
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Callable

import numpy as np
import pandas as pd

from quant.engine import (
    UNIVERSE,
    BACKTEST_START,
    fetch_universe,
)
from quant.strategies import momentum as mom_mod
from quant.strategies import mean_rev as rev_mod

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────────
START_CASH    = 100_000.0
COST_PCT      = 0.0005          # 0.05 % one-way trade cost
RISK_FREE_DAY = 0.045 / 252     # 4.5 % annual → daily

FOLD_IS_YEARS = 3
FOLD_OS_YEARS = 1
FOLD_STEP_YEARS = 1

# first IS start, last OS end
WF_START = pd.Timestamp("2015-01-01", tz="UTC")
WF_END   = pd.Timestamp("2025-01-01", tz="UTC")

# ── Per-day backtest cache: keyed by strategy name → (date_str, report) ─────
_backtest_cache: dict[str, tuple[str, dict]] = {}


# ── Metric helpers ───────────────────────────────────────────────────────────

def _cagr(equity: np.ndarray, n_days: int) -> float:
    if n_days <= 0 or equity[0] <= 0:
        return 0.0
    years = n_days / 252.0
    return float((equity[-1] / equity[0]) ** (1.0 / years) - 1.0) if years > 0 else 0.0


def _sharpe(daily_returns: np.ndarray) -> float:
    if len(daily_returns) < 2:
        return 0.0
    excess = daily_returns - RISK_FREE_DAY
    std = float(np.std(excess, ddof=1))
    if std == 0:
        return 0.0
    return float(np.mean(excess) / std * np.sqrt(252))


def _max_drawdown(equity: np.ndarray) -> float:
    """Return max drawdown as a negative fraction, e.g. -0.23."""
    if len(equity) == 0:
        return 0.0
    running_max = np.maximum.accumulate(equity)
    dd = (equity - running_max) / running_max
    return float(np.min(dd))


def _win_rate(trade_pnls: list[float]) -> float:
    if not trade_pnls:
        return 0.0
    wins = sum(1 for p in trade_pnls if p > 0)
    return round(wins / len(trade_pnls), 4)


# ── Core portfolio simulation ────────────────────────────────────────────────

def _run_portfolio(
    data_map: dict[str, pd.DataFrame],
    tickers: list[str],
    signal_fn: Callable[[pd.DataFrame], pd.Series],
    start: pd.Timestamp,
    end: pd.Timestamp,
    max_positions: int,
) -> dict[str, Any]:
    """
    Run a vectorised equal-weight portfolio over [start, end).

    Returns a dict:
        equity_curve : list of {date: str, value: float}
        daily_returns: np.ndarray
        trade_pnls   : list[float]
        n_trades     : int
    """
    # Align all tickers to a common daily date index
    date_index: pd.DatetimeIndex | None = None
    signals: dict[str, pd.Series] = {}

    for ticker in tickers:
        df = data_map.get(ticker)
        if df is None or df.empty:
            continue
        window = df.loc[(df.index >= start) & (df.index < end)].copy()
        if len(window) < 10:
            continue
        sig = signal_fn(window)
        signals[ticker] = sig
        if date_index is None:
            date_index = sig.index
        else:
            date_index = date_index.union(sig.index)

    if date_index is None or len(date_index) < 2:
        return {
            "equity_curve":  [{"date": start.strftime("%Y-%m-%d"), "value": START_CASH}],
            "daily_returns": np.array([0.0]),
            "trade_pnls":    [],
            "n_trades":      0,
        }

    # Build aligned close price matrix (dates × tickers)
    close_df = pd.DataFrame(index=date_index)
    for ticker, sig in signals.items():
        df = data_map[ticker]
        closes = df.loc[df.index.isin(date_index), "Close"].reindex(date_index)
        close_df[ticker] = closes

    open_df = pd.DataFrame(index=date_index)
    for ticker in signals:
        df = data_map[ticker]
        opens = df.loc[df.index.isin(date_index), "Open"].reindex(date_index)
        open_df[ticker] = opens

    signal_df = pd.DataFrame(
        {t: s.reindex(date_index, fill_value=False) for t, s in signals.items()},
        index=date_index,
    )

    # ── Simulate day-by-day ──────────────────────────────────────────────────
    cash        = START_CASH
    holdings: dict[str, float] = {}   # ticker → number of shares held
    entry_price: dict[str, float] = {}
    equity_curve: list[dict] = []
    trade_pnls: list[float] = []
    dates = date_index.tolist()

    for i, dt in enumerate(dates):
        # Portfolio value at today's close
        port_value = cash + sum(
            shares * float(close_df.at[dt, t])
            for t, shares in holdings.items()
            if not pd.isna(close_df.at[dt, t])
        )
        equity_curve.append({
            "date":  dt.strftime("%Y-%m-%d"),
            "value": round(port_value, 2),
        })

        # Decide positions for tomorrow (next-open fill)
        desired = set(
            t for t in signal_df.columns
            if bool(signal_df.at[dt, t])
        )
        # Enforce max_positions cap: keep existing, then fill up to cap
        current = set(holdings.keys())
        keep  = current & desired
        add   = desired - current
        # Rank new entries by RSI distance below 50 (arbitrary tiebreak)
        add_sorted = sorted(add)
        slots = max_positions - len(keep)
        enter = set(list(add_sorted)[:slots]) if slots > 0 else set()
        exit_ = current - desired

        if i + 1 >= len(dates):
            break
        next_dt  = dates[i + 1]
        next_open: dict[str, float] = {}
        for t in enter | exit_:
            val = open_df.at[next_dt, t] if next_dt in open_df.index else None
            if val is not None and not pd.isna(val):
                next_open[t] = float(val)

        # Execute exits at next open
        for t in list(exit_):
            if t not in next_open:
                continue
            fill  = next_open[t]
            shares = holdings.pop(t)
            entry_px = entry_price.pop(t, fill)
            gross  = shares * fill
            cost   = gross * COST_PCT
            cash  += gross - cost
            trade_pnls.append(gross - shares * entry_px - cost)

        # Execute entries at next open
        n_active = len(holdings) + len(enter)
        alloc_each = port_value / max(n_active, 1) if enter else 0.0
        for t in list(enter):
            if t not in next_open:
                continue
            fill  = next_open[t]
            if fill <= 0:
                continue
            cost_entry = alloc_each * COST_PCT
            invest     = alloc_each - cost_entry
            shares     = invest / fill
            holdings[t]    = shares
            entry_price[t] = fill
            cash          -= alloc_each

    equity_vals = np.array([e["value"] for e in equity_curve], dtype=float)
    daily_ret   = np.diff(equity_vals) / equity_vals[:-1]
    daily_ret   = np.nan_to_num(daily_ret, nan=0.0, posinf=0.0, neginf=0.0)

    return {
        "equity_curve":  equity_curve,
        "daily_returns": daily_ret,
        "trade_pnls":    trade_pnls,
        "n_trades":      len(trade_pnls),
    }


def _spy_return(spy_df: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp) -> float:
    """Buy-and-hold SPY return over [start, end)."""
    window = spy_df.loc[(spy_df.index >= start) & (spy_df.index < end), "Close"]
    if len(window) < 2:
        return 0.0
    return float((window.iloc[-1] / window.iloc[0]) - 1.0)


# ── Walk-forward harness ─────────────────────────────────────────────────────

def _walk_forward(
    data_map: dict[str, pd.DataFrame],
    strategy_name: str,
    signal_fn: Callable[[pd.DataFrame], pd.Series],
    max_positions: int,
) -> dict:
    """
    Run 7-fold walk-forward backtest and return a full BacktestReport dict.
    """
    spy_df = data_map.get("SPY", pd.DataFrame())
    tickers = [t for t in UNIVERSE if t in data_map]

    folds: list[dict] = []
    fold_num = 0

    # Generate folds
    cur_is_start = WF_START
    while True:
        is_end = cur_is_start + pd.DateOffset(years=FOLD_IS_YEARS)
        os_start = is_end
        os_end   = os_start + pd.DateOffset(years=FOLD_OS_YEARS)
        if os_end > WF_END:
            break

        fold_num += 1
        logger.info(f"Fold {fold_num}: IS [{cur_is_start.date()} – {is_end.date()}] "
                    f"OS [{os_start.date()} – {os_end.date()}]")

        is_result = _run_portfolio(data_map, tickers, signal_fn,
                                   cur_is_start, is_end, max_positions)
        os_result = _run_portfolio(data_map, tickers, signal_fn,
                                   os_start, os_end, max_positions)

        is_eq  = np.array([e["value"] for e in is_result["equity_curve"]])
        os_eq  = np.array([e["value"] for e in os_result["equity_curve"]])

        is_cagr   = _cagr(is_eq,  len(is_eq))
        os_cagr   = _cagr(os_eq,  len(os_eq))
        is_sharpe = _sharpe(is_result["daily_returns"])
        os_sharpe = _sharpe(os_result["daily_returns"])
        os_maxdd  = _max_drawdown(os_eq)
        spy_ret   = _spy_return(spy_df, os_start, os_end)

        folds.append({
            "fold":                fold_num,
            "is_start":            cur_is_start.strftime("%Y-%m-%d"),
            "is_end":              is_end.strftime("%Y-%m-%d"),
            "os_start":            os_start.strftime("%Y-%m-%d"),
            "os_end":              os_end.strftime("%Y-%m-%d"),
            "is_cagr":             round(is_cagr, 4),
            "os_cagr":             round(os_cagr, 4),
            "is_sharpe":           round(is_sharpe, 4),
            "os_sharpe":           round(os_sharpe, 4),
            "os_max_dd":           round(os_maxdd, 4),
            "os_win_rate":         _win_rate(os_result["trade_pnls"]),
            "os_trades":           os_result["n_trades"],
            "os_benchmark_return": round(spy_ret, 4),
            "equity_curve":        os_result["equity_curve"],
        })

        cur_is_start += pd.DateOffset(years=FOLD_STEP_YEARS)

    if not folds:
        logger.warning(f"No folds generated for strategy {strategy_name}")

    # ── Aggregate metrics ───────────────────────────────────────────────────
    all_os_sharpes = [f["os_sharpe"] for f in folds]
    all_is_sharpes = [f["is_sharpe"] for f in folds]
    all_os_cagrs   = [f["os_cagr"]   for f in folds]

    mean_os_sharpe = float(np.mean(all_os_sharpes)) if all_os_sharpes else 0.0
    mean_is_sharpe = float(np.mean(all_is_sharpes)) if all_is_sharpes else 0.0
    sharpe_degradation = round(mean_is_sharpe - mean_os_sharpe, 4) if all_is_sharpes else 0.0
    median_os_cagr = float(np.median(all_os_cagrs)) if all_os_cagrs else 0.0

    # Combined OS equity curve (stitch fold OS curves back-to-back)
    combined_os_equity: list[dict] = []
    running_value = START_CASH
    for fold in folds:
        curve = fold["equity_curve"]
        if not curve:
            continue
        scale = running_value / curve[0]["value"] if curve[0]["value"] != 0 else 1.0
        for pt in curve:
            combined_os_equity.append({
                "date":  pt["date"],
                "value": round(pt["value"] * scale, 2),
            })
        running_value = combined_os_equity[-1]["value"]

    combined_eq = np.array([p["value"] for p in combined_os_equity]) if combined_os_equity else np.array([START_CASH])
    combined_cagr   = _cagr(combined_eq,  len(combined_eq))
    combined_maxdd  = _max_drawdown(combined_eq)
    combined_rets   = np.diff(combined_eq) / combined_eq[:-1] if len(combined_eq) > 1 else np.array([0.0])
    combined_sharpe = _sharpe(np.nan_to_num(combined_rets))

    return {
        "strategy":             strategy_name,
        "universe":             tickers,
        "folds":                folds,
        "combined_os_cagr":     round(combined_cagr, 4),
        "combined_os_sharpe":   round(combined_sharpe, 4),
        "combined_os_max_dd":   round(combined_maxdd, 4),
        "mean_is_sharpe":       round(mean_is_sharpe, 4),
        "mean_os_sharpe":       round(mean_os_sharpe, 4),
        "sharpe_degradation":   sharpe_degradation,
        "median_os_cagr":       round(median_os_cagr, 4),
        "combined_os_equity":   combined_os_equity,
        "generated_at":         int(datetime.now(timezone.utc).timestamp()),
    }


# ── Public API ───────────────────────────────────────────────────────────────

def run_backtest(strategy: str) -> dict:
    """
    Run walk-forward backtest for the given strategy name.
    Results are cached for the rest of the calendar day.

    strategy: 'momentum' | 'mean_rev' | 'both'
    """
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if strategy != "both":
        cached = _backtest_cache.get(strategy)
        if cached is not None and cached[0] == today_str:
            logger.info(f"backtest: returning cached result for {strategy}")
            return cached[1]

    data_map = fetch_universe(start=BACKTEST_START)

    if strategy == "momentum":
        report = _walk_forward(data_map, "momentum", mom_mod.generate_signals, max_positions=5)
        _backtest_cache["momentum"] = (today_str, report)
        return report

    elif strategy == "mean_rev":
        report = _walk_forward(data_map, "mean_rev", rev_mod.generate_signals, max_positions=3)
        _backtest_cache["mean_rev"] = (today_str, report)
        return report

    elif strategy == "both":
        # Return both strategies' reports as a list
        mom_cached = _backtest_cache.get("momentum")
        rev_cached = _backtest_cache.get("mean_rev")

        if mom_cached and mom_cached[0] == today_str:
            mom_report = mom_cached[1]
        else:
            mom_report = _walk_forward(data_map, "momentum", mom_mod.generate_signals, max_positions=5)
            _backtest_cache["momentum"] = (today_str, mom_report)

        if rev_cached and rev_cached[0] == today_str:
            rev_report = rev_cached[1]
        else:
            rev_report = _walk_forward(data_map, "mean_rev", rev_mod.generate_signals, max_positions=3)
            _backtest_cache["mean_rev"] = (today_str, rev_report)

        return {"momentum": mom_report, "mean_rev": rev_report}

    else:
        raise ValueError(f"Unknown strategy: {strategy!r}. Use 'momentum', 'mean_rev', or 'both'.")
