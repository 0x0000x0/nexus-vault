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
