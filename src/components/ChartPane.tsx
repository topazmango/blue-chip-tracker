import { useEffect, useRef, useCallback } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts';
import type {
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
  SeriesType,
} from 'lightweight-charts';
import type { Candle, IndicatorSettings, Timeframe } from '../types';

interface Props {
  candles: Candle[];
  indicators: IndicatorSettings;
  timeframe: Timeframe;
  liveCandle?: Candle | null;
}

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

/** Get the period key (integer bucket) for a timestamp, used to determine band color alternation */
function getPeriodKey(ts: number, unit: PeriodUnit): number {
  const d = new Date(ts * 1000);
  switch (unit) {
    case 'year':  return d.getUTCFullYear();
    case 'month': return d.getUTCFullYear() * 12 + d.getUTCMonth();
    case 'week': {
      // ISO week number
      const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);
      return d.getUTCFullYear() * 54 + week;
    }
    case 'day':   return Math.floor(ts / 86400);
    case 'hour':  return Math.floor(ts / 3600);
  }
}

/**
 * Build histogram band data: each candle gets value=1, colored alternately
 * based on which period bucket it falls in.
 */
function buildBandData(
  candles: Candle[],
  unit: PeriodUnit
): { time: UTCTimestamp; value: number; color: string }[] {
  const EVEN = 'rgba(255,255,255,0.03)';
  const ODD  = 'rgba(255,255,255,0.00)';

  // We need consistent bar-width spacing. For histogram bands we'll assign
  // each candle its own bar coloured by period parity.
  return candles.map((c) => {
    const key = getPeriodKey(c.time, unit);
    return {
      time: c.time as UTCTimestamp,
      value: 1,
      color: key % 2 === 0 ? EVEN : ODD,
    };
  });
}

/**
 * Build divider line data: one point at the start of each new period.
 * Returns array of {time, value} at fixed value (will be invisible price-wise
 * Returns array of timestamps where period changes, used to render divider bars.
 */
function getPeriodBoundaryTimes(candles: Candle[], unit: PeriodUnit): UTCTimestamp[] {
  const boundaries: UTCTimestamp[] = [];
  let lastKey: number | null = null;
  for (const c of candles) {
    const key = getPeriodKey(c.time, unit);
    if (lastKey !== null && key !== lastKey) {
      boundaries.push(c.time as UTCTimestamp);
    }
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
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ChartPane({ candles, indicators, timeframe, liveCandle }: Props) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const chartRef        = useRef<IChartApi | null>(null);
  const rsiChartRef     = useRef<IChartApi | null>(null);
  const seriesRefs      = useRef<{ [key: string]: ISeriesApi<SeriesType> }>({});

  const destroyCharts = useCallback(() => {
    try { chartRef.current?.remove(); }    catch { /* ignore */ }
    try { rsiChartRef.current?.remove(); } catch { /* ignore */ }
    chartRef.current    = null;
    rsiChartRef.current = null;
    seriesRefs.current  = {};
  }, []);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    destroyCharts();

    const showRSI = indicators.rsi;
    const parentEl = containerRef.current.parentElement;
    if (!parentEl) return;

    const mainH = showRSI ? Math.floor(parentEl.clientHeight * 0.68) : parentEl.clientHeight;
    const rsiH  = showRSI ? parentEl.clientHeight - mainH - 4 : 0;

    containerRef.current.style.height = `${mainH}px`;
    if (rsiContainerRef.current) {
      rsiContainerRef.current.style.height = showRSI ? `${rsiH}px` : '0px';
    }

    // ── Main chart ──────────────────────────────────────────────────────────
    const chart = createChart(containerRef.current, makeChartOpts());
    chartRef.current = chart;

    // ── Period band shading (rendered first so it's behind everything) ──────
    const unit = getPeriodUnit(timeframe);
    const bandData = buildBandData(candles, unit);

    const bandSeries = chart.addSeries(HistogramSeries, {
      priceFormat:    { type: 'volume' },
      priceScaleId:   'bands',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    // Make the band scale invisible — fills 0–100% behind the chart
    chart.priceScale('bands').applyOptions({
      scaleMargins:  { top: 0, bottom: 0 },
      visible:       false,
    });
    bandSeries.setData(bandData);
    seriesRefs.current['bands'] = bandSeries;

    // ── Period divider lines ─────────────────────────────────────────────────
    const boundaries = getPeriodBoundaryTimes(candles, unit);
    if (boundaries.length > 0) {
      const boundarySet = new Set(boundaries);
      const divData = candles.map((c) => ({
        time:  c.time as UTCTimestamp,
        value: 1,
        color: boundarySet.has(c.time as UTCTimestamp) ? 'rgba(148,163,184,0.25)' : 'rgba(0,0,0,0)',
      }));
      const divSeries = chart.addSeries(HistogramSeries, {
        priceFormat:      { type: 'volume' },
        priceScaleId:     'bands',
        lastValueVisible: false,
        priceLineVisible: false,
      });
      divSeries.setData(divData);
      seriesRefs.current['dividers'] = divSeries;
    }

    // ── Candlestick series ───────────────────────────────────────────────────
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:         '#26a69a',
      downColor:       '#ef5350',
      borderUpColor:   '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor:     '#26a69a',
      wickDownColor:   '#ef5350',
    });
    candleSeries.setData(candles.map((c) => ({
      time:  c.time as UTCTimestamp,
      open:  c.open,
      high:  c.high,
      low:   c.low,
      close: c.close,
    })));
    seriesRefs.current['candle'] = candleSeries;

    // ── Volume histogram ─────────────────────────────────────────────────────
    if (indicators.volume) {
      const volSeries = chart.addSeries(HistogramSeries, {
        color:        '#26a69a',
        priceFormat:  { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      volSeries.setData(candles.map((c) => ({
        time:  c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? '#26a69a40' : '#ef535040',
      })));
      seriesRefs.current['volume'] = volSeries;
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

    chart.timeScale().fitContent();

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

      rsiChart.timeScale().fitContent();

      // Sync time scales
      chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r) rsiChart.timeScale().setVisibleLogicalRange(r); });
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r) chart.timeScale().setVisibleLogicalRange(r); });
    }

    // ── Resize observer ──────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return;
      const parent = containerRef.current.parentElement;
      if (!parent) return;
      const totalH = parent.clientHeight;
      const mH = showRSI ? Math.floor(totalH * 0.68) : totalH;
      const rH = showRSI ? totalH - mH - 4 : 0;
      containerRef.current.style.height = `${mH}px`;
      chart.applyOptions({ height: mH });
      if (showRSI && rsiContainerRef.current) {
        rsiContainerRef.current.style.height = `${rH}px`;
        rsiChartRef.current?.applyOptions({ height: rH });
      }
    });
    ro.observe(parentEl);

    return () => { ro.disconnect(); destroyCharts(); };
  }, [candles, indicators, timeframe, destroyCharts]);

  // ── Live candle update (no full rebuild) ────────────────────────────────────
  useEffect(() => {
    if (!liveCandle) return;
    const candle = seriesRefs.current['candle'];
    const vol    = seriesRefs.current['volume'];
    if (candle) {
      candle.update({
        time:  liveCandle.time as UTCTimestamp,
        open:  liveCandle.open,
        high:  liveCandle.high,
        low:   liveCandle.low,
        close: liveCandle.close,
      });
    }
    if (vol) {
      vol.update({
        time:  liveCandle.time as UTCTimestamp,
        value: liveCandle.volume,
        color: liveCandle.close >= liveCandle.open ? '#26a69a40' : '#ef535040',
      });
    }
  }, [liveCandle]);

  return (
    <div className="flex flex-col w-full h-full">
      <div ref={containerRef}    className="w-full" />
      <div ref={rsiContainerRef} className="w-full" />
    </div>
  );
}
