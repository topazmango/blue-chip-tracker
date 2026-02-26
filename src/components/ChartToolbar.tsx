import { Camera, BarChart2, ZoomIn, ZoomOut, Maximize, RotateCcw } from 'lucide-react';

const tools = [
  { icon: Camera,     title: 'Screenshot' },
  null,
  { icon: ZoomIn,     title: 'Zoom In' },
  { icon: ZoomOut,    title: 'Zoom Out' },
  { icon: Maximize,   title: 'Fit Content' },
  null,
  { icon: BarChart2,  title: 'Chart Type' },
  { icon: RotateCcw,  title: 'Reset' },
];

export default function ChartToolbar() {
  return (
    <div
      className="flex flex-col items-center py-2 flex-shrink-0 border-l"
      style={{ width: '44px', backgroundColor: '#131722', borderColor: '#2a2e39' }}
    >
      {tools.map((tool, i) =>
        tool === null ? (
          <div key={i} className="w-5 my-1" style={{ height: '1px', backgroundColor: '#2a2e39' }} />
        ) : (
          <button
            key={i}
            title={tool.title}
            className="flex items-center justify-center w-8 h-8 rounded my-0.5 transition-colors"
            style={{ color: '#787b86' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#2a2e39'; e.currentTarget.style.color = '#d1d4dc'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#787b86'; }}
          >
            <tool.icon size={15} />
          </button>
        )
      )}
    </div>
  );
}
