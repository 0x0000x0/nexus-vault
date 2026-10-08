// Board geometry helpers (Grok Bot).
import type { BoardData, BoardNode } from '../../../shared/types';

export const CARD = { note: { w: 210, h: 130 }, folder: { w: 230, h: 150 }, text: { w: 180, h: 110 }, group: { w: 380, h: 260 }, image: { w: 240, h: 180 }, link: { w: 220, h: 84 } } as const;
export const GRID = { x0: 40, y0: 40, dx: 250, dy: 180, cols: 5 };

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function emptyBoard(): BoardData {
  return { nodes: [], edges: [], hidden: [] };
}

export function normalizeBoard(b: Partial<BoardData> | undefined): BoardData {
  return {
    nodes: Array.isArray(b?.nodes) ? b!.nodes.filter((n) => n && typeof n.id === 'string' && Number.isFinite(n.x) && Number.isFinite(n.y)) : [],
    edges: Array.isArray(b?.edges) ? b!.edges.filter((e) => e && e.from && e.to) : [],
    hidden: Array.isArray(b?.hidden) ? b!.hidden : [],
    view: b?.view && Number.isFinite(b.view.k) ? b.view : undefined,
  };
}

export function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, m = 12): boolean {
  return a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
}

/** First free cell in the grid (row-major) that does not overlap existing nodes. */
export function freeSlot(nodes: BoardNode[], w: number, h: number, cols: number = GRID.cols): { x: number; y: number } {
  // Build an occupancy Set of cell keys "r,c" once from existing non-group nodes,
  // then scan candidate cells against the Set in O(1) per candidate.
  const cellKeysFor = (x: number, y: number, ww: number, hh: number): string[] => {
    const c0 = Math.floor((x - GRID.x0) / GRID.dx);
    const c1 = Math.floor((x + ww - GRID.x0) / GRID.dx);
    const r0 = Math.floor((y - GRID.y0) / GRID.dy);
    const r1 = Math.floor((y + hh - GRID.y0) / GRID.dy);
    const keys: string[] = [];
    for (let r = r0; r <= r1; r++) {
      if (r < 0) continue;
      for (let c = c0; c <= c1; c++) keys.push(r + ',' + c);
    }
    return keys;
  };
  const occupied = new Set<string>();
  for (const n of nodes) {
    if (n.type === 'group') continue;
    // A node occupies a cell when overlaps() is true for that cell's rect.
    // Check the cells its bbox touches (plus neighbors for the margin).
    const c0 = Math.floor((n.x - GRID.x0) / GRID.dx) - 1;
    const c1 = Math.floor((n.x + n.w - GRID.x0) / GRID.dx) + 1;
    const r0 = Math.floor((n.y - GRID.y0) / GRID.dy) - 1;
    const r1 = Math.floor((n.y + n.h - GRID.y0) / GRID.dy) + 1;
    for (let r = Math.max(0, r0); r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = { x: GRID.x0 + c * GRID.dx, y: GRID.y0 + r * GRID.dy, w, h };
        if (overlaps(cell, n)) occupied.add(r + ',' + c);
      }
    }
    // Always mark the cells the node's own rect touches so odd sizes still block.
    for (const k of cellKeysFor(n.x, n.y, n.w, n.h)) occupied.add(k);
  }
  for (let r = 0; r < 2000; r++) {
    for (let c = 0; c < cols; c++) {
      if (!occupied.has(r + ',' + c)) {
        const cand = { x: GRID.x0 + c * GRID.dx, y: GRID.y0 + r * GRID.dy, w, h };
        return cand;
      }
    }
  }
  return { x: GRID.x0, y: GRID.y0 };
}

export function inside(inner: BoardNode, outer: BoardNode): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/** Point where the segment from rect center toward (tx,ty) leaves the rect. */
export function clipToRect(n: BoardNode, tx: number, ty: number): { x: number; y: number } {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx !== 0 ? n.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? n.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

export function bbox(nodes: BoardNode[]): { x: number; y: number; w: number; h: number } | null {
  if (!nodes.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const n of nodes) {
    x1 = Math.min(x1, n.x);
    y1 = Math.min(y1, n.y);
    x2 = Math.max(x2, n.x + n.w);
    y2 = Math.max(y2, n.y + n.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function normalizeUrl(u: string): string | null {
  let s = u.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  try {
    const url = new URL(s);
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}
