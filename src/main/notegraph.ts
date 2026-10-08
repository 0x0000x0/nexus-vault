// Pure note-graph builders: full graph and folder-collapsed graph for large vaults. Grok Bot — Nexus Vault 0.0.8.
import type { GraphData, GraphLink, GraphNode } from '../shared/types';

/** Notes vaults above this many notes open folder-collapsed (code mode uses COLLAPSE_ABOVE = 1200). */
export const COLLAPSE_ABOVE_NOTES = 800;
/** Max folder groups before we drop to a shallower folder depth. */
export const MAX_GROUPS = 150;
/** Total hub-note budget spread over the groups. */
export const HUB_BUDGET = 320;

export interface NoteLite {
  rel: string;
  title: string;
  tags: string[];
}

const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const topFolder = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '');

/** Group key of a note at a folder depth ('(root)' for vault-root notes). */
export function groupOf(rel: string, depth: number): string {
  const parts = dirOf(rel).split('/').filter(Boolean);
  return parts.slice(0, depth).join('/') || '(root)';
}

/** Deepest depth ≤ 3 whose number of distinct groups stays ≤ MAX_GROUPS. */
export function chooseDepth(rels: string[], maxGroups = MAX_GROUPS): number {
  let depth = 3;
  while (depth > 1 && new Set(rels.map((r) => groupOf(r, depth))).size > maxGroups) depth--;
  return depth;
}

/** Top-level folders ordered by note count desc (ties by name). */
export function folderOrder(rels: Iterable<string>): string[] {
  const c = new Map<string, number>();
  for (const r of rels) {
    const f = topFolder(r);
    if (f) c.set(f, (c.get(f) ?? 0) + 1);
  }
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([f]) => f);
}

/** Ghost id for an unresolved [[link]] name (mirrors parse.norm without importing node-only code). */
export type NormFn = (s: string) => string;

/** Every note + ghost (unchanged 0.0.7 shape). */
export function fullNoteGraph(notes: NoteLite[], out: Map<string, Set<string>>, ghosts: Map<string, Set<string>>, version: number, norm: NormFn): GraphData {
  const nodes = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  for (const n of notes) nodes.set(n.rel, { id: n.rel, title: n.title, folder: topFolder(n.rel), degree: 0, tags: n.tags });
  for (const [src, set] of out) {
    const sn = nodes.get(src);
    if (!sn) continue;
    for (const t of set) {
      links.push({ source: src, target: t });
      sn.degree++;
      const tn = nodes.get(t);
      if (tn) tn.degree++;
    }
  }
  for (const [src, gh] of ghosts) {
    const sn = nodes.get(src);
    if (!sn) continue;
    for (const g of gh) {
      const id = `ghost:${norm(g)}`;
      if (!nodes.has(id)) nodes.set(id, { id, title: g, folder: '', ghost: true, degree: 0, tags: [] });
      nodes.get(id)!.degree++;
      sn.degree++;
      links.push({ source: src, target: id });
    }
  }
  return { nodes: [...nodes.values()], links, version, folders: folderOrder(notes.map((n) => n.rel)), total: notes.length };
}

/**
 * Folder-collapsed graph: one `dir:<group>` node per folder group plus its top hub notes
 * (highest link degree). Links between non-hub notes are aggregated to folder→folder edges.
 * `expand` swaps one group's folder node for all of its notes (and their ghosts).
 */
export function collapsedNoteGraph(
  notes: NoteLite[],
  out: Map<string, Set<string>>,
  ghosts: Map<string, Set<string>>,
  version: number,
  norm: NormFn,
  expand: string | null = null,
): GraphData {
  const rels = notes.map((n) => n.rel);
  const depth = chooseDepth(rels);
  const group = new Map<string, string>();
  const members = new Map<string, NoteLite[]>();
  for (const n of notes) {
    const g = groupOf(n.rel, depth);
    group.set(n.rel, g);
    const arr = members.get(g);
    if (arr) arr.push(n);
    else members.set(g, [n]);
  }
  const exp = expand !== null && members.has(expand) ? expand : null;
  // Note degree (resolved links, both directions) decides hubs.
  const deg = new Map<string, number>();
  for (const [s, set] of out) {
    if (!group.has(s)) continue;
    for (const t of set) {
      if (!group.has(t)) continue;
      deg.set(s, (deg.get(s) ?? 0) + 1);
      deg.set(t, (deg.get(t) ?? 0) + 1);
    }
  }
  const k = Math.max(2, Math.min(40, Math.floor(HUB_BUDGET / Math.max(1, members.size))));
  const keep = new Set<string>(); // individual note nodes
  for (const [g, arr] of members) {
    if (g === exp) {
      for (const n of arr) keep.add(n.rel);
      continue;
    }
    const hubs = arr
      .filter((n) => (deg.get(n.rel) ?? 0) > 0)
      .sort((a, b) => (deg.get(b.rel) ?? 0) - (deg.get(a.rel) ?? 0) || a.rel.localeCompare(b.rel))
      .slice(0, k);
    for (const h of hubs) keep.add(h.rel);
  }
  const nodes = new Map<string, GraphNode>();
  const byRel = new Map(notes.map((n) => [n.rel, n]));
  for (const [g, arr] of members) {
    if (g === exp) continue;
    const id = 'dir:' + g;
    const name = g === '(root)' ? '(root)' : g.split('/').pop()!;
    nodes.set(id, { id, title: name + '/', folder: g === '(root)' ? '' : g.split('/')[0], degree: 0, tags: ['folder'], count: arr.length });
  }
  for (const rel of keep) {
    const n = byRel.get(rel)!;
    nodes.set(rel, { id: rel, title: n.title, folder: topFolder(rel), degree: 0, tags: n.tags });
  }
  const rep = (rel: string) => (keep.has(rel) ? rel : 'dir:' + group.get(rel));
  const links: GraphLink[] = [];
  const seen = new Set<string>();
  const addLink = (a: string, b: string) => {
    if (a === b) return;
    const key = a < b ? a + '\u0000' + b : b + '\u0000' + a;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ source: a, target: b });
    nodes.get(a)!.degree++;
    nodes.get(b)!.degree++;
  };
  // Tether hubs to their folder so clusters stay together.
  for (const rel of keep) {
    const g = group.get(rel)!;
    if (g !== exp) addLink(rel, 'dir:' + g);
  }
  for (const [s, set] of out) {
    if (!group.has(s)) continue;
    const a = rep(s);
    for (const t of set) if (group.has(t)) addLink(a, rep(t));
  }
  if (exp !== null) {
    for (const n of members.get(exp)!) {
      for (const g of ghosts.get(n.rel) ?? []) {
        const id = `ghost:${norm(g)}`;
        if (!nodes.has(id)) nodes.set(id, { id, title: g, folder: '', ghost: true, degree: 0, tags: [] });
        addLink(n.rel, id);
      }
    }
  }
  return {
    nodes: [...nodes.values()],
    links,
    version,
    folders: folderOrder(rels),
    total: notes.length,
    collapsed: { total: notes.length, groups: members.size, depth, expanded: exp },
  };
}
