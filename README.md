# Blue Chip Stock Tracker

A Windows desktop application for tracking S&P 500 top 20 blue chip stocks with interactive TradingView-style charts.

## Features

- **20 Blue Chip Stocks** — S&P 500 top 20 by market cap (AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA, and more)
- **Candlestick Charts** — Professional OHLC candlestick charts powered by TradingView Lightweight Charts
- **Volume Bars** — Volume histogram overlaid on the price chart
- **8 Timeframes** — 1D, 1W, 1M, 3M, 6M, 1Y, 5Y, ALL
- **Technical Indicators** — SMA (20/50/200), Bollinger Bands, RSI(14)
- **Live Data** — Powered by Yahoo Finance (yfinance), auto-refreshes every 60 seconds
- **Dark Theme** — TradingView-inspired dark UI
- **Search & Sort** — Filter stocks by name/ticker/sector, sort by % change or price

## Prerequisites

- **Node.js 18+** — https://nodejs.org
- **Python 3.9+** — https://python.org

## Quick Start (Windows)

Double-click `start.bat`, or run manually:

```bash
# 1. Install Python dependencies
pip install fastapi uvicorn yfinance pandas

# 2. Install npm dependencies
npm install

# 3. Build the frontend
npm run build

# 4. Launch
npx electron .
```

## Development Mode

Runs with hot-reload for the React frontend:

```bash
npm run electron:dev
```

## Build Windows Installer

```bash
npm run electron:build:win
```

Output: `dist-electron/Blue Chip Stock Tracker Setup.exe`

## Project Structure

```
stocklist/
├── electron/
│   ├── main.cjs          # Electron main process (window + Python spawn)
│   └── preload.cjs       # Context bridge
├── python/
│   ├── server.py         # FastAPI + yfinance backend (port 8765)
│   └── requirements.txt
├── src/
│   ├── components/
│   │   ├── StockList.tsx       # Left panel: stock list + search
│   │   ├── StockCard.tsx       # Individual stock row
│   │   ├── StockChart.tsx      # Chart panel with header
│   │   ├── ChartPane.tsx       # TradingView chart implementation
│   │   ├── TimeframeSelector.tsx
│   │   └── IndicatorPanel.tsx
│   ├── hooks/
│   │   └── useStockData.ts     # API hooks
│   └── types/
│       └── index.ts
└── start.bat             # Windows quick launch script
```

## Data Source

All market data is fetched from **Yahoo Finance** via the `yfinance` Python library. Data is for informational purposes only and may be delayed.
