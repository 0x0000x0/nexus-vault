// Pure architecture inference from CodeIndex snapshot + stack heuristics (0.0.7). Grok Bot.
import type { ArchEdge, ArchHeuristic, ArchKind, ArchModel, ArchNode } from '../shared/arch';
import { IGNORE_DIRS } from './codeparse';

const MAX_NODES = 80;
const MAX_EDGES = 150;
const MAX_EXTERNALS = 12;
const STORE_NAMES = new Set(['vault', 'settings', 'db', 'database', 'prisma', 'supabase', 'data', 'store', 'stores', 'models', 'schema', 'migrations', 'vector-store', 'vectors', 'memory-store']);
const PARSE_EXT = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go']);

export interface PackageJsonHint {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  main?: string;
}

export interface ArchInferInput {
  rootName: string;
  rels: string[];
  edges: [string, string][];
  externals: { name: string; count: number }[];
  packageJson?: PackageJsonHint | null;
  /** Top-level file/dir names at repo root. */
  rootEntries: string[];
  /** Marker filenames found anywhere (rel), e.g. electron-vite.config.ts. */
  markerFiles: string[];
}

function extOf(rel: string): string {
  const b = rel.split('/').pop() ?? rel;
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'x';
}

function hasPrefix(rel: string, prefix: string): boolean {
  if (!prefix) return true;
  return rel === prefix || rel.startsWith(prefix + '/');
}

function topFolders(rels: string[]): string[] {
  const s = new Set<string>();
  for (const r of rels) {
    const t = r.includes('/') ? r.slice(0, r.indexOf('/')) : '';
    if (t && !IGNORE_DIRS.has(t) && !t.startsWith('.')) s.add(t);
  }
  return [...s].sort();
}

function childFolders(rels: string[], parent: string): string[] {
  const s = new Set<string>();
  const pre = parent ? parent + '/' : '';
  for (const r of rels) {
    if (!hasPrefix(r, parent)) continue;
    const rest = pre ? r.slice(pre.length) : r;
    if (!rest.includes('/')) continue;
    const name = rest.slice(0, rest.indexOf('/'));
    if (name && !IGNORE_DIRS.has(name) && !name.startsWith('.')) s.add(name);
  }
  return [...s].sort();
}

function filesUnder(rels: string[], prefix: string): string[] {
  return rels.filter((r) => hasPrefix(r, prefix));
}

function workspaceGlobs(pj: PackageJsonHint | null | undefined): string[] {
  if (!pj?.workspaces) return [];
  if (Array.isArray(pj.workspaces)) return pj.workspaces;
  return pj.workspaces.packages ?? [];
}

/** Expand simple workspace globs like "apps/*" or "packages/*" against known top paths. */
function expandWorkspaces(globs: string[], rels: string[]): string[] {
  const out = new Set<string>();
  const allDirs = new Set<string>();
  for (const r of rels) {
    const parts = r.split('/');
    for (let i = 1; i < parts.length; i++) allDirs.add(parts.slice(0, i).join('/'));
    if (!r.includes('/')) allDirs.add(''); // file at root — skip
  }
  for (const g of globs) {
    if (g.endsWith('/*')) {
      const base = g.slice(0, -2);
      for (const d of allDirs) {
        if (d.startsWith(base + '/') && !d.slice(base.length + 1).includes('/')) out.add(d);
      }
    } else if (allDirs.has(g) || filesUnder(rels, g).length) out.add(g);
  }
  return [...out].sort();
}

function isElectron(input: ArchInferInput): boolean {
  const pj = input.packageJson;
  const deps = { ...(pj?.dependencies ?? {}), ...(pj?.devDependencies ?? {}) };
  const hasEv = input.markerFiles.some((f) => /(^|\/)electron-vite\.config\.(ts|js|mjs|cjs)$/.test(f));
  if (hasEv) return true;
  if (deps.electron || deps['electron-vite']) return true;
  const hasMain = input.rels.some((r) => r === 'src/main/index.ts' || r.startsWith('src/main/'));
  const hasPre = input.rels.some((r) => r.startsWith('src/preload/'));
  const hasRen = input.rels.some((r) => r.startsWith('src/renderer/'));
  return !!(pj?.main && hasMain && (hasPre || hasRen));
}

function isWeb(input: ArchInferInput): boolean {
  const tops = new Set(input.rootEntries);
  const hasSrc = input.rels.some((r) => r.startsWith('src/'));
  const hasApp = input.rels.some((r) => r.startsWith('app/') || r.startsWith('pages/') || r.startsWith('components/'));
  const pj = input.packageJson;
  const deps = { ...(pj?.dependencies ?? {}), ...(pj?.devDependencies ?? {}) };
  const webDep = !!(deps.next || deps.react || deps.vue || deps.nuxt || deps.svelte || deps['@angular/core']);
  return (hasSrc || hasApp || tops.has('app') || tops.has('pages')) && (webDep || hasApp);
}

class Builder {
  nodes: ArchNode[] = [];
  byId = new Map<string, ArchNode>();
  truncated = false;

  add(partial: Omit<ArchNode, 'inferred'> & { inferred?: boolean }): ArchNode {
    if (this.nodes.length >= MAX_NODES) {
      this.truncated = true;
      return partial as ArchNode;
    }
    const n: ArchNode = { ...partial, inferred: partial.inferred !== false };
    this.nodes.push(n);
    this.byId.set(n.id, n);
    return n;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }
}

function pathLooksLikeFile(p: string): boolean {
  const base = p.split('/').pop() ?? p;
  return base.includes('.') && PARSE_EXT.has(extOf(p));
}

function coverPath(b: Builder, rel: string): string | null {
  // Prefer folder-level app/store/component coverage (not leaf file cards) so imports aggregate.
  let best: ArchNode | null = null;
  let bestLen = -1;
  for (const n of b.nodes) {
    if (n.kind === 'external' || n.kind === 'actor' || n.kind === 'system' || n.kind === 'domain') continue;
    for (const p of n.paths) {
      if (!p || pathLooksLikeFile(p)) continue;
      if (hasPrefix(rel, p) && p.length >= bestLen) {
        best = n;
        bestLen = p.length;
      }
    }
  }
  if (best) return best.id;
  // Fallback: leaf file nodes
  for (const n of b.nodes) {
    if (n.kind === 'external' || n.kind === 'actor' || n.kind === 'system' || n.kind === 'domain') continue;
    for (const p of n.paths) {
      if (hasPrefix(rel, p) && p.length >= bestLen) {
        best = n;
        bestLen = p.length;
      }
    }
  }
  return best?.id ?? null;
}

function aggregateEdges(b: Builder, edges: [string, string][], minWeight: number): ArchEdge[] {
  const w = new Map<string, number>();
  for (const [s, t] of edges) {
    const a = coverPath(b, s);
    const c = coverPath(b, t);
    if (!a || !c || a === c) continue;
    const key = a + '>' + c;
    w.set(key, (w.get(key) ?? 0) + 1);
  }
  const list = [...w.entries()]
    .filter(([, n]) => n >= minWeight)
    .sort((x, y) => y[1] - x[1])
    .slice(0, MAX_EDGES);
  return list.map(([key, weight]) => {
    const [from, to] = key.split('>');
    return { id: `e:${from}>${to}`, from, to, label: 'imports', weight };
  });
}

function addExternals(b: Builder, systemId: string, externals: { name: string; count: number }[]): void {
  const top = externals.filter((e) => e.count >= 2).slice(0, MAX_EXTERNALS);
  for (const e of top) {
    if (b.nodes.length >= MAX_NODES) {
      b.truncated = true;
      break;
    }
    b.add({
      id: `arch:ext:${slug(e.name)}`,
      kind: 'external',
      name: e.name,
      caption: `used by ${e.count} files`,
      parentId: systemId,
      paths: [],
      tags: ['package'],
      inferred: true,
    });
  }
}

function addComponentsUnder(b: Builder, parentId: string, parentPath: string, rels: string[], asKind: ArchKind = 'component'): void {
  const kids = childFolders(rels, parentPath);
  if (kids.length === 0) {
    // leaf files as components only if few
    const files = filesUnder(rels, parentPath).filter((r) => r.slice(parentPath ? parentPath.length + 1 : 0).split('/').length === 1);
    if (files.length && files.length <= 8) {
      for (const f of files.slice(0, 8)) {
        if (b.nodes.length >= MAX_NODES) {
          b.truncated = true;
          return;
        }
        const base = f.split('/').pop()!;
        b.add({
          id: `arch:file:${slug(f)}`,
          kind: asKind,
          name: base,
          parentId,
          paths: [f],
          inferred: true,
        });
      }
    }
    return;
  }
  for (const k of kids) {
    if (b.nodes.length >= MAX_NODES) {
      b.truncated = true;
      return;
    }
    const path = parentPath ? `${parentPath}/${k}` : k;
    const kind: ArchKind = STORE_NAMES.has(k.toLowerCase()) ? 'store' : asKind;
    b.add({
      id: `arch:${kind}:${slug(path)}`,
      kind,
      name: k,
      parentId,
      paths: [path],
      inferred: true,
    });
  }
}

function buildElectron(input: ArchInferInput, b: Builder): string {
  const name = input.packageJson?.name || input.rootName;
  const sys = b.add({
    id: 'arch:system:root',
    kind: 'system',
    name,
    caption: 'Electron desktop app (inferred)',
    parentId: null,
    paths: [''],
    tags: ['electron'],
    inferred: true,
  });
  const layers: { id: string; folder: string; label: string; kind: ArchKind }[] = [
    { id: 'arch:app:main', folder: 'src/main', label: 'Main', kind: 'app' },
    { id: 'arch:app:preload', folder: 'src/preload', label: 'Preload', kind: 'app' },
    { id: 'arch:app:renderer', folder: 'src/renderer', label: 'Renderer', kind: 'app' },
  ];
  // Also support electron/ main structure
  if (!filesUnder(input.rels, 'src/main').length && filesUnder(input.rels, 'electron').length) {
    layers[0] = { id: 'arch:app:main', folder: 'electron', label: 'Main', kind: 'app' };
  }
  for (const L of layers) {
    if (!filesUnder(input.rels, L.folder).length) continue;
    b.add({
      id: L.id,
      kind: L.kind,
      name: L.label,
      caption: L.folder,
      parentId: sys.id,
      paths: [L.folder],
      tags: ['electron'],
      inferred: true,
    });
    // Prefer src/main/* modules as components; renderer uses src/renderer/src if present
    let base = L.folder;
    if (L.label === 'Renderer' && filesUnder(input.rels, 'src/renderer/src').length) base = 'src/renderer/src';
    addComponentsUnder(b, L.id, base, input.rels, 'component');
  }
  // Shared folders at src/shared
  if (filesUnder(input.rels, 'src/shared').length) {
    b.add({
      id: 'arch:app:shared',
      kind: 'app',
      name: 'Shared',
      caption: 'src/shared',
      parentId: sys.id,
      paths: ['src/shared'],
      inferred: true,
    });
    addComponentsUnder(b, 'arch:app:shared', 'src/shared', input.rels);
  }
  return sys.id;
}

function buildMonorepo(input: ArchInferInput, b: Builder, workspaces: string[]): string {
  const name = input.packageJson?.name || input.rootName;
  const sys = b.add({
    id: 'arch:system:root',
    kind: 'system',
    name,
    caption: 'Monorepo (workspaces inferred)',
    parentId: null,
    paths: [''],
    tags: ['monorepo'],
    inferred: true,
  });
  for (const ws of workspaces) {
    if (b.nodes.length >= MAX_NODES) {
      b.truncated = true;
      break;
    }
    const label = ws.split('/').pop() || ws;
    const kind: ArchKind = /store|db|data|prisma/i.test(label) ? 'store' : 'app';
    const id = `arch:${kind}:${slug(ws)}`;
    b.add({
      id,
      kind,
      name: label,
      caption: ws,
      parentId: sys.id,
      paths: [ws],
      inferred: true,
    });
    addComponentsUnder(b, id, ws, input.rels);
  }
  return sys.id;
}

function buildWeb(input: ArchInferInput, b: Builder): string {
  const name = input.packageJson?.name || input.rootName;
  const sys = b.add({
    id: 'arch:system:root',
    kind: 'system',
    name,
    caption: 'Web app (inferred)',
    parentId: null,
    paths: [''],
    tags: ['web'],
    inferred: true,
  });
  const appCandidates = ['src', 'app', 'pages', 'components', 'lib', 'server', 'api'];
  const storeCandidates = ['prisma', 'db', 'supabase', 'data', 'drizzle'];
  for (const s of storeCandidates) {
    if (!filesUnder(input.rels, s).length) continue;
    b.add({
      id: `arch:store:${slug(s)}`,
      kind: 'store',
      name: s,
      parentId: sys.id,
      paths: [s],
      inferred: true,
    });
  }
  for (const a of appCandidates) {
    if (!filesUnder(input.rels, a).length) continue;
    if (b.has(`arch:store:${slug(a)}`)) continue;
    const id = `arch:app:${slug(a)}`;
    if (b.has(id)) continue;
    b.add({
      id,
      kind: 'app',
      name: a,
      parentId: sys.id,
      paths: [a],
      inferred: true,
    });
    addComponentsUnder(b, id, a, input.rels);
  }
  // API routes under app/api or pages/api
  for (const api of ['app/api', 'pages/api', 'src/api', 'api']) {
    if (!filesUnder(input.rels, api).length) continue;
    if (b.has(`arch:app:${slug(api)}`)) continue;
    b.add({
      id: `arch:app:${slug(api)}`,
      kind: 'app',
      name: 'API',
      caption: api,
      parentId: sys.id,
      paths: [api],
      inferred: true,
    });
  }
  return sys.id;
}

function buildGeneric(input: ArchInferInput, b: Builder): string {
  const sys = b.add({
    id: 'arch:system:root',
    kind: 'system',
    name: input.rootName,
    caption: 'Folder structure (inferred)',
    parentId: null,
    paths: [''],
    inferred: true,
  });
  const tops = topFolders(input.rels);
  for (const t of tops) {
    if (b.nodes.length >= MAX_NODES) {
      b.truncated = true;
      break;
    }
    const kind: ArchKind = STORE_NAMES.has(t.toLowerCase()) ? 'store' : tops.length <= 6 ? 'app' : 'component';
    const id = `arch:${kind}:${slug(t)}`;
    b.add({
      id,
      kind,
      name: t,
      parentId: sys.id,
      paths: [t],
      inferred: true,
    });
    if (kind === 'app' || kind === 'store') addComponentsUnder(b, id, t, input.rels);
  }
  // Root-level source files if no folders
  if (tops.length === 0) {
    const rootFiles = input.rels.filter((r) => !r.includes('/')).slice(0, 20);
    for (const f of rootFiles) {
      if (b.nodes.length >= MAX_NODES) {
        b.truncated = true;
        break;
      }
      b.add({
        id: `arch:file:${slug(f)}`,
        kind: 'component',
        name: f,
        parentId: sys.id,
        paths: [f],
        inferred: true,
      });
    }
  }
  return sys.id;
}

/**
 * Infer a C4-ish ArchModel from indexed repo paths + import edges + light stack heuristics.
 * Pure: no I/O. Never writes into the repo.
 */
export function inferArchitecture(input: ArchInferInput): ArchModel {
  const b = new Builder();
  const wsGlobs = workspaceGlobs(input.packageJson);
  const workspaces = expandWorkspaces(wsGlobs, input.rels);
  let heuristic: ArchHeuristic = 'generic';
  let rootId: string;

  if (workspaces.length >= 2) {
    heuristic = 'monorepo';
    rootId = buildMonorepo(input, b, workspaces);
  } else if (isElectron(input)) {
    heuristic = 'electron';
    rootId = buildElectron(input, b);
  } else if (isWeb(input)) {
    heuristic = 'web';
    rootId = buildWeb(input, b);
  } else {
    heuristic = 'generic';
    rootId = buildGeneric(input, b);
  }

  addExternals(b, rootId, input.externals);

  const minW = input.rels.length > 1200 ? 2 : 1;
  const edges = aggregateEdges(b, input.edges, minW);

  // External edges: file→external package when importer covered
  const extNodes = new Map(b.nodes.filter((n) => n.kind === 'external').map((n) => [n.name, n.id]));
  if (extNodes.size && edges.length < MAX_EDGES) {
    const extDeg = new Map(input.externals.map((e) => [e.name, e.count]));
    // Lightweight: connect apps that likely use high-degree packages via path coverage of any importing file
    // (skip — importEdges are file→file only; externals are separate. Keep external nodes as context.)
    void extDeg;
  }

  const importsParsed = input.rels.some((r) => PARSE_EXT.has(extOf(r)));
  const components = b.nodes.filter((n) => n.kind === 'component' || n.kind === 'app' || n.kind === 'store').length;

  return {
    version: 1,
    rootId,
    nodes: b.nodes,
    edges,
    stats: {
      files: input.rels.length,
      components,
      truncated: b.truncated || input.rels.length >= 20000,
      heuristic,
      importsParsed,
    },
  };
}

/** Build ArchInferInput helpers from path lists (tests + main). */
export function collectRootEntries(rels: string[]): string[] {
  const s = new Set<string>();
  for (const r of rels) s.add(r.includes('/') ? r.slice(0, r.indexOf('/')) : r);
  return [...s].sort();
}
