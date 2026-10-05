import { useRef, useEffect } from 'react';

interface BoardPaneProps {
  maximized: boolean;
  onCloseMaximize: () => void;
  selectedFile: string | null;
}

export function BoardPane({ maximized, onCloseMaximize, selectedFile }: BoardPaneProps) {
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Board placeholder - dot grid is handled by CSS
  }, [selectedFile]);

  return (
    <section className="pane" style={{ flex: maximized ? '1' : '1', minWidth: 280 }}>
      <div className="panehead">
        <div className="crumb">
          <span>Vault</span>
          <span>›</span>
          <span className="cur"><b>{selectedFile || 'Select a note'}</b></span>
        </div>
        <div className="r">
          <button className="iconbtn" title="Export PNG/PDF">⇩</button>
          <button className="iconbtn max" title={maximized ? 'Restore' : 'Maximize'} onClick={onCloseMaximize}>
            {maximized ? '⤡' : '⤢'}
          </button>
        </div>
      </div>
      <div className="canvas" ref={boardRef}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted)', fontSize: 14 }}>
          Board arrives in M2
          {selectedFile && <span style={{ marginLeft: 16 }}>Selected: {selectedFile}</span>}
        </div>
      </div>
    </section>
  );
}