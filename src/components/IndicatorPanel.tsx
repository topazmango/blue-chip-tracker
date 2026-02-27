import type { IndicatorSettings, StockMeta } from '../types';

interface Props {
  settings: IndicatorSettings;
  onChange: (settings: IndicatorSettings) => void;
  meta?: StockMeta | null;
}

const INDICATORS: { key: keyof IndicatorSettings; label: string; color: string }[] = [
  { key: 'sma20',           label: 'MA20',   color: '#f59e0b' },
  { key: 'sma50',           label: 'MA50',   color: '#2962ff' },
  { key: 'sma200',          label: 'MA200',  color: '#ab47bc' },
  { key: 'bollingerBands',  label: 'BB',     color: '#26a69a' },
  { key: 'rsi',             label: 'RSI',    color: '#ef5350' },
  { key: 'macd',            label: 'MACD',   color: '#7c3aed' },
  { key: 'volume',          label: 'Vol',    color: '#787b86' },
  { key: 'volumeProfile',   label: 'VPVR',   color: '#0ea5e9' },
  { key: 'supportResistance', label: 'S&R',  color: '#f97316' },
  { key: 'relativeStrength', label: 'RS',    color: '#84cc16' },
  { key: 'earningsDates',   label: 'Earn',   color: '#f59e0b' },
  { key: 'week52HighLow',   label: '52wk',   color: '#94a3b8' },
];

export default function IndicatorPanel({ settings, onChange, meta }: Props) {
  const toggle = (key: keyof IndicatorSettings) =>
    onChange({ ...settings, [key]: !settings[key] });

  return (
    <div className="flex items-center gap-1">
      {INDICATORS.map(({ key, label, color }) => {
        const on = settings[key];
        return (
          <button
            key={key}
            onClick={() => toggle(key)}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors"
            style={{
              color: on ? '#d1d4dc' : '#4c525e',
              backgroundColor: on ? '#2a2e39' : 'transparent',
              border: `1px solid ${on ? '#363a45' : 'transparent'}`,
            }}
            onMouseEnter={e => { if (!on) e.currentTarget.style.color = '#787b86'; }}
            onMouseLeave={e => { if (!on) e.currentTarget.style.color = '#4c525e'; }}
          >
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            {label}
          </button>
        );
      })}

      {/* ATR badge — shown when meta is available */}
      {meta?.atr14 != null && (
        <>
          <div className="w-px h-3 mx-1" style={{ backgroundColor: '#2a2e39' }} />
          <span
            className="px-2 py-0.5 rounded text-[11px] font-medium tabular-nums"
            style={{ color: '#94a3b8', backgroundColor: '#1e222d', border: '1px solid #2a2e39' }}
            title="Average True Range (14)"
          >
            ATR&nbsp;{meta.atr14.toFixed(2)}
          </span>
        </>
      )}
    </div>
  );
}
