// Pure helpers for large-graph camera / sizing. Grok Bot — Nexus Vault 0.0.5.
export const LARGE = 800;
export const INITIAL_K = 2;

export function autoScale(n: number): number {
  if (n >= 2000) return 1.6;
  if (n >= 1000) return 1.4;
  if (n >= 500) return 1.2;
  return 1;
}

export interface CamNode {
  id: string;
  degree?: number;
  ghost?: boolean;
  folder?: string;
  x?: number;
  y?: number;
}

/** Pick initial camera for large graphs: highest-degree hub (non-ghost), optional folder preference. */
export function pickInitialCam(
  nodes: CamNode[],
  opts?: { folderFocus?: string | null; selected?: string | null },
): { x: number; y: number; k: number } | null {
  if (!nodes.length) return null;
  const selected = opts?.selected ? nodes.find((n) => n.id === opts.selected && n.x != null && n.y != null) : undefined;
  if (selected && selected.x != null && selected.y != null) {
    return { x: selected.x, y: selected.y, k: INITIAL_K };
  }
  let pool = nodes.filter((n) => !n.ghost && n.x != null && n.y != null);
  if (opts?.folderFocus) {
    const focused = pool.filter((n) => n.folder === opts.folderFocus);
    if (focused.length) pool = focused;
  }
  if (!pool.length) pool = nodes.filter((n) => n.x != null && n.y != null);
  if (!pool.length) return null;
  pool.sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0));
  const hub = pool[0]!;
  return { x: hub.x!, y: hub.y!, k: INITIAL_K };
}

/** Label visibility gate for large vs small graphs. */
export function shouldShowLabel(opts: {
  n: number;
  scale: number;
  degree: number;
  labelDegree: number;
  important: boolean;
  showLabels: boolean;
}): boolean {
  if (!opts.showLabels) return false;
  if (opts.important) return true;
  if (opts.n < LARGE) {
    const fade = Math.max(0, Math.min(1, (opts.scale - 0.6) / 0.8));
    if (fade <= 0.02) return false;
    return opts.scale > 1.8 || opts.degree >= opts.labelDegree;
  }
  // large: top hubs only when zoomed enough; others need scale >= 2
  const hubCap = Math.max(1, Math.min(25, Math.floor(opts.n * 0.03)));
  // caller passes labelDegree already computed for top hubs; treat degree >= labelDegree as hub
  if (opts.degree >= opts.labelDegree && opts.scale >= 1.4) return true;
  return opts.scale >= 2.0;
}

/** For large graphs, raise the permanent-label degree threshold to top ~3% (min 25 hubs). */
export function largeLabelDegree(degreesSortedDesc: number[], n: number): number {
  if (n < LARGE) {
    return Math.max(4, degreesSortedDesc[Math.floor(degreesSortedDesc.length * 0.12)] ?? 4);
  }
  const hubCount = Math.max(1, Math.min(25, Math.floor(n * 0.03)));
  return Math.max(1, degreesSortedDesc[hubCount - 1] ?? 1);
}

// ---- 0.0.8 perf helpers (Grok Bot) ----

export interface ForceBudget {
  warmupTicks: number;
  cooldownTicks: number;
  alphaDecay: number;
  charge: number;
}

/** Simulation budget scaled by node count: big graphs settle in far fewer ticks with weaker forces. */
export function forceBudget(n: number): ForceBudget {
  if (n < 400) return { warmupTicks: 30, cooldownTicks: 200, alphaDecay: 0.0228, charge: -60 };
  if (n < 1200) return { warmupTicks: 20, cooldownTicks: 80, alphaDecay: 0.04, charge: -45 };
  return { warmupTicks: 10, cooldownTicks: 40, alphaDecay: 0.06, charge: -30 };
}

/**
 * Budget for an index refresh where most nodes already have positions: skip warmup and
 * use a short cooldown so editing a note doesn't re-run the whole layout.
 */
export function refreshBudget(n: number, positioned: number): ForceBudget {
  const b = forceBudget(n);
  if (n === 0 || positioned / n < 0.9) return b;
  return { ...b, warmupTicks: 0, cooldownTicks: Math.min(b.cooldownTicks, 30) };
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Visible graph-space box from a canvas 2D transform (a = scale·dpr, e/f = translate·dpr),
 * padded by `pad` device pixels so nodes/labels near the edge don't pop. Sizes are canvas (device) pixels.
 */
export function viewBoxFromTransform(t: { a: number; e: number; f: number }, canvasW: number, canvasH: number, pad = 80): Box | null {
  if (!t.a || !Number.isFinite(t.a) || !canvasW || !canvasH) return null;
  const x0 = (-pad - t.e) / t.a;
  const y0 = (-pad - t.f) / t.a;
  const x1 = (canvasW + pad - t.e) / t.a;
  const y1 = (canvasH + pad - t.f) / t.a;
  return { x0, y0, x1, y1 };
}

export function inBox(b: Box | null, x: number | undefined, y: number | undefined, r = 0): boolean {
  if (!b || x === undefined || y === undefined) return true;
  return x + r >= b.x0 && x - r <= b.x1 && y + r >= b.y0 && y - r <= b.y1;
}

/** Conservative segment test: the segment's bounding box overlaps the view box. */
export function segInBox(b: Box | null, ax?: number, ay?: number, bx?: number, by?: number): boolean {
  if (!b || ax === undefined || ay === undefined || bx === undefined || by === undefined) return true;
  return Math.max(ax, bx) >= b.x0 && Math.min(ax, bx) <= b.x1 && Math.max(ay, by) >= b.y0 && Math.min(ay, by) <= b.y1;
}
