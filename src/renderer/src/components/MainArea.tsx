import { useState, useRef, useEffect } from 'react';
import { GraphPane } from './GraphPane';
import { BoardPane } from './BoardPane';
import { SwapIcon } from './icons';

interface MainAreaProps {
  vault: { name: string; path: string; type: 'copy' | 'real' } | null;
  view: 'graph' | 'split' | 'board';
  paneOrder: 'board-graph' | 'graph-board';
  paneRatio: number;
  onPaneRatioChange: (ratio: number) => void;
  selectedFile: string | null;
  onMaximizePane: (pane: 'graph' | 'board' | null) => void;
  onResetDivider: () => void;
}

export function MainArea({
  vault,
  view,
  paneOrder,
  paneRatio,
  onPaneRatioChange,
  selectedFile,
  onMaximizePane,
  onResetDivider,
}: MainAreaProps) {
  const [maximizedPane, setMaximizedPane] = useState<'graph' | 'board' | null>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startRatio = paneRatio;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!mainRef.current) return;
      const rect = mainRef.current.getBoundingClientRect();
      const newRatio = Math.max(0.15, Math.min(0.85, (moveEvent.clientX - rect.left) / rect.width));
      onPaneRatioChange(newRatio);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleDividerDoubleClick = () => {
    onResetDivider();
    onPaneRatioChange(0.44);
  };

  const handleMaximize = (pane: 'graph' | 'board') => {
    setMaximizedPane(maximizedPane === pane ? null : pane);
    onMaximizePane(maximizedPane === pane ? null : pane);
  };

  if (view === 'graph') {
    return <GraphPane maximized={!!maximizedPane} onCloseMaximize={() => handleMaximize('graph')} />;
  }

  if (view === 'board') {
    return <BoardPane maximized={!!maximizedPane} onCloseMaximize={() => handleMaximize('board')} selectedFile={selectedFile} />;
  }

  // Split view
  const isBoardLeft = paneOrder === 'board-graph';
  const leftPane = isBoardLeft ? 'board' : 'graph';
  const rightPane = isBoardLeft ? 'graph' : 'board';

  return (
    <main className="main" ref={mainRef}>
      {leftPane === 'board' ? (
        <BoardPane maximized={maximizedPane === 'board'} onCloseMaximize={() => handleMaximize('board')} selectedFile={selectedFile} />
      ) : (
        <GraphPane maximized={maximizedPane === 'graph'} onCloseMaximize={() => handleMaximize('graph')} />
      )}
      {!maximizedPane && (
        <div
          className="divider"
          ref={dividerRef}
          onMouseDown={handleDividerMouseDown}
          onDoubleClick={handleDividerDoubleClick}
          title="Drag to resize, double-click to reset"
          style={{ left: `${paneRatio * 100}%` }}
        >
          <i />
        </div>
      )}
      {rightPane === 'graph' ? (
        <GraphPane maximized={maximizedPane === 'graph'} onCloseMaximize={() => handleMaximize('graph')} />
      ) : (
        <BoardPane maximized={maximizedPane === 'board'} onCloseMaximize={() => handleMaximize('board')} selectedFile={selectedFile} />
      )}
      {!maximizedPane && (
        <button
          className="iconbtn"
          style={{
            position: 'absolute',
            top: 8,
            left: isBoardLeft ? `calc(${paneRatio * 100}% + 8px)` : `calc(${paneRatio * 100}% - 38px)`,
            zIndex: 10,
            background: 'var(--card)',
            border: '1px solid var(--border)',
          }}
          onClick={() => {
            // This would need to be handled by parent via setLayout
          }}
          title="Swap panes"
        >
          <SwapIcon />
        </button>
      )}
    </main>
  );
}