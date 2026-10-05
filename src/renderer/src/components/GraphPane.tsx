// Interactive force-directed graph of notes (react-force-graph-2d / d3-force, bundled locally). Grok Bot.
import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-2d';
import type { GraphNode, ViewMode } from '../../../shared/types';
import { folderColor, useApp } from '../ctx';
import { GraphIcon } from './icons';
import { MaxBtn } from './Panes';

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
}

const idOf = (v: string | N) => (typeof v === 'string' ? v : (v.id as string));

export function GraphPane({ view, onMax, dark, selected, focus, nodeSize, linkWidth, onSizes }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const app = useApp();
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<N, L>>();
  const [size, setSize] = useState({ w: 400, h: 300 });
  const [hover, setHover] = useState<string | null>(null);
  const [showGhosts, setShowGhosts] = useState(true);
  const [showOrphans, setShowOrphans] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const prevNodes = useRef(new Map<string, N>());
  const fitted = useRef('');

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
    const c = new Map<string, number>();
    for (const n of app.graph.nodes) if (!n.ghost && n.folder) c.set(n.folder, (c.get(n.folder) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  }, [app.graph]);

  // Keep node objects (and their positions) stable across index updates.
  const data = useMemo(() => {
    const keep = new Map<string, N>();
    let nodes = app.graph.nodes.filter((n) => (showGhosts || !n.ghost) && (showOrphans || n.degree > 0));
    const ids = new Set(nodes.map((n) => n.id));
    const links: L[] = app.graph.links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => ({ source: l.source, target: l.target }));
    nodes = nodes.map((n) => {
      const old = prevNodes.current.get(n.id);
      const nn: N = old ? Object.assign(old, n) : { ...n };
      keep.set(n.id, nn);
      return nn;
    });
    prevNodes.current = keep;
    return { nodes: nodes as N[], links };
  }, [app.graph, showGhosts, showOrphans]);

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

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength(-60);
    fg.d3Force('link')?.distance(40);
  }, []);

  // External focus requests ("Show in graph").
  useEffect(() => {
    if (!focus) return;
    const fg = fgRef.current;
    const n = prevNodes.current.get(focus.rel);
    if (!fg || !n || n.x === undefined || n.y === undefined) return;
    fg.centerAt(n.x, n.y, 600);
    fg.zoom(Math.max(2, fg.zoom()), 600);
    setHover(focus.rel);
    const t = setTimeout(() => setHover(null), 2500);
    return () => clearTimeout(t);
  }, [focus]);

  const [zoomK, setZoomK] = useState(1);
  const zoomBy = (f: number) => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.zoom(Math.min(12, Math.max(0.05, fg.zoom() * f)), 250);
  };

  const hl = hover ? neighbors.get(hover) ?? new Set<string>() : null;
  const colors = dark
    ? { text: '#dcddde', link: 'rgba(160,160,160,0.28)', linkHl: '#8b6cf6', ghost: '#555', bg: '#1e1e1e' }
    : { text: '#1f1f1f', link: 'rgba(90,90,90,0.25)', linkHl: '#8b6cf6', ghost: '#bdbdbd', bg: '#f7f7f5' };

  // Only the most-linked ~12% get a permanent label; others show on hover / zoom-in.
  const labelDegree = useMemo(() => {
    const d = app.graph.nodes.map((n) => n.degree).sort((a, b) => b - a);
    return Math.max(4, d[Math.floor(d.length * 0.12)] ?? 4);
  }, [app.graph]);
  // Obsidian-like sizing: ~3px base on screen, growing gently (log) with links, capped at ~2x for hubs.
  // Radius is computed in screen pixels and only grows slowly when zooming in (scale^0.3).
  const nodePx = (n: N) => nodeSize * (3 + Math.min(3, 1.1 * Math.log2(1 + (n.degree ?? 0))));
  const nodeR = (n: N, scale: number) => (nodePx(n) * Math.pow(scale, 0.3)) / scale;

  return (
    <section className="pane" style={{ flex: 1 }} data-pane="graph">
      <div className="panehead">
        <GraphIcon size={13} />
        <b>Graph</b> <span className="hcount">{app.graph.nodes.filter((n) => !n.ghost).length} {app.readOnly ? (app.graph.nodes.some((n) => n.id.startsWith('dir:')) ? 'folders (collapsed)' : 'files') : 'notes'} · {app.graph.links.length} {app.readOnly ? 'imports' : 'links'}</span>
        <div className="r">
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
          <button className="chipbtn" onClick={() => fgRef.current?.zoomToFit(400, 30)} title="Zoom to fit">
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
            </div>
          )}
        </div>
        <div className="zoombar" onPointerDown={(e) => e.stopPropagation()} data-testid="graph-zoombar">
          <button onClick={() => zoomBy(1 / 1.3)} title="Zoom out (or scroll)" data-testid="graph-zoom-out">−</button>
          <span data-testid="graph-zoom-pct">{Math.round(zoomK * 100)}%</span>
          <button onClick={() => zoomBy(1.3)} title="Zoom in (or scroll)" data-testid="graph-zoom-in">+</button>
          <button onClick={() => fgRef.current?.zoomToFit(400, 30)} title="Zoom to fit">⤢</button>
        </div>
        {folders.length > 0 && (
          <div className="legend">
            {folders.slice(0, 8).map((f) => (
              <div key={f}>
                <i style={{ background: folderColor(f, folders) }} />
                {f}
              </div>
            ))}
            <div>
              <i style={{ background: folderColor('', folders) }} />
              (root)
            </div>
          </div>
        )}
        {app.graph.version < 0 || (app.graph.nodes.length === 0 && app.indexVersion <= 0) ? (
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
          cooldownTicks={200}
          minZoom={0.05}
          maxZoom={12}
          onZoom={(t) => setZoomK(t.k)}
          warmupTicks={30}
          onEngineStop={() => {
            // Fit once per vault, and again when the graph size changes a lot (e.g. index finished late).
            const key = `${app.vault.path}:${Math.round(Math.log2(data.nodes.length + 1))}`;
            if (fitted.current !== key && data.nodes.length) {
              fitted.current = key;
              fgRef.current?.zoomToFit(400, 30);
            }
          }}
          linkColor={(l) => (hover && (idOf(l.source) === hover || idOf(l.target) === hover) ? colors.linkHl : colors.link)}
          linkWidth={(l) => linkWidth * (hover && (idOf(l.source) === hover || idOf(l.target) === hover) ? 1.6 : 0.6)}
          linkDirectionalArrowLength={(l) => (hover && (idOf(l.source) === hover || idOf(l.target) === hover) ? 2.5 : 0)}
          linkDirectionalArrowRelPos={0.92}
          onNodeHover={(n) => {
            setHover(n ? (n.id as string) : null);
            if (wrapRef.current) wrapRef.current.style.cursor = n ? 'pointer' : 'grab';
          }}
          onNodeClick={(n) => {
            const id = n.id as string;
            if (n.ghost) {
              app.notify(app.readOnly ? `"${n.title}" is an external package (not in this repo).` : `"${n.title}" does not exist yet (unresolved link).`);
              return;
            }
            if (id.startsWith('dir:')) {
              const d = id.slice(4);
              app.openOnBoard(d === '(root)' ? '' : d, 'folder');
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
          nodeCanvasObject={(n, ctx, scale) => {
            const id = n.id as string;
            const r = nodeR(n, scale);
            const dim = hl && id !== hover && !hl.has(id);
            const color = n.ghost ? colors.ghost : folderColor(n.folder, folders);
            ctx.globalAlpha = dim ? 0.15 : 1;
            ctx.beginPath();
            ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
            if (n.ghost) {
              ctx.strokeStyle = colors.text;
              ctx.globalAlpha *= 0.4;
              ctx.lineWidth = 0.8 / scale;
              ctx.stroke();
              ctx.globalAlpha = dim ? 0.15 : 1;
            }
            if (id === selected || id === hover) {
              ctx.beginPath();
              ctx.arc(n.x!, n.y!, r + 2.5 / scale, 0, 2 * Math.PI);
              ctx.strokeStyle = '#8b6cf6';
              ctx.lineWidth = 1.5 / scale;
              ctx.stroke();
            }
            const important = id === hover || id === selected || (hl && hl.has(id));
            // Labels: constant ~11px on screen (independent of node size); non-highlighted labels fade out when zoomed out.
            const fade = important ? 1 : Math.max(0, Math.min(1, (scale - 0.6) / 0.8));
            if (showLabels && fade > 0.02 && (important || scale > 1.8 || (n.degree ?? 0) >= labelDegree)) {
              const fs = 11 / scale;
              ctx.font = `${important ? 600 : 400} ${fs}px "Segoe UI", system-ui, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillStyle = colors.text;
              ctx.globalAlpha = (dim ? 0.15 : n.ghost ? 0.55 : 0.9) * fade;
              ctx.fillText(n.title, n.x!, n.y! + r + 2 / scale);
            }
            ctx.globalAlpha = 1;
          }}
          nodePointerAreaPaint={(n, color, ctx, scale) => {
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
