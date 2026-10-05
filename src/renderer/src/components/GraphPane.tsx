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
}

const idOf = (v: string | N) => (typeof v === 'string' ? v : (v.id as string));

export function GraphPane({ view, onMax, dark, selected, focus }: Props) {
  const app = useApp();
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<N, L>>();
  const [size, setSize] = useState({ w: 400, h: 300 });
  const [hover, setHover] = useState<string | null>(null);
  const [showGhosts, setShowGhosts] = useState(true);
  const [showOrphans, setShowOrphans] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const prevNodes = useRef(new Map<string, N>());
  const fitted = useRef(false);

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
    fg.zoom(Math.max(2.2, fg.zoom()), 600);
    setHover(focus.rel);
    const t = setTimeout(() => setHover(null), 2500);
    return () => clearTimeout(t);
  }, [focus]);

  const hl = hover ? neighbors.get(hover) ?? new Set<string>() : null;
  const colors = dark
    ? { text: '#dcddde', link: 'rgba(160,160,160,0.28)', linkHl: '#8b6cf6', ghost: '#555', bg: '#1e1e1e' }
    : { text: '#1f1f1f', link: 'rgba(90,90,90,0.25)', linkHl: '#8b6cf6', ghost: '#bdbdbd', bg: '#f7f7f5' };

  // Only the most-linked ~12% get a permanent label; others show on hover / zoom-in.
  const labelDegree = useMemo(() => {
    const d = app.graph.nodes.map((n) => n.degree).sort((a, b) => b - a);
    return Math.max(4, d[Math.floor(d.length * 0.12)] ?? 4);
  }, [app.graph]);
  const nodeR = (n: N) => 3 + Math.sqrt(n.degree ?? 0) * 1.6;

  return (
    <section className="pane" style={{ flex: 1 }} data-pane="graph">
      <div className="panehead">
        <GraphIcon size={13} />
        <b>Graph</b> <span className="hcount">{app.graph.nodes.filter((n) => !n.ghost).length} notes · {app.graph.links.length} links</span>
        <div className="r">
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
          <MaxBtn single={view === 'graph'} onMax={onMax} />
        </div>
      </div>
      <div className="graphbg" ref={wrapRef} data-testid="graph-canvas">
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
          warmupTicks={30}
          onEngineStop={() => {
            if (!fitted.current && data.nodes.length) {
              fitted.current = true;
              fgRef.current?.zoomToFit(400, 30);
            }
          }}
          linkColor={(l) => (hover && (idOf(l.source) === hover || idOf(l.target) === hover) ? colors.linkHl : colors.link)}
          linkWidth={(l) => (hover && (idOf(l.source) === hover || idOf(l.target) === hover) ? 1.8 : 0.8)}
          linkDirectionalArrowLength={(l) => (hover && (idOf(l.source) === hover || idOf(l.target) === hover) ? 4 : 0)}
          linkDirectionalArrowRelPos={0.92}
          onNodeHover={(n) => {
            setHover(n ? (n.id as string) : null);
            if (wrapRef.current) wrapRef.current.style.cursor = n ? 'pointer' : 'grab';
          }}
          onNodeClick={(n) => {
            const id = n.id as string;
            if (n.ghost) {
              app.notify(`"${n.title}" does not exist yet (unresolved link).`);
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
            const r = nodeR(n);
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
              ctx.lineWidth = 0.6;
              ctx.stroke();
              ctx.globalAlpha = dim ? 0.15 : 1;
            }
            if (id === selected || id === hover) {
              ctx.beginPath();
              ctx.arc(n.x!, n.y!, r + 2.5, 0, 2 * Math.PI);
              ctx.strokeStyle = '#8b6cf6';
              ctx.lineWidth = 1.5;
              ctx.stroke();
            }
            const important = id === hover || id === selected || (hl && hl.has(id));
            if (showLabels && (important || scale > 2.2 || (n.degree ?? 0) >= labelDegree)) {
              const fs = Math.max(10 / scale, 2.5);
              ctx.font = `${important ? 600 : 400} ${fs}px "Segoe UI", system-ui, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillStyle = colors.text;
              ctx.globalAlpha = dim ? 0.15 : n.ghost ? 0.55 : 0.9;
              ctx.fillText(n.title, n.x!, n.y! + r + 2);
            }
            ctx.globalAlpha = 1;
          }}
          nodePointerAreaPaint={(n, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x!, n.y!, nodeR(n) + 2, 0, 2 * Math.PI);
            ctx.fill();
          }}
        />
      </div>
    </section>
  );
}
