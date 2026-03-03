#!/usr/bin/env python3
"""
Blue Chip Stock Tracker - FastAPI Backend
Serves OHLCV data and real-time quotes via yfinance
Includes background Discord alert task for ≥5% intraday moves
"""

import sys
import os
import time
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, time as dtime
from typing import Optional, Literal

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
# Period is set to the maximum available for each interval so all historical
# data is returned; the frontend sets the default visible window.
TIMEFRAME_MAP = {
    "1D":  ("60d",  "5m"),   # 5m data: yfinance allows up to 60d
    "1W":  ("60d",  "30m"),  # 30m data: yfinance allows up to 60d
    "1M":  ("max",  "1d"),
    "3M":  ("max",  "1d"),
    "6M":  ("max",  "1d"),
    "1Y":  ("max",  "1d"),
    "5Y":  ("max",  "1wk"),
    "ALL": ("max",  "1mo"),
}

# ─── S&P 500 Screener universe (~150 liquid names, all 11 GICS sectors) ────────

SP500_SCREENER_UNIVERSE: list[str] = [
    # Technology
    "AAPL", "MSFT", "NVDA", "AVGO", "AMD", "ORCL", "CRM", "NOW", "ADBE", "INTC",
    "QCOM", "TXN", "IBM", "HPQ", "ANET", "PANW", "SNPS", "CDNS", "KLAC", "LRCX",
    "AMAT", "MU", "STX", "WDC", "FTNT", "CTSH",
    # Communication Services
    "GOOGL", "META", "NFLX", "DIS", "CMCSA", "VZ", "T", "TMUS", "CHTR", "TTWO",
    "EA", "OMC", "IPG",
    # Consumer Discretionary
    "AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "TGT", "LOW", "BKNG", "ABNB",
    "CMG", "YUM", "MAR", "HLT", "F", "GM", "APTV", "GRMN",
    # Consumer Staples
    "WMT", "PG", "COST", "KO", "PEP", "PM", "MO", "MDLZ", "CL", "GIS",
    "KHC", "STZ", "SYY", "ADM",
    # Energy
    "XOM", "CVX", "COP", "SLB", "EOG", "PSX", "VLO", "MPC", "OXY", "KMI",
    "WMB", "HAL",
    # Financials
    "BRK-B", "JPM", "V", "MA", "BAC", "WFC", "GS", "MS", "BLK", "SCHW",
    "AXP", "USB", "PNC", "TFC", "COF", "CB", "MMC", "AON", "ICE", "CME",
    "MCO", "SPGI",
    # Healthcare
    "UNH", "LLY", "JNJ", "MRK", "ABBV", "PFE", "TMO", "ABT", "DHR", "BMY",
    "AMGN", "GILD", "ISRG", "SYK", "MDT", "BSX", "ZTS", "REGN", "VRTX", "HCA",
    "CI", "ELV", "CVS", "MCK", "ABC",
    # Industrials
    "GE", "CAT", "DE", "HON", "RTX", "LMT", "BA", "NOC", "GD", "UPS",
    "FDX", "CSX", "NSC", "UNP", "EMR", "ETN", "PH", "ROK", "IR", "DOV",
    "AME", "IEX", "CTAS", "RSG",
    # Materials
    "LIN", "APD", "ECL", "SHW", "FCX", "NEM", "NUE", "VMC", "MLM", "PPG",
    "ALB",
    # Real Estate
    "PLD", "AMT", "EQIX", "CCI", "PSA", "O", "WELL", "SPG", "VICI",
    # Utilities
    "NEE", "DUK", "SO", "D", "AEP", "EXC", "XEL", "PCG", "ED",
]

# ─── Screener cache ────────────────────────────────────────────────────────────

_screener_cache: Optional[tuple[float, list]] = None   # (monotonic_ts, results)
_screener_running: bool = False
_SCREENER_TTL: float = 4 * 3600.0   # 4 hours


def _compute_bollinger_touch(ticker: str, window: int = 20, std_mult: float = 2.0, lookback: int = 10) -> Optional[int]:
    """
    Return how many trading days ago the close last crossed below the lower
    Bollinger Band (20-day, 2σ), or None if it never did in the last `lookback` days.
    Fetches 60d of daily closes.
    """
    try:
        df = yf.download(ticker, period="60d", interval="1d", auto_adjust=True, progress=False)
        if df is None or df.empty or len(df) < window + lookback:
            return None
        # yf.download for a single ticker may return a MultiIndex DataFrame
        close_col = df["Close"]
        if hasattr(close_col, "iloc") and hasattr(close_col, "columns"):
            # MultiIndex — take first column
            close_col = close_col.iloc[:, 0]  # type: ignore[assignment]
        closes: pd.Series = pd.Series(close_col.dropna().values, dtype=float)  # type: ignore[arg-type]
        if len(closes) < window + lookback:
            return None
        sma   = closes.rolling(window).mean()
        std   = closes.rolling(window).std()
        lower = sma - std_mult * std
        # Scan the last `lookback` bars from newest to oldest
        for i in range(len(closes) - 1, len(closes) - 1 - lookback, -1):
            if i < 0:
                break
            c_val = float(closes.iloc[i])
            l_val = float(lower.iloc[i])  # type: ignore[index]
            if not pd.isna(l_val) and c_val <= l_val:
                return len(closes) - 1 - i
        return None
    except Exception:
        return None


def _run_screener_sync() -> list:
    """
    Scan SP500_SCREENER_UNIVERSE and return up to 10 stocks that pass:
      1. EPS estimate for current quarter increased vs 30 days ago (earnings_trend)
      2. EV/EBITDA (trailing) <= 20x
      3. Price crossed below lower 20-day Bollinger Band within last 10 trading days

    Results are sorted descending by Rule of 40 (revenue_growth% + operating_margin%).
    Runs in a thread-pool executor; one bad ticker never fails the whole run.
    """
    global _screener_running, _screener_cache
    _screener_running = True
    logger.info(f"Screener: starting run over {len(SP500_SCREENER_UNIVERSE)} tickers")

    passed: list[dict] = []

    for ticker in SP500_SCREENER_UNIVERSE:
        try:
            t = yf.Ticker(ticker)
            info: dict = t.info or {}

            # ── Filter 1: EPS estimate revision ─────────────────────────────
            eps_revision_pct: Optional[float] = None
            try:
                # yfinance exposes earnings trend as a property/attribute
                raw_trend = getattr(t, "earnings_trend", None)  # type: ignore[attr-defined]
                if raw_trend is None:
                    # Fallback: try get_earnings_trend if available on this yfinance version
                    get_fn = getattr(t, "get_earnings_trend", None)
                    if callable(get_fn):
                        raw_trend = get_fn()
                if raw_trend is not None:
                    # May be a dict with key 'trend', or a DataFrame directly
                    if isinstance(raw_trend, dict):
                        trend_list = raw_trend.get("trend", [])
                    elif hasattr(raw_trend, "to_dict"):
                        trend_list = raw_trend.to_dict("records")  # type: ignore[union-attr]
                    else:
                        trend_list = []
                    # Find the '0q' (current quarter) entry
                    cur_entry: Optional[dict] = None
                    for entry in trend_list:
                        if isinstance(entry, dict) and entry.get("period") in ("0q", "0Q"):
                            cur_entry = entry
                            break
                    if cur_entry is None and trend_list:
                        cur_entry = trend_list[0] if isinstance(trend_list[0], dict) else None
                    if cur_entry is not None:
                        est_block = cur_entry.get("earningsEstimate", {}) or {}
                        est_now = est_block.get("current", {})
                        est_30d = est_block.get("30daysAgo", {})
                        # Yahoo returns these as {"raw": float, "fmt": str} dicts
                        if isinstance(est_now, dict):
                            est_now = est_now.get("raw")
                        if isinstance(est_30d, dict):
                            est_30d = est_30d.get("raw")
                        if (
                            est_now is not None and est_30d is not None
                            and not pd.isna(float(est_now)) and not pd.isna(float(est_30d))
                            and float(est_30d) != 0
                        ):
                            eps_revision_pct = round(
                                (float(est_now) - float(est_30d)) / abs(float(est_30d)) * 100, 2
                            )
            except Exception:
                pass

            if eps_revision_pct is None or eps_revision_pct <= 0:
                continue

            # ── Filter 2: EV/EBITDA <= 20x ──────────────────────────────────
            ev_ebitda = info.get("enterpriseToEbitda")
            if ev_ebitda is None or pd.isna(ev_ebitda):
                continue
            ev_ebitda = float(ev_ebitda)
            if ev_ebitda <= 0 or ev_ebitda > 20:
                continue

            # ── Filter 3: Bollinger Band lower-band touch ────────────────────
            bb_days_ago = _compute_bollinger_touch(ticker)
            if bb_days_ago is None:
                continue

            # ── Rule of 40 score ────────────────────────────────────────────
            rev_growth      = info.get("revenueGrowth")
            op_margin       = info.get("operatingMargins")
            rev_growth_pct  = round(float(rev_growth) * 100, 2) if rev_growth is not None and not pd.isna(rev_growth) else 0.0
            op_margin_pct   = round(float(op_margin)  * 100, 2) if op_margin  is not None and not pd.isna(op_margin)  else 0.0
            rule_of_40      = round(rev_growth_pct + op_margin_pct, 2)

            # ── Price / name ─────────────────────────────────────────────────
            price     = info.get("regularMarketPrice") or info.get("currentPrice") or info.get("previousClose") or 0.0
            long_name = info.get("longName") or info.get("shortName") or ticker
            sector    = info.get("sector") or "Unknown"

            passed.append({
                "ticker":           ticker,
                "name":             long_name,
                "sector":           sector,
                "price":            round(float(price), 2),
                "eps_revision_pct": eps_revision_pct,
                "ev_ebitda":        round(ev_ebitda, 2),
                "revenue_growth":   rev_growth_pct,
                "operating_margin": op_margin_pct,
                "rule_of_40":       rule_of_40,
                "bb_touch_days_ago": bb_days_ago,
            })
            logger.info(f"Screener pass: {ticker}  R40={rule_of_40}  EV/EBITDA={ev_ebitda:.1f}  BB={bb_days_ago}d  EPSrev={eps_revision_pct:.1f}%")

        except Exception as e:
            logger.warning(f"Screener: skipping {ticker} — {e}")

    # Sort by Rule of 40 descending, keep top 10
    passed.sort(key=lambda x: x["rule_of_40"], reverse=True)
    results = passed[:10]

    ts = time.monotonic()
    _screener_cache = (ts, results)
    _screener_running = False
    logger.info(f"Screener: done — {len(passed)} passed, returning top {len(results)}")
    return results


# ─── Alert configuration ──────────────────────────────────────────────────────

DISCORD_WEBHOOK_URL: Optional[str] = os.environ.get("DISCORD_WEBHOOK_URL")
ALERT_THRESHOLD: float = float(os.environ.get("ALERT_THRESHOLD", "5.0"))
ALERT_POLL_SECONDS: int = 30          # How often to check (seconds)
ALERT_COOLDOWN_SECONDS: int = 300     # Minimum gap between alerts for the same ticker (5 min)
HOURLY_MOVERS_THRESHOLD: float = float(os.environ.get("HOURLY_MOVERS_THRESHOLD", "5.0"))  # Min |change_pct| to appear in hourly digest
ET = pytz.timezone("America/New_York")
MARKET_OPEN  = dtime(9, 30)
MARKET_CLOSE = dtime(16, 0)

# Tracks the last time (monotonic) each ticker fired a Discord alert this session
_last_alert_sent: dict[str, float] = {}

_executor = ThreadPoolExecutor(max_workers=6)

# ── Shared /quotes TTL cache (10 s) ───────────────────────────────────────────
# Prevents thundering-herd when get_quotes(), _alert_loop(), and
# _send_hourly_movers() all call _fetch_quotes_sync() at the same time.
_quotes_cache: Optional[tuple[float, dict]] = None
_QUOTES_TTL = 10.0


def _get_cached_quotes() -> dict:
    """
    Return cached quote results if fresh, otherwise fetch and cache.
    Shared by get_quotes(), _alert_loop(), and _send_hourly_movers()
    so a burst of simultaneous callers only hits yfinance once per 10 s.
    """
    global _quotes_cache
    now = time.monotonic()
    if _quotes_cache is not None:
        ts, data = _quotes_cache
        if now - ts < _QUOTES_TTL:
            return data
    data = _fetch_quotes_sync()
    _quotes_cache = (now, data)
    return data


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
    Returns dict keyed by ticker with full quote shape (same as /quotes endpoint).
    """
    tickers = [s["ticker"] for s in DEFAULT_STOCKS]
    et = pytz.timezone('America/New_York')
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
        logger.error(f"_fetch_quotes_sync failed: {e}")
        return {}

    results: dict = {}
    for stock in DEFAULT_STOCKS:
        ticker = stock["ticker"]
        try:
            td = data[ticker] if len(tickers) > 1 else data
            td = td.dropna(subset=["Close"])
            if len(td) == 0:
                continue

            # Partition rows by ET session
            reg_rows: list  = []
            pre_rows: list  = []
            post_rows: list = []
            for ts, row in td.iterrows():
                ts_et = ts.astimezone(et)
                t = ts_et.time()
                if dtime(9, 30) <= t < dtime(16, 0):
                    reg_rows.append(row)
                elif dtime(4, 0) <= t < dtime(9, 30):
                    pre_rows.append(row)
                else:
                    post_rows.append(row)

            # Regular session close
            if reg_rows:
                reg_close = float(reg_rows[-1]["Close"])
                reg_high  = float(max(r["High"]  for r in reg_rows))
                reg_low   = float(min(r["Low"]   for r in reg_rows))
                reg_vol   = int(sum(r["Volume"]  for r in reg_rows if not pd.isna(r["Volume"])))
            else:
                reg_close = float(td["Close"].iloc[-1])
                reg_high  = reg_close
                reg_low   = reg_close
                reg_vol   = 0

            # prev_close: last bar from a previous calendar day
            today_date = td.index[-1].astimezone(et).date()
            prev_bars = [row for ts, row in td.iterrows() if ts.astimezone(et).date() < today_date]
            prev_close = float(prev_bars[-1]["Close"]) if prev_bars else reg_close

            # Extended hours
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

            change     = reg_close - prev_close
            change_pct = (change / prev_close * 100) if prev_close != 0 else 0.0

            # Last minute-candle (incl. extended) for chart update
            last_row = td.iloc[-1]
            last_ts  = int(last_row.name.timestamp())

            results[ticker] = {
                # Alert-poller fields
                "name":           stock["name"],
                "sector":         stock["sector"],
                # Full /quotes fields
                "price":          round(reg_close, 2),
                "prev_close":     round(prev_close, 2),
                "change":         round(change, 2),
                "change_pct":     round(change_pct, 4),
                "day_high":       round(reg_high, 2),
                "day_low":        round(reg_low, 2),
                "volume":         reg_vol,
                "ext_price":      round(ext_price, 2) if ext_price is not None else None,
                "ext_change_pct": ext_change_pct,
                "ext_session":    ext_session,
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
            logger.warning(f"_fetch_quotes_sync error for {ticker}: {e}")

    return results


async def _send_discord_alert_batch(
    client: httpx.AsyncClient,
    movers: list[dict],
) -> None:
    """
    POST a single rich embed to the configured Discord webhook summarising all
    current intraday movers as a formatted chart/table.

    Each entry in `movers` must have keys:
        ticker, name, price, prev_close, change_pct
    Sorted by |change_pct| descending before display.
    """
    if not DISCORD_WEBHOOK_URL or not movers:
        return

    movers_sorted = sorted(movers, key=lambda x: abs(x["change_pct"]), reverse=True)

    gainers = [m for m in movers_sorted if m["change_pct"] >= 0]
    losers  = [m for m in movers_sorted if m["change_pct"] <  0]

    now_et  = datetime.now(ET).strftime("%H:%M ET")

    # ── Build table rows ─────────────────────────────────────────────────────
    # Each row: `TICK  ` ▲/▼ +X.XX%  $PPP.PP  (+$CC.CC)
    def fmt_mover(m: dict) -> str:
        arrow  = "▲" if m["change_pct"] >= 0 else "▼"
        sign   = "+" if m["change_pct"] >= 0 else ""
        dollar_chg = m["price"] - m["prev_close"]
        d_sign = "+" if dollar_chg >= 0 else ""
        return (
            f"`{m['ticker']:6s}` {arrow} {sign}{m['change_pct']:.2f}%"
            f"  ${m['price']:.2f}  ({d_sign}${dollar_chg:.2f})"
        )

    gainers_txt = "\n".join(fmt_mover(m) for m in gainers) or "_None_"
    losers_txt  = "\n".join(fmt_mover(m) for m in losers)  or "_None_"

    # Colour: green if more gainers, red if more losers, orange if equal
    if len(gainers) > len(losers):
        color = 0x2ECC71
    elif len(losers) > len(gainers):
        color = 0xE74C3C
    else:
        color = 0xE67E22

    total    = len(movers_sorted)
    n_up     = len(gainers)
    n_down   = len(losers)
    top      = movers_sorted[0]
    top_sign = "+" if top["change_pct"] >= 0 else ""

    description = (
        f"**{n_up} up / {n_down} down** across {total} alert{'s' if total != 1 else ''}\n"
        f"Biggest mover: **{top['ticker']}** {top_sign}{top['change_pct']:.2f}%"
    )

    fields = []
    if gainers:
        fields.append({"name": "📈 Gainers", "value": gainers_txt, "inline": True})
    if losers:
        fields.append({"name": "📉 Losers",  "value": losers_txt,  "inline": True})

    embed = {
        "title":       f"Intraday Movers  •  {now_et}",
        "description": description,
        "color":       color,
        "fields":      fields,
        "footer":      {"text": f"S&P 500 Alerts  •  threshold ≥{ALERT_THRESHOLD}%"},
        "timestamp":   datetime.now(timezone.utc).isoformat(),
    }

    payload = {
        "username":   "Stock Alert",
        "avatar_url": "https://cdn-icons-png.flaticon.com/512/4305/4305512.png",
        "embeds":     [embed],
    }

    tickers_str = ", ".join(m["ticker"] for m in movers_sorted)
    try:
        resp = await client.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
        if resp.status_code not in (200, 204):
            logger.warning(f"Discord batch alert webhook returned {resp.status_code}")
        else:
            logger.info(f"Discord batch alert sent: {tickers_str}")
    except Exception as e:
        logger.error(f"Failed to send Discord batch alert: {e}")


async def _alert_loop() -> None:
    """
    Background coroutine: polls every ALERT_POLL_SECONDS during market hours.
    Collects all stocks whose |change_pct| >= ALERT_THRESHOLD that are not in
    cooldown, then fires a single batched Discord chart message for the whole set.
    """
    if not DISCORD_WEBHOOK_URL:
        logger.warning(
            "DISCORD_WEBHOOK_URL not set — alert poller is disabled. "
            "Set it in python/.env to enable alerts."
        )
        return

    logger.info(
        f"Discord alert poller started — threshold={ALERT_THRESHOLD}%, "
        f"interval={ALERT_POLL_SECONDS}s, cooldown={ALERT_COOLDOWN_SECONDS}s, webhook configured."
    )

    loop = asyncio.get_running_loop()

    async with httpx.AsyncClient() as client:
        while True:
            await asyncio.sleep(ALERT_POLL_SECONDS)

            if not _is_market_open():
                continue

            try:
                quotes = await loop.run_in_executor(_executor, _get_cached_quotes)
            except Exception as e:
                logger.error(f"Alert poller executor error: {e}")
                continue

            now_mono = time.monotonic()
            batch: list[dict] = []
            for ticker, q in quotes.items():
                if abs(q["change_pct"]) >= ALERT_THRESHOLD:
                    last_sent = _last_alert_sent.get(ticker, 0.0)
                    if now_mono - last_sent >= ALERT_COOLDOWN_SECONDS:
                        _last_alert_sent[ticker] = now_mono
                        batch.append({
                            "ticker":     ticker,
                            "name":       q["name"],
                            "price":      q["price"],
                            "prev_close": q["prev_close"],
                            "change_pct": q["change_pct"],
                        })
                    else:
                        secs_remaining = int(ALERT_COOLDOWN_SECONDS - (now_mono - last_sent))
                        logger.debug(
                            f"Alert suppressed for {ticker} — cooldown {secs_remaining}s remaining"
                        )

            if batch:
                await _send_discord_alert_batch(client, batch)


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

    loop = asyncio.get_running_loop()
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


async def _send_hourly_movers(client: httpx.AsyncClient) -> None:
    """
    Fetch all 30 stocks and POST a Discord embed listing every stock whose
    |change_pct| >= HOURLY_MOVERS_THRESHOLD for the day.
    Sends a "no big movers" note when nothing qualifies.
    """
    if not DISCORD_WEBHOOK_URL:
        return

    loop = asyncio.get_running_loop()
    try:
        quotes = await loop.run_in_executor(_executor, _get_cached_quotes)
    except Exception as e:
        logger.error(f"Hourly movers fetch error: {e}")
        return

    movers = [
        {
            "ticker":     ticker,
            "name":       q["name"],
            "price":      q["price"],
            "prev_close": q["prev_close"],
            "change_pct": q["change_pct"],
        }
        for ticker, q in quotes.items()
        if abs(q["change_pct"]) >= HOURLY_MOVERS_THRESHOLD
    ]
    movers.sort(key=lambda x: x["change_pct"], reverse=True)

    gainers = [m for m in movers if m["change_pct"] >= 0]
    losers  = [m for m in movers if m["change_pct"] <  0]

    now_et   = datetime.now(ET)
    time_str = now_et.strftime("%I:%M %p ET")
    date_str = now_et.strftime("%A, %B %-d %Y")

    def fmt_row(m: dict) -> str:
        arrow  = "▲" if m["change_pct"] >= 0 else "▼"
        sign   = "+" if m["change_pct"] >= 0 else ""
        d      = m["price"] - m["prev_close"]
        ds     = "+" if d >= 0 else ""
        return (
            f"`{m['ticker']:6s}` {arrow} {sign}{m['change_pct']:.2f}%"
            f"  ${m['price']:.2f}  ({ds}${d:.2f})"
        )

    if movers:
        gainers_txt = "\n".join(fmt_row(m) for m in gainers) or "_None_"
        losers_txt  = "\n".join(fmt_row(m) for m in reversed(losers)) or "_None_"

        color = 0x2ECC71 if len(gainers) >= len(losers) else 0xE74C3C

        best  = movers[0]
        worst = movers[-1]
        b_sign = "+" if best["change_pct"] >= 0 else ""
        description = (
            f"**{len(gainers)} up / {len(losers)} down** moving ≥{HOURLY_MOVERS_THRESHOLD}%\n"
            f"Biggest: **{best['ticker']}** {b_sign}{best['change_pct']:.2f}%"
            + (f"   Worst: **{worst['ticker']}** {worst['change_pct']:.2f}%" if worst is not best else "")
        )

        fields = []
        if gainers:
            fields.append({"name": "📈 Gainers", "value": gainers_txt, "inline": True})
        if losers:
            fields.append({"name": "📉 Losers",  "value": losers_txt,  "inline": True})
    else:
        color       = 0x95A5A6   # grey — nothing notable
        description = f"No stocks in the watchlist are moving ≥{HOURLY_MOVERS_THRESHOLD}% today."
        fields      = []

    payload = {
        "username":   "Hourly Movers",
        "avatar_url": "https://cdn-icons-png.flaticon.com/512/4305/4305512.png",
        "embeds": [{
            "title":       f"Hourly Movers — {date_str}",
            "description": description,
            "color":       color,
            "fields":      fields,
            "footer":      {"text": f"S&P 500 Top 30  •  threshold ≥{HOURLY_MOVERS_THRESHOLD}%  •  {time_str}"},
            "timestamp":   datetime.now(timezone.utc).isoformat(),
        }],
    }

    try:
        resp = await client.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
        if resp.status_code not in (200, 204):
            logger.warning(f"Hourly movers webhook returned {resp.status_code}")
        else:
            tickers_str = ", ".join(m["ticker"] for m in movers) if movers else "none"
            logger.info(f"Hourly movers sent to Discord: {tickers_str}")
    except Exception as e:
        logger.error(f"Failed to send hourly movers: {e}")


async def _hourly_movers_loop() -> None:
    """
    Background coroutine: fires _send_hourly_movers once per clock-hour during
    market hours (09:00–16:00 ET, Mon–Fri). Ticks every 30 s so it never misses
    the top of an hour by more than 30 s.
    """
    if not DISCORD_WEBHOOK_URL:
        return

    logger.info(
        f"Hourly movers scheduler started — threshold ≥{HOURLY_MOVERS_THRESHOLD}%, "
        "fires at the top of each market hour Mon–Fri 09:00–16:00 ET."
    )

    last_fired_hour: Optional[int] = None   # (day_ordinal * 24 + hour) of last send

    async with httpx.AsyncClient() as client:
        while True:
            await asyncio.sleep(30)

            now_et = datetime.now(ET)

            # Only fire on weekdays inside/around market hours
            if now_et.weekday() >= 5:
                continue
            if not (dtime(9, 0) <= now_et.time() <= dtime(16, 5)):
                continue

            hour_key = now_et.toordinal() * 24 + now_et.hour
            if last_fired_hour == hour_key:
                continue

            # Fire within the first 2 minutes of the hour (or 09:00 pre-open)
            if now_et.minute <= 2:
                last_fired_hour = hour_key
                await _send_hourly_movers(client)


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
    asyncio.create_task(_hourly_movers_loop())
    # Kick off the screener in the background so first request is instant
    loop = asyncio.get_running_loop()
    loop.run_in_executor(_executor, _run_screener_sync)


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


def _candle_session(ts: pd.Timestamp) -> str:
    """Classify a timestamp into 'pre', 'regular', or 'post' ET session."""
    et = pytz.timezone("America/New_York")
    t = ts.astimezone(et).time()
    if dtime(9, 30) <= t < dtime(16, 0):
        return "regular"
    elif dtime(4, 0) <= t < dtime(9, 30):
        return "pre"
    else:
        return "post"


@app.get("/history/{ticker}")
def get_history(
    ticker: str,
    timeframe: str = Query("1M", description="Timeframe key: 1D, 1W, 1M, 3M, 6M, 1Y, 5Y, ALL"),
    prepost: bool = Query(False, description="Include pre/post market candles (only meaningful for intraday timeframes)"),
):
    """Return OHLCV history for a ticker."""
    if timeframe not in TIMEFRAME_MAP:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {timeframe}. Valid: {list(TIMEFRAME_MAP.keys())}")

    period, interval = TIMEFRAME_MAP[timeframe]

    # Pre/post market only applies to intraday intervals
    intraday = interval.endswith("m") or interval.endswith("h")
    fetch_prepost = prepost and intraday

    try:
        t = yf.Ticker(ticker)
        df = t.history(period=period, interval=interval, auto_adjust=True, prepost=fetch_prepost)
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

        session = _candle_session(ts) if fetch_prepost else "regular"

        candles.append({
            "time":    time_val,
            "open":    round(float(row["Open"]),   2),
            "high":    round(float(row["High"]),   2),
            "low":     round(float(row["Low"]),    2),
            "close":   round(float(row["Close"]),  2),
            "volume":  int(row["Volume"]) if not pd.isna(row["Volume"]) else 0,
            "session": session,
        })

    # Sort by time ascending
    candles.sort(key=lambda x: x["time"])

    return {
        "ticker":   ticker,
        "timeframe": timeframe,
        "interval": interval,
        "prepost":  fetch_prepost,
        "candles":  candles,
    }


@app.get("/quotes")
async def get_quotes():
    """
    Fast batch quote endpoint — fetches last 2 days at 1m interval with pre/post market,
    returns latest price/change/volume + extended hours data for all 30 stocks.
    Called every 5s by the frontend for real-time updates.
    Results are cached for 10 seconds (shared with alert/hourly-movers pollers).
    """
    loop = asyncio.get_running_loop()
    try:
        raw = await loop.run_in_executor(_executor, _get_cached_quotes)
    except Exception as e:
        logger.error(f"/quotes error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    return raw


@app.get("/earnings/{ticker}")
def get_earnings(ticker: str):
    """
    Return past and upcoming earnings dates for a ticker.
    Returns list of {date: ISO string, is_upcoming: bool}.
    """
    try:
        t = yf.Ticker(ticker)
        cal = t.calendar
        history_earnings = t.earnings_dates
        results = []

        # Past earnings from earnings_dates (index is datetime)
        if history_earnings is not None and not history_earnings.empty:
            now = pd.Timestamp.now(tz="UTC")
            for dt_idx in history_earnings.index:
                try:
                    if hasattr(dt_idx, 'timestamp'):
                        ts = int(dt_idx.timestamp())
                        is_upcoming = dt_idx > now
                    else:
                        ts_obj = pd.Timestamp(dt_idx)
                        ts = int(ts_obj.timestamp())
                        is_upcoming = ts_obj > now
                    results.append({"time": ts, "is_upcoming": bool(is_upcoming)})
                except Exception:
                    pass

        # Next earnings from calendar (may have more precise date)
        if cal is not None:
            earn_key = None
            for k in ["Earnings Date", "earnings_date", "earningsDate"]:
                if k in cal:
                    earn_key = k
                    break
            if earn_key:
                val = cal[earn_key]
                try:
                    dates = val if hasattr(val, '__iter__') and not isinstance(val, str) else [val]
                    for d in dates:
                        if d is None:
                            continue
                        ts_obj = pd.Timestamp(d)
                        ts = int(ts_obj.timestamp())
                        # Avoid duplicates
                        if not any(abs(r["time"] - ts) < 86400 * 3 for r in results):
                            results.append({"time": ts, "is_upcoming": True})
                except Exception:
                    pass

        results.sort(key=lambda x: x["time"])
        return results
    except Exception as e:
        logger.warning(f"earnings error for {ticker}: {e}")
        return []


@app.get("/spy-history")
def get_spy_history(timeframe: str = Query("3M")):
    """Return SPY OHLCV history for relative-strength calculations."""
    if timeframe not in TIMEFRAME_MAP:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {timeframe}")
    period, interval = TIMEFRAME_MAP[timeframe]
    try:
        t = yf.Ticker("SPY")
        df = t.history(period=period, interval=interval, auto_adjust=True)
    except Exception as e:
        logger.error(f"spy-history fetch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    if df.empty:
        return {"candles": []}

    df = df.dropna(subset=["Close"])
    candles = []
    for ts, row in df.iterrows():
        if hasattr(ts, 'timestamp'):
            time_val = int(ts.timestamp())
        else:
            time_val = int(pd.Timestamp(ts).timestamp())
        candles.append({
            "time":   time_val,
            "open":   round(float(row["Open"]),  2),
            "high":   round(float(row["High"]),  2),
            "low":    round(float(row["Low"]),   2),
            "close":  round(float(row["Close"]), 2),
            "volume": int(row["Volume"]) if not pd.isna(row["Volume"]) else 0,
        })
    candles.sort(key=lambda x: x["time"])
    return {"candles": candles}


@app.get("/meta/{ticker}")
def get_meta(ticker: str):
    """
    Return metadata: 52-week high/low, ATR(14), current price.
    Used for 52wk hi/lo lines and ATR display.
    """
    try:
        t = yf.Ticker(ticker)
        info = t.info or {}

        # 52-week hi/lo from info (fast path)
        week52_high = info.get("fiftyTwoWeekHigh") or info.get("52WeekHigh")
        week52_low  = info.get("fiftyTwoWeekLow")  or info.get("52WeekLow")

        # ATR(14) from daily data
        atr_value: Optional[float] = None
        try:
            df = t.history(period="60d", interval="1d", auto_adjust=True)
            if not df.empty and len(df) >= 15:
                highs  = df["High"].values
                lows   = df["Low"].values
                closes = df["Close"].values
                trs = []
                for i in range(1, len(df)):
                    tr = max(
                        highs[i] - lows[i],
                        abs(highs[i] - closes[i - 1]),
                        abs(lows[i]  - closes[i - 1]),
                    )
                    trs.append(tr)
                # Wilder smoothing over 14 periods
                atr = sum(trs[:14]) / 14
                for tr in trs[14:]:
                    atr = (atr * 13 + tr) / 14
                atr_value = round(float(atr), 2)

                # Fallback 52wk from history if info didn't have it
                if week52_high is None:
                    year_df = t.history(period="1y", interval="1d", auto_adjust=True)
                    if not year_df.empty:
                        week52_high = round(float(year_df["High"].max()), 2)
                        week52_low  = round(float(year_df["Low"].min()),  2)
        except Exception as e:
            logger.warning(f"ATR calc error for {ticker}: {e}")

        return {
            "ticker":      ticker,
            "week52_high": round(float(week52_high), 2) if week52_high else None,
            "week52_low":  round(float(week52_low),  2) if week52_low  else None,
            "atr14":       atr_value,
        }
    except Exception as e:
        logger.warning(f"meta error for {ticker}: {e}")
        return {"ticker": ticker, "week52_high": None, "week52_low": None, "atr14": None}




# ─── Quant model imports (lazy — only imported when endpoints are first hit) ──
import importlib as _importlib
_quant_engine = None
_quant_backtest = None

def _get_engine():  # type: ignore[return]
    global _quant_engine
    if _quant_engine is None:
        import sys as _sys
        _sys.path.insert(0, os.path.dirname(__file__))
        _quant_engine = _importlib.import_module("quant.engine")
    return _quant_engine

def _get_backtest():  # type: ignore[return]
    global _quant_backtest
    if _quant_backtest is None:
        import sys as _sys
        _sys.path.insert(0, os.path.dirname(__file__))
        _quant_backtest = _importlib.import_module("quant.backtest")
    return _quant_backtest

# ── Signals cache (60 s) — separate from engine-level cache ──────────────────
_signals_resp_cache: Optional[tuple[float, list]] = None
_SIGNALS_TTL = 60.0


def _fetch_signals_sync() -> list:
    """Fetch live signals for all universe tickers.  Runs in thread pool."""
    eng = _get_engine()
    return eng.get_live_signals()


@app.get("/signals")
async def get_signals():
    """
    Return live quant signals for all 11 universe tickers (both strategies).
    Cached 60 seconds.
    """
    global _signals_resp_cache
    now = time.monotonic()
    if _signals_resp_cache is not None:
        ts, data = _signals_resp_cache
        if now - ts < _SIGNALS_TTL:
            return data

    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(_executor, _fetch_signals_sync)
    except Exception as e:
        logger.error(f"/signals error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    _signals_resp_cache = (now, result)
    return result


@app.get("/signals/{ticker}")
async def get_signal_ticker(ticker: str):
    """Return live signal detail for a single ticker in the universe."""
    signals = await get_signals()
    ticker = ticker.upper().strip()
    for sig in signals:
        if sig["ticker"] == ticker:
            return sig
    raise HTTPException(status_code=404, detail=f"Ticker '{ticker}' not in quant universe")


def _run_backtest_sync(strategy: str) -> dict:
    """Run walk-forward backtest synchronously in a thread pool worker."""
    bt = _get_backtest()
    return bt.run_backtest(strategy)


@app.get("/backtest/{strategy}")
async def get_backtest(strategy: str):
    """
    Run walk-forward backtest.
    strategy: 'momentum' | 'mean_rev' | 'both'
    Long-running (~10-30 s first call); cached for the rest of the calendar day.
    """
    valid: list[Literal["momentum", "mean_rev", "both"]] = ["momentum", "mean_rev", "both"]
    if strategy not in valid:
        raise HTTPException(status_code=400, detail=f"strategy must be one of: {valid}")

    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(_executor, _run_backtest_sync, strategy)
    except Exception as e:
        logger.error(f"/backtest/{strategy} error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return result


@app.get("/search/{ticker}")
def search_ticker(ticker: str):
    """
    Validate a ticker symbol and return basic info (name, sector, price).
    Used by the frontend add-symbol flow before adding to the watchlist.
    Returns 404 if the ticker is not found or has no price data.
    """
    ticker = ticker.upper().strip()
    try:
        t = yf.Ticker(ticker)
        info = t.info or {}

        # yfinance returns an empty-ish dict for unknown tickers
        price = info.get("regularMarketPrice") or info.get("currentPrice") or info.get("previousClose")
        long_name = info.get("longName") or info.get("shortName") or ticker
        sector = info.get("sector") or info.get("industry") or "Unknown"

        if price is None:
            # Try fetching a tiny history as fallback
            df = t.history(period="5d", interval="1d", auto_adjust=True)
            if df.empty:
                raise HTTPException(status_code=404, detail=f"Ticker '{ticker}' not found")
            price = round(float(df["Close"].iloc[-1]), 2)

        return {
            "ticker":  ticker,
            "name":    long_name,
            "sector":  sector,
            "price":   round(float(price), 2),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"search error for {ticker}: {e}")
        raise HTTPException(status_code=404, detail=f"Ticker '{ticker}' not found")


@app.get("/quote/{ticker}")
def get_single_quote(ticker: str):
    """
    Return a single real-time quote for any ticker (not just DEFAULT_STOCKS).
    Used for live-price polling of user-added custom symbols.
    Returns same shape as one entry in /quotes.
    """
    ticker = ticker.upper().strip()
    et = pytz.timezone('America/New_York')
    try:
        data = yf.download(
            ticker,
            period="2d",
            interval="1m",
            auto_adjust=True,
            prepost=True,
            progress=False,
        )
        if data is None or data.empty:
            raise HTTPException(status_code=404, detail=f"No data for '{ticker}'")

        td = data.dropna(subset=["Close"])
        if len(td) == 0:
            raise HTTPException(status_code=404, detail=f"No data for '{ticker}'")

        reg_rows, pre_rows, post_rows = [], [], []
        for ts, row in td.iterrows():
            ts_et = ts.astimezone(et)
            t_et = ts_et.time()
            if dtime(9, 30) <= t_et < dtime(16, 0):
                reg_rows.append(row)
            elif dtime(4, 0) <= t_et < dtime(9, 30):
                pre_rows.append(row)
            else:
                post_rows.append(row)

        if reg_rows:
            reg_close = float(reg_rows[-1]["Close"])
            reg_high  = float(max(r["High"]  for r in reg_rows))
            reg_low   = float(min(r["Low"]   for r in reg_rows))
            reg_vol   = int(sum(r["Volume"]  for r in reg_rows if not pd.isna(r["Volume"])))
        else:
            reg_close = float(td["Close"].iloc[-1])
            reg_high  = reg_close
            reg_low   = reg_close
            reg_vol   = 0

        today_date = td.index[-1].astimezone(et).date()
        prev_bars  = [row for ts, row in td.iterrows() if ts.astimezone(et).date() < today_date]
        prev_close = float(prev_bars[-1]["Close"]) if prev_bars else reg_close

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

        change     = reg_close - prev_close
        change_pct = (change / prev_close * 100) if prev_close != 0 else 0.0

        last_row = td.iloc[-1]
        last_ts  = int(last_row.name.timestamp())

        return {
            "price":          round(reg_close, 2),
            "prev_close":     round(prev_close, 2),
            "change":         round(change, 2),
            "change_pct":     round(change_pct, 2),
            "day_high":       round(reg_high, 2),
            "day_low":        round(reg_low, 2),
            "volume":         reg_vol,
            "ext_price":      round(ext_price, 2) if ext_price is not None else None,
            "ext_change_pct": ext_change_pct,
            "ext_session":    ext_session,
            "last_candle": {
                "time":   last_ts,
                "open":   round(float(last_row["Open"]),  2),
                "high":   round(float(last_row["High"]),  2),
                "low":    round(float(last_row["Low"]),   2),
                "close":  round(float(last_row["Close"]), 2),
                "volume": int(last_row["Volume"]) if not pd.isna(last_row["Volume"]) else 0,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"/quote/{ticker} error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── S&P 500 Quality Screener endpoint ───────────────────────────────────────

@app.get("/screener/sp500-quality")
async def get_screener(refresh: bool = Query(False, description="Force re-run even if cache is fresh")) -> dict:
    """
    Return top-10 S&P 500 stocks passing:
      1. EPS estimate for current quarter raised vs 30 days ago
      2. Trailing EV/EBITDA <= 20x
      3. Close crossed below lower 20-day Bollinger Band within last 10 trading days
    Sorted by Rule of 40 (revenue growth % + operating margin %) descending.

    Results are pre-computed on server startup and cached for 4 hours.
    Pass ?refresh=true to force an immediate re-run.
    Returns {"status": "computing", "results": [], "generated_at": null} while still running.
    """
    global _screener_running, _screener_cache

    now_mono = time.monotonic()

    # Honour refresh=true: re-run if not already running
    if refresh and not _screener_running:
        _screener_cache = None
        loop = asyncio.get_running_loop()
        loop.run_in_executor(_executor, _run_screener_sync)

    # Cache is stale / expired — kick off a fresh run if not already running
    cache_stale = (
        _screener_cache is None
        or (now_mono - _screener_cache[0]) >= _SCREENER_TTL
    )
    if cache_stale and not _screener_running:
        loop = asyncio.get_running_loop()
        loop.run_in_executor(_executor, _run_screener_sync)

    # Still computing (first run or refresh)
    if _screener_running and _screener_cache is None:
        return {"status": "computing", "results": [], "generated_at": None}

    # Return whatever we have (may be stale while refresh runs in background)
    ts, results = _screener_cache if _screener_cache is not None else (0.0, [])
    # Convert monotonic ts → wall clock unix ts
    wall_ts = int(time.time() - (now_mono - ts))
    return {
        "status":       "computing" if (_screener_running and refresh) else "ready",
        "results":      results,
        "generated_at": wall_ts,
    }


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    host = "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1"
    uvicorn.run(app, host=host, port=port, log_level="info")
