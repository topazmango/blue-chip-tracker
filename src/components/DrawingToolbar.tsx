import { MousePointer2, Crosshair, TrendingUp, Minus, Type, Circle, Square, Pencil, Trash2, GitBranch, Bell } from 'lucide-react';
import type { DrawingTool, ChartActions } from '../types';

interface Props {
  activeTool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
  chartActionsRef: React.RefObject<ChartActions | null>;
}

const tools: ({ icon: React.ElementType; title: string; tool: DrawingTool } | null)[] = [
  { icon: MousePointer2, title: 'Cursor',              tool: 'cursor'    },
  { icon: Crosshair,     title: 'Crosshair',            tool: 'crosshair' },
  null,
  { icon: TrendingUp,    title: 'Trend Line',           tool: 'trendline' },
  { icon: Minus,         title: 'Horizontal Line',      tool: 'hline'     },
  { icon: GitBranch,     title: 'Fibonacci Retracement', tool: 'fibonacci' },
  null,
  { icon: Square,        title: 'Rectangle',            tool: 'rectangle' },
  { icon: Circle,        title: 'Ellipse',              tool: 'ellipse'   },
  null,
  { icon: Type,          title: 'Text',                 tool: 'text'      },
  { icon: Pencil,        title: 'Freehand',             tool: 'freehand'  },
  { icon: Bell,          title: 'Price Alert',          tool: 'alert'     },
  null,
  { icon: Trash2,        title: 'Remove All',           tool: 'cursor'    },
];

export default function DrawingToolbar({ activeTool, onToolChange, chartActionsRef }: Props) {
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
            onClick={() => {
              if (tool.title === 'Remove All') {
                chartActionsRef.current?.reset();
              }
              onToolChange(tool.tool);
            }}
            className="flex items-center justify-center w-8 h-8 rounded my-0.5 transition-colors"
            style={{
              color: activeTool === tool.tool && tool.title !== 'Remove All' ? '#d1d4dc' : '#787b86',
              backgroundColor: activeTool === tool.tool && tool.title !== 'Remove All' ? '#2a2e39' : 'transparent',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.backgroundColor = '#2a2e39';
              e.currentTarget.style.color = '#d1d4dc';
            }}
            onMouseLeave={e => {
              const isActive = activeTool === tool.tool && tool.title !== 'Remove All';
              e.currentTarget.style.backgroundColor = isActive ? '#2a2e39' : 'transparent';
              e.currentTarget.style.color = isActive ? '#d1d4dc' : '#787b86';
            }}
          >
            <tool.icon size={15} />
          </button>
        )
      )}
    </div>
  );
}
