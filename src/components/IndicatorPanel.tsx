import type { IndicatorSettings } from '../types';

interface Props {
  settings: IndicatorSettings;
  onChange: (settings: IndicatorSettings) => void;
}

const INDICATORS: { key: keyof IndicatorSettings; label: string; color: string }[] = [
  { key: 'sma20',          label: 'MA20',   color: '#f59e0b' },
  { key: 'sma50',          label: 'MA50',   color: '#2962ff' },
  { key: 'sma200',         label: 'MA200',  color: '#ab47bc' },
  { key: 'bollingerBands', label: 'BB',     color: '#26a69a' },
  { key: 'rsi',            label: 'RSI',    color: '#ef5350' },
  { key: 'volume',         label: 'Vol',    color: '#787b86' },
];

export default function IndicatorPanel({ settings, onChange }: Props) {
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
    </div>
  );
}
