"""
quant/strategies/momentum.py — Strategy A: Dual Momentum

Used by the walk-forward backtester in quant/backtest.py.

Signal contract
---------------
generate_signals(df: pd.DataFrame) -> pd.Series[bool]

    Given an enriched DataFrame (must already have 'sma50', 'sma200', 'rsi14'
    columns from engine.compute_indicators), return a boolean Series indexed
    the same way, where True = "this day is an in-position day".

Entry : close > SMA200 AND close > SMA50
        AND rsi14[t-1] < 50 AND rsi14[t] >= 50   ← RSI crosses above midline
Exit  : close < SMA50 OR rsi14 < 40
"""

from __future__ import annotations

import pandas as pd


def generate_signals(df: pd.DataFrame) -> pd.Series:
    """
    Returns a boolean Series (same index as df):
        True  = hold a long position on this bar
        False = flat / exit

    Position is entered on the bar AFTER the entry condition triggers
    (next-day open fill is handled by the backtester).
    """
    close  = df["Close"].astype(float)
    sma50  = df["sma50"].astype(float)
    sma200 = df["sma200"].astype(float)
    rsi    = df["rsi14"].astype(float)

    rsi_prev = rsi.shift(1)

    entry = (
        (close > sma200) &
        (close > sma50)  &
        (rsi_prev < 50)  &
        (rsi >= 50)
    )

    exit_ = (close < sma50) | (rsi < 40)

    # Forward-fill entry into a position state; exit clears it
    in_position = pd.Series(False, index=df.index)
    pos = False
    for i in range(len(df)):
        if exit_.iloc[i]:
            pos = False
        elif entry.iloc[i]:
            pos = True
        in_position.iloc[i] = pos

    return in_position
