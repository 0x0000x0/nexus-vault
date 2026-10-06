// Deterministic ArchModel → BoardData nested group layout (0.0.7). Grok Bot.
import type { ArchEdge, ArchKind, ArchModel, ArchNode } from './arch';
import type { BoardData, BoardEdge, BoardNode } from './types';

const KIND_COLOR: Partial<Record<ArchKind, string>> = {
  system: 'purple',
  app: 'blue',
  store: 'green',
  component: '',
  external: 'yellow',
  actor: 'red',
  domain: 'purple',
};

const PAD = 28;
const HEADER = 36;
const GAP = 20;
const COMP_W = 150;
const COMP_H = 72;
const EXT_W = 140;
const EXT_H = 56;

function childrenOf(model: ArchModel, parentId: string | null): ArchNode[] {
  return model.nodes.filter((n) => n.parentId === parentId);
}

function measure(model: ArchModel, node: ArchNode): { w: number; h: number } {
  const kids = childrenOf(model, node.id);
  if (!kids.length) {
    if (node.kind === 'external' || node.kind === 'actor') return { w: EXT_W, h: EXT_H };
    if (node.kind === 'component') return { w: COMP_W, h: COMP_H };
    return { w: 220, h: 100 };
  }
  // Apps/stores: grid of children; system: row of apps + column of stores/externals
  if (node.kind === 'system' || node.kind === 'domain') {
    const apps = kids.filter((k) => k.kind === 'app' || k.kind === 'component');
    const stores = kids.filter((k) => k.kind === 'store');
    const exts = kids.filter((k) => k.kind === 'external' || k.kind === 'actor');
    const appSizes = apps.map((a) => measure(model, a));
    const storeSizes = stores.map((s) => measure(model, s));
    const extSizes = exts.map((e) => measure(model, e));
    const appsW = appSizes.reduce((s, x) => s + x.w, 0) + Math.max(0, apps.length - 1) * GAP;
    const appsH = appSizes.reduce((s, x) => Math.max(s, x.h), 0);
    const storesW = storeSizes.reduce((s, x) => Math.max(s, x.w), 0);
    const storesH = storeSizes.reduce((s, x) => s + x.h, 0) + Math.max(0, stores.length - 1) * GAP;
    const extsW = extSizes.reduce((s, x) => Math.max(s, x.w), EXT_W);
    const extsH = extSizes.reduce((s, x) => s + x.h, 0) + Math.max(0, exts.length - 1) * 12;
    const sideW = Math.max(storesW, extsW, 0);
    const sideH = storesH + (stores.length && exts.length ? GAP : 0) + extsH;
    const w = PAD * 2 + appsW + (sideW ? GAP + sideW : 0);
    const h = HEADER + PAD * 2 + Math.max(appsH, sideH, 80);
    return { w: Math.max(w, 420), h: Math.max(h, 200) };
  }
  // app / store / component with children: grid
  const sizes = kids.map((k) => measure(model, k));
  const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(kids.length))));
  let maxRowH = 0;
  let rowW = 0;
  let totalH = 0;
  let maxW = 0;
  sizes.forEach((sz, i) => {
    if (i % cols === 0 && i > 0) {
      maxW = Math.max(maxW, rowW);
      totalH += maxRowH + GAP;
      rowW = 0;
      maxRowH = 0;
    }
    rowW += sz.w + (i % cols === 0 ? 0 : GAP);
    maxRowH = Math.max(maxRowH, sz.h);
  });
  maxW = Math.max(maxW, rowW);
  totalH += maxRowH;
  return { w: Math.max(PAD * 2 + maxW, 260), h: HEADER + PAD * 2 + totalH };
}

function place(
  model: ArchModel,
  node: ArchNode,
  x: number,
  y: number,
  out: BoardNode[],
): { w: number; h: number } {
  const sz = measure(model, node);
  const color = KIND_COLOR[node.kind];
  const label =
    node.kind === 'system' || node.kind === 'domain'
      ? `${node.name}`
      : node.caption && node.caption !== node.name
        ? `${node.name}`
        : node.name;
  const caption =
    node.kind === 'system'
      ? node.caption || 'System'
      : node.kind === 'app'
        ? 'App'
        : node.kind === 'store'
          ? 'Store'
          : node.kind === 'external'
            ? 'Package'
            : node.kind === 'component'
              ? undefined
              : node.kind;

  out.push({
    id: node.id,
    type: 'group',
    x,
    y,
    w: sz.w,
    h: sz.h,
    text: caption ? `${label} · ${caption}` : label,
    color: color || undefined,
  });

  const kids = childrenOf(model, node.id);
  if (!kids.length) return sz;

  if (node.kind === 'system' || node.kind === 'domain') {
    const apps = kids.filter((k) => k.kind === 'app' || k.kind === 'component');
    const stores = kids.filter((k) => k.kind === 'store');
    const exts = kids.filter((k) => k.kind === 'external' || k.kind === 'actor');
    let cx = x + PAD;
    const cy = y + HEADER + PAD;
    for (const a of apps) {
      const asz = place(model, a, cx, cy, out);
      cx += asz.w + GAP;
    }
    let sy = cy;
    const sx = apps.length ? cx : x + PAD;
    for (const s of stores) {
      const ssz = place(model, s, sx, sy, out);
      sy += ssz.h + GAP;
    }
    for (const e of exts) {
      const esz = place(model, e, sx, sy, out);
      sy += esz.h + 12;
    }
    return sz;
  }

  const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(kids.length))));
  let cx = x + PAD;
  let cy = y + HEADER + PAD;
  let rowH = 0;
  kids.forEach((k, i) => {
    if (i > 0 && i % cols === 0) {
      cx = x + PAD;
      cy += rowH + GAP;
      rowH = 0;
    }
    const ksz = place(model, k, cx, cy, out);
    cx += ksz.w + GAP;
    rowH = Math.max(rowH, ksz.h);
  });
  return sz;
}

function mapEdges(model: ArchModel, nodeIds: Set<string>): BoardEdge[] {
  return model.edges
    .filter((e: ArchEdge) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      label: e.weight && e.weight > 1 ? `${e.label ?? 'imports'} ×${e.weight}` : e.label ?? 'imports',
      link: true,
    }));
}

/**
 * Layout an ArchModel as nested Board groups. Stable ids = ArchNode.id.
 * Pure / deterministic for a given model.
 */
export function layoutArch(model: ArchModel, _canvasSize?: { w: number; h: number }): BoardData {
  const roots = childrenOf(model, null);
  const root = roots.find((n) => n.id === model.rootId) ?? roots[0];
  const nodes: BoardNode[] = [];
  if (root) place(model, root, 40, 40, nodes);
  else {
    // orphan nodes
    let x = 40;
    for (const n of model.nodes) {
      place(model, n, x, 40, nodes);
      x += 280;
    }
  }
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    edges: mapEdges(model, ids),
    hidden: [],
    view: { x: 0, y: 0, k: 0.85 },
  };
}

/** Children of a group that lie geometrically inside it (for zoom-to-bbox). */
export function nodesInsideGroup(board: BoardData, groupId: string): BoardNode[] {
  const g = board.nodes.find((n) => n.id === groupId);
  if (!g) return [];
  return board.nodes.filter(
    (n) => n.id !== groupId && n.x >= g.x && n.y >= g.y && n.x + n.w <= g.x + g.w && n.y + n.h <= g.y + g.h,
  );
}
