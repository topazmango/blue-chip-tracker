# AGENTS.md — Blue Chip Stock Tracker

Guidance for agentic coding assistants operating in this repository.

---

## Project Overview

A TradingView-style stock terminal for S&P 500 top-20 blue chips, built as both an **Electron desktop app** and a **Vercel-hosted web app**, sharing one React codebase. The Python FastAPI backend runs locally (Electron) or on Railway (web).

**Stack:**
- Frontend: React 19, TypeScript 5.9, Vite 7, Tailwind CSS v4
- Charts: TradingView `lightweight-charts` v5
- Icons: `lucide-react`
- Desktop: Electron 40 (frameless, custom titlebar, IPC window controls)
- Backend: Python 3.12, FastAPI + uvicorn + yfinance + pandas + pytz (port 8765)
- Deploy: Vercel (frontend), Railway via Docker (backend)

---

## Build, Lint & Dev Commands

### Frontend (Node)

```bash
# Install dependencies
npm install

# Type-check + production build (outputs to dist/)
npm run build

# Lint (ESLint with TypeScript + React hooks rules)
npm run lint

# Vite dev server only (http://localhost:5173)
npm run dev

# Electron dev mode (Vite + Electron with hot reload)
npm run electron:dev

# Build Electron installer (Windows NSIS)
npm run electron:build:win
```

### Run Electron (WSL2 / Linux)

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
export LD_LIBRARY_PATH="/home/jacob/.local/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
export DISPLAY=:0 && export WAYLAND_DISPLAY=wayland-0
npx electron . --no-sandbox --disable-gpu
```

### Python Backend

```bash
# Install deps (once)
pip install -r requirements.txt

# Run locally (port 8765)
python3 python/server.py

# Verify
curl http://localhost:8765/health
```

### Testing

There is no automated test suite. Verification is manual:

```bash
# Type-check only (fastest sanity check)
npx tsc -b --noEmit

# Lint only
npm run lint

# Verify API endpoints after changes to server.py
curl http://localhost:8765/health
curl http://localhost:8765/stocks
curl "http://localhost:8765/history/AAPL?timeframe=1M"
curl http://localhost:8765/quotes
```

---

## Repository Layout

```
stocklist/
├── electron/
│   ├── main.cjs          # Electron main process: window, Python spawn, IPC
│   └── preload.cjs       # Context bridge (exposes window.electronAPI)
├── python/
│   ├── server.py         # FastAPI backend — all endpoints
│   └── requirements.txt  # Python deps
├── src/
│   ├── App.tsx           # Root component, layout, state wiring
│   ├── main.tsx          # React DOM entry point
│   ├── index.css         # Tailwind import + CSS custom properties
│   ├── App.css           # Unused Vite scaffold (can ignore)
│   ├── components/
│   │   ├── TitleBar.tsx         # Custom titlebar (returns null on web)
│   │   ├── StockList.tsx        # Left watchlist panel
│   │   ├── StockCard.tsx        # Single watchlist row
│   │   ├── StockChart.tsx       # Chart panel header + layout
│   │   ├── ChartPane.tsx        # TradingView chart, indicators, live updates
│   │   ├── TimeframeSelector.tsx
│   │   ├── IndicatorPanel.tsx
│   │   ├── DrawingToolbar.tsx   # Left icon toolbar (drawing tools)
│   │   └── ChartToolbar.tsx     # Right icon toolbar (chart tools)
│   ├── hooks/
│   │   └── useStockData.ts      # All data-fetching hooks
│   └── types/
│       └── index.ts             # All shared TypeScript types
├── Dockerfile            # Python-only image for Railway
├── requirements.txt      # Root copy of python/requirements.txt (used by Docker)
├── vercel.json           # SPA rewrite + security headers
├── railway.toml          # Railway fallback config (Dockerfile takes precedence)
├── vite.config.ts
├── tsconfig.app.json     # Strict TS config for src/
├── tsconfig.node.json    # TS config for vite.config.ts
└── eslint.config.js
```

---

## API Endpoints (`python/server.py`)

| Endpoint | Description |
|---|---|
| `GET /health` | Health check, returns UTC timestamp |
| `GET /stocks` | All 20 stocks with daily price/change/volume |
| `GET /history/{ticker}?timeframe=` | OHLCV candle history (1D/1W/1M/3M/6M/1Y/5Y/ALL) |
| `GET /quotes` | Batch real-time 1-min quotes + pre/post market (polled every 5s) |

Timeframe map: `1D→5m`, `1W→30m`, `1M/3M/6M/1Y→1d`, `5Y→1wk`, `ALL→1mo`.

---

## TypeScript Style Guidelines

### Compiler Settings (tsconfig.app.json)
- `strict: true` — all strict checks enabled; never use `any` without justification
- `noUnusedLocals: true`, `noUnusedParameters: true` — remove dead code, don't leave unused params
- `verbatimModuleSyntax: true` — use `import type` for type-only imports
- `noEmit: true` — Vite handles emit; `tsc` is type-check only
- Target: `ES2022`, JSX: `react-jsx`

### Imports
```ts
// Type-only imports must use `import type`
import type { StockInfo, Candle } from '../types';

// Values/components use regular import
import { useState, useEffect, useCallback, useRef } from 'react';
import StockCard from './StockCard';
```

- Order: external libraries → internal absolute → relative
- No barrel `index.ts` re-exports needed (project is small)
- Tailwind CSS v4 is configured via `@import "tailwindcss"` in `index.css` — **no `tailwind.config.js`**

### Naming Conventions
- **Components**: PascalCase files and function names (`StockCard.tsx`, `export default function StockCard`)
- **Hooks**: camelCase prefixed with `use` (`useStockData.ts`, `useRealtimeQuotes`)
- **Types/Interfaces**: PascalCase (`StockInfo`, `QuoteData`, `Candle`)
- **Type aliases**: PascalCase (`type Timeframe = '1D' | ...`)
- **Constants**: SCREAMING_SNAKE_CASE for module-level consts (`API_BASE`, `TIMEFRAME_MAP`, `DEFAULT_STOCKS`)
- **CSS custom properties**: `--tv-*` prefix for TradingView theme tokens

### Types
- Prefer `interface` for object shapes that could be extended; `type` for unions and aliases
- Always type function return values for exported functions
- Use `null` (not `undefined`) for intentionally absent values — API returns `null` for missing ext data
- Optional fields: `field?: T` (may be absent) vs `field: T | null` (present but explicitly null)

### Formatting
- 2-space indentation throughout
- Single quotes for strings in TypeScript/JavaScript
- Semicolons required
- Arrow functions preferred for callbacks and hooks
- No trailing commas required (but acceptable)

---

## React Patterns

- **Functional components only** — no class components
- **Default exports** for all components; named exports for hooks
- **State shape**: keep related state in a single object when it changes together; otherwise separate `useState` calls
- **Effects**: always return a cleanup function when setting up timers or subscriptions
- **AbortController**: use for fetch calls in effects that may re-fire (see `useStockHistory`)
- **Refs for mutable values that shouldn't re-render**: `useRef` for timers, stale-closure escapes

```ts
// Pattern used in useRealtimeQuotes — keep latest prop in ref to avoid stale closures
const baseRef = useRef(baseStocks);
useEffect(() => { baseRef.current = baseStocks; }, [baseStocks]);
```

---

## Web vs Electron Compatibility

- **`window.electronAPI`**: always check before using — components must be safe in both environments
- **`TitleBar`**: returns `null` on web (no `window.electronAPI`)
- **API base URL**: determined once at module load:
  ```ts
  const API_BASE =
    typeof window !== 'undefined' && (window as any).electronAPI
      ? 'http://localhost:8765'
      : (import.meta.env.VITE_API_URL ?? 'http://localhost:8765');
  ```
- **`isDev` in Electron main**: must use `process.env.ELECTRON_DEV === '1'` — never rely on other heuristics
- **Vite base**: set to `'/'` in `vite.config.ts` for Vercel; Electron loads from `dist/index.html` directly

---

## Python Style Guidelines

- Python 3.12+; type hints required for all function signatures
- `Optional[T]` from `typing` for nullable fields
- Import third-party deps inside try/except at module top with clear error message + `sys.exit(1)`
- `logging` via `logger = logging.getLogger(__name__)` — use `logger.error` / `logger.warning`, not `print`
- Always `round(float(...), 2)` for prices before returning JSON; guard volume with `int(...)` + `isna` check
- Raise `HTTPException` (not bare exceptions) in FastAPI route handlers
- `$PORT` env var: `port = int(os.environ.get("PORT", 8765))`; bind `0.0.0.0` when `PORT` is set (required for Railway)

---

## Error Handling

- **Frontend**: catch fetch errors, set `error: string | null` state, display gracefully — never let errors crash the render tree
- **Backend**: per-ticker try/except in batch loops — one bad ticker must not fail the whole response; log warnings and append zero-filled fallback
- **Electron Python spawn**: `waitForServer` retries 30×1s before showing the window; log but don't crash if server is slow

---

## Deployment Notes

- **Vercel**: SPA rewrite in `vercel.json`. Set `VITE_API_URL` environment variable to the Railway URL. Run `npx vercel --prod` to redeploy.
- **Railway**: Uses `Dockerfile` (Python 3.12-slim) — this overrides `railway.toml`'s nixpacks config. The Dockerfile is the source of truth for the production Python build.
- **GitHub**: push to `main` at `https://github.com/topazmango/blue-chip-tracker`. Railway auto-deploys on push if configured; Vercel also auto-deploys.
- **Both `python/requirements.txt` and root `requirements.txt` must be kept in sync** — the Dockerfile copies the root one; Vercel uses the one it finds during Python detection.
