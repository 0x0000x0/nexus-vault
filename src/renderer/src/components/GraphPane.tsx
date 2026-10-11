// Interactive force-directed graph of notes (react-force-graph-2d / d3-force, bundled locally). Grok Bot.
import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-2d';
import type { GraphNode, ViewMode } from '../../../shared/types';
import { folderColor, useApp, useIndexVersion } from '../ctx';
import { GraphIcon } from './icons';
import { MaxBtn } from './Panes';
import { NavButtons } from './NavButtons';
import { loadPositions, savePositions, type PosMap } from '../graph-pos-cache';
import type { LayoutJob, LayoutMsg } from '../graph-layout.worker';
import { LARGE, autoScale, forceBudget, inBox, largeLabelDegree, pickInitialCam, refreshBudget, shouldShowLabel, viewBoxFromTransform, type Box } from '../graphCam';

type N = NodeObject<GraphNode & { x?: number; y?: number }>;
interface L {
  source: string | N;
  target: string | N;
}

interface Props {
  view: ViewMode;
  onMax: () => void;
  dark: boolean;
  selected: string | null;
  focus: { rel: string; n: number } | null;
  nodeSize: number;
  linkWidth: number;
  onSizes: (p: { graphNodeSize?: number; graphLinkWidth?: number }, persist?: boolean) => void;
  /** Reports the graph camera (center in graph coords + zoom) after each zoom/pan settles. */
  onCam?: (cam: { x: number; y: number; k: number }) => void;
  /** Back/Forward restore request: jump to this camera once. */
  restoreCam?: { cam: { x: number; y: number; k: number }; n: number } | null;
  /** 0.0.8 collapsed-graph controls: mode/expand requests bubble to App (which owns getGraph opts). */
  onGraphOpts?: (o: { mode: 'auto' | 'full'; expand: string | null }) => void;
}

const idOf = (v: string | N) => (typeof v === 'string' ? v : (v.id as string));
/** 0.0.9: graphs at least this big get their first layout in a Web Worker instead of on the UI thread. */
const WORKER_MIN = 300;

export function GraphPane({ view, onMax, dark, selected, focus, nodeSize, linkWidth, onSizes, onCam, restoreCam, onGraphOpts }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const app = useApp();
  const indexVersion = useIndexVersion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<N, L>>();
  const [size, setSize] = useState({ w: 400, h: 300 });
  // 0.0.9: the pane stays mounted when Board is shown alone; stop its frame loop while hidden.
  const hidden = view === 'board';
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (hidden) fg.pauseAnimation();
    else fg.resumeAnimation();
  }, [hidden]);
  // 0.0.8 perf: canvas paint callbacks read this ref so hover repaints don't wait on React.
  const hoverRef = useRef<string | null>(null);
  // Last computed view box (graph coords, padded) for viewport culling.
  const viewBoxRef = useRef<Box | null>(null);
  // True while the force engine is still settling (labels are gated on large graphs).
  const engineRunning = useRef(true);
  // Collapsed-graph controls (0.0.8): 'auto' collapses large vaults, 'full' shows every note.
  const [graphMode, setGraphMode] = useState<'auto' | 'full'>('auto');
  const modeRef = useRef(graphMode);
  modeRef.current = graphMode;
  const lastDirClick = useRef<{ id: string; t: number } | null>(null);
  useEffect(() => setGraphMode('auto'), [app.vault.path]);
  const [showGhosts, setShowGhosts] = useState(true);
  const [showOrphans, setShowOrphans] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [folderFocus, setFolderFocus] = useState<string | null>(null);
  const folderFitGen = useRef(0);
  const pendingFolderFit = useRef(0);
  const prevNodes = useRef(new Map<string, N>());
  const fitted = useRef('');
  // 0.0.9: settled positions cached per vault + graph view (collapsed/expanded/full).
  const posKey = `${app.vault.path}|${app.graph.collapsed ? 'c:' + (app.graph.collapsed.expanded ?? '') : 'full'}`;
  const posCache = useRef<{ key: string; map: PosMap }>({ key: '', map: new Map() });
  if (posCache.current.key !== posKey) posCache.current = { key: posKey, map: loadPositions(posKey) };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Folder order for colors: by note count, desc.
  const folders = useMemo(() => {
    if (app.graph.folders) return app.graph.folders;
    const c = new Map<string, number>();
    for (const n of app.graph.nodes) if (!n.ghost && n.folder) c.set(n.folder, (c.get(n.folder) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  }, [app.graph]);

  // Keep node objects (and their positions) stable across index updates.
  const data = useMemo(() => {
    const keep = new Map<string, N>();
    let nodes = app.graph.nodes.filter((n) => (showGhosts || !n.ghost) && (showOrphans || n.degree > 0));
    if (folderFocus !== null) {
      const inFolder = new Set(nodes.filter((n) => !n.ghost && n.folder === folderFocus).map((n) => n.id));
      // Keep linked ghosts that touch a kept note.
      const ghostKeep = new Set<string>();
      for (const l of app.graph.links) {
        if (inFolder.has(l.source) || inFolder.has(l.target)) {
          if (l.source.startsWith('ghost:')) ghostKeep.add(l.source);
          if (l.target.startsWith('ghost:')) ghostKeep.add(l.target);
        }
      }
      nodes = nodes.filter((n) => (n.ghost ? ghostKeep.has(n.id) : n.folder === folderFocus));
    }
    const ids = new Set(nodes.map((n) => n.id));
    const links: L[] = app.graph.links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => ({ source: l.source, target: l.target }));
    const cached = posCache.current.map;
    nodes = nodes.map((n) => {
      const old = prevNodes.current.get(n.id);
      const nn: N = old ? Object.assign(old, n) : { ...n };
      if (nn.x === undefined) {
        const c = cached.get(n.id);
        if (c) {
          nn.x = c[0];
          nn.y = c[1];
        }
      }
      keep.set(n.id, nn);
      return nn;
    });
    prevNodes.current = keep;
    let positioned = 0;
    for (const x of nodes as N[]) if (x.x !== undefined && x.y !== undefined) positioned++;
    return { nodes: nodes as N[], links, positioned };
  }, [app.graph, showGhosts, showOrphans, folderFocus, posKey]);

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of data.links) {
      const s = idOf(l.source);
      const t = idOf(l.target);
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t);
      m.get(t)!.add(s);
    }
    return m;
  }, [data]);

  // 0.0.8 perf: simulation budget scaled by node count. Index refreshes that keep
  // >=90% of node positions skip warmup so editing a note doesn't re-run the layout.
  // 0.0.9: three cases. (1) every node already has a position (cache or previous layout): freeze, no
  // simulation at all; (2) >=90% positioned: short refresh; (3) big and unpositioned: layout runs in a
  // Web Worker while the canvas shows progress (engine frozen), small graphs keep the built-in engine.
  const [frozenStopped, setFrozenStopped] = useState(false);
  const useWorker = data.nodes.length >= WORKER_MIN && data.positioned / Math.max(1, data.nodes.length) < 0.9;
  const frozen = data.nodes.length > 0 && (data.positioned === data.nodes.length || useWorker);
  const workerPending = useRef(false);
  const workerDoneFor = useRef<object | null>(null);
  workerPending.current = useWorker && workerDoneFor.current !== data;
  useEffect(() => setFrozenStopped(false), [data]);
  const budget = useMemo(() => {
    const n = data.nodes.length;
    const b = n > 0 && data.positioned / n >= 0.9 ? refreshBudget(n, data.positioned) : forceBudget(n);
    return frozen ? { ...b, warmupTicks: 0, cooldownTicks: 0 } : b;
  }, [data, frozen]);
  // After a frozen start, allow a short settle again so dragging a node still pulls its neighbours.
  const cooldownTicks = frozen && frozenStopped ? Math.min(30, forceBudget(data.nodes.length).cooldownTicks) : budget.cooldownTicks;

  // ---- 0.0.9 layout worker ----
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  const redraw = useRef(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const c = fg.centerAt();
    if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) fg.centerAt(c.x, c.y); // cheapest way to flag a repaint
  });
  useEffect(() => () => workerRef.current?.terminate(), []);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength(budget.charge);
    fg.d3Force('link')?.distance(40);
  }, [budget]);

  // Re-arm the running flag whenever the dataset changes; cleared in onEngineStop.
  useEffect(() => {
    engineRunning.current = true;
  }, [data]);

  useEffect(() => {
    if (!useWorker) return;
    const nodes = data.nodes;
    const idx = new Map<string, number>();
    nodes.forEach((n, i) => idx.set(n.id as string, i));
    const xs = new Float64Array(nodes.length);
    const ys = new Float64Array(nodes.length);
    nodes.forEach((n, i) => {
      xs[i] = n.x ?? NaN;
      ys[i] = n.y ?? NaN;
    });
    const pairs: number[] = [];
    for (const l of data.links) {
      const a = idx.get(idOf(l.source));
      const b = idx.get(idOf(l.target));
      if (a !== undefined && b !== undefined) pairs.push(a, b);
    }
    const fb = forceBudget(nodes.length);
    if (!workerRef.current) workerRef.current = new Worker(new URL('../graph-layout.worker.ts', import.meta.url), { type: 'module' });
    const w = workerRef.current;
    const job = ++jobRef.current;
    w.onmessage = (e: MessageEvent<LayoutMsg>) => {
      const m = e.data;
      if (m.job !== jobRef.current) return;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.fx !== undefined && n.fx !== null) continue;
        n.x = m.xs[i];
        n.y = m.ys[i];
      }
      if (m.done) {
        workerDoneFor.current = data;
        workerPending.current = false;
        setFrozenStopped(true);
        engineRunning.current = false;
        settled();
      }
      redraw.current();
    };
    const msg: LayoutJob = { job, xs, ys, links: new Uint32Array(pairs), charge: fb.charge, alphaDecay: fb.alphaDecay, ticks: fb.warmupTicks + fb.cooldownTicks, every: 5 };
    w.postMessage(msg, [xs.buffer, ys.buffer]);
    return () => w.postMessage({ cancel: job });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, useWorker]);

  // External focus requests ("Show in graph").
  useEffect(() => {
    if (!focus) return;
    const fg = fgRef.current;
    const n = prevNodes.current.get(focus.rel);
    if (!fg || !n || n.x === undefined || n.y === undefined) return;
    fg.centerAt(n.x, n.y, 600);
    fg.zoom(Math.max(2, fg.zoom()), 600);
    hoverRef.current = focus.rel;
    const t = setTimeout(() => {
      if (hoverRef.current === focus.rel) hoverRef.current = null;
      redraw.current();
    }, 2500);
    return () => clearTimeout(t);
  }, [focus]);

  // Back/Forward history: jump to a stored camera (no animation) and stop the first-fit from overriding it.
  const restoredN = useRef(0);
  useEffect(() => {
    const fg = fgRef.current;
    if (!restoreCam || restoreCam.n === restoredN.current || !fg) return;
    restoredN.current = restoreCam.n;
    fitted.current = `${app.vault.path}:${Math.round(Math.log2(data.nodes.length + 1))}`;
    fg.centerAt(restoreCam.cam.x, restoreCam.cam.y, 0);
    fg.zoom(restoreCam.cam.k, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreCam]);
  const reportCam = () => {
    const fg = fgRef.current;
    if (!fg || !onCam) return;
    const c = fg.centerAt();
    if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) onCam({ x: c.x, y: c.y, k: fg.zoom() });
  };

  const zoomPctRef = useRef<HTMLSpanElement>(null);
  // 0.0.9: zoom % is written straight into the DOM; zooming never re-renders this pane.
  const handleZoom = (t: { k: number }) => {
    if (zoomPctRef.current) zoomPctRef.current.textContent = `${Math.round(t.k * 100)}%`;
  };
  const zoomBy = (f: number) => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.zoom(Math.min(12, Math.max(0.05, fg.zoom() * f)), 250);
  };

  // 0.0.8 perf: hover id lives in a ref for canvas paint callbacks; React state only
  // updates when the id actually changes (panel), while fg.refresh() repaints at once.
  const handleHover = (n: N | null | undefined) => {
    const id = n ? (n.id as string) : null;
    if (hoverRef.current !== id) {
      // 0.0.9: hover never re-renders React; just flag a canvas repaint.
      hoverRef.current = id;
      redraw.current();
    }
    if (wrapRef.current) wrapRef.current.style.cursor = id ? 'pointer' : 'grab';
  };

  const colors = dark
    ? { text: '#dcddde', link: 'rgba(160,160,160,0.28)', linkHl: '#8b6cf6', ghost: '#555', bg: '#1e1e1e' }
    : { text: '#1f1f1f', link: 'rgba(90,90,90,0.25)', linkHl: '#8b6cf6', ghost: '#bdbdbd', bg: '#f7f7f5' };

  const nCount = data.nodes.length;
  const scaleAuto = autoScale(nCount);
  const labelDegree = useMemo(() => {
    const d = app.graph.nodes.map((n) => n.degree).sort((a, b) => b - a);
    return largeLabelDegree(d, app.graph.nodes.length);
  }, [app.graph]);
  // Obsidian-like sizing + autoScale for large vaults (user slider still applies).
  const nodePx = (n: N) => nodeSize * scaleAuto * (3 + Math.min(3, 1.1 * Math.log2(1 + (n.degree ?? 0))));
  const nodeR = (n: N, scale: number) => (nodePx(n) * Math.pow(scale, 0.3)) / scale;

  const toggleFolder = (f: string | null) => {
    setFolderFocus((cur) => {
      const next = cur === f ? null : f;
      pendingFolderFit.current = ++folderFitGen.current;
      return next;
    });
  };
  // 0.0.8 collapsed-graph controls.
  const collapsed = app.graph.collapsed;
  const headCount = collapsed ? app.graph.nodes.filter((n) => n.id.startsWith('dir:')).length : app.graph.nodes.filter((n) => !n.ghost).length;
  const headKind = collapsed
    ? `folders (collapsed) · ${collapsed.total} notes`
    : app.readOnly
      ? (app.graph.nodes.some((n) => n.id.startsWith('dir:')) ? 'folders (collapsed)' : 'files')
      : 'notes';
  const toggleMode = () => {
    const next = modeRef.current === 'auto' ? 'full' : 'auto';
    setGraphMode(next);
    onGraphOpts?.({ mode: next, expand: collapsed?.expanded ?? null });
  };
  const clearExpand = () => onGraphOpts?.({ mode: modeRef.current, expand: null });
  const fitVisible = () => {
    const fg = fgRef.current;
    if (!fg) return;
    if (folderFocus) {
      const ids = new Set(data.nodes.map((n) => n.id));
      (fg as unknown as { zoomToFit: (ms: number, pad: number, pred?: (n: N) => boolean) => void }).zoomToFit(400, 40, (n) => ids.has(n.id as string));
    } else {
      fg.zoomToFit(400, 30);
    }
  };

  // 0.0.9: all links in one path + one stroke (force-graph's own link painter re-grouped 25k links by
  // colour/width and called accessors per link every frame); hovered links get a second small pass.
  const paintLinks = (ctx: CanvasRenderingContext2D, scale: number, box: Box | null) => {
    const hov = hoverRef.current;
    const ls = data.links;
    const hl: [N, N][] = [];
    ctx.save();
    ctx.beginPath();
    const x0 = box ? box.x0 : -Infinity, y0 = box ? box.y0 : -Infinity, x1 = box ? box.x1 : Infinity, y1 = box ? box.y1 : Infinity;
    for (let i = 0; i < ls.length; i++) {
      const a = ls[i].source as N;
      const b = ls[i].target as N;
      if (typeof a !== 'object' || typeof b !== 'object' || a.x === undefined || b.x === undefined) continue;
      if (hov && (a.id === hov || b.id === hov)) {
        hl.push([a, b]);
        continue;
      }
      const ax = a.x, ay = a.y!, bx = b.x, by = b.y!;
      if ((ax < x0 && bx < x0) || (ax > x1 && bx > x1) || (ay < y0 && by < y0) || (ay > y1 && by > y1)) continue;
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.strokeStyle = colors.link;
    ctx.lineWidth = (linkWidth * 0.6) / scale;
    ctx.stroke();
    if (hl.length) {
      ctx.beginPath();
      for (const [a, b] of hl) {
        ctx.moveTo(a.x!, a.y!);
        ctx.lineTo(b.x!, b.y!);
      }
      ctx.strokeStyle = colors.linkHl;
      ctx.lineWidth = (linkWidth * 1.6) / scale;
      ctx.stroke();
      // direction arrows (same 2.5 length / 0.92 position as before)
      ctx.beginPath();
      for (const [a, b] of hl) {
        const dx = b.x! - a.x!, dy = b.y! - a.y!;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const px = a.x! + dx * 0.92, py = a.y! + dy * 0.92;
        ctx.moveTo(px, py);
        ctx.lineTo(px - ux * 2.5 - uy * 1, py - uy * 2.5 + ux * 1);
        ctx.lineTo(px - ux * 2.5 + uy * 1, py - uy * 2.5 - ux * 1);
        ctx.closePath();
      }
      ctx.fillStyle = colors.linkHl;
      ctx.fill();
    }
    ctx.restore();
  };

  // 0.0.9: nodes visible this frame (collected by nodeCanvasObject), painted in a few batched fills.
  const frameNodes = useRef<N[]>([]);
  const paintNodes = (ctx: CanvasRenderingContext2D, scale: number) => {
    const list = frameNodes.current;
    if (!list.length) return;
    const hov = hoverRef.current;
    const nb = hov ? neighbors.get(hov) : undefined;
    const isDim = (id: string) => !!nb && id !== hov && !nb.has(id);
    // circles: one path + fill per (colour, dim) bucket
    const buckets = new Map<string, N[]>();
    for (const n of list) {
      const key = (n.ghost ? colors.ghost : folderColor(n.folder, folders)) + (isDim(n.id as string) ? '|d' : '|');
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(n);
    }
    ctx.save();
    for (const [key, ns] of buckets) {
      const bar = key.lastIndexOf('|');
      ctx.globalAlpha = key.endsWith('|d') ? 0.15 : 1;
      ctx.fillStyle = key.slice(0, bar);
      ctx.beginPath();
      for (const n of ns) {
        const r = nodeR(n, scale);
        ctx.moveTo(n.x! + r, n.y!);
        ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
      }
      ctx.fill();
    }
    // ghost outlines
    ctx.strokeStyle = colors.text;
    ctx.lineWidth = 0.8 / scale;
    for (const dim of [false, true]) {
      ctx.beginPath();
      let any = false;
      for (const n of list) {
        if (!n.ghost || isDim(n.id as string) !== dim) continue;
        const r = nodeR(n, scale);
        ctx.moveTo(n.x! + r, n.y!);
        ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
        any = true;
      }
      if (!any) continue;
      ctx.globalAlpha = (dim ? 0.15 : 1) * 0.4;
      ctx.stroke();
    }
    // selection / hover rings
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#8b6cf6';
    ctx.lineWidth = 1.5 / scale;
    for (const n of list) {
      const id = n.id as string;
      if (id !== selected && id !== hov) continue;
      ctx.beginPath();
      ctx.arc(n.x!, n.y!, nodeR(n, scale) + 2.5 / scale, 0, 2 * Math.PI);
      ctx.stroke();
    }
    // labels
    const fs = (nCount >= LARGE ? 12 : 11) / scale;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = colors.text;
    let font = '';
    for (const n of list) {
      const id = n.id as string;
      const important = !!(id === hov || id === selected || (nb && nb.has(id)));
      // While the engine is still running on a large graph, only important nodes (or zoomed-in views) pay for fillText.
      if (nCount >= LARGE && engineRunning.current && !important && scale < 2) continue;
      if (!shouldShowLabel({ n: nCount, scale, degree: n.degree ?? 0, labelDegree, important, showLabels })) continue;
      const f = `${important ? 600 : 400} ${fs}px "Segoe UI", system-ui, sans-serif`;
      if (f !== font) ctx.font = font = f;
      const fade = important ? 1 : nCount >= LARGE ? 1 : Math.max(0, Math.min(1, (scale - 0.6) / 0.8));
      ctx.globalAlpha = (isDim(id) ? 0.15 : n.ghost ? 0.55 : 0.9) * fade;
      ctx.fillText(n.title, n.x!, n.y! + nodeR(n, scale) + 2 / scale);
    }
    ctx.restore();
  };

  /** 0.0.9: layout is final (engine stopped or worker done): cache positions, then the first-fit camera. */
  const settled = () => {
    if (data.nodes.length) savePositions(posKey, data.nodes);
    const fg = fgRef.current;
    if (!fg || !data.nodes.length) return;
    // Folder filter change → fit visible set (separate from vault first-cam).
    if (pendingFolderFit.current) {
      pendingFolderFit.current = 0;
      const ids = new Set(data.nodes.map((n) => n.id));
      (fg as unknown as { zoomToFit: (ms: number, pad: number, pred?: (n: N) => boolean) => void }).zoomToFit(400, 40, (n) => ids.has(n.id as string));
      return;
    }
    // Fit once per vault / size bucket (Back/Forward stamps fitted so we bail).
    const key = `${app.vault.path}:${Math.round(Math.log2(data.nodes.length + 1))}`;
    if (fitted.current === key) return;
    fitted.current = key;
    if (data.nodes.length < LARGE) {
      fg.zoomToFit(400, 30);
      return;
    }
    if (folderFocus !== null) {
      const ids = new Set(data.nodes.map((n) => n.id));
      (fg as unknown as { zoomToFit: (ms: number, pad: number, pred?: (n: N) => boolean) => void }).zoomToFit(400, 40, (n) => ids.has(n.id as string));
      return;
    }
    const cam = pickInitialCam(data.nodes, { selected, folderFocus });
    if (cam) {
      fg.centerAt(cam.x, cam.y, 400);
      fg.zoom(Math.min(12, Math.max(0.05, cam.k)), 400);
    } else {
      fg.zoomToFit(400, 30);
    }
  };

  return (
    <section className="pane" style={{ flex: 1 }} data-pane="graph">
      <div className="panehead">
        <NavButtons pane="graph" />
        <GraphIcon size={13} />
        <b>Graph</b> <span className="hcount">{headCount} {headKind} · {app.graph.links.length} {app.readOnly ? 'imports' : 'links'}</span>
        <div className="r">
          {(collapsed || graphMode === 'full') && !app.readOnly && (
            <>
              <button className={`chipbtn${graphMode === 'full' ? ' on' : ''}`} onClick={toggleMode} title={graphMode === 'full' ? 'Back to folder-collapsed view' : 'Show every note (slow on large vaults)'} data-testid="graph-all-notes">
                All notes (slow)
              </button>
              {collapsed?.expanded && (
                <button className="chipbtn" onClick={clearExpand} title={`Collapse ${collapsed?.expanded} back to its folder`}>
                  Collapse
                </button>
              )}
            </>
          )}
          <MaxBtn single={view === 'graph'} onMax={onMax} />
        </div>
      </div>
      <div className="graphbg" ref={wrapRef} data-testid="graph-canvas">
        <div className="gtools">
          <button className={`chipbtn${showLabels ? ' on' : ''}`} onClick={() => setShowLabels(!showLabels)} title="Show note names">
            Labels
          </button>
          <button className={`chipbtn${showGhosts ? ' on' : ''}`} onClick={() => setShowGhosts(!showGhosts)} title="Show unresolved links (notes that don't exist yet)">
            Ghosts
          </button>
          <button className={`chipbtn${showOrphans ? ' on' : ''}`} onClick={() => setShowOrphans(!showOrphans)} title="Show notes without links">
            Orphans
          </button>
          <button className="chipbtn" onClick={fitVisible} title={folderFocus ? 'Fit visible notes' : 'Fit all notes'}>
            Fit
          </button>
          <button className={`chipbtn${showSettings ? ' on' : ''}`} onClick={() => setShowSettings(!showSettings)} title="Node size and link thickness" data-testid="graph-settings">
            ⚙ Display
          </button>
          {showSettings && (
            <div className="gsettings" onPointerDown={(e) => e.stopPropagation()}>
              <label>
                <span>Node size</span>
                <input type="range" min={0.3} max={3} step={0.05} value={nodeSize} onChange={(e) => onSizes({ graphNodeSize: Number(e.target.value) }, false)} onPointerUp={(e) => onSizes({ graphNodeSize: Number((e.target as HTMLInputElement).value) })} onKeyUp={(e) => onSizes({ graphNodeSize: Number((e.target as HTMLInputElement).value) })} data-testid="node-size" />
                <b>{nodeSize.toFixed(1)}×</b>
              </label>
              <label>
                <span>Link thickness</span>
                <input type="range" min={0.3} max={3} step={0.05} value={linkWidth} onChange={(e) => onSizes({ graphLinkWidth: Number(e.target.value) }, false)} onPointerUp={(e) => onSizes({ graphLinkWidth: Number((e.target as HTMLInputElement).value) })} onKeyUp={(e) => onSizes({ graphLinkWidth: Number((e.target as HTMLInputElement).value) })} />
                <b>{linkWidth.toFixed(1)}×</b>
              </label>
              <button className="linkbtn" onClick={() => onSizes({ graphNodeSize: 1, graphLinkWidth: 1 })}>
                Reset
              </button>
              {scaleAuto !== 1 && (
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Auto size ×{scaleAuto.toFixed(1)} for {nCount} nodes
                </div>
              )}
            </div>
          )}
        </div>
        <div className="zoombar" onPointerDown={(e) => e.stopPropagation()} data-testid="graph-zoombar">
          <button onClick={() => zoomBy(1 / 1.3)} title="Zoom out (or scroll)" data-testid="graph-zoom-out">−</button>
          <span ref={zoomPctRef} data-testid="graph-zoom-pct">100%</span>
          <button onClick={() => zoomBy(1.3)} title="Zoom in (or scroll)" data-testid="graph-zoom-in">+</button>
          <button onClick={fitVisible} title={folderFocus ? 'Fit visible notes' : 'Fit all notes'}>⤢</button>
        </div>
        {folders.length > 0 && (
          <div className="legend" onPointerDown={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={`legendrow${folderFocus === null ? ' on' : ''}`}
              onClick={() => toggleFolder(null)}
              title="Show all folders"
            >
              <i style={{ background: 'var(--muted)' }} />
              All folders
            </button>
            {folders.slice(0, 8).map((f) => (
              <button
                type="button"
                key={f}
                className={`legendrow${folderFocus === f ? ' on' : ''}${folderFocus && folderFocus !== f ? ' dim' : ''}`}
                onClick={() => toggleFolder(f)}
                title={`Show only notes in ${f}`}
              >
                <i style={{ background: folderColor(f, folders) }} />
                {f}
              </button>
            ))}
            <button
              type="button"
              className={`legendrow${folderFocus === '' ? ' on' : ''}${folderFocus && folderFocus !== '' ? ' dim' : ''}`}
              onClick={() => toggleFolder('')}
              title="Show only root notes"
            >
              <i style={{ background: folderColor('', folders) }} />
              (root)
            </button>
          </div>
        )}
        {app.graph.version < 0 || (app.graph.nodes.length === 0 && indexVersion <= 0) ? (
          <div className="placeholder">
            <div className="spin" />
            Indexing notes…
          </div>
        ) : app.graph.nodes.length === 0 ? (
          <div className="placeholder">
            <h3>No notes yet</h3>
            <div>Create a note in the tree; links like [[Another note]] become lines here.</div>
          </div>
        ) : null}
        <ForceGraph2D<N, L>
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={data}
          nodeId="id"
          backgroundColor={colors.bg}
          nodeRelSize={4}
          d3AlphaDecay={budget.alphaDecay}
          cooldownTicks={cooldownTicks}
          minZoom={0.05}
          maxZoom={12}
          onZoom={handleZoom}
          onRenderFramePre={(ctx, scale) => {
            // 0.0.8 perf: visible graph-space box for culling, from this frame's canvas transform.
            const gt = ctx.getTransform();
            const box = viewBoxFromTransform({ a: gt.a, e: gt.e, f: gt.f }, ctx.canvas.width, ctx.canvas.height, 80);
            viewBoxRef.current = box;
            frameNodes.current.length = 0;
            paintLinks(ctx, scale, box);
          }}
          onRenderFramePost={(ctx, scale) => paintNodes(ctx, scale)}
          onZoomEnd={reportCam}
          warmupTicks={budget.warmupTicks}
          onEngineStop={() => {
            if (workerPending.current) return; // the worker's final positions call settled()
            engineRunning.current = false;
            if (frozen && !frozenStopped) setFrozenStopped(true);
            settled();
          }}
          linkVisibility={false}
          nodeVisibility={(n) => {
            const id = n.id as string;
            if (id === selected || id === hoverRef.current) return true;
            return inBox(viewBoxRef.current, n.x, n.y);
          }}
          onNodeHover={handleHover}
          onNodeClick={(n) => {
            const id = n.id as string;
            if (n.ghost) {
              app.notify(app.readOnly ? `"${n.title}" is an external package (not in this repo).` : `"${n.title}" does not exist yet (unresolved link).`);
              return;
            }
            if (id.startsWith('dir:')) {
              const d = id.slice(4);
              app.openOnBoard(d === '(root)' ? '' : d, 'folder');
              // Second click within 350ms on the same dir expands it into its notes.
              const now = Date.now();
              const last = lastDirClick.current;
              lastDirClick.current = { id, t: now };
              if (last && last.id === id && now - last.t < 350) {
                onGraphOpts?.({ mode: modeRef.current, expand: d });
              }
              return;
            }
            app.select(id);
            app.openNote(id);
          }}
          onNodeDragEnd={(n) => {
            n.fx = n.x;
            n.fy = n.y;
          }}
          onNodeRightClick={(n) => {
            n.fx = undefined;
            n.fy = undefined;
            fgRef.current?.d3ReheatSimulation();
          }}
          nodeCanvasObject={(n, _ctx, scale) => {
            // 0.0.9: only collect here; paintNodes() draws all visible nodes batched by colour after this pass.
            const id = n.id as string;
            if (id !== selected && id !== hoverRef.current && !inBox(viewBoxRef.current, n.x, n.y, nodeR(n, scale))) return;
            frameNodes.current.push(n);
          }}
          nodePointerAreaPaint={(n, color, ctx, scale) => {
            const id = n.id as string;
            if (id !== selected && id !== hoverRef.current && !inBox(viewBoxRef.current, n.x, n.y, nodeR(n, scale))) return;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x!, n.y!, nodeR(n, scale) + 3 / scale, 0, 2 * Math.PI);
            ctx.fill();
          }}
        />
      </div>
    </section>
  );
}
