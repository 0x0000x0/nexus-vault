// Back/Forward arrows shown top-left of Board and Graph pane headers (Grok Bot).
import { useApp } from '../ctx';

const isMac = navigator.platform.toLowerCase().includes('mac');
const mod = isMac ? '⌘[' : 'Alt+←';
const modF = isMac ? '⌘]' : 'Alt+→';

export function NavButtons({ pane }: { pane: 'board' | 'graph' }) {
  const { nav } = useApp();
  return (
    <div className="navbtns" data-testid={`nav-${pane}`} onPointerDown={(e) => e.stopPropagation()}>
      <button className="iconbtn" disabled={!nav.canBack} onClick={nav.back} title={`Back (${mod})`} aria-label="Back" data-testid="nav-back">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button className="iconbtn" disabled={!nav.canForward} onClick={nav.forward} title={`Forward (${modF})`} aria-label="Forward" data-testid="nav-forward">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );
}
