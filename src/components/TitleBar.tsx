import { Minus, Square, X, Maximize2, Minimize2, RefreshCw } from 'lucide-react';

declare global {
  interface Window {
    electronAPI?: {
      platform: string;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      toggleFullscreen: () => void;
      onStateChange: (cb: (state: { maximized: boolean; fullscreen: boolean }) => void) => void;
    };
  }
}

interface Props {
  maximized: boolean;
  fullscreen: boolean;
  onRefresh?: () => void;
  loading?: boolean;
}

export default function TitleBar({ maximized, fullscreen, onRefresh, loading }: Props) {
  const api = window.electronAPI;
  if (!api) return null;

  const dragStyle = (!maximized && !fullscreen)
    ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties)
    : ({} as React.CSSProperties);
  const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

  return (
    <div
      className="flex items-center h-[38px] flex-shrink-0 border-b select-none"
      style={{ ...dragStyle, backgroundColor: '#131722', borderColor: '#2a2e39' }}
    >
      {/* Left: App name */}
      <div className="flex items-center gap-2 px-3" style={noDrag}>
        {/* TV-style logo dot */}
        <div className="w-5 h-5 rounded flex items-center justify-center" style={{ backgroundColor: '#2962ff' }}>
          <span className="text-white font-bold" style={{ fontSize: '10px', lineHeight: 1 }}>B</span>
        </div>
        <span className="text-xs font-semibold" style={{ color: '#d1d4dc' }}>Blue Chip Tracker</span>
        <span className="text-xs" style={{ color: '#4c525e' }}>·</span>
        <span className="text-xs" style={{ color: '#787b86' }}>S&P 500 Top 20</span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: Refresh + window controls */}
      <div className="flex items-center h-full" style={noDrag}>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center justify-center w-9 h-full transition-colors disabled:opacity-40"
            style={{ color: '#787b86' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#d1d4dc')}
            onMouseLeave={e => (e.currentTarget.style.color = '#787b86')}
            title="Refresh data"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        )}

        <div className="w-px h-4 mx-1" style={{ backgroundColor: '#2a2e39' }} />

        {/* Minimize */}
        <button
          onClick={api.minimize}
          className="flex items-center justify-center w-10 h-full transition-colors"
          style={{ color: '#787b86' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#2a2e39'; e.currentTarget.style.color = '#d1d4dc'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#787b86'; }}
        >
          <Minus size={12} />
        </button>

        {/* Maximize */}
        <button
          onClick={api.maximize}
          className="flex items-center justify-center w-10 h-full transition-colors"
          style={{ color: '#787b86' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#2a2e39'; e.currentTarget.style.color = '#d1d4dc'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#787b86'; }}
        >
          {maximized ? <Minimize2 size={11} /> : <Square size={10} />}
        </button>

        {/* Fullscreen */}
        <button
          onClick={api.toggleFullscreen}
          className="flex items-center justify-center w-10 h-full transition-colors"
          style={{ color: fullscreen ? '#2962ff' : '#787b86' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#2a2e39'; if (!fullscreen) e.currentTarget.style.color = '#d1d4dc'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = fullscreen ? '#2962ff' : '#787b86'; }}
        >
          <Maximize2 size={11} />
        </button>

        {/* Close */}
        <button
          onClick={api.close}
          className="flex items-center justify-center w-10 h-full transition-colors"
          style={{ color: '#787b86' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#ef5350'; e.currentTarget.style.color = '#ffffff'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#787b86'; }}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
