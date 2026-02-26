#!/usr/bin/env python3
"""
Blue Chip Stock Tracker - FastAPI Backend
Serves OHLCV data and real-time quotes via yfinance
Includes background Discord alert task for ≥5% intraday moves
"""

import sys
import os
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, time as dtime
from typing import Optional

try:
    from fastapi import FastAPI, HTTPException, Query
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
    import yfinance as yf
    import pandas as pd
    import pytz
    import httpx
    from dotenv import load_dotenv
except ImportError as e:
    print(f"Missing dependency: {e}", file=sys.stderr)
    print("Run: pip install fastapi uvicorn yfinance pandas pytz httpx python-dotenv", file=sys.stderr)
    sys.exit(1)

# Load .env from same directory as this file
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

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

# S&P 500 Top 30 by market cap
DEFAULT_STOCKS = [
    {"ticker": "AAPL",  "name": "Apple Inc.",                  "sector": "Technology"},
    {"ticker": "MSFT",  "name": "Microsoft Corp.",             "sector": "Technology"},
    {"ticker": "NVDA",  "name": "NVIDIA Corp.",                "sector": "Technology"},
    {"ticker": "AMZN",  "name": "Amazon.com Inc.",             "sector": "Consumer Disc."},
    {"ticker": "GOOGL", "name": "Alphabet Inc. (A)",           "sector": "Communication"},
    {"ticker": "META",  "name": "Meta Platforms Inc.",         "sector": "Communication"},
    {"ticker": "TSLA",  "name": "Tesla Inc.",                  "sector": "Consumer Disc."},
    {"ticker": "BRK-B", "name": "Berkshire Hathaway",          "sector": "Financials"},
    {"ticker": "UNH",   "name": "UnitedHealth Group",          "sector": "Healthcare"},
    {"ticker": "LLY",   "name": "Eli Lilly and Co.",           "sector": "Healthcare"},
    {"ticker": "JPM",   "name": "JPMorgan Chase & Co.",        "sector": "Financials"},
    {"ticker": "V",     "name": "Visa Inc.",                   "sector": "Financials"},
    {"ticker": "XOM",   "name": "Exxon Mobil Corp.",           "sector": "Energy"},
    {"ticker": "MA",    "name": "Mastercard Inc.",             "sector": "Financials"},
    {"ticker": "AVGO",  "name": "Broadcom Inc.",               "sector": "Technology"},
    {"ticker": "PG",    "name": "Procter & Gamble Co.",        "sector": "Consumer Staples"},
    {"ticker": "HD",    "name": "Home Depot Inc.",             "sector": "Consumer Disc."},
    {"ticker": "MRK",   "name": "Merck & Co. Inc.",            "sector": "Healthcare"},
    {"ticker": "COST",  "name": "Costco Wholesale Corp.",      "sector": "Consumer Staples"},
    {"ticker": "ABBV",  "name": "AbbVie Inc.",                 "sector": "Healthcare"},
    {"ticker": "GOOG",  "name": "Alphabet Inc. (C)",           "sector": "Communication"},
    {"ticker": "WMT",   "name": "Walmart Inc.",                "sector": "Consumer Staples"},
    {"ticker": "NFLX",  "name": "Netflix Inc.",                "sector": "Communication"},
    {"ticker": "AMD",   "name": "Advanced Micro Devices",      "sector": "Technology"},
    {"ticker": "CRM",   "name": "Salesforce Inc.",             "sector": "Technology"},
    {"ticker": "TMO",   "name": "Thermo Fisher Scientific",    "sector": "Healthcare"},
    {"ticker": "ORCL",  "name": "Oracle Corp.",                "sector": "Technology"},
    {"ticker": "NOW",   "name": "ServiceNow Inc.",             "sector": "Technology"},
    {"ticker": "BAC",   "name": "Bank of America Corp.",       "sector": "Financials"},
    {"ticker": "GS",    "name": "Goldman Sachs Group",         "sector": "Financials"},
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

# ─── Alert configuration ──────────────────────────────────────────────────────

DISCORD_WEBHOOK_URL: Optional[str] = os.environ.get("DISCORD_WEBHOOK_URL")
ALERT_THRESHOLD: float = float(os.environ.get("ALERT_THRESHOLD", "5.0"))
ALERT_POLL_SECONDS: int = 30          # How often to check (seconds)
ET = pytz.timezone("America/New_York")
MARKET_OPEN  = dtime(9, 30)
MARKET_CLOSE = dtime(16, 0)

_executor = ThreadPoolExecutor(max_workers=2)


def _is_market_open() -> bool:
    """Return True if it's currently a US market trading session."""
    now_et = datetime.now(ET)
    if now_et.weekday() >= 5:          # Saturday=5, Sunday=6
        return False
    return MARKET_OPEN <= now_et.time() < MARKET_CLOSE


def _fetch_quotes_sync() -> dict:
    """
    Fetch 1-minute data for all 30 tickers and compute intraday change %.
    Runs in a thread pool to avoid blocking the event loop.
    Returns dict keyed by ticker: {price, prev_close, change_pct, name, sector}
    """
    tickers = [s["ticker"] for s in DEFAULT_STOCKS]
    try:
        data = yf.download(
            tickers,
            period="2d",
            interval="1m",
            group_by="ticker",
            auto_adjust=True,
            progress=False,
            threads=True,
        )
    except Exception as e:
        logger.error(f"Alert poller fetch failed: {e}")
        return {}

    results: dict = {}
    for stock in DEFAULT_STOCKS:
        ticker = stock["ticker"]
        try:
            td = data[ticker] if len(tickers) > 1 else data
            closes = td["Close"].dropna()
            if len(closes) == 0:
                continue

            price = float(closes.iloc[-1])

            # prev_close: last close from a prior calendar day (ET)
            idx = closes.index
            today_et = idx[-1].astimezone(ET).date()
            prev_closes = closes[[i.astimezone(ET).date() < today_et for i in idx]]
            prev_close = float(prev_closes.iloc[-1]) if len(prev_closes) > 0 else price

            change_pct = ((price - prev_close) / prev_close * 100) if prev_close != 0 else 0.0

            results[ticker] = {
                "name":       stock["name"],
                "sector":     stock["sector"],
                "price":      round(price, 2),
                "prev_close": round(prev_close, 2),
                "change_pct": round(change_pct, 4),
            }
        except Exception as e:
            logger.warning(f"Alert poller error for {ticker}: {e}")

    return results


async def _send_discord_alert(
    client: httpx.AsyncClient,
    ticker: str,
    name: str,
    price: float,
    prev_close: float,
    change_pct: float,
) -> None:
    """POST a rich embed to the configured Discord webhook."""
    if not DISCORD_WEBHOOK_URL:
        return

    direction = "up" if change_pct >= 0 else "down"
    arrow     = "▲" if change_pct >= 0 else "▼"
    color     = 0x2ECC71 if change_pct >= 0 else 0xE74C3C  # green / red
    sign      = "+" if change_pct >= 0 else ""
    now_et    = datetime.now(ET).strftime("%H:%M ET")

    embed = {
        "title":       f"{arrow} {ticker}  {sign}{change_pct:.2f}%",
        "description": f"**{name}** is {direction} **{sign}{change_pct:.2f}%** on the day",
        "color":       color,
        "fields": [
            {"name": "Current Price",  "value": f"${price:.2f}",      "inline": True},
            {"name": "Prev Close",     "value": f"${prev_close:.2f}", "inline": True},
            {"name": "Change",         "value": f"{sign}${price - prev_close:.2f}", "inline": True},
        ],
        "footer": {"text": f"S&P 500 Alert  •  {now_et}"},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    payload = {
        "username":   "Stock Alert",
        "avatar_url": "https://cdn-icons-png.flaticon.com/512/4305/4305512.png",
        "embeds":     [embed],
    }

    try:
        resp = await client.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
        if resp.status_code not in (200, 204):
            logger.warning(f"Discord webhook returned {resp.status_code} for {ticker}")
        else:
            logger.info(f"Discord alert sent: {ticker} {sign}{change_pct:.2f}%")
    except Exception as e:
        logger.error(f"Failed to send Discord alert for {ticker}: {e}")


async def _alert_loop() -> None:
    """
    Background coroutine: polls every ALERT_POLL_SECONDS during market hours.
    Fires a Discord alert for every stock whose |change_pct| >= ALERT_THRESHOLD.
    """
    if not DISCORD_WEBHOOK_URL:
        logger.warning(
            "DISCORD_WEBHOOK_URL not set — alert poller is disabled. "
            "Set it in python/.env to enable alerts."
        )
        return

    logger.info(
        f"Discord alert poller started — threshold={ALERT_THRESHOLD}%, "
        f"interval={ALERT_POLL_SECONDS}s, webhook configured."
    )

    loop = asyncio.get_event_loop()

    async with httpx.AsyncClient() as client:
        while True:
            await asyncio.sleep(ALERT_POLL_SECONDS)

            if not _is_market_open():
                continue

            try:
                quotes = await loop.run_in_executor(_executor, _fetch_quotes_sync)
            except Exception as e:
                logger.error(f"Alert poller executor error: {e}")
                continue

            for ticker, q in quotes.items():
                if abs(q["change_pct"]) >= ALERT_THRESHOLD:
                    await _send_discord_alert(
                        client,
                        ticker=ticker,
                        name=q["name"],
                        price=q["price"],
                        prev_close=q["prev_close"],
                        change_pct=q["change_pct"],
                    )


def _fetch_daily_closes_sync() -> list:
    """
    Fetch previous-day vs today close for the top 20 stocks.
    Returns list of dicts sorted by change_pct descending.
    Runs in thread pool.
    """
    top20 = DEFAULT_STOCKS[:20]
    tickers = [s["ticker"] for s in top20]
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
        logger.error(f"Daily close fetch failed: {e}")
        return []

    results = []
    for stock in top20:
        ticker = stock["ticker"]
        try:
            td = data[ticker] if len(tickers) > 1 else data
            closes = td["Close"].dropna()
            price = float(closes.iloc[-1])
            prev  = float(closes.iloc[-2]) if len(closes) >= 2 else price
            pct   = (price - prev) / prev * 100 if prev != 0 else 0.0
            results.append({
                "ticker":     ticker,
                "name":       stock["name"],
                "price":      round(price, 2),
                "prev_close": round(prev, 2),
                "change_pct": round(pct, 2),
            })
        except Exception as e:
            logger.warning(f"Daily close error for {ticker}: {e}")

    results.sort(key=lambda x: x["change_pct"], reverse=True)
    return results


async def _send_daily_close_summary(client: httpx.AsyncClient) -> None:
    """Build and POST the daily market-close embed to Discord."""
    if not DISCORD_WEBHOOK_URL:
        return

    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(_executor, _fetch_daily_closes_sync)
    if not results:
        logger.warning("Daily close: no data to send")
        return

    gainers = [r for r in results if r["change_pct"] >= 0]
    losers  = [r for r in results if r["change_pct"] < 0]

    def fmt_row(r: dict) -> str:
        arrow = "▲" if r["change_pct"] >= 0 else "▼"
        sign  = "+" if r["change_pct"] >= 0 else ""
        return f"`{r['ticker']:6s}`  {arrow} {sign}{r['change_pct']:.2f}%   ${r['price']:.2f}"

    gainers_txt = "\n".join(fmt_row(r) for r in gainers)         or "_None_"
    losers_txt  = "\n".join(fmt_row(r) for r in reversed(losers)) or "_None_"

    best  = results[0]
    worst = results[-1]
    advances = len(gainers)
    declines = len(losers)

    date_str  = datetime.now(ET).strftime("%A, %B %-d %Y")
    close_str = datetime.now(ET).strftime("%I:%M %p ET")

    summary = (
        f"**{advances} advances / {declines} declines**\n"
        f"Best: **{best['ticker']}** +{best['change_pct']:.2f}%   "
        f"Worst: **{worst['ticker']}** {worst['change_pct']:.2f}%"
    )

    payload = {
        "username":   "Market Close",
        "avatar_url": "https://cdn-icons-png.flaticon.com/512/4305/4305512.png",
        "embeds": [{
            "title":       f"Market Close Summary — {date_str}",
            "description": summary,
            "color":       0x5865F2,
            "fields": [
                {"name": "📈 Gainers", "value": gainers_txt, "inline": True},
                {"name": "📉 Losers",  "value": losers_txt,  "inline": True},
            ],
            "footer":    {"text": f"Top 20 S&P 500  •  as of {close_str}"},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }],
    }

    try:
        resp = await client.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
        if resp.status_code not in (200, 204):
            logger.warning(f"Daily close webhook returned {resp.status_code}")
        else:
            logger.info("Daily close summary sent to Discord")
    except Exception as e:
        logger.error(f"Failed to send daily close summary: {e}")


async def _daily_close_loop() -> None:
    """
    Background coroutine: waits until 16:00 ET on each weekday, then fires
    the daily close summary. Sleeps in 30-second ticks to stay responsive.
    """
    if not DISCORD_WEBHOOK_URL:
        return

    logger.info("Daily close summary scheduler started — fires at 16:00 ET on weekdays.")
    sent_today: Optional[int] = None   # ordinal of the day we last sent

    async with httpx.AsyncClient() as client:
        while True:
            await asyncio.sleep(30)

            now_et   = datetime.now(ET)
            today_ord = now_et.toordinal()

            # Only fire Mon–Fri at or after 16:00 ET, once per day
            if (
                now_et.weekday() < 5
                and now_et.time() >= dtime(16, 0)
                and sent_today != today_ord
            ):
                sent_today = today_ord
                await _send_daily_close_summary(client)


@app.on_event("startup")
async def startup_event() -> None:
    asyncio.create_task(_alert_loop())
    asyncio.create_task(_daily_close_loop())


# ─── API Endpoints ────────────────────────────────────────────────────────────

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
    returns latest price/change/volume + extended hours data for all 30 stocks.
    Called every 5s by the frontend for real-time updates.
    """
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
    port = int(os.environ.get("PORT", 8765))
    host = "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1"
    uvicorn.run(app, host=host, port=port, log_level="info")
