"""
quant/strategies/mean_rev.py — Strategy B: RSI Mean Reversion

Used by the walk-forward backtester in quant/backtest.py.

Signal contract
---------------
generate_signals(df: pd.DataFrame) -> pd.Series[bool]

    Given an enriched DataFrame (must already have 'sma200', 'rsi14' columns),
    return a boolean Series indexed the same way, where True = "in position".

Entry : rsi14 < 30 AND close > SMA200 AND close < close[t-1]  ← falling into dip
Exit  : rsi14 > 55 OR days_held >= 10
"""

from __future__ import annotations

import pandas as pd

MAX_HOLD_DAYS = 10


def generate_signals(df: pd.DataFrame) -> pd.Series:
    """
    Returns a boolean Series (same index as df):
        True  = hold a long position on this bar
        False = flat / exit
    """
    close  = df["Close"].astype(float)
    sma200 = df["sma200"].astype(float)
    rsi    = df["rsi14"].astype(float)

    close_prev = close.shift(1)

    entry = (
        (rsi < 30)           &
        (close > sma200)     &
        (close < close_prev)
    )

    exit_rsi = rsi > 55

    in_position = pd.Series(False, index=df.index)
    pos        = False
    days_held  = 0

    for i in range(len(df)):
        if pos:
            days_held += 1
            if exit_rsi.iloc[i] or days_held >= MAX_HOLD_DAYS:
                pos = False
                days_held = 0
        elif entry.iloc[i]:
            pos = True
            days_held = 1
        in_position.iloc[i] = pos

    return in_position
