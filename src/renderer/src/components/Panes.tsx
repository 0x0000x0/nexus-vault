// Board and Graph placeholder panes (Grok Bot).
import type { ViewMode } from '../../../shared/types';
import { BoardIcon, GraphIcon, MaxIcon, RestoreIcon } from './icons';

interface PaneProps {
  vaultName: string;
  view: ViewMode;
  onMax: () => void;
  selected: string | null;
  noteCount: string;
}

function MaxBtn({ single, onMax }: { single: boolean; onMax: () => void }) {
  return (
    <button className="iconbtn" title={single ? 'Restore side-by-side' : 'Maximize pane'} onClick={onMax}>
      {single ? <RestoreIcon /> : <MaxIcon />}
    </button>
  );
}

export function BoardPane({ vaultName, view, onMax, selected }: PaneProps) {
  return (
    <section className="pane" style={{ flex: 1 }} data-pane="board">
      <div className="panehead">
        <BoardIcon size={13} />
        <b>Board</b> · {vaultName}
        <div className="r">
          <MaxBtn single={view === 'board'} onMax={onMax} />
        </div>
      </div>
      <div className="canvas">
        <div className="placeholder">
          <BoardIcon size={34} />
          <h3>Board arrives in M2</h3>
          <div>Milanote-style boards of your notes will live here.</div>
          {selected && <div className="sel">Selected: {selected}</div>}
        </div>
      </div>
    </section>
  );
}

export function GraphPane({ vaultName, view, onMax, noteCount }: PaneProps) {
  return (
    <section className="pane" style={{ flex: 1 }} data-pane="graph">
      <div className="panehead">
        <GraphIcon size={13} />
        <b>Graph</b> · {vaultName} · {noteCount}
        <div className="r">
          <MaxBtn single={view === 'graph'} onMax={onMax} />
        </div>
      </div>
      <div className="graphbg">
        <div className="placeholder">
          <svg width="120" height="80" viewBox="0 0 120 80" aria-hidden="true" opacity="0.7">
            <g stroke="var(--faint)" strokeWidth="1">
              <line x1="20" y1="60" x2="55" y2="25" /><line x1="55" y1="25" x2="95" y2="40" /><line x1="55" y1="25" x2="70" y2="68" /><line x1="20" y1="60" x2="70" y2="68" />
            </g>
            <circle cx="55" cy="25" r="8" fill="var(--accent)" /><circle cx="20" cy="60" r="5" fill="var(--c-green)" /><circle cx="95" cy="40" r="6" fill="var(--c-orange)" /><circle cx="70" cy="68" r="4" fill="var(--c-blue)" />
          </svg>
          <h3>Graph view arrives in M1</h3>
          <div>Your notes and [[links]] will appear here as a graph.</div>
        </div>
      </div>
    </section>
  );
}
