import { MousePointer2, Crosshair, TrendingUp, Minus, Type, Circle, Square, Pencil, Trash2 } from 'lucide-react';

const tools = [
  { icon: MousePointer2, title: 'Cursor' },
  { icon: Crosshair,     title: 'Crosshair' },
  null,
  { icon: TrendingUp,    title: 'Trend Line' },
  { icon: Minus,         title: 'Horizontal Line' },
  null,
  { icon: Square,        title: 'Rectangle' },
  { icon: Circle,        title: 'Ellipse' },
  null,
  { icon: Type,          title: 'Text' },
  { icon: Pencil,        title: 'Freehand' },
  null,
  { icon: Trash2,        title: 'Remove All' },
];

export default function DrawingToolbar() {
  return (
    <div
      className="flex flex-col items-center py-2 flex-shrink-0 border-r"
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
