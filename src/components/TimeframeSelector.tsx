import type { Timeframe } from '../types';

const TIMEFRAMES: Timeframe[] = ['1D', '1W', '1M', '3M', '6M', '1Y', '5Y', 'ALL'];

interface Props {
  selected: Timeframe;
  onChange: (tf: Timeframe) => void;
}

export default function TimeframeSelector({ selected, onChange }: Props) {
  return (
    <div className="flex items-center gap-0.5">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          onClick={() => onChange(tf)}
          className="px-2 py-1 rounded text-[11px] font-medium tracking-wide transition-colors"
          style={{
            color: selected === tf ? '#d1d4dc' : '#787b86',
            backgroundColor: selected === tf ? '#2a2e39' : 'transparent',
          }}
          onMouseEnter={e => { if (selected !== tf) e.currentTarget.style.color = '#b2b5be'; }}
          onMouseLeave={e => { if (selected !== tf) e.currentTarget.style.color = '#787b86'; }}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}
