// Root component: theme, layout persistence, vault actions, index state (Grok Bot).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_LAYOUT, LIMITS, type GraphData, type IndexStats, type ProgressInfo, type LayoutSettings, type RecentVaultView, type ThemePref, type VaultInfo, type ViewMode } from '../../shared/types';
import { BoardPane, type ToolId } from './components/BoardPane';
import { PromptModal, type PromptState } from './components/ContextMenu';
import { Divider } from './components/Divider';
import { FolderTree } from './components/FolderTree';
import { GraphPane } from './components/GraphPane';
import { NotePanel } from './components/NotePanel';
import { QuickSearch } from './components/QuickSearch';
import { RepoDrop } from './components/RepoDrop';
import { StatusBar } from './components/StatusBar';
import { TitleBar } from './components/TitleBar';
import { AiAccess } from './components/AiAccess';
import { ToolStrip } from './components/ToolStrip';
import { VaultPicker } from './components/VaultPicker';
import { Ctx, dirOf, errMsg, type AppActions } from './ctx';
import { back as navBack, canBack, canForward, createNav, forward as navForward, push as navPush, replace as navReplace, type Cam, type NavSnap, type NavState } from './nav-history';

const nexus = window.nexus;
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const EMPTY_GRAPH: GraphData = { nodes: [], links: [], version: -1 };

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
  const [graph, setGraph] = useState<GraphData>(EMPTY_GRAPH);
  const [stats, setStats] = useState<IndexStats | null>(null);
  const [openRel, setOpenRel] = useState<string | null>(null);
  const [editReq, setEditReq] = useState(0);
  const [boardFolder, setBoardFolder] = useState('');
  const [toolReq, setToolReq] = useState<{ tool: ToolId; n: number } | null>(null);
  const [lineMode, setLineMode] = useState(false);
  const [graphFocus, setGraphFocus] = useState<{ rel: string; n: number } | null>(null);
  const [boardFocus, setBoardFocus] = useState<{ rel: string; n: number } | null>(null);
  const [treeReveal, setTreeReveal] = useState<{ rel: string; n: number } | null>(null);
  const [boardKey, setBoardKey] = useState(0);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [quick, setQuick] = useState(false);
  const [isAiAccessOpen, setIsAiAccessOpen] = useState(false);
  const [repoDrop, setRepoDrop] = useState(false);
  const [prog, setProg] = useState<ProgressInfo | null>(null);
  const [files, setFiles] = useState<Set<string>>(new Set());
  const [fileLinks, setFileLinks] = useState<[string, string][]>([]);
  const mainRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef(0);
  const bannerTimer = useRef<number | null>(null);
  const counter = useRef(0);
  const next = () => ++counter.current;

  // ---- Back/Forward view history (Board + Graph). k === 0 means "camera not known yet".
  const navRef = useRef<NavState>(createNav());
  const [navTick, setNavTick] = useState(0);
  const boardCams = useRef(new Map<string, Cam>());
  const graphCam = useRef<Cam>({ x: 0, y: 0, k: 0 });
  const [boardRestore, setBoardRestore] = useState<{ folder: string; view: Cam; n: number } | null>(null);
  const [graphRestore, setGraphRestore] = useState<{ cam: Cam; n: number } | null>(null);
  const skipRecord = useRef(false);
  const camTimer = useRef<number | null>(null);
  const setNav = (s: NavState) => {
    if (s === navRef.current) return;
    navRef.current = s;
    (window as unknown as { __nav?: NavState }).__nav = s; // test harness hook
    setNavTick((t) => t + 1);
  };
  /** Current entry with the latest known cameras folded in. */
  const withCams = (snap: NavSnap): NavSnap => ({
    ...snap,
    boardView: boardCams.current.get(snap.boardFolder) ?? snap.boardView,
    graphCam: graphCam.current.k > 0 ? { ...graphCam.current } : snap.graphCam,
  });
  const freezeCurrent = (nav: NavState): NavState => {
    const cur = nav.stack[nav.index];
    return cur ? navReplace(nav, withCams(cur)) : nav;
  };
  const camSettled = () => {
    if (camTimer.current) window.clearTimeout(camTimer.current);
    camTimer.current = window.setTimeout(() => setNav(freezeCurrent(navRef.current)), 350);
  };
  const onBoardCam = useCallback((folder: string, cam: Cam) => {
    boardCams.current.set(folder, { x: cam.x, y: cam.y, k: cam.k });
    camSettled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onGraphCam = useCallback((cam: Cam) => {
    graphCam.current = cam;
    camSettled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const offIndex = nexus.onIndexChanged((s) => {
      setStats(s);
      void nexus.getGraph().then(setGraph);
      void nexus.listNotes().then((r) => setFiles(new Set(r.notes.map((n) => n.rel))));
      void nexus.fileLinks().then(setFileLinks);
    });
    const offProg = nexus.onProgress((p) => setProg(p.label ? p : null));
    const mq = () => setSystemDark(darkQuery.matches);
    darkQuery.addEventListener('change', mq);
    return () => {
      offCount();
      offTheme();
      offIndex();
      offProg();
      darkQuery.removeEventListener('change', mq);
    };
  }, []);

  // Fetch the graph whenever a vault becomes active (index may already be ready).
  useEffect(() => {
    setGraph(EMPTY_GRAPH);
    setStats(null);
    setOpenRel(null);
    setBoardFolder('');
    navRef.current = createNav();
    boardCams.current.clear();
    graphCam.current = { x: 0, y: 0, k: 0 };
    setNavTick((t) => t + 1);
    if (!vault) return;
    // Seed the first history entry (vault root, no note); the record effect below skips this commit's stale state.
    skipRecord.current = true;
    navRef.current = navPush(navRef.current, { boardFolder: '', boardView: { x: 0, y: 0, k: 0 }, graphCam: { x: 0, y: 0, k: 0 }, selected: null, openRel: null, notePanelOpen: layoutRef.current.notePanelOpen });
    setFiles(new Set());
    setFileLinks([]);
    void nexus.listNotes().then((r) => {
      if (r.ready) {
        setStats(r.stats);
        setFiles(new Set(r.notes.map((n) => n.rel)));
        void nexus.fileLinks().then(setFileLinks);
        void nexus.getGraph().then(setGraph);
      }
    });
  }, [vault?.path]);

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
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const notify = useCallback((text: string, err?: boolean) => {
    setBanner({ text, err });
    if (bannerTimer.current) window.clearTimeout(bannerTimer.current);
    bannerTimer.current = window.setTimeout(() => setBanner(null), err ? 9000 : 4500);
  }, []);

  // Record history: folder drill / opening a note / "show in graph|board" push a new entry;
  // selection and note panel open/close only update the current entry (cameras are never reset).
  const lastFocus = useRef({ g: 0, b: 0 });
  useEffect(() => {
    if (skipRecord.current) {
      skipRecord.current = false;
      lastFocus.current = { g: graphFocus?.n ?? 0, b: boardFocus?.n ?? 0 };
      return;
    }
    if (!vault) return;
    const nav = navRef.current;
    const cur = nav.stack[nav.index];
    const focusMoved = (graphFocus?.n ?? 0) !== lastFocus.current.g || (boardFocus?.n ?? 0) !== lastFocus.current.b;
    lastFocus.current = { g: graphFocus?.n ?? 0, b: boardFocus?.n ?? 0 };
    const snap = withCams({ boardFolder, boardView: { x: 0, y: 0, k: 0 }, graphCam: { x: 0, y: 0, k: 0 }, selected, openRel, notePanelOpen: layout.notePanelOpen });
    if (!cur) return setNav(navPush(nav, snap));
    const navigated = cur.boardFolder !== boardFolder || (openRel !== null && cur.openRel !== openRel) || focusMoved;
    if (navigated) setNav(navPush(freezeCurrent(nav), snap));
    else setNav(navReplace(nav, { ...withCams(cur), selected, openRel, notePanelOpen: layout.notePanelOpen }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.path, boardFolder, selected, openRel, layout.notePanelOpen, graphFocus?.n, boardFocus?.n]);

  const applySnap = (s: NavSnap) => {
    setBoardFolder(s.boardFolder);
    setSelected(s.selected);
    setOpenRel(s.openRel);
    if (s.openRel) setTreeReveal({ rel: s.openRel, n: next() });
    if (s.notePanelOpen !== layoutRef.current.notePanelOpen) setLayout({ notePanelOpen: s.notePanelOpen });
    if (s.boardView.k > 0) {
      boardCams.current.set(s.boardFolder, s.boardView);
      setBoardRestore({ folder: s.boardFolder, view: s.boardView, n: next() });
    }
    if (s.graphCam.k > 0) {
      graphCam.current = s.graphCam;
      setGraphRestore({ cam: s.graphCam, n: next() });
    }
  };
  const goBack = () => {
    const r = navBack(freezeCurrent(navRef.current));
    if (!r) return;
    setNav(r.state);
    applySnap(r.snap);
  };
  const goForward = () => {
    const r = navForward(freezeCurrent(navRef.current));
    if (!r) return;
    setNav(r.state);
    applySnap(r.snap);
  };
  const goRef = useRef({ goBack, goForward });
  goRef.current = { goBack, goForward };

  // ---- global keys
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && vault) {
        e.preventDefault();
        setQuick((q) => !q);
      }
      // Alt+Left / Alt+Right: Back / Forward (not while typing in a field).
      if (vault && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        e.preventDefault();
        if (e.key === 'ArrowLeft') goRef.current.goBack();
        else goRef.current.goForward();
      }
    };
    // Mouse side buttons (X1 = back, X2 = forward).
    const m = (e: MouseEvent) => {
      if (!vault || (e.button !== 3 && e.button !== 4)) return;
      e.preventDefault();
      if (e.button === 3) goRef.current.goBack();
      else goRef.current.goForward();
    };
    window.addEventListener('keydown', k);
    window.addEventListener('mouseup', m);
    return () => {
      window.removeEventListener('keydown', k);
      window.removeEventListener('mouseup', m);
    };
  }, [vault]);

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
      notify(`Safe copy created at ${v.path}`);
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
  const openCode = (p: string) =>
    run('Opening code project…', async () => {
      const v = await nexus.openCode(p);
      setRepoDrop(false);
      await afterOpen(v);
      setLayout({ view: 'split' });
      notify(`Opened ${v.name} read-only (code architecture mode)${v.source ? ' — extracted to ' + v.path : ''}`);
    });
  const removeRecent = async (p: string) => {
    await nexus.removeRecent(p);
    await refreshRecent();
  };

  // ---- actions shared via context
  const ask = useCallback<AppActions['ask']>(
    (title, initial = '', opts) => new Promise((resolve) => setPrompt({ title, initial, ...opts, resolve })),
    [],
  );
  const ensureVisible = (pane: 'graph' | 'board') => {
    const l = layoutRef.current;
    if (l.view !== 'split' && l.view !== pane) setLayout({ view: 'split' });
  };
  const actions: AppActions | null = useMemo(() => {
    if (!vault) return null;
    return {
      vault,
      graph,
      indexVersion: stats?.version ?? 0,
      files,
      fileLinks,
      readOnly: vault.readOnly,
      ask,
      notify,
      openNote: (rel, opts) => {
        setOpenRel(rel);
        setSelected(rel);
        setTreeReveal({ rel, n: next() });
        if (opts?.edit) setEditReq(next());
        if (!layoutRef.current.notePanelOpen) setLayout({ notePanelOpen: true });
      },
      select: (rel) => setSelected(rel),
      showInGraph: (rel) => {
        ensureVisible('graph');
        setSelected(rel);
        setGraphFocus({ rel, n: next() });
      },
      openOnBoard: (rel, kind) => {
        ensureVisible('board');
        if (kind === 'folder') setBoardFolder(rel);
        else setBoardFolder(dirOf(rel));
        setBoardFocus({ rel, n: next() });
      },
      newNote: async (dir) => {
        const name = await ask('New note', 'Untitled', { okLabel: 'Create' });
        if (!name) return null;
        try {
          const rel = await nexus.createNote(dir, name, `# ${name.replace(/\.md$/i, '')}\n\n`);
          setOpenRel(rel);
          setSelected(rel);
          setEditReq(next());
          if (!layoutRef.current.notePanelOpen) setLayout({ notePanelOpen: true });
          return rel;
        } catch (e) {
          notify(errMsg(e), true);
          return null;
        }
      },
      newFolder: async (dir) => {
        const name = await ask('New folder', 'New folder', { okLabel: 'Create' });
        if (!name) return null;
        try {
          return await nexus.createFolder(dir, name);
        } catch (e) {
          notify(errMsg(e), true);
          return null;
        }
      },
      renamed: (oldRel, newRel) => {
        const fix = (p: string) => (p === oldRel ? newRel : p.startsWith(oldRel + '/') ? newRel + p.slice(oldRel.length) : p);
        setOpenRel((o) => (o ? fix(o) : o));
        setBoardFolder((f) => fix(f));
        setBoardKey((k) => k + 1);
      },
      deleted: (rel) => {
        setOpenRel((o) => (o && (o === rel || o.startsWith(rel + '/')) ? null : o));
        setBoardFolder((f) => (f === rel || f.startsWith(rel + '/') ? dirOf(rel) : f));
        setSelected(null);
      },
      nav: {
        canBack: canBack(navRef.current),
        canForward: canForward(navRef.current),
        back: () => goRef.current.goBack(),
        forward: () => goRef.current.goForward(),
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, graph, stats?.version, files, fileLinks, ask, notify, navTick]);

  if (!ready) return <div className="app" />;

  const countText = noteCount ? `${noteCount.count.toLocaleString()} notes${noteCount.done ? '' : ' (counting…)'}` : 'counting…';
  const toolWidth = layout.toolStripExpanded ? LIMITS.toolExpanded : LIMITS.toolCollapsed;
  const swap = () => setLayout({ paneOrder: layout.paneOrder === 'board-graph' ? 'graph-board' : 'board-graph' });
  const maxToggle = (pane: ViewMode) => () => setLayout({ view: layout.view === pane ? 'split' : pane });

  const board = (
    <BoardPane
      key={`${vault?.path}:${boardKey}`}
      view={layout.view}
      onMax={maxToggle('board')}
      folder={boardFolder}
      setFolder={setBoardFolder}
      toolReq={toolReq}
      lineMode={lineMode}
      setLineMode={setLineMode}
      focus={boardFocus}
      selectedRel={selected}
      readOnly={vault?.readOnly}
      onCam={onBoardCam}
      restoreView={boardRestore}
    />
  );
  const graphPane = <GraphPane view={layout.view} onMax={maxToggle('graph')} dark={resolved === 'dark'} selected={selected} focus={graphFocus} nodeSize={layout.graphNodeSize} linkWidth={layout.graphLinkWidth} onSizes={(p, persist) => setLayout(p, persist)} onCam={onGraphCam} restoreCam={graphRestore} />;
  const [left, right] = layout.paneOrder === 'board-graph' ? [board, graphPane] : [graphPane, board];

  const mainWidth = () => mainRef.current?.clientWidth ?? 1000;
  const clampRatio = (r: number) => {
    const w = mainWidth() - 7;
    const min = Math.min(0.5, LIMITS.paneMin / Math.max(1, w));
    return Math.min(1 - min, Math.max(min, r));
  };
  const clampNote = (w: number) => Math.min(LIMITS.noteMax, Math.max(LIMITS.noteMin, w));

  const onTool = (t: ToolId) => {
    if (layout.view === 'graph') setLayout({ view: 'split' });
    if (t === 'line') setLineMode(!lineMode);
    else setToolReq({ tool: t, n: next() });
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
        onSearch={() => setQuick(true)}
        onOpenCode={() => setRepoDrop(true)}
        onAiAccess={() => setIsAiAccessOpen(true)}
      />
      <div className="body">
        {!vault && banner && (
          <div className={`banner${banner.err ? ' err' : ''}`} style={{ top: 52 }}>
            <span>{banner.text}</span>
            <button onClick={() => setBanner(null)} title="Dismiss">✕</button>
          </div>
        )}
        {!vault || !actions ? (
          <VaultPicker recent={recent} busy={busy} onOpenCopy={() => void openCopy()} onOpenReal={() => void openReal()} onOpenRecent={(p) => void openRecent(p)} onRemove={(p) => void removeRecent(p)} onOpenCode={() => setRepoDrop(true)} />
        ) : (
          <Ctx.Provider value={actions}>
            <FolderTree vault={vault} width={layout.treeWidth} selected={selected} openRel={openRel} onSelect={(rel) => setSelected(rel)} reveal={treeReveal} />
            <Divider
              testId="div-tree"
              onStart={() => (dragStart.current = layout.treeWidth)}
              onDrag={(dx) => setLayout({ treeWidth: Math.min(LIMITS.treeMax, Math.max(LIMITS.treeMin, dragStart.current + dx)) }, false)}
              onEnd={(dx) => setLayout({ treeWidth: Math.min(LIMITS.treeMax, Math.max(LIMITS.treeMin, dragStart.current + dx)) })}
              onReset={() => setLayout({ treeWidth: DEFAULT_LAYOUT.treeWidth })}
            />
            <ToolStrip expanded={layout.toolStripExpanded} width={toolWidth} lineMode={lineMode} onTool={onTool} readOnly={vault.readOnly} />
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
                <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>{layout.view === 'board' ? board : graphPane}</div>
              )}
            </div>
            {layout.notePanelOpen ? (
              <>
                <Divider
                  testId="div-note"
                  onStart={() => (dragStart.current = layout.notePanelWidth)}
                  onDrag={(dx) => setLayout({ notePanelWidth: clampNote(dragStart.current - dx) }, false)}
                  onEnd={(dx) => setLayout({ notePanelWidth: clampNote(dragStart.current - dx) })}
                  onReset={() => setLayout({ notePanelWidth: DEFAULT_LAYOUT.notePanelWidth })}
                />
                <NotePanel rel={openRel} editRequest={editReq} width={layout.notePanelWidth} onClose={() => setLayout({ notePanelOpen: false })} readOnly={vault.readOnly} />
              </>
            ) : (
              <button className="npopen" title="Show note panel" onClick={() => setLayout({ notePanelOpen: true })}>
                ‹ Note
              </button>
            )}
            {quick && (
              <QuickSearch
                onClose={() => setQuick(false)}
                onPick={(rel) => {
                  setQuick(false);
                  actions.openNote(rel);
                  setGraphFocus({ rel, n: next() });
                }}
              />
            )}
          </Ctx.Provider>
        )}
        {prompt && <PromptModal p={prompt} onDone={() => setPrompt(null)} />}

        {isAiAccessOpen && <AiAccess onClose={() => setIsAiAccessOpen(false)} />}

        {repoDrop && <RepoDrop recent={recent} busy={!!busy || !!prog} onOpen={(p) => void openCode(p)} onOpenRecent={(p) => void openRecent(p).then(() => setRepoDrop(false))} onClose={() => setRepoDrop(false)} />}
        {prog && (
          <div className="progress" data-testid="progress">
            <div>{prog.label}{prog.total > 0 ? ` ${Math.round((prog.done / prog.total) * 100)}%` : ''}</div>
            <div className="bar"><i style={{ width: prog.total > 0 ? `${(prog.done / prog.total) * 100}%` : '30%' }} className={prog.total > 0 ? '' : 'indet'} /></div>
          </div>
        )}
      </div>
      <StatusBar selected={selected} noteCount={countText} vault={vault} stats={stats} readOnly={vault?.readOnly} />
    </div>
  );
}
