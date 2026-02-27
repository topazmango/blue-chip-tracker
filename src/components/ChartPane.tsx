import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  BarSeries,
  HistogramSeries,
  LineSeries,
  AreaSeries,
  BaselineSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts';
import type {
  IChartApi,
  ISeriesApi,
  IPriceLine,
  UTCTimestamp,
  SeriesType,
} from 'lightweight-charts';
import type { Candle, IndicatorSettings, Timeframe, ChartType, DrawingTool, ChartActions, EarningDate, StockMeta, PriceAlert } from '../types';

interface Props {
  candles: Candle[];
  indicators: IndicatorSettings;
  timeframe: Timeframe;
  chartType: ChartType;
  activeTool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
  liveCandle?: Candle | null;
  ticker: string;
  spyCandles: { time: number; close: number }[];
  earningsDates: EarningDate[];
  meta: StockMeta | null;
  alerts: PriceAlert[];
  onAlertAdd: (price: number) => void;
  onAlertTriggered: (id: string) => void;
  /** When true, extended-hours candles are present and should be styled differently */
  prepost: boolean;
}

// ── Drawing overlay types ─────────────────────────────────────────────────────

interface ChartPoint {
  time: number;
  price: number;
}

type Drawing =
  | { kind: 'trendline';  p1: ChartPoint; p2: ChartPoint }
  | { kind: 'hline';      price: number }
  | { kind: 'rectangle';  p1: ChartPoint; p2: ChartPoint }
  | { kind: 'ellipse';    p1: ChartPoint; p2: ChartPoint }
  | { kind: 'text';       p: ChartPoint; text: string }
  | { kind: 'freehand';   points: ChartPoint[] }
  | { kind: 'fibonacci';  p1: ChartPoint; p2: ChartPoint };

// ── Indicator helpers ────────────────────────────────────────────────────────

function calcSMA(candles: Candle[], period: number): { time: UTCTimestamp; value: number }[] {
  const result: { time: UTCTimestamp; value: number }[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1);
    const avg = slice.reduce((s, c) => s + c.close, 0) / period;
    result.push({ time: candles[i].time as UTCTimestamp, value: parseFloat(avg.toFixed(2)) });
  }
  return result;
}

function calcBollinger(candles: Candle[], period = 20, mult = 2) {
  const mid: { time: UTCTimestamp; value: number }[] = [];
  const upper: { time: UTCTimestamp; value: number }[] = [];
  const lower: { time: UTCTimestamp; value: number }[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1).map((c) => c.close);
    const avg = slice.reduce((s, v) => s + v, 0) / period;
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - avg) ** 2, 0) / period);
    const t = candles[i].time as UTCTimestamp;
    mid.push({ time: t, value: parseFloat(avg.toFixed(2)) });
    upper.push({ time: t, value: parseFloat((avg + mult * std).toFixed(2)) });
    lower.push({ time: t, value: parseFloat((avg - mult * std).toFixed(2)) });
  }
  return { mid, upper, lower };
}

function calcRSI(candles: Candle[], period = 14): { time: UTCTimestamp; value: number }[] {
  const result: { time: UTCTimestamp; value: number }[] = [];
  if (candles.length < period + 1) return result;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d > 0) gains += d; else losses -= d;
  }
  let ag = gains / period, al = losses / period;
  for (let i = period; i < candles.length; i++) {
    if (i > period) {
      const d = candles[i].close - candles[i - 1].close;
      ag = (ag * (period - 1) + Math.max(d, 0)) / period;
      al = (al * (period - 1) + Math.max(-d, 0)) / period;
    }
    result.push({ time: candles[i].time as UTCTimestamp, value: parseFloat((100 - 100 / (1 + (al === 0 ? 100 : ag / al))).toFixed(2)) });
  }
  return result;
}

function calcEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  if (values.length === 0) return result;
  result[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

function calcMACD(candles: Candle[], fast = 12, slow = 26, signal = 9) {
  const closes = candles.map((c) => c.close);
  const ema12 = calcEMA(closes, fast);
  const ema26 = calcEMA(closes, slow);
  const macdLine: { time: UTCTimestamp; value: number }[] = [];
  const signalData: { time: UTCTimestamp; value: number }[] = [];
  const hist: { time: UTCTimestamp; value: number; color: string }[] = [];

  const macdValues: number[] = [];
  for (let i = slow - 1; i < candles.length; i++) {
    macdValues.push(ema12[i] - ema26[i]);
  }
  const sigValues = calcEMA(macdValues, signal);

  const offset = slow - 1;
  for (let i = 0; i < macdValues.length; i++) {
    const t = candles[offset + i].time as UTCTimestamp;
    const mv = parseFloat(macdValues[i].toFixed(4));
    const sv = parseFloat(sigValues[i].toFixed(4));
    const hv = parseFloat((mv - sv).toFixed(4));
    macdLine.push({ time: t, value: mv });
    signalData.push({ time: t, value: sv });
    hist.push({ time: t, value: hv, color: hv >= 0 ? '#26a69a80' : '#ef535080' });
  }
  return { macdLine, signalData, hist };
}

// ── Support & Resistance ─────────────────────────────────────────────────────

function detectSR(candles: Candle[], lookback = 3): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows:  number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let isHigh = true, isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].high >= c.high || candles[i + j].high >= c.high) isHigh = false;
      if (candles[i - j].low  <= c.low  || candles[i + j].low  <= c.low)  isLow  = false;
    }
    if (isHigh) highs.push(c.high);
    if (isLow)  lows.push(c.low);
  }
  // Cluster nearby levels (within 0.3% of each other) to avoid clutter
  function cluster(levels: number[]): number[] {
    const sorted = [...levels].sort((a, b) => a - b);
    const out: number[] = [];
    for (const lvl of sorted) {
      const last = out[out.length - 1];
      if (last === undefined || Math.abs(lvl - last) / last > 0.003) {
        out.push(lvl);
      }
    }
    return out;
  }
  return { highs: cluster(highs), lows: cluster(lows) };
}

// ── Volume Profile (VPVR) ────────────────────────────────────────────────────

interface VPBucket {
  price: number;
  volume: number;
  bullVol: number;
}

function buildVolumeProfile(candles: Candle[], bins = 40): VPBucket[] {
  if (candles.length === 0) return [];
  const priceMin = Math.min(...candles.map((c) => c.low));
  const priceMax = Math.max(...candles.map((c) => c.high));
  const binSize  = (priceMax - priceMin) / bins;
  const buckets: VPBucket[] = Array.from({ length: bins }, (_, i) => ({
    price:   priceMin + (i + 0.5) * binSize,
    volume:  0,
    bullVol: 0,
  }));
  for (const c of candles) {
    const idx = Math.min(Math.floor((c.close - priceMin) / binSize), bins - 1);
    if (idx >= 0) {
      buckets[idx].volume  += c.volume;
      if (c.close >= c.open) buckets[idx].bullVol += c.volume;
    }
  }
  return buckets;
}

// ── Timeframe visible-range helpers ─────────────────────────────────────────

function getVisibleFromTime(timeframe: Timeframe): number {
  const now = Date.now() / 1000;
  switch (timeframe) {
    case '1D':  return now - 86400;
    case '1W':  return now - 7 * 86400;
    case '1M':  return now - 30 * 86400;
    case '3M':  return now - 91 * 86400;
    case '6M':  return now - 182 * 86400;
    case '1Y':  return now - 365 * 86400;
    case '5Y':  return now - 5 * 365 * 86400;
    case 'ALL': return 0;
  }
}

// ── Band highlighting helpers ────────────────────────────────────────────────

type PeriodUnit = 'year' | 'month' | 'week' | 'day' | 'hour';

function getPeriodUnit(timeframe: Timeframe): PeriodUnit {
  switch (timeframe) {
    case '1D': return 'hour';
    case '1W': return 'day';
    case '1M': return 'week';
    case '3M':
    case '6M': return 'month';
    case '1Y':
    case '5Y':
    case 'ALL': return 'year';
  }
}

function getPeriodKey(ts: number, unit: PeriodUnit): number {
  const d = new Date(ts * 1000);
  switch (unit) {
    case 'year':  return d.getUTCFullYear();
    case 'month': return d.getUTCFullYear() * 12 + d.getUTCMonth();
    case 'week': {
      const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);
      return d.getUTCFullYear() * 54 + week;
    }
    case 'day':  return Math.floor(ts / 86400);
    case 'hour': return Math.floor(ts / 3600);
  }
}

function buildBandData(candles: Candle[], unit: PeriodUnit): { time: UTCTimestamp; value: number; color: string }[] {
  const EVEN = 'rgba(255,255,255,0.03)';
  const ODD  = 'rgba(255,255,255,0.00)';
  return candles.map((c) => ({
    time: c.time as UTCTimestamp,
    value: 1,
    color: getPeriodKey(c.time, unit) % 2 === 0 ? EVEN : ODD,
  }));
}

function getPeriodBoundaryTimes(candles: Candle[], unit: PeriodUnit): UTCTimestamp[] {
  const boundaries: UTCTimestamp[] = [];
  let lastKey: number | null = null;
  for (const c of candles) {
    const key = getPeriodKey(c.time, unit);
    if (lastKey !== null && key !== lastKey) boundaries.push(c.time as UTCTimestamp);
    lastKey = key;
  }
  return boundaries;
}

// ── Chart options factory ────────────────────────────────────────────────────

function makeChartOpts(handleScroll?: object) {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: '#131722' },
      textColor: '#787b86',
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: '#1e222d' },
      horzLines: { color: '#1e222d' },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: '#758696', width: 1 as const, style: LineStyle.Dashed, labelBackgroundColor: '#363a45' },
      horzLine: { color: '#758696', width: 1 as const, style: LineStyle.Dashed, labelBackgroundColor: '#363a45' },
    },
    rightPriceScale: { borderColor: '#2a2e39' },
    timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false },
    handleScale: { mouseWheel: true, pinch: true },
    handleScroll: handleScroll ?? { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    attributionLogo: false,
  };
}

// ── Projection helpers ────────────────────────────────────────────────────────

function projectPoint(
  cp: ChartPoint,
  chart: IChartApi,
  mainSeries: ISeriesApi<SeriesType>,
): { x: number; y: number } | null {
  const x = chart.timeScale().timeToCoordinate(cp.time as UTCTimestamp);
  const y = (mainSeries as ISeriesApi<'Candlestick'>).priceToCoordinate(cp.price);
  if (x === null || y === null) return null;
  return { x, y };
}

// ── Fibonacci levels ──────────────────────────────────────────────────────────

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
const FIB_COLORS = ['#94a3b8', '#f59e0b', '#f97316', '#ef5350', '#26a69a', '#3b82f6', '#94a3b8'];

// ── Drawing canvas helpers ────────────────────────────────────────────────────

interface DrawAllExtras {
  vpBuckets: VPBucket[];
  earningsDates: EarningDate[];
  alerts: PriceAlert[];
}

function drawAll(
  ctx: CanvasRenderingContext2D,
  drawings: Drawing[],
  draft: Drawing | null,
  w: number,
  h: number,
  chart: IChartApi,
  mainSeries: ISeriesApi<SeriesType>,
  extras: DrawAllExtras,
) {
  ctx.clearRect(0, 0, w, h);
  const all = draft ? [...drawings, draft] : drawings;

  // ── Volume Profile (VPVR) ───────────────────────────────────────────────────
  const { vpBuckets } = extras;
  if (vpBuckets.length > 0) {
    const maxVol = Math.max(...vpBuckets.map((b) => b.volume));
    const maxBarW = Math.min(w * 0.14, 90);
    for (const b of vpBuckets) {
      const y = (mainSeries as ISeriesApi<'Candlestick'>).priceToCoordinate(b.price);
      if (y === null) continue;
      const barW = (b.volume / maxVol) * maxBarW;
      const barH = Math.max(1.5, h / vpBuckets.length * 0.85);
      const bullRatio = b.volume > 0 ? b.bullVol / b.volume : 0.5;
      // Bull portion (green)
      ctx.fillStyle = 'rgba(38,166,154,0.35)';
      ctx.fillRect(w - barW, y - barH / 2, barW * bullRatio, barH);
      // Bear portion (red)
      ctx.fillStyle = 'rgba(239,83,80,0.35)';
      ctx.fillRect(w - barW + barW * bullRatio, y - barH / 2, barW * (1 - bullRatio), barH);
    }
  }

  // ── Earnings date vertical lines ────────────────────────────────────────────
  for (const ed of extras.earningsDates) {
    const x = chart.timeScale().timeToCoordinate(ed.time as UTCTimestamp);
    if (x === null || x < 0 || x > w) continue;
    ctx.strokeStyle = ed.is_upcoming ? '#f59e0b' : '#3b82f6';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.setLineDash([]);
    // Label
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.fillStyle = ed.is_upcoming ? '#f59e0b' : '#3b82f680';
    ctx.fillText('E', x + 3, 12);
  }

  // ── Alert lines ─────────────────────────────────────────────────────────────
  for (const al of extras.alerts) {
    const y = (mainSeries as ISeriesApi<'Candlestick'>).priceToCoordinate(al.price);
    if (y === null) continue;
    ctx.strokeStyle = al.triggered ? '#6b7280' : '#f59e0b';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillStyle = al.triggered ? '#6b7280' : '#f59e0b';
    ctx.fillText(`\u{1F514} ${al.price.toFixed(2)}`, 6, y - 3);
  }

  // ── User drawings ───────────────────────────────────────────────────────────
  for (const d of all) {
    ctx.strokeStyle = '#f59e0b';
    ctx.fillStyle   = 'rgba(245,158,11,0.12)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([]);

    if (d.kind === 'trendline') {
      const px1 = projectPoint(d.p1, chart, mainSeries);
      const px2 = projectPoint(d.p2, chart, mainSeries);
      const x1 = px1?.x ?? (d.p1.time < d.p2.time ? -10 : w + 10);
      const y1 = px1?.y ?? (px2 ? px2.y : 0);
      const x2 = px2?.x ?? (d.p2.time > d.p1.time ? w + 10 : -10);
      const y2 = px2?.y ?? (px1 ? px1.y : 0);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      const dx = x2 - x1;
      const dy = y2 - y1;
      if (Math.abs(dx) > 0.001) {
        const tRight = (w - x1) / dx;
        const tLeft  = -x1 / dx;
        const tExt   = dx > 0 ? tRight : tLeft;
        ctx.strokeStyle = 'rgba(245,158,11,0.3)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x1 + tExt * dx, y1 + tExt * dy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (d.kind === 'hline') {
      const y = (mainSeries as ISeriesApi<'Candlestick'>).priceToCoordinate(d.price);
      if (y === null) continue;
      ctx.strokeStyle = '#ef5350';
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (d.kind === 'rectangle') {
      const px1 = projectPoint(d.p1, chart, mainSeries);
      const px2 = projectPoint(d.p2, chart, mainSeries);
      if (!px1 || !px2) continue;
      const x  = Math.min(px1.x, px2.x);
      const y  = Math.min(px1.y, px2.y);
      const rw = Math.abs(px2.x - px1.x);
      const rh = Math.abs(px2.y - px1.y);
      ctx.fillRect(x, y, rw, rh);
      ctx.strokeRect(x, y, rw, rh);
    } else if (d.kind === 'ellipse') {
      const px1 = projectPoint(d.p1, chart, mainSeries);
      const px2 = projectPoint(d.p2, chart, mainSeries);
      if (!px1 || !px2) continue;
      const cx = (px1.x + px2.x) / 2;
      const cy = (px1.y + px2.y) / 2;
      const rx = Math.abs(px2.x - px1.x) / 2;
      const ry = Math.abs(px2.y - px1.y) / 2;
      if (rx < 0.5 || ry < 0.5) continue;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (d.kind === 'text') {
      const px = projectPoint(d.p, chart, mainSeries);
      if (!px) continue;
      ctx.font = '13px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#f59e0b';
      ctx.fillText(d.text, px.x, px.y);
    } else if (d.kind === 'freehand') {
      if (d.points.length < 2) continue;
      const projected = d.points.map((pt) => projectPoint(pt, chart, mainSeries));
      const first = projected[0];
      if (!first) continue;
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (const px of projected.slice(1)) {
        if (px) ctx.lineTo(px.x, px.y);
      }
      ctx.stroke();
    } else if (d.kind === 'fibonacci') {
      const px1 = projectPoint(d.p1, chart, mainSeries);
      const px2 = projectPoint(d.p2, chart, mainSeries);
      const x1 = px1?.x ?? 0;
      const x2 = px2?.x ?? w;
      const priceRange = d.p1.price - d.p2.price;
      FIB_LEVELS.forEach((lvl, idx) => {
        const fibPrice = d.p2.price + priceRange * lvl;
        const y = (mainSeries as ISeriesApi<'Candlestick'>).priceToCoordinate(fibPrice);
        if (y === null) return;
        ctx.strokeStyle = FIB_COLORS[idx];
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.min(x1, x2), y);
        ctx.lineTo(Math.max(x1, x2), y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.fillStyle = FIB_COLORS[idx];
        ctx.fillText(`${(lvl * 100).toFixed(1)}%  ${fibPrice.toFixed(2)}`, Math.min(x1, x2) + 4, y - 3);
      });
      // Vertical connecting lines at each end
      if (px1 && px2) {
        const yTop    = Math.min(px1.y, px2.y);
        const yBottom = Math.max(px1.y, px2.y);
        ctx.strokeStyle = 'rgba(148,163,184,0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(px1.x, yTop); ctx.lineTo(px1.x, yBottom); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px2.x, yTop); ctx.lineTo(px2.x, yBottom); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
}

// ── Component ────────────────────────────────────────────────────────────────

const ChartPane = forwardRef<ChartActions, Props>(function ChartPane(
  {
    candles, indicators, timeframe, chartType, activeTool, onToolChange, liveCandle,
    spyCandles, earningsDates, meta, alerts, onAlertAdd, onAlertTriggered, prepost,
  },
  ref,
) {
  const containerRef     = useRef<HTMLDivElement>(null);
  const rsiContainerRef  = useRef<HTMLDivElement>(null);
  const macdContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const chartRef         = useRef<IChartApi | null>(null);
  const rsiChartRef      = useRef<IChartApi | null>(null);
  const macdChartRef     = useRef<IChartApi | null>(null);
  const seriesRefs       = useRef<{ [key: string]: ISeriesApi<SeriesType> }>({});
  const priceLineRefs    = useRef<{ w52h?: IPriceLine; w52l?: IPriceLine }>({});
  const candlesRef       = useRef<Candle[]>(candles);
  useEffect(() => { candlesRef.current = candles; }, [candles]);

  // Keep latest props in refs for use inside canvas callbacks
  const alertsRef          = useRef<PriceAlert[]>(alerts);
  const earningsRef        = useRef<EarningDate[]>(earningsDates);
  const vpBucketsRef       = useRef<VPBucket[]>([]);
  const onAlertTriggeredRef = useRef(onAlertTriggered);
  useEffect(() => { alertsRef.current = alerts; },              [alerts]);
  useEffect(() => { earningsRef.current = earningsDates; },    [earningsDates]);
  useEffect(() => { onAlertTriggeredRef.current = onAlertTriggered; }, [onAlertTriggered]);

  // Drawing state
  const drawingsRef   = useRef<Drawing[]>([]);
  const draftRef      = useRef<Drawing | null>(null);
  const isDrawing     = useRef(false);
  const activeToolRef = useRef<DrawingTool>(activeTool);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

  // Text input overlay
  const [textInput, setTextInput] = useState<{ x: number; y: number; chartPt: ChartPoint } | null>(null);
  const [textValue, setTextValue] = useState('');
  const textInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textInput) textInputRef.current?.focus();
  }, [textInput]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const parent = container.parentElement;
    if (!parent) return;
    canvas.width  = parent.clientWidth;
    canvas.height = container.clientHeight || parent.clientHeight;
  }, []);

  const destroyCharts = useCallback(() => {
    try { chartRef.current?.remove(); }     catch { /* ignore */ }
    try { rsiChartRef.current?.remove(); }  catch { /* ignore */ }
    try { macdChartRef.current?.remove(); } catch { /* ignore */ }
    chartRef.current     = null;
    rsiChartRef.current  = null;
    macdChartRef.current = null;
    seriesRefs.current   = {};
    priceLineRefs.current = {};
  }, []);

  // ── Canvas redraw ──────────────────────────────────────────────────────────
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const chart  = chartRef.current;
    const mainS  = seriesRefs.current['candle'];
    if (!canvas || !chart || !mainS) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Check for triggered alerts
    const livePrice = (mainS as ISeriesApi<'Candlestick'>).coordinateToPrice(0);
    for (const al of alertsRef.current) {
      if (!al.triggered && livePrice !== null) {
        // We check against last candle close instead
      }
    }

    drawAll(ctx, drawingsRef.current, draftRef.current, canvas.width, canvas.height, chart, mainS, {
      vpBuckets:    vpBucketsRef.current,
      earningsDates: earningsRef.current,
      alerts:       alertsRef.current,
    });
  }, []);

  // ── Check alerts against live price ───────────────────────────────────────
  useEffect(() => {
    if (candles.length === 0) return;
    const lastPrice = candles[candles.length - 1].close;
    for (const al of alerts) {
      if (!al.triggered) {
        // triggered if price is within 0.05% of alert (since we only have candle resolution)
        if (Math.abs(lastPrice - al.price) / al.price < 0.0005) {
          onAlertTriggered(al.id);
        }
      }
    }
  }, [candles, alerts, onAlertTriggered]);

  // ── Imperative actions ─────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    zoomIn() {
      const chart = chartRef.current;
      if (!chart) return;
      const ts = chart.timeScale();
      const range = ts.getVisibleLogicalRange();
      if (!range) return;
      const mid = (range.from + range.to) / 2;
      const half = (range.to - range.from) / 4;
      ts.setVisibleLogicalRange({ from: mid - half, to: mid + half });
    },
    zoomOut() {
      const chart = chartRef.current;
      if (!chart) return;
      const ts = chart.timeScale();
      const range = ts.getVisibleLogicalRange();
      if (!range) return;
      const mid = (range.from + range.to) / 2;
      const half = (range.to - range.from);
      ts.setVisibleLogicalRange({ from: mid - half, to: mid + half });
    },
    fitContent() {
      chartRef.current?.timeScale().fitContent();
      rsiChartRef.current?.timeScale().fitContent();
      macdChartRef.current?.timeScale().fitContent();
    },
    reset() {
      drawingsRef.current = [];
      draftRef.current    = null;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      const fromTime = getVisibleFromTime(timeframe);
      const cs = candlesRef.current;
      if (cs.length === 0) return;
      const toTime = (cs[cs.length - 1].time + 3600) as UTCTimestamp;
      if (timeframe === 'ALL') {
        chartRef.current?.timeScale().fitContent();
        rsiChartRef.current?.timeScale().fitContent();
        macdChartRef.current?.timeScale().fitContent();
      } else {
        chartRef.current?.timeScale().setVisibleRange({ from: fromTime as UTCTimestamp, to: toTime });
        rsiChartRef.current?.timeScale().setVisibleRange({ from: fromTime as UTCTimestamp, to: toTime });
        macdChartRef.current?.timeScale().setVisibleRange({ from: fromTime as UTCTimestamp, to: toTime });
      }
    },
    screenshot() {
      const chart = chartRef.current;
      if (!chart) return;
      const imageData = chart.takeScreenshot();
      const link = document.createElement('a');
      link.download = `chart-${Date.now()}.png`;
      link.href = imageData.toDataURL('image/png');
      link.click();
    },
  }), [timeframe]);

  // ── Main chart build ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    destroyCharts();

    const showRSI  = indicators.rsi;
    const showMACD = indicators.macd;
    const subCount = (showRSI ? 1 : 0) + (showMACD ? 1 : 0);

    const parentEl = containerRef.current.parentElement;
    if (!parentEl) return;
    const totalH = parentEl.clientHeight;

    // Height split: main 60% if 2 sub-panes, 75% if 1, 100% if none
    const mainRatio  = subCount === 2 ? 0.58 : subCount === 1 ? 0.74 : 1.0;
    const subRatio   = subCount === 2 ? 0.19 : subCount === 1 ? 0.25 : 0;
    const mainH      = Math.floor(totalH * mainRatio);
    const subH       = subCount > 0 ? Math.floor(totalH * subRatio) : 0;

    containerRef.current.style.height = `${mainH}px`;
    if (rsiContainerRef.current)  rsiContainerRef.current.style.height  = showRSI  ? `${subH}px` : '0px';
    if (macdContainerRef.current) macdContainerRef.current.style.height = showMACD ? `${subH}px` : '0px';

    const chart = createChart(containerRef.current, makeChartOpts());
    chartRef.current = chart;

    // ── Band shading & dividers ──────────────────────────────────────────────
    const unit = getPeriodUnit(timeframe);
    const bandSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' }, priceScaleId: 'bands',
      lastValueVisible: false, priceLineVisible: false,
    });
    chart.priceScale('bands').applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
    bandSeries.setData(buildBandData(candles, unit));
    seriesRefs.current['bands'] = bandSeries;

    const boundaries = getPeriodBoundaryTimes(candles, unit);
    if (boundaries.length > 0) {
      const boundarySet = new Set(boundaries);
      const divSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' }, priceScaleId: 'bands',
        lastValueVisible: false, priceLineVisible: false,
      });
      divSeries.setData(candles.map((c) => ({
        time: c.time as UTCTimestamp, value: 1,
        color: boundarySet.has(c.time as UTCTimestamp) ? 'rgba(148,163,184,0.25)' : 'rgba(0,0,0,0)',
      })));
      seriesRefs.current['dividers'] = divSeries;
    }

    // ── Main price series ────────────────────────────────────────────────────
    let mainSeries: ISeriesApi<SeriesType>;

    // Helper: per-bar extended-hours color override
    const extColor    = 'rgba(120,123,134,0.55)';
    const extWick     = 'rgba(120,123,134,0.35)';
    const isExtCandle = (c: Candle) => prepost && c.session !== 'regular' && c.session !== undefined;

    if (chartType === 'bar') {
      const s = chart.addSeries(BarSeries, { upColor: '#26a69a', downColor: '#ef5350' });
      s.setData(candles.map((c) => {
        if (isExtCandle(c)) {
          return { time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close,
            color: extColor };
        }
        return { time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close };
      }));
      mainSeries = s;
    } else if (chartType === 'line') {
      const s = chart.addSeries(LineSeries, { color: '#2962ff', lineWidth: 2, priceLineVisible: true, lastValueVisible: true });
      s.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
      mainSeries = s;
    } else if (chartType === 'area') {
      const s = chart.addSeries(AreaSeries, {
        lineColor: '#2962ff', topColor: 'rgba(41,98,255,0.28)', bottomColor: 'rgba(41,98,255,0.02)',
        lineWidth: 2, priceLineVisible: true, lastValueVisible: true,
      });
      s.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
      mainSeries = s;
    } else if (chartType === 'baseline') {
      const baseValue = candles[0]?.close ?? 0;
      const s = chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: baseValue },
        topLineColor: '#26a69a', topFillColor1: 'rgba(38,166,154,0.28)', topFillColor2: 'rgba(38,166,154,0.02)',
        bottomLineColor: '#ef5350', bottomFillColor1: 'rgba(239,83,80,0.02)', bottomFillColor2: 'rgba(239,83,80,0.28)',
        lineWidth: 2,
      });
      s.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
      mainSeries = s;
    } else {
      const s = chart.addSeries(CandlestickSeries, {
        upColor: '#26a69a', downColor: '#ef5350',
        borderUpColor: '#26a69a', borderDownColor: '#ef5350',
        wickUpColor: '#26a69a', wickDownColor: '#ef5350',
      });
      s.setData(candles.map((c) => {
        if (isExtCandle(c)) {
          return {
            time: c.time as UTCTimestamp,
            open: c.open, high: c.high, low: c.low, close: c.close,
            color: extColor, borderColor: extColor, wickColor: extWick,
          };
        }
        return { time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close };
      }));
      mainSeries = s;
    }
    seriesRefs.current['candle'] = mainSeries;

    // ── Volume bars ──────────────────────────────────────────────────────────
    if (indicators.volume) {
      const volSeries = chart.addSeries(HistogramSeries, {
        color: '#26a69a', priceFormat: { type: 'volume' }, priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      volSeries.setData(candles.map((c) => ({
        time: c.time as UTCTimestamp, value: c.volume,
        color: c.close >= c.open ? '#26a69a40' : '#ef535040',
      })));
      seriesRefs.current['volume'] = volSeries;
    }

    // ── Volume Profile (precompute buckets) ──────────────────────────────────
    if (indicators.volumeProfile) {
      vpBucketsRef.current = buildVolumeProfile(candles);
    } else {
      vpBucketsRef.current = [];
    }

    // ── SMA lines ────────────────────────────────────────────────────────────
    for (const cfg of [
      { key: 'sma20',  period: 20,  color: '#f59e0b', enabled: indicators.sma20 },
      { key: 'sma50',  period: 50,  color: '#2962ff', enabled: indicators.sma50 },
      { key: 'sma200', period: 200, color: '#ab47bc', enabled: indicators.sma200 },
    ]) {
      if (!cfg.enabled) continue;
      const data = calcSMA(candles, cfg.period);
      if (!data.length) continue;
      const s = chart.addSeries(LineSeries, {
        color: cfg.color, lineWidth: 1,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      s.setData(data);
      seriesRefs.current[cfg.key] = s;
    }

    // ── Bollinger Bands ──────────────────────────────────────────────────────
    if (indicators.bollingerBands) {
      const bb = calcBollinger(candles);
      if (bb.mid.length > 0) {
        const bbOpts = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
        const bbMid   = chart.addSeries(LineSeries, { ...bbOpts, color: '#26a69a',   lineWidth: 1, lineStyle: LineStyle.Dashed });
        const bbUpper = chart.addSeries(LineSeries, { ...bbOpts, color: '#26a69a50', lineWidth: 1 });
        const bbLower = chart.addSeries(LineSeries, { ...bbOpts, color: '#26a69a50', lineWidth: 1 });
        bbMid.setData(bb.mid);
        bbUpper.setData(bb.upper);
        bbLower.setData(bb.lower);
        seriesRefs.current['bbMid']   = bbMid;
        seriesRefs.current['bbUpper'] = bbUpper;
        seriesRefs.current['bbLower'] = bbLower;
      }
    }

    // ── Support & Resistance price lines ─────────────────────────────────────
    if (indicators.supportResistance) {
      const { highs, lows } = detectSR(candles);
      const plOpts = { lineWidth: 1 as const, lineStyle: LineStyle.Dashed, axisLabelVisible: false };
      for (const price of highs.slice(-8)) {
        mainSeries.createPriceLine({ price, color: '#ef535060', ...plOpts, title: '' });
      }
      for (const price of lows.slice(-8)) {
        mainSeries.createPriceLine({ price, color: '#26a69a60', ...plOpts, title: '' });
      }
    }

    // ── 52-week High / Low ────────────────────────────────────────────────────
    // Handled in a separate effect below so meta loading doesn't trigger a full chart rebuild.

    // ── Relative Strength vs SPY ─────────────────────────────────────────────
    if (indicators.relativeStrength && spyCandles.length > 0) {
      const spyMap = new Map(spyCandles.map((s) => [s.time, s.close]));
      const rsData: { time: UTCTimestamp; value: number }[] = [];
      for (const c of candles) {
        const spyClose = spyMap.get(c.time);
        if (spyClose && spyClose > 0) {
          rsData.push({ time: c.time as UTCTimestamp, value: parseFloat(((c.close / spyClose) * 100).toFixed(4)) });
        }
      }
      if (rsData.length > 0) {
        const rsSeries = chart.addSeries(LineSeries, {
          color: '#84cc16', lineWidth: 1,
          priceScaleId: 'rs',
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
          title: 'RS',
        });
        chart.priceScale('rs').applyOptions({
          scaleMargins: { top: 0.78, bottom: 0 },
          visible: false,
        });
        rsSeries.setData(rsData);
        seriesRefs.current['rs'] = rsSeries;
      }
    }

    // ── Visible range ────────────────────────────────────────────────────────
    const fromTime = getVisibleFromTime(timeframe);
    const toTime   = (candles[candles.length - 1].time + 3600) as UTCTimestamp;
    if (timeframe === 'ALL') {
      chart.timeScale().fitContent();
    } else {
      chart.timeScale().setVisibleRange({ from: fromTime as UTCTimestamp, to: toTime });
    }

    // ── RSI sub-chart ────────────────────────────────────────────────────────
    if (showRSI && rsiContainerRef.current) {
      const rsiChart = createChart(rsiContainerRef.current, {
        ...makeChartOpts({ mouseWheel: true, pressedMouseMove: true }),
        rightPriceScale: { borderColor: '#2a2e39', scaleMargins: { top: 0.1, bottom: 0.1 } },
      });
      rsiChartRef.current = rsiChart;

      const rsiData = calcRSI(candles);
      if (rsiData.length > 0) {
        const rsiSeries = rsiChart.addSeries(LineSeries, {
          color: '#ef5350', lineWidth: 1,
          priceLineVisible: false, lastValueVisible: true, title: 'RSI(14)',
        });
        rsiSeries.setData(rsiData);
        const refOpts = { lineWidth: 1 as const, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
        const ob = rsiChart.addSeries(LineSeries, { ...refOpts, color: '#ef535030' });
        const os = rsiChart.addSeries(LineSeries, { ...refOpts, color: '#26a69a30' });
        ob.setData(rsiData.map((d) => ({ time: d.time, value: 70 })));
        os.setData(rsiData.map((d) => ({ time: d.time, value: 30 })));
        seriesRefs.current['rsi'] = rsiSeries;
      }

      if (timeframe === 'ALL') rsiChart.timeScale().fitContent();
      else rsiChart.timeScale().setVisibleRange({ from: fromTime as UTCTimestamp, to: toTime });

      chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r) rsiChart.timeScale().setVisibleLogicalRange(r); });
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r) chart.timeScale().setVisibleLogicalRange(r); });
    }

    // ── MACD sub-chart ───────────────────────────────────────────────────────
    if (showMACD && macdContainerRef.current) {
      const macdChart = createChart(macdContainerRef.current, {
        ...makeChartOpts({ mouseWheel: true, pressedMouseMove: true }),
        rightPriceScale: { borderColor: '#2a2e39', scaleMargins: { top: 0.1, bottom: 0.1 } },
      });
      macdChartRef.current = macdChart;

      const { macdLine, signalData, hist } = calcMACD(candles);
      if (macdLine.length > 0) {
        const macdSeries = macdChart.addSeries(LineSeries, {
          color: '#7c3aed', lineWidth: 1,
          priceLineVisible: false, lastValueVisible: true, title: 'MACD',
        });
        const signalSeries = macdChart.addSeries(LineSeries, {
          color: '#f97316', lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: 'Signal',
        });
        const histSeries = macdChart.addSeries(HistogramSeries, {
          priceScaleId: 'right',
          priceLineVisible: false, lastValueVisible: false,
        });
        macdSeries.setData(macdLine);
        signalSeries.setData(signalData);
        histSeries.setData(hist);
        seriesRefs.current['macdLine']   = macdSeries;
        seriesRefs.current['macdSignal'] = signalSeries;
        seriesRefs.current['macdHist']   = histSeries;
      }

      if (timeframe === 'ALL') macdChart.timeScale().fitContent();
      else macdChart.timeScale().setVisibleRange({ from: fromTime as UTCTimestamp, to: toTime });

      chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r) macdChart.timeScale().setVisibleLogicalRange(r); });
      macdChart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r) chart.timeScale().setVisibleLogicalRange(r); });

      // Also sync with RSI if both are shown
      if (showRSI && rsiChartRef.current) {
        const rc = rsiChartRef.current;
        macdChart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r) rc.timeScale().setVisibleLogicalRange(r); });
        rc.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r) macdChart.timeScale().setVisibleLogicalRange(r); });
      }
    }

    // ── Pan/zoom → redraw canvas ─────────────────────────────────────────────
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => { redrawCanvas(); });
    chart.subscribeCrosshairMove(() => { redrawCanvas(); });

    // ── Resize observer ──────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return;
      const parent = containerRef.current.parentElement;
      if (!parent) return;
      const newTotalH = parent.clientHeight;
      const newMainH  = Math.floor(newTotalH * mainRatio);
      const newSubH   = subCount > 0 ? Math.floor(newTotalH * subRatio) : 0;

      containerRef.current.style.height = `${newMainH}px`;
      chart.applyOptions({ height: newMainH });

      if (showRSI && rsiContainerRef.current && rsiChartRef.current) {
        rsiContainerRef.current.style.height = `${newSubH}px`;
        rsiChartRef.current.applyOptions({ height: newSubH });
      }
      if (showMACD && macdContainerRef.current && macdChartRef.current) {
        macdContainerRef.current.style.height = `${newSubH}px`;
        macdChartRef.current.applyOptions({ height: newSubH });
      }
      if (canvasRef.current) {
        canvasRef.current.width  = parent.clientWidth;
        canvasRef.current.height = newMainH;
        redrawCanvas();
      }
    });
    ro.observe(parentEl);

    return () => { ro.disconnect(); destroyCharts(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, indicators, timeframe, chartType, spyCandles, prepost, destroyCharts]);

  // ── 52-week Hi/Lo price lines ─────────────────────────────────────────────
  // Handled separately so meta loading after a ticker switch doesn't trigger a full chart rebuild.
  useEffect(() => {
    const mainS = seriesRefs.current['candle'];

    // Remove existing 52W lines before (re-)adding to avoid duplicates
    if (priceLineRefs.current.w52h) {
      try { (mainS as ISeriesApi<'Candlestick'> | undefined)?.removePriceLine(priceLineRefs.current.w52h); } catch { /* ignore */ }
      priceLineRefs.current.w52h = undefined;
    }
    if (priceLineRefs.current.w52l) {
      try { (mainS as ISeriesApi<'Candlestick'> | undefined)?.removePriceLine(priceLineRefs.current.w52l); } catch { /* ignore */ }
      priceLineRefs.current.w52l = undefined;
    }

    if (!mainS || !indicators.week52HighLow || !meta) return;
    if (meta.week52_high != null) {
      priceLineRefs.current.w52h = (mainS as ISeriesApi<'Candlestick'>).createPriceLine({
        price: meta.week52_high, color: '#26a69a',
        lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '52W H',
      });
    }
    if (meta.week52_low != null) {
      priceLineRefs.current.w52l = (mainS as ISeriesApi<'Candlestick'>).createPriceLine({
        price: meta.week52_low, color: '#ef5350',
        lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '52W L',
      });
    }
  }, [meta, indicators.week52HighLow]);

  // ── Live candle update ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!liveCandle) return;
    const mainS = seriesRefs.current['candle'];
    const vol   = seriesRefs.current['volume'];
    if (mainS) {
      if (chartType === 'candlestick' || chartType === 'bar') {
        mainS.update({ time: liveCandle.time as UTCTimestamp, open: liveCandle.open, high: liveCandle.high, low: liveCandle.low, close: liveCandle.close });
      } else {
        mainS.update({ time: liveCandle.time as UTCTimestamp, value: liveCandle.close });
      }
    }
    if (vol) {
      vol.update({ time: liveCandle.time as UTCTimestamp, value: liveCandle.volume, color: liveCandle.close >= liveCandle.open ? '#26a69a40' : '#ef535040' });
    }
    // Check alerts against live price
    const livePrice = liveCandle.close;
    for (const al of alertsRef.current) {
      if (!al.triggered && Math.abs(livePrice - al.price) / al.price < 0.001) {
        onAlertTriggeredRef.current(al.id);
      }
    }
    redrawCanvas();
  }, [liveCandle, chartType, redrawCanvas]);

  // ── Redraw when alerts / earnings change ────────────────────────────────────
  useEffect(() => { redrawCanvas(); }, [alerts, earningsDates, redrawCanvas]);

  // ── Convert mouse event → chart-space ──────────────────────────────────────
  const eventToChartPoint = useCallback((e: React.MouseEvent<HTMLCanvasElement>): ChartPoint => {
    const canvas = canvasRef.current;
    const chart  = chartRef.current;
    const mainS  = seriesRefs.current['candle'];
    if (!canvas) return { time: 0, price: 0 };
    const rect   = canvas.getBoundingClientRect();
    const px     = e.clientX - rect.left;
    const py     = e.clientY - rect.top;

    let time  = 0;
    let price = 0;

    if (chart && mainS) {
      const t = chart.timeScale().coordinateToTime(px);
      if (t !== null) time = t as number;
      price = (mainS as ISeriesApi<'Candlestick'>).coordinateToPrice(py) ?? 0;
    }
    return { time, price };
  }, []);

  // ── Mouse handlers ────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const tool = activeToolRef.current;
    if (tool === 'cursor' || tool === 'crosshair') return;

    if (tool === 'text') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect   = canvas.getBoundingClientRect();
      const px     = e.clientX - rect.left;
      const py     = e.clientY - rect.top;
      const chartPt = eventToChartPoint(e);
      setTextInput({ x: px, y: py, chartPt });
      setTextValue('');
      return;
    }

    if (tool === 'alert') {
      const pt = eventToChartPoint(e);
      onAlertAdd(pt.price);
      return;
    }

    isDrawing.current = true;
    const pt = eventToChartPoint(e);

    if (tool === 'trendline') {
      draftRef.current = { kind: 'trendline', p1: pt, p2: pt };
    } else if (tool === 'hline') {
      draftRef.current = { kind: 'hline', price: pt.price };
    } else if (tool === 'rectangle') {
      draftRef.current = { kind: 'rectangle', p1: pt, p2: pt };
    } else if (tool === 'ellipse') {
      draftRef.current = { kind: 'ellipse', p1: pt, p2: pt };
    } else if (tool === 'freehand') {
      draftRef.current = { kind: 'freehand', points: [pt] };
    } else if (tool === 'fibonacci') {
      draftRef.current = { kind: 'fibonacci', p1: pt, p2: pt };
    }
    redrawCanvas();
  }, [eventToChartPoint, redrawCanvas, onAlertAdd]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current || !draftRef.current) return;
    const pt = eventToChartPoint(e);
    const d  = draftRef.current;
    if (d.kind === 'trendline' || d.kind === 'rectangle' || d.kind === 'ellipse' || d.kind === 'fibonacci') {
      draftRef.current = { ...d, p2: pt };
    } else if (d.kind === 'hline') {
      draftRef.current = { kind: 'hline', price: pt.price };
    } else if (d.kind === 'freehand') {
      draftRef.current = { ...d, points: [...d.points, pt] };
    }
    redrawCanvas();
  }, [eventToChartPoint, redrawCanvas]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawing.current || !draftRef.current) return;
    isDrawing.current = false;
    drawingsRef.current.push(draftRef.current);
    draftRef.current = null;
    redrawCanvas();
  }, [redrawCanvas]);

  // Canvas cursor style
  const toolCursor: Record<DrawingTool, string> = {
    cursor:    'default',
    crosshair: 'crosshair',
    trendline: 'crosshair',
    hline:     'row-resize',
    rectangle: 'crosshair',
    ellipse:   'crosshair',
    text:      'text',
    freehand:  'crosshair',
    fibonacci: 'crosshair',
    alert:     'crosshair',
  };

  const commitTextInput = useCallback(() => {
    if (!textInput || !textValue.trim()) {
      setTextInput(null);
      setTextValue('');
      return;
    }
    drawingsRef.current.push({ kind: 'text', p: textInput.chartPt, text: textValue.trim() });
    redrawCanvas();
    setTextInput(null);
    setTextValue('');
    onToolChange('cursor');
  }, [textInput, textValue, redrawCanvas, onToolChange]);

  return (
    <div className="flex flex-col w-full h-full relative">
      <div ref={containerRef} className="w-full relative">
        {/* Drawing + overlay canvas */}
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            top: 0, left: 0,
            width: '100%', height: '100%',
            zIndex: 10,
            pointerEvents: activeTool === 'cursor' || activeTool === 'crosshair' ? 'none' : 'all',
            cursor: toolCursor[activeTool],
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>

      {/* Text input overlay */}
      {textInput && (
        <input
          ref={textInputRef}
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitTextInput();
            else if (e.key === 'Escape') { setTextInput(null); setTextValue(''); }
          }}
          onBlur={commitTextInput}
          style={{
            position: 'absolute',
            left: textInput.x,
            top: textInput.y - 16,
            zIndex: 30,
            background: 'rgba(19,23,34,0.9)',
            border: '1px solid #f59e0b',
            color: '#f59e0b',
            outline: 'none',
            padding: '2px 6px',
            fontSize: 13,
            fontFamily: 'Inter, system-ui, sans-serif',
            minWidth: 80,
            borderRadius: 3,
            pointerEvents: 'all',
          }}
          placeholder="Label…"
        />
      )}

      {/* RSI sub-pane */}
      <div ref={rsiContainerRef} className="w-full" style={{ borderTop: indicators.rsi ? '1px solid #2a2e39' : undefined }} />

      {/* MACD sub-pane */}
      <div ref={macdContainerRef} className="w-full" style={{ borderTop: indicators.macd ? '1px solid #2a2e39' : undefined }} />
    </div>
  );
});

export default ChartPane;
