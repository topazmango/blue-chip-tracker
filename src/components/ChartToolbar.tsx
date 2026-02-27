import { useState, useRef, useEffect } from 'react';
import { Camera, ZoomIn, ZoomOut, Maximize, RotateCcw, CandlestickChart, BarChart2, TrendingUp, AreaChart, GitCommitHorizontal } from 'lucide-react';
import type { ChartType, ChartActions } from '../types';

interface Props {
  chartType: ChartType;
  onChartTypeChange: (t: ChartType) => void;
  chartActionsRef: React.RefObject<ChartActions | null>;
}

const CHART_TYPES: { type: ChartType; icon: React.ElementType; label: string }[] = [
  { type: 'candlestick', icon: CandlestickChart,      label: 'Candlestick' },
  { type: 'bar',         icon: BarChart2,              label: 'Bar' },
  { type: 'line',        icon: TrendingUp,             label: 'Line' },
  { type: 'area',        icon: AreaChart,              label: 'Area' },
  { type: 'baseline',    icon: GitCommitHorizontal,    label: 'Baseline' },
];

function ToolBtn({
  icon: Icon,
  title,
  active,
  onClick,
}: {
  icon: React.ElementType;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex items-center justify-center w-8 h-8 rounded my-0.5 transition-colors"
      style={{
        color: active ? '#d1d4dc' : '#787b86',
        backgroundColor: active ? '#2a2e39' : 'transparent',
      }}
      onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#2a2e39'; e.currentTarget.style.color = '#d1d4dc'; }}
      onMouseLeave={e => {
        e.currentTarget.style.backgroundColor = active ? '#2a2e39' : 'transparent';
        e.currentTarget.style.color = active ? '#d1d4dc' : '#787b86';
      }}
    >
      <Icon size={15} />
    </button>
  );
}

export default function ChartToolbar({ chartType, onChartTypeChange, chartActionsRef }: Props) {
  const [showChartMenu, setShowChartMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!showChartMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowChartMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showChartMenu]);

  const ActiveChartIcon = CHART_TYPES.find((t) => t.type === chartType)?.icon ?? CandlestickChart;

  return (
    <div
      className="flex flex-col items-center py-2 flex-shrink-0 border-l relative"
      style={{ width: '44px', backgroundColor: '#131722', borderColor: '#2a2e39' }}
    >
      {/* Screenshot */}
      <ToolBtn icon={Camera} title="Screenshot" onClick={() => chartActionsRef.current?.screenshot()} />

      <div className="w-5 my-1" style={{ height: '1px', backgroundColor: '#2a2e39' }} />

      {/* Zoom In */}
      <ToolBtn icon={ZoomIn} title="Zoom In" onClick={() => chartActionsRef.current?.zoomIn()} />

      {/* Zoom Out */}
      <ToolBtn icon={ZoomOut} title="Zoom Out" onClick={() => chartActionsRef.current?.zoomOut()} />

      {/* Fit Content */}
      <ToolBtn icon={Maximize} title="Fit Content" onClick={() => chartActionsRef.current?.fitContent()} />

      <div className="w-5 my-1" style={{ height: '1px', backgroundColor: '#2a2e39' }} />

      {/* Chart Type picker */}
      <div ref={menuRef} className="relative">
        <ToolBtn
          icon={ActiveChartIcon}
          title="Chart Type"
          active={showChartMenu}
          onClick={() => setShowChartMenu((v) => !v)}
        />
        {showChartMenu && (
          <div
            className="absolute right-full top-0 mr-1 rounded py-1 shadow-xl z-50 min-w-[140px]"
            style={{ backgroundColor: '#1e222d', border: '1px solid #2a2e39' }}
          >
            {CHART_TYPES.map(({ type, icon: Icon, label }) => (
              <button
                key={type}
                onClick={() => { onChartTypeChange(type); setShowChartMenu(false); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs transition-colors"
                style={{
                  color: chartType === type ? '#d1d4dc' : '#787b86',
                  backgroundColor: chartType === type ? '#2a2e39' : 'transparent',
                }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#2a2e39'; e.currentTarget.style.color = '#d1d4dc'; }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = chartType === type ? '#2a2e39' : 'transparent';
                  e.currentTarget.style.color = chartType === type ? '#d1d4dc' : '#787b86';
                }}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Reset view + drawings */}
      <ToolBtn icon={RotateCcw} title="Reset" onClick={() => chartActionsRef.current?.reset()} />
    </div>
  );
}
