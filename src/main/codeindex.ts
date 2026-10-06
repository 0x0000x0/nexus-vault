// Read-only code repository index: files, imports (JS/TS, Python, Go), md links, full-text. Grok Bot.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import MiniSearch from 'minisearch';
import type { FsChange, GraphData, GraphNode, IndexStats, LinkRef, NoteInfo, SearchHit } from '../shared/types';
import { CODE_EXT, extOf, IGNORE_DIRS, parseImports, resolveImport, type RawImport } from './codeparse';
import { norm, parseNote, resolveTarget } from './parse';
import { logWarn } from './logger';

const SOURCE_EXT = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'cs', 'rb', 'php', 'c', 'h', 'cpp', 'hpp', 'swift', 'vue', 'svelte', 'md']);
const MAX_FILES = 20000;
const MAX_BYTES = 1024 * 1024;
export const COLLAPSE_ABOVE = 1200;

interface FileRec {
  rel: string;
  content: string; // truncated for search/preview
  imports: RawImport[];
  mdLinks: { target: string; kind: 'wiki' | 'md'; line: number }[];
  lines: number;
}

const toRel = (root: string, abs: string) => path.relative(root, abs).split(path.sep).join('/');
const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const baseOf = (rel: string) => rel.split('/').pop() ?? rel;
const topFolder = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '');

export function ignoredSegment(seg: string): boolean {
  return seg.startsWith('.') || IGNORE_DIRS.has(seg);
}

export class CodeIndex {
  readonly root: string;
  private files = new Map<string, FileRec>();
  private out = new Map<string, Map<string, number>>(); // rel -> target rel -> line
  private ext = new Map<string, Set<string>>(); // rel -> external packages
  private dirs = new Map<string, string[]>();
  private goModule: string | null = null;
  private mini = this.newMini();
  private watcher: FSWatcher | null = null;
  private pending = new Map<string, 'upsert' | 'remove'>();
  private pendingDirs = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  byName = new Map<string, string[]>();
  byPath = new Map<string, string>();
  version = 0;
  ready = false;
  truncated = false;

  constructor(
    root: string,
    private onChange: (stats: IndexStats, fsChange: FsChange) => void,
    private onProgress: (label: string, done: number, total: number) => void = () => undefined,
  ) {
    this.root = root;
  }

  private newMini() {
    return new MiniSearch<{ id: string; title: string; path: string; content: string }>({
      fields: ['title', 'path', 'content'],
      storeFields: ['title'],
      searchOptions: { boost: { title: 5, path: 2 }, prefix: true, fuzzy: 0.1 },
    });
  }

  async start(): Promise<void> {
    try {
      const gm = await fsp.readFile(path.join(this.root, 'go.mod'), 'utf8');
      this.goModule = /^module\s+(\S+)/m.exec(gm)?.[1] ?? null;
    } catch {
      /* not go */
    }
    const list: string[] = [];
    const stack = [this.root];
    this.onProgress('Scanning folders…', 0, 0);
    while (stack.length && !this.closed && list.length < MAX_FILES) {
      const dir = stack.pop()!;
      let ents: fs.Dirent[];
      try {
        ents = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const d of ents) {
        if (ignoredSegment(d.name)) continue;
        const abs = path.join(dir, d.name);
        if (d.isDirectory()) stack.push(abs);
        else if (d.isFile() && CODE_EXT.has(extOf(d.name)) && !/\.min\.(js|css)$/.test(d.name) && d.name !== 'package-lock.json') list.push(toRel(this.root, abs));
      }
    }
    this.truncated = list.length >= MAX_FILES;
    for (let i = 0; i < list.length; i += 64) {
      if (this.closed) return;
      await Promise.all(list.slice(i, i + 64).map((r) => this.load(r)));
      this.onProgress('Reading files…', Math.min(list.length, i + 64), list.length);
    }
    this.onProgress('Building graph…', list.length, list.length);
    this.rebuildNames();
    this.mini.addAll([...this.files.values()].map((f) => this.doc(f)));
    this.relinkAll();
    this.ready = true;
    this.version++;
    this.onProgress('', list.length, list.length);
    this.onChange(this.stats(), { dirs: [], files: [] });
    this.startWatcher();
  }

  private startWatcher(): void {
    if (this.closed) return;
    this.watcher = watch(this.root, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (p: string) => {
        const rel = toRel(this.root, p);
        return rel !== '' && rel.split('/').some(ignoredSegment);
      },
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    });
    const q = (kind: 'upsert' | 'remove' | 'dir') => (abs: string) => {
      const rel = toRel(this.root, abs);
      this.pendingDirs.add(dirOf(rel));
      if (kind !== 'dir' && CODE_EXT.has(extOf(rel))) this.pending.set(rel, kind);
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.flush(), 400);
    };
    this.watcher.on('add', q('upsert')).on('change', q('upsert')).on('unlink', q('remove')).on('addDir', q('dir')).on('unlinkDir', q('dir'));
    this.watcher.on('error', (e) => logWarn('watch', 'chokidar watcher error (code)', e));
  }

  touch(): void {}
  touchDir(): void {}

  private async flush(): Promise<void> {
    if (this.closed) return;
    const batch = [...this.pending];
    const dirs = [...this.pendingDirs];
    this.pending.clear();
    this.pendingDirs.clear();
    for (const [rel, kind] of batch) {
      if (this.files.has(rel)) this.mini.discard(rel);
      if (kind === 'remove' || !(await this.load(rel))) this.files.delete(rel);
      else this.mini.add(this.doc(this.files.get(rel)!));
    }
    if (batch.length) {
      this.rebuildNames();
      this.relinkAll();
      this.version++;
    }
    this.onChange(this.stats(), { dirs, files: batch.map(([r]) => r) });
  }

  private async load(rel: string): Promise<boolean> {
    try {
      const abs = path.join(this.root, rel);
      const st = await fsp.stat(abs);
      let content = '';
      if (st.size <= MAX_BYTES) content = await fsp.readFile(abs, 'utf8');
      if (content.includes('\u0000')) content = '';
      const imports = parseImports(rel, content);
      const mdLinks = extOf(rel) === 'md' ? parseNote(content).links.map((l) => ({ target: l.target, kind: l.kind, line: l.line })) : [];
      let lines = 1;
      for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) lines++;
      this.files.set(rel, { rel, content: content.slice(0, 120_000), imports, mdLinks, lines });
      return true;
    } catch {
      return false;
    }
  }

  private doc(f: FileRec) {
    return { id: f.rel, title: baseOf(f.rel), path: f.rel.replace(/[/._-]/g, ' '), content: f.content };
  }

  private rebuildNames(): void {
    this.byName.clear();
    this.byPath.clear();
    this.dirs.clear();
    for (const rel of this.files.keys()) {
      const d = dirOf(rel);
      const arr = this.dirs.get(d);
      if (arr) arr.push(rel);
      else this.dirs.set(d, [rel]);
      if (extOf(rel) === 'md') {
        const k = norm(baseOf(rel).replace(/\.md$/i, ''));
        this.byName.set(k, [...(this.byName.get(k) ?? []), rel]);
        this.byPath.set(norm(rel.replace(/\.md$/i, '')), rel);
      }
    }
  }

  private relinkAll(): void {
    this.out.clear();
    this.ext.clear();
    const set = new Set(this.files.keys());
    for (const f of this.files.values()) {
      const m = new Map<string, number>();
      const ex = new Set<string>();
      for (const imp of f.imports) {
        const r = resolveImport(f.rel, imp.spec, set, this.goModule, this.dirs);
        if (r?.files) for (const t of r.files) if (t !== f.rel && !m.has(t)) m.set(t, imp.line);
        if (r?.external) ex.add(r.external);
      }
      for (const l of f.mdLinks) {
        const t = resolveTarget(l.target, f.rel, this.byName, this.byPath, l.kind) ?? (set.has(l.target) ? l.target : null);
        if (t && t !== f.rel && !m.has(t)) m.set(t, l.line);
      }
      this.out.set(f.rel, m);
      if (ex.size) this.ext.set(f.rel, ex);
    }
  }

  /** Indexed relative paths (read-only snapshot for architecture inference). */
  rels(): string[] {
    return [...this.files.keys()];
  }

  /** Resolved file→file import edges (alias of links). */
  importEdges(): [string, string][] {
    return this.links();
  }

  /** External packages with file-degree (for architecture externals). */
  externalPackages(): { name: string; count: number }[] {
    const extCount = new Map<string, number>();
    for (const ex of this.ext.values()) for (const e of ex) extCount.set(e, (extCount.get(e) ?? 0) + 1);
    return [...extCount.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  /** All resolved file->file links (never collapsed). */
  links(): [string, string][] {
    const out: [string, string][] = [];
    for (const [s, m] of this.out) for (const t of m.keys()) out.push([s, t]);
    return out;
  }

  stats(): IndexStats {
    let links = 0;
    for (const s of this.out.values()) links += s.size;
    return { notes: this.files.size, links, version: this.version };
  }

  graph(): GraphData {
    const src = [...this.files.keys()].filter((r) => SOURCE_EXT.has(extOf(r)));
    if (src.length > COLLAPSE_ABOVE) return this.folderGraph(src);
    const nodes = new Map<string, GraphNode>();
    for (const r of src) nodes.set(r, { id: r, title: baseOf(r), folder: topFolder(r), degree: 0, tags: [extOf(r)] });
    const links: { source: string; target: string }[] = [];
    for (const [s, m] of this.out) {
      if (!nodes.has(s)) continue;
      for (const t of m.keys()) {
        if (!nodes.has(t)) continue;
        links.push({ source: s, target: t });
        nodes.get(s)!.degree++;
        nodes.get(t)!.degree++;
      }
    }
    // External packages as faded "ghost" nodes (only those used by 2+ files, to limit noise).
    const extCount = new Map<string, number>();
    for (const ex of this.ext.values()) for (const e of ex) extCount.set(e, (extCount.get(e) ?? 0) + 1);
    for (const [s, ex] of this.ext) {
      if (!nodes.has(s)) continue;
      for (const e of ex) {
        if ((extCount.get(e) ?? 0) < 2) continue;
        const id = `ghost:${e}`;
        if (!nodes.has(id)) nodes.set(id, { id, title: e, folder: '', ghost: true, degree: 0, tags: [] });
        nodes.get(id)!.degree++;
        links.push({ source: s, target: id });
      }
    }
    return { nodes: [...nodes.values()], links, version: this.version };
  }

  /** Big repos: one node per folder (depth chosen so the graph stays readable). */
  private folderGraph(src: string[]): GraphData {
    let depth = 3;
    const key = (r: string, d: number) => {
      const parts = dirOf(r).split('/').filter(Boolean);
      return parts.slice(0, d).join('/') || '(root)';
    };
    while (depth > 1 && new Set(src.map((r) => key(r, depth))).size > COLLAPSE_ABOVE / 3) depth--;
    const nodes = new Map<string, GraphNode>();
    const ofFile = new Map<string, string>();
    for (const r of src) {
      const k = key(r, depth);
      ofFile.set(r, 'dir:' + k);
      if (!nodes.has('dir:' + k)) nodes.set('dir:' + k, { id: 'dir:' + k, title: k.split('/').pop()! + '/', folder: k.split('/')[0], degree: 0, tags: ['folder'] });
    }
    const seen = new Set<string>();
    const links: { source: string; target: string }[] = [];
    for (const [s, m] of this.out) {
      const a = ofFile.get(s);
      if (!a) continue;
      for (const t of m.keys()) {
        const b = ofFile.get(t);
        if (!b || a === b || seen.has(a + '>' + b)) continue;
        seen.add(a + '>' + b);
        links.push({ source: a, target: b });
        nodes.get(a)!.degree++;
        nodes.get(b)!.degree++;
      }
    }
    return { nodes: [...nodes.values()], links, version: this.version };
  }

  search(q: string, limit = 30): SearchHit[] {
    const query = q.trim();
    if (!query)
      return [...this.files.keys()]
        .slice(0, limit)
        .map((r) => ({ rel: r, title: baseOf(r), folder: dirOf(r), snippet: '', score: 0 }));
    let res = this.mini.search(query, { combineWith: 'AND' });
    if (!res.length) res = this.mini.search(query, { combineWith: 'OR' });
    return res.slice(0, limit).map((r) => {
      const f = this.files.get(r.id as string)!;
      const lower = f.content.toLowerCase();
      const at = lower.indexOf(query.toLowerCase().split(/\s+/)[0]);
      const start = Math.max(0, at - 40);
      return { rel: f.rel, title: baseOf(f.rel), folder: dirOf(f.rel), snippet: at < 0 ? '' : (start ? '…' : '') + f.content.slice(start, start + 150).replace(/\s+/g, ' '), score: r.score };
    });
  }

  listNotes(): { rel: string; title: string }[] {
    return [...this.files.keys()].map((r) => ({ rel: r, title: baseOf(r) }));
  }

  previews(rels: string[]): Record<string, { preview: string; tags: string[] }> {
    const out: Record<string, { preview: string; tags: string[] }> = {};
    for (const r of rels) {
      const f = this.files.get(r);
      if (!f) continue;
      const deps = this.out.get(r)?.size ?? 0;
      let used = 0;
      for (const m of this.out.values()) if (m.has(r)) used++;
      const head = f.content
        .split(/\r?\n/)
        .filter((l) => l.trim() && !/^\s*(import|from|package|\/\/|#|\*|\/\*|use |require)/.test(l))
        .slice(0, 5)
        .join('\n');
      out[r] = { preview: `${f.lines} lines · imports ${deps} · used by ${used}\n${head}`.slice(0, 400), tags: [extOf(r)] };
    }
    return out;
  }

  noteInfo(rel: string): NoteInfo {
    const f = this.files.get(rel);
    const backlinks: LinkRef[] = [];
    for (const [s, m] of this.out) {
      const line = m.get(rel);
      if (line === undefined) continue;
      const src = this.files.get(s)!;
      backlinks.push({ rel: s, title: s, context: (src.content.split(/\r?\n/)[line] ?? '').trim().slice(0, 200) });
    }
    backlinks.sort((a, b) => a.rel.localeCompare(b.rel));
    const outgoing: NoteInfo['outgoing'] = [...(this.out.get(rel)?.keys() ?? [])].map((t) => ({ target: t, title: t, resolved: true }));
    for (const e of this.ext.get(rel) ?? []) outgoing.push({ target: e, title: `${e} (package)`, resolved: false });
    return { rel, title: baseOf(rel), exists: !!f, backlinks, outgoing, tags: f ? [extOf(rel)] : [], headings: [] };
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    await this.watcher?.close();
  }
}
