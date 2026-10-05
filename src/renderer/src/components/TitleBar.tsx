// Title bar: brand, vault switcher, view switcher + swap, search placeholder, theme control (Grok Bot).
import { useEffect, useRef, useState } from 'react';
import type { PaneOrder, RecentVaultView, ThemePref, VaultInfo, ViewMode } from '../../../shared/types';
import { BoardIcon, GraphIcon, Logo, MonitorIcon, MoonIcon, SearchIcon, SplitIcon, SunIcon, SwapIcon, VaultIcon } from './icons';

interface Props {
  vault: VaultInfo | null;
  recent: RecentVaultView[];
  theme: ThemePref;
  view: ViewMode;
  paneOrder: PaneOrder;
  onTheme: (t: ThemePref) => void;
  onView: (v: ViewMode) => void;
  onSwap: () => void;
  onOpenRecent: (p: string) => void;
  onOpenCopy: () => void;
  onOpenReal: () => void;
  onClose: () => void;
  onMenuOpen: () => void;
  onSearch: () => void;
  onOpenCode: () => void;
  onSnapshots?: () => void;
}

export function TitleBar(p: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', h);
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('mousedown', h);
      window.removeEventListener('keydown', k);
    };
  }, [open]);
  const act = (f: () => void) => () => {
    setOpen(false);
    f();
  };

  return (
    <header className="titlebar">
      <div className="brand">
        <Logo /> Nexus Vault
      </div>
      <div
        className="chip"
        ref={ref}
        title="Switch vault"
        onClick={() => {
          if (!open) p.onMenuOpen();
          setOpen(!open);
        }}
      >
        <VaultIcon />
        <span className="nm">{p.vault ? p.vault.name : 'No vault'}</span>
        {p.vault?.isCopy && <span className="badge">copy</span>}
        {p.vault?.readOnly && <span className="badge">read-only repo</span>}
        <span className="caret">▼</span>
        {open && (
          <div className="menu" onClick={(e) => e.stopPropagation()}>
            {p.recent.length > 0 && <div className="hdr">Recent vaults</div>}
            {p.recent.map((r) => (
              <button
                key={r.path}
                className={`mi${p.vault?.path === r.path ? ' cur' : ''}${r.exists ? '' : ' missing'}`}
                disabled={!r.exists}
                onClick={act(() => p.onOpenRecent(r.path))}
                title={r.path}
              >
                <span className="check">{p.vault?.path === r.path ? '✓' : ''}</span>
                <div>
                  {r.name}
                  {r.isCopy && <span className="badge">copy</span>}
                  {r.mode === 'code' && <span className="badge">repo</span>}
                  {!r.exists && <span className="badge warn">not found</span>}
                  <small>{r.path}</small>
                </div>
              </button>
            ))}
            {p.recent.length > 0 && <div className="sep" />}
            <button className="mi" onClick={act(p.onOpenCopy)}>
              <span className="check" />
              Open safe copy…
            </button>
            <button className="mi" onClick={act(p.onOpenReal)}>
              <span className="check" />
              Open folder as vault…
            </button>
            <button className="mi" onClick={act(p.onOpenCode)}>
              <span className="check" />
              Open GitHub repo / code project…
            </button>
            {p.vault && p.onSnapshots && (
              <button className="mi" onClick={act(p.onSnapshots)}>
                <span className="check" />
                Snapshots…
              </button>
            )}
            {p.vault && (
              <button className="mi" onClick={act(p.onClose)}>
                <span className="check" />
                Close vault
              </button>
            )}
          </div>
        )}
      </div>
      <div className="seg" role="group" aria-label="View">
        <button className={p.view === 'graph' ? 'on' : ''} onClick={() => p.onView('graph')} disabled={!p.vault}>
          <GraphIcon /> Graph
        </button>
        <button className={p.view === 'split' ? 'on' : ''} onClick={() => p.onView('split')} disabled={!p.vault}>
          <SplitIcon /> Side-by-side
        </button>
        <button className={p.view === 'board' ? 'on' : ''} onClick={() => p.onView('board')} disabled={!p.vault}>
          <BoardIcon /> Board
        </button>
      </div>
      <button className="iconbtn" title={`Swap panes (now: ${p.paneOrder === 'board-graph' ? 'Board left, Graph right' : 'Graph left, Board right'})`} onClick={p.onSwap} disabled={!p.vault}>
        <SwapIcon />
      </button>
      <button className="search" title="Search notes (Ctrl+K)" onClick={p.onSearch} disabled={!p.vault}>
        <SearchIcon /> Search notes… <span className="kbd">Ctrl K</span>
      </button>
      <div className="spacer" />
      <div className="seg" role="group" aria-label="Theme">
        <button className={p.theme === 'light' ? 'on' : ''} onClick={() => p.onTheme('light')}>
          <SunIcon /> Light
        </button>
        <button className={p.theme === 'dark' ? 'on' : ''} onClick={() => p.onTheme('dark')}>
          <MoonIcon /> Dark
        </button>
        <button className={p.theme === 'system' ? 'on' : ''} onClick={() => p.onTheme('system')}>
          <MonitorIcon /> System
        </button>
      </div>
    </header>
  );
}
