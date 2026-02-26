#!/usr/bin/env python3
"""
Blue Chip Stock Tracker - FastAPI Backend
Serves OHLCV data and real-time quotes via yfinance
"""

import sys
import json
import logging
from datetime import datetime, timezone, time as dtime
from typing import Optional

try:
    from fastapi import FastAPI, HTTPException, Query
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
    import yfinance as yf
    import pandas as pd
except ImportError as e:
    print(f"Missing dependency: {e}", file=sys.stderr)
    print("Run: pip install fastapi uvicorn yfinance pandas", file=sys.stderr)
    sys.exit(1)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Stock Tracker API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# S&P 500 Top 20 by market cap
DEFAULT_STOCKS = [
    {"ticker": "AAPL",  "name": "Apple Inc.",               "sector": "Technology"},
    {"ticker": "MSFT",  "name": "Microsoft Corp.",          "sector": "Technology"},
    {"ticker": "NVDA",  "name": "NVIDIA Corp.",             "sector": "Technology"},
    {"ticker": "AMZN",  "name": "Amazon.com Inc.",          "sector": "Consumer Disc."},
    {"ticker": "GOOGL", "name": "Alphabet Inc.",            "sector": "Communication"},
    {"ticker": "META",  "name": "Meta Platforms Inc.",      "sector": "Communication"},
    {"ticker": "TSLA",  "name": "Tesla Inc.",               "sector": "Consumer Disc."},
    {"ticker": "BRK-B", "name": "Berkshire Hathaway",       "sector": "Financials"},
    {"ticker": "UNH",   "name": "UnitedHealth Group",       "sector": "Healthcare"},
    {"ticker": "LLY",   "name": "Eli Lilly and Co.",        "sector": "Healthcare"},
    {"ticker": "JPM",   "name": "JPMorgan Chase & Co.",     "sector": "Financials"},
    {"ticker": "V",     "name": "Visa Inc.",                "sector": "Financials"},
    {"ticker": "XOM",   "name": "Exxon Mobil Corp.",        "sector": "Energy"},
    {"ticker": "MA",    "name": "Mastercard Inc.",          "sector": "Financials"},
    {"ticker": "AVGO",  "name": "Broadcom Inc.",            "sector": "Technology"},
    {"ticker": "PG",    "name": "Procter & Gamble Co.",     "sector": "Consumer Staples"},
    {"ticker": "HD",    "name": "Home Depot Inc.",          "sector": "Consumer Disc."},
    {"ticker": "MRK",   "name": "Merck & Co. Inc.",         "sector": "Healthcare"},
    {"ticker": "COST",  "name": "Costco Wholesale Corp.",   "sector": "Consumer Staples"},
    {"ticker": "ABBV",  "name": "AbbVie Inc.",              "sector": "Healthcare"},
]

# Timeframe -> (period, interval) mapping
TIMEFRAME_MAP = {
    "1D":  ("1d",  "5m"),
    "1W":  ("5d",  "30m"),
    "1M":  ("1mo", "1d"),
    "3M":  ("3mo", "1d"),
    "6M":  ("6mo", "1d"),
    "1Y":  ("1y",  "1d"),
    "5Y":  ("5y",  "1wk"),
    "ALL": ("max", "1mo"),
}


@app.get("/health")
def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


@app.get("/stocks")
def get_stocks():
    """Return list of default stocks with current price info."""
    tickers = [s["ticker"] for s in DEFAULT_STOCKS]
    try:
        data = yf.download(
            tickers,
            period="2d",
            interval="1d",
            group_by="ticker",
            auto_adjust=True,
            progress=False,
            threads=True,
        )
    except Exception as e:
        logger.error(f"Failed to fetch stock data: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    results = []
    for stock in DEFAULT_STOCKS:
        ticker = stock["ticker"]
        try:
            if len(tickers) == 1:
                ticker_data = data
            else:
                ticker_data = data[ticker]

            closes = ticker_data["Close"].dropna()
            if len(closes) >= 2:
                price = float(closes.iloc[-1])
                prev_close = float(closes.iloc[-2])
            elif len(closes) == 1:
                price = float(closes.iloc[-1])
                prev_close = price
            else:
                price = 0.0
                prev_close = 0.0

            change = price - prev_close
            change_pct = (change / prev_close * 100) if prev_close != 0 else 0.0

            # Volume
            volumes = ticker_data["Volume"].dropna()
            volume = int(volumes.iloc[-1]) if len(volumes) > 0 else 0

            # High/Low from latest day
            highs = ticker_data["High"].dropna()
            lows = ticker_data["Low"].dropna()
            high = float(highs.iloc[-1]) if len(highs) > 0 else price
            low = float(lows.iloc[-1]) if len(lows) > 0 else price

            results.append({
                **stock,
                "price": round(price, 2),
                "prev_close": round(prev_close, 2),
                "change": round(change, 2),
                "change_pct": round(change_pct, 2),
                "volume": volume,
                "day_high": round(high, 2),
                "day_low": round(low, 2),
            })
        except Exception as e:
            logger.warning(f"Error processing {ticker}: {e}")
            results.append({
                **stock,
                "price": 0.0,
                "prev_close": 0.0,
                "change": 0.0,
                "change_pct": 0.0,
                "volume": 0,
                "day_high": 0.0,
                "day_low": 0.0,
            })

    return results


@app.get("/history/{ticker}")
def get_history(
    ticker: str,
    timeframe: str = Query("1M", description="Timeframe key: 1D, 1W, 1M, 3M, 6M, 1Y, 5Y, ALL"),
):
    """Return OHLCV history for a ticker."""
    if timeframe not in TIMEFRAME_MAP:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {timeframe}. Valid: {list(TIMEFRAME_MAP.keys())}")

    period, interval = TIMEFRAME_MAP[timeframe]

    try:
        t = yf.Ticker(ticker)
        df = t.history(period=period, interval=interval, auto_adjust=True)
    except Exception as e:
        logger.error(f"Failed to fetch history for {ticker}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    if df.empty:
        raise HTTPException(status_code=404, detail=f"No data found for {ticker}")

    df = df.dropna(subset=["Open", "High", "Low", "Close"])

    candles = []
    for ts, row in df.iterrows():
        # Convert timestamp to Unix seconds (UTC)
        if hasattr(ts, 'timestamp'):
            time_val = int(ts.timestamp())
        else:
            time_val = int(pd.Timestamp(ts).timestamp())

        candles.append({
            "time": time_val,
            "open":   round(float(row["Open"]),   2),
            "high":   round(float(row["High"]),   2),
            "low":    round(float(row["Low"]),    2),
            "close":  round(float(row["Close"]),  2),
            "volume": int(row["Volume"]) if not pd.isna(row["Volume"]) else 0,
        })

    # Sort by time ascending
    candles.sort(key=lambda x: x["time"])

    return {
        "ticker": ticker,
        "timeframe": timeframe,
        "interval": interval,
        "candles": candles,
    }


@app.get("/quotes")
def get_quotes():
    """
    Fast batch quote endpoint — fetches last 2 days at 1m interval with pre/post market,
    returns latest price/change/volume + extended hours data for all 20 stocks.
    Called every 5s by the frontend for real-time updates.
    """
    import pytz
    et = pytz.timezone('America/New_York')

    tickers = [s["ticker"] for s in DEFAULT_STOCKS]
    try:
        data = yf.download(
            tickers,
            period="2d",
            interval="1m",
            group_by="ticker",
            auto_adjust=True,
            prepost=True,
            progress=False,
            threads=True,
        )
    except Exception as e:
        logger.error(f"/quotes fetch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    results = {}
    for stock in DEFAULT_STOCKS:
        ticker = stock["ticker"]
        try:
            td = data[ticker] if len(tickers) > 1 else data
            td = td.dropna(subset=["Close"])
            if len(td) == 0:
                continue

            # Partition rows by ET session
            reg_rows  = []
            pre_rows  = []
            post_rows = []
            for ts, row in td.iterrows():
                ts_et = ts.astimezone(et)
                t = ts_et.time()
                if dtime(9, 30) <= t < dtime(16, 0):
                    reg_rows.append(row)
                elif dtime(4, 0) <= t < dtime(9, 30):
                    pre_rows.append(row)
                else:
                    # after 16:00 or before 04:00 ET
                    post_rows.append(row)

            # Regular session close (most recent regular bar)
            if reg_rows:
                reg_close = float(reg_rows[-1]["Close"])
                reg_high  = float(max(r["High"]   for r in reg_rows))
                reg_low   = float(min(r["Low"]    for r in reg_rows))
                reg_vol   = int(sum(r["Volume"]   for r in reg_rows if not pd.isna(r["Volume"])))
            else:
                # No regular bars today; fall back to last close in all data
                reg_close = float(td["Close"].iloc[-1])
                reg_high  = reg_close
                reg_low   = reg_close
                reg_vol   = 0

            # prev_close: last bar from a previous calendar day
            today_date = td.index[-1].astimezone(et).date()
            prev_bars = [row for ts, row in td.iterrows() if ts.astimezone(et).date() < today_date]
            prev_close = float(prev_bars[-1]["Close"]) if prev_bars else reg_close

            # Determine current market session and extended price
            ext_price: Optional[float] = None
            ext_change_pct: Optional[float] = None
            ext_session: Optional[str] = None

            if post_rows:
                ext_price = float(post_rows[-1]["Close"])
                ext_change_pct = round((ext_price - reg_close) / reg_close * 100, 4) if reg_close else None
                ext_session = "POST"
            elif pre_rows:
                ext_price = float(pre_rows[-1]["Close"])
                ext_change_pct = round((ext_price - prev_close) / prev_close * 100, 4) if prev_close else None
                ext_session = "PRE"

            # Regular session change vs prev_close
            change     = reg_close - prev_close
            change_pct = (change / prev_close * 100) if prev_close != 0 else 0.0

            # Last minute-candle (incl. extended) for chart update
            last_row = td.iloc[-1]
            last_ts  = int(last_row.name.timestamp())

            results[ticker] = {
                "price":          round(reg_close, 2),
                "prev_close":     round(prev_close, 2),
                "change":         round(change, 2),
                "change_pct":     round(change_pct, 2),
                "day_high":       round(reg_high, 2),
                "day_low":        round(reg_low, 2),
                "volume":         reg_vol,
                # Extended hours
                "ext_price":      round(ext_price, 2) if ext_price is not None else None,
                "ext_change_pct": ext_change_pct,
                "ext_session":    ext_session,
                # Last candle for chart
                "last_candle": {
                    "time":   last_ts,
                    "open":   round(float(last_row["Open"]),  2),
                    "high":   round(float(last_row["High"]),  2),
                    "low":    round(float(last_row["Low"]),   2),
                    "close":  round(float(last_row["Close"]), 2),
                    "volume": int(last_row["Volume"]) if not pd.isna(last_row["Volume"]) else 0,
                },
            }
        except Exception as e:
            logger.warning(f"/quotes error for {ticker}: {e}")

    return results



if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 8765))
    host = "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1"
    uvicorn.run(app, host=host, port=port, log_level="info")
