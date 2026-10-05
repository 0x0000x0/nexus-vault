// Root component: theme, layout persistence, vault actions (Grok Bot).
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_LAYOUT, LIMITS, type LayoutSettings, type RecentVaultView, type ThemePref, type VaultInfo, type ViewMode } from '../../shared/types';
import { Divider } from './components/Divider';
import { FolderTree } from './components/FolderTree';
import { BoardPane, GraphPane } from './components/Panes';
import { StatusBar } from './components/StatusBar';
import { TitleBar } from './components/TitleBar';
import { ToolStrip } from './components/ToolStrip';
import { VaultPicker } from './components/VaultPicker';

const nexus = window.nexus;
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function errMsg(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export function App() {
  const [ready, setReady] = useState(false);
  const [theme, setThemeState] = useState<ThemePref>('system');
  const [systemDark, setSystemDark] = useState(darkQuery.matches);
  const [layout, setLayoutState] = useState<LayoutSettings>(DEFAULT_LAYOUT);
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [recent, setRecent] = useState<RecentVaultView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [noteCount, setNoteCount] = useState<{ count: number; done: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ text: string; err?: boolean } | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef(0);

  // ---- startup
  useEffect(() => {
    void (async () => {
      const s = await nexus.getSettings();
      setThemeState(s.theme);
      setLayoutState(s.layout);
      setRecent(await nexus.getRecent());
      setVault(await nexus.getCurrent());
      setReady(true);
    })();
    const offCount = nexus.onNoteCount((n) => setNoteCount({ count: n.count, done: n.done }));
    const offTheme = nexus.onSystemTheme(() => setSystemDark(darkQuery.matches));
    const mq = () => setSystemDark(darkQuery.matches);
    darkQuery.addEventListener('change', mq);
    return () => {
      offCount();
      offTheme();
      darkQuery.removeEventListener('change', mq);
    };
  }, []);

  // ---- theme
  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);
  const setTheme = async (t: ThemePref) => {
    setThemeState(t);
    await nexus.setTheme(t);
    setSystemDark(darkQuery.matches);
  };

  // ---- layout
  const setLayout = useCallback((patch: Partial<LayoutSettings>, persist = true) => {
    setLayoutState((l) => ({ ...l, ...patch }));
    if (persist) void nexus.setLayout(patch);
  }, []);

  // ---- vault actions
  const refreshRecent = async () => setRecent(await nexus.getRecent());
  const afterOpen = async (v: VaultInfo) => {
    setVault(v);
    setSelected(null);
    setNoteCount(null);
    await refreshRecent();
  };
  const run = async (msg: string, f: () => Promise<void>) => {
    setBusy(msg);
    setBanner(null);
    try {
      await f();
    } catch (e) {
      setBanner({ text: errMsg(e), err: true });
    } finally {
      setBusy(null);
    }
  };
  const copyFrom = (src: string) =>
    run(`Copying ${src} …`, async () => {
      const v = await nexus.safeCopy(src);
      await afterOpen(v);
      setBanner({ text: `Safe copy created at ${v.path}` });
    });
  const openCopy = async () => {
    const src = await nexus.pickFolder('Choose a vault to copy');
    if (src) await copyFrom(src);
  };
  const openReal = async () => {
    const p = await nexus.pickFolder('Open folder as vault');
    if (!p) return;
    const choice = await nexus.confirmReal(p);
    if (choice === 'real') await run('Opening…', async () => afterOpen(await nexus.openVault(p)));
    else if (choice === 'copy') await copyFrom(p);
  };
  const openRecent = (p: string) => run('Opening…', async () => afterOpen(await nexus.openVault(p)));
  const closeVault = async () => {
    await nexus.closeVault();
    setVault(null);
    setSelected(null);
    await refreshRecent();
  };
  const removeRecent = async (p: string) => {
    await nexus.removeRecent(p);
    await refreshRecent();
  };

  if (!ready) return <div className="app" />;

  const countText = noteCount ? `${noteCount.count.toLocaleString()} notes${noteCount.done ? '' : ' (counting…)'}` : 'counting…';
  const toolWidth = layout.toolStripExpanded ? LIMITS.toolExpanded : LIMITS.toolCollapsed;
  const swap = () => setLayout({ paneOrder: layout.paneOrder === 'board-graph' ? 'graph-board' : 'board-graph' });
  const maxToggle = (pane: ViewMode) => () => setLayout({ view: layout.view === pane ? 'split' : pane });

  const paneProps = { vaultName: vault?.name ?? '', view: layout.view, selected, noteCount: countText };
  const board = <BoardPane {...paneProps} onMax={maxToggle('board')} />;
  const graph = <GraphPane {...paneProps} onMax={maxToggle('graph')} />;
  const [left, right] = layout.paneOrder === 'board-graph' ? [board, graph] : [graph, board];

  const mainWidth = () => mainRef.current?.clientWidth ?? 1000;
  const clampRatio = (r: number) => {
    const w = mainWidth() - 7;
    const min = Math.min(0.5, LIMITS.paneMin / Math.max(1, w));
    return Math.min(1 - min, Math.max(min, r));
  };

  return (
    <div className="app">
      <TitleBar
        vault={vault}
        recent={recent}
        theme={theme}
        view={layout.view}
        paneOrder={layout.paneOrder}
        onTheme={(t) => void setTheme(t)}
        onView={(v) => setLayout({ view: v })}
        onSwap={swap}
        onOpenRecent={(p) => void openRecent(p)}
        onOpenCopy={() => void openCopy()}
        onOpenReal={() => void openReal()}
        onClose={() => void closeVault()}
        onMenuOpen={() => void refreshRecent()}
      />
      <div className="body">
        {!vault && banner && (
          <div className={`banner${banner.err ? ' err' : ''}`} style={{ top: 52 }}>
            <span>{banner.text}</span>
            <button onClick={() => setBanner(null)} title="Dismiss">✕</button>
          </div>
        )}
        {!vault ? (
          <VaultPicker recent={recent} busy={busy} onOpenCopy={() => void openCopy()} onOpenReal={() => void openReal()} onOpenRecent={(p) => void openRecent(p)} onRemove={(p) => void removeRecent(p)} />
        ) : (
          <>
            <FolderTree vault={vault} width={layout.treeWidth} selected={selected} onSelect={(rel) => setSelected(rel)} />
            <Divider
              testId="div-tree"
              onStart={() => (dragStart.current = layout.treeWidth)}
              onDrag={(dx) => setLayout({ treeWidth: Math.min(LIMITS.treeMax, Math.max(LIMITS.treeMin, dragStart.current + dx)) }, false)}
              onEnd={(dx) => setLayout({ treeWidth: Math.min(LIMITS.treeMax, Math.max(LIMITS.treeMin, dragStart.current + dx)) })}
              onReset={() => setLayout({ treeWidth: DEFAULT_LAYOUT.treeWidth })}
            />
            <ToolStrip expanded={layout.toolStripExpanded} width={toolWidth} />
            <Divider
              thin
              testId="div-tools"
              title="Drag right to show labels, left for icons only · double-click to toggle"
              onDrag={() => undefined}
              onEnd={(dx) => {
                if (dx > 12) setLayout({ toolStripExpanded: true });
                else if (dx < -12) setLayout({ toolStripExpanded: false });
              }}
              onReset={() => setLayout({ toolStripExpanded: !layout.toolStripExpanded })}
            />
            <div className="main" ref={mainRef}>
              {banner && (
                <div className={`banner${banner.err ? ' err' : ''}`}>
                  <span>{banner.text}</span>
                  <button onClick={() => setBanner(null)} title="Dismiss">✕</button>
                </div>
              )}
              {busy && <div className="banner"><div className="spin" />{busy}</div>}
              {layout.view === 'split' ? (
                <>
                  <div style={{ flex: `0 0 calc(${layout.paneRatio * 100}% - 3.5px)`, display: 'flex', minWidth: 0 }}>{left}</div>
                  <Divider
                    testId="div-panes"
                    onStart={() => (dragStart.current = layout.paneRatio)}
                    onDrag={(dx) => setLayout({ paneRatio: clampRatio(dragStart.current + dx / mainWidth()) }, false)}
                    onEnd={(dx) => setLayout({ paneRatio: clampRatio(dragStart.current + dx / mainWidth()) })}
                    onReset={() => setLayout({ paneRatio: DEFAULT_LAYOUT.paneRatio })}
                  />
                  <div style={{ flex: '1 1 0', display: 'flex', minWidth: 0 }}>{right}</div>
                </>
              ) : (
                <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>{layout.view === 'board' ? board : graph}</div>
              )}
            </div>
          </>
        )}
      </div>
      <StatusBar selected={selected} noteCount={countText} hasVault={!!vault} />
    </div>
  );
}
