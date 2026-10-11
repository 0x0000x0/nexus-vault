// In-memory vault index (notes, links, tags, headings, full-text) kept fresh by chokidar. Grok Bot.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import v8 from 'node:v8';
import { watch, type FSWatcher } from 'chokidar';
import MiniSearch from 'minisearch';
import type { FsChange, GraphData, GraphOpts, IndexStats, LinkRef, NoteInfo, SearchHit } from '../shared/types';
import { COLLAPSE_ABOVE_NOTES, collapsedNoteGraph, fullNoteGraph } from './notegraph';
import { norm, parseNote, resolveTarget, titleOf, type ParsedNote } from './parse';
import { logWarn } from './index-log';

interface NoteRec {
  rel: string;
  title: string;
  content: string;
  parsed: ParsedNote;
}

const MINI_OPTS = {
  fields: ['title', 'content', 'tags', 'headings'],
  storeFields: ['title'],
  searchOptions: { boost: { title: 4, headings: 2, tags: 2 }, prefix: true, fuzzy: 0.15 },
};
/** 0.0.9: bump when NoteRec/ParsedNote/MiniSearch options change, so old caches are ignored. */
const CACHE_VERSION = 1;
interface CacheFile {
  v: number;
  root: string;
  notes: [rel: string, mtimeMs: number, size: number, rec: NoteRec][];
  mini: unknown;
}

const toRel = (root: string, abs: string) => path.relative(root, abs).split(path.sep).join('/');
const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

export class VaultIndex {
  readonly root: string;
  private notes = new Map<string, NoteRec>();
  byName = new Map<string, string[]>();
  byPath = new Map<string, string>();
  private out = new Map<string, Set<string>>(); // rel -> resolved targets
  private ghosts = new Map<string, Set<string>>(); // rel -> unresolved names
  private mini = this.newMini();
  private watcher: FSWatcher | null = null;
  private pending = new Map<string, 'upsert' | 'remove'>();
  private pendingDirs = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  version = 0;
  /** 0.0.9: bumps only when graph-visible data changes (note set, resolved links, ghosts, tags). */
  topoVersion = 0;
  /** 0.0.9: bumps only when the set of note paths changes (create/delete/rename). */
  namesVersion = 0;
  ready = false;
  /** 0.0.9: MiniSearch is filled (start() builds it in chunks after `ready`). */
  private searchReady = false;
  /** Optional per-note change hook (semantic index). null content = removed. */
  onNote: ((rel: string, note: { title: string; content: string } | null) => void) | null = null;

  /** 0.0.9: file stamps (mtime, size) of what is indexed; a note is reused from the cache only if both match. */
  private stamps = new Map<string, [number, number]>();
  private cacheTimer: NodeJS.Timeout | null = null;
  private cacheDirty = false;
  /** How the last start() went (for logs and benches). */
  startInfo = { cached: 0, read: 0, miniFromCache: false, cacheMs: 0 };

  /**
   * @param cacheFile 0.0.9: optional persistent index cache (lives in userData, never in the vault).
   *   Notes whose mtime+size match are not re-read or re-parsed, and the full-text index is restored.
   */
  constructor(
    root: string,
    private onChange: (stats: IndexStats, fsChange: FsChange) => void,
    private cacheFile: string | null = null,
  ) {
    this.root = root;
  }

  private newMini() {
    return new MiniSearch<{ id: string; title: string; content: string; tags: string; headings: string }>(MINI_OPTS);
  }

  private async readCache(): Promise<CacheFile | null> {
    if (!this.cacheFile) return null;
    try {
      const c = v8.deserialize(await fsp.readFile(this.cacheFile)) as CacheFile;
      if (c?.v !== CACHE_VERSION || c.root !== this.root || !Array.isArray(c.notes)) return null;
      return c;
    } catch {
      return null; // missing or unreadable cache = cold start
    }
  }

  /** Write the cache now (atomic: temp file + rename). */
  async saveCache(): Promise<void> {
    if (!this.cacheFile || !this.ready || !this.searchReady) return;
    if (this.cacheTimer) clearTimeout(this.cacheTimer);
    this.cacheTimer = null;
    this.cacheDirty = false;
    const notes: CacheFile['notes'] = [];
    for (const [rel, n] of this.notes) {
      const st = this.stamps.get(rel);
      if (st) notes.push([rel, st[0], st[1], n]);
    }
    const data: CacheFile = { v: CACHE_VERSION, root: this.root, notes, mini: this.mini.toJSON() };
    const tmp = `${this.cacheFile}.${process.pid}.tmp`;
    try {
      await fsp.mkdir(path.dirname(this.cacheFile), { recursive: true });
      await fsp.writeFile(tmp, v8.serialize(data));
      await fsp.rename(tmp, this.cacheFile);
    } catch (e) {
      logWarn('index', 'could not write index cache', e);
      await fsp.rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  private scheduleCacheSave(ms = 4000): void {
    if (!this.cacheFile) return;
    this.cacheDirty = true;
    if (this.cacheTimer) clearTimeout(this.cacheTimer);
    this.cacheTimer = setTimeout(() => void this.saveCache(), ms);
  }

  async start(): Promise<void> {
    const files: string[] = [];
    const stack = [this.root];
    while (stack.length && !this.closed) {
      const dir = stack.pop()!;
      let ents: fs.Dirent[];
      try {
        ents = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const d of ents) {
        if (d.name.startsWith('.')) continue;
        const abs = path.join(dir, d.name);
        if (d.isDirectory()) stack.push(abs);
        else if (d.isFile() && d.name.toLowerCase().endsWith('.md')) files.push(toRel(this.root, abs));
      }
    }
    const c0 = performance.now();
    const cache = await this.readCache();
    const cached = new Map<string, CacheFile['notes'][number]>();
    for (const e of cache?.notes ?? []) cached.set(e[0], e);
    const fresh: string[] = []; // read + parsed now (new or changed since the cache)
    for (let i = 0; i < files.length; i += 64) {
      if (this.closed) return;
      await Promise.all(
        files.slice(i, i + 64).map(async (r) => {
          const c = cached.get(r);
          if (c) {
            try {
              const st = await fsp.stat(path.join(this.root, r));
              if (st.mtimeMs === c[1] && st.size === c[2]) {
                this.notes.set(r, c[3]);
                this.stamps.set(r, [c[1], c[2]]);
                return;
              }
            } catch {
              return;
            }
          }
          if (await this.load(r)) fresh.push(r);
        }),
      );
    }
    this.startInfo = { cached: this.notes.size - fresh.length, read: fresh.length, miniFromCache: false, cacheMs: 0 };
    this.rebuildNames();
    this.relinkAll();
    this.ready = true;
    this.version++;
    this.topoVersion++;
    this.namesVersion++;
    // 0.0.9: tree/graph/board can show now; the full-text index builds in small chunks after this,
    // so the main process keeps answering IPC (addAll blocked it ~600-700 ms at 3k notes).
    this.emit({ dirs: [], files: [] });
    let restored = false;
    if (cache?.mini) {
      try {
        const MS = MiniSearch as unknown as { loadJSAsync: (js: unknown, o: typeof MINI_OPTS) => Promise<MiniSearch> };
        const m = await MS.loadJSAsync(cache.mini, MINI_OPTS);
        // bring it up to date: drop removed/changed notes, add new/changed ones
        const freshSet = new Set(fresh);
        for (const rel of cached.keys()) if (m.has(rel) && (!this.notes.has(rel) || freshSet.has(rel))) m.discard(rel);
        for (const rel of fresh) m.add(this.doc(this.notes.get(rel)!));
        this.mini = m as typeof this.mini;
        restored = true;
      } catch (e) {
        logWarn('index', 'index cache: full-text part unusable, rebuilding', e);
        this.mini = this.newMini();
      }
    }
    if (!restored) await this.mini.addAllAsync([...this.notes.values()].map((n) => this.doc(n)), { chunkSize: 100 });
    this.searchReady = true;
    this.startInfo.miniFromCache = restored;
    this.startInfo.cacheMs = Math.round(performance.now() - c0);
    if (this.closed) return;
    this.startWatcher();
    if (this.cacheFile && (!cache || fresh.length || cached.size !== this.notes.size)) this.scheduleCacheSave(1500);
  }

  private startWatcher(): void {
    if (this.closed) return;
    this.watcher = watch(this.root, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (p: string) => {
        const rel = toRel(this.root, p);
        return rel !== '' && rel.split('/').some((s) => s.startsWith('.'));
      },
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    });
    const q = (kind: 'upsert' | 'remove' | 'dir', listingChanges = true) => (abs: string) => {
      const rel = toRel(this.root, abs);
      // 0.0.9: a content change doesn't change any folder listing (no tree/board reload).
      if (listingChanges) this.pendingDirs.add(dirOf(rel));
      if (kind === 'dir') this.pendingDirs.add(rel);
      else if (rel.toLowerCase().endsWith('.md')) this.pending.set(rel, kind);
      this.schedule();
    };
    this.watcher.on('add', q('upsert')).on('change', q('upsert', false)).on('unlink', q('remove'));
    this.watcher.on('addDir', q('dir')).on('unlinkDir', (abs: string) => {
      const rel = toRel(this.root, abs);
      for (const k of this.notes.keys()) if (k.startsWith(rel + '/')) this.pending.set(k, 'remove');
      q('dir')(abs);
    });
    this.watcher.on('error', (e) => logWarn('watch', 'chokidar watcher error', e));
  }

  /** Tell the index a file changed right now (used after our own writes so UI updates instantly). */
  touch(rel: string, kind: 'upsert' | 'remove' = 'upsert'): void {
    if (rel.toLowerCase().endsWith('.md')) this.pending.set(rel, kind);
    if (kind === 'remove' || !this.notes.has(rel)) this.pendingDirs.add(dirOf(rel));
    this.schedule(60);
  }
  touchDir(rel: string): void {
    this.pendingDirs.add(rel);
    this.pendingDirs.add(dirOf(rel));
    this.schedule(60);
  }

  private schedule(ms = 300): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    if (this.closed) return;
    if (!this.searchReady) {
      // Startup is still filling the search index; apply edits right after it.
      this.schedule(50);
      return;
    }
    const batch = [...this.pending];
    const dirs = [...this.pendingDirs];
    this.pending.clear();
    this.pendingDirs.clear();
    let namesChanged = false;
    const changed: string[] = []; // notes whose content really changed (0.0.9: echo of our own write = no-op)
    const prevTags = new Map<string, string[]>();
    for (const [rel, kind] of batch) {
      const prev = this.notes.get(rel);
      if (kind === 'remove' || !(await this.load(rel))) {
        if (prev) {
          this.mini.discard(rel);
          this.notes.delete(rel);
          this.stamps.delete(rel);
          namesChanged = true;
          changed.push(rel);
          this.onNote?.(rel, null);
        }
        continue;
      }
      const n = this.notes.get(rel)!;
      if (prev && prev.content === n.content) {
        // Same bytes we already indexed (watcher echo of our own save, or a touch without edits).
        this.notes.set(rel, prev);
        continue;
      }
      if (prev) {
        this.mini.discard(rel);
        prevTags.set(rel, prev.parsed.tags);
      } else namesChanged = true;
      this.mini.add(this.doc(n));
      changed.push(rel);
      this.onNote?.(rel, { title: n.title, content: n.content });
    }
    const files = changed;
    if (changed.length) {
      let topo = namesChanged;
      if (namesChanged) {
        this.rebuildNames();
        this.relinkAll();
        this.namesVersion++;
      } else {
        // 0.0.9: content-only edits re-resolve just the edited notes (names unchanged => nobody else's links move).
        for (const rel of changed) if (this.relinkOne(rel, prevTags.get(rel) ?? [])) topo = true;
      }
      this.version++;
      if (topo) this.topoVersion++;
    }
    if (changed.length || dirs.length) this.emit({ dirs, files });
    if (batch.length) this.scheduleCacheSave();
  }

  private emit(fsChange: FsChange): void {
    this.onChange(this.stats(), fsChange);
  }

  /** Resolved file->file links (never collapsed). With `among`, only links whose both ends are in that set. */
  links(among?: string[]): [string, string][] {
    const out: [string, string][] = [];
    if (among) {
      const set = new Set(among);
      for (const s of set) for (const t of this.out.get(s)?.keys() ?? []) if (set.has(t)) out.push([s, t]);
      return out;
    }
    for (const [s, m] of this.out) for (const t of m.keys()) out.push([s, t]);
    return out;
  }

  stats(): IndexStats {
    let links = 0;
    for (const s of this.out.values()) links += s.size;
    return { notes: this.notes.size, links, version: this.version, topo: this.topoVersion, names: this.namesVersion };
  }

  private async load(rel: string): Promise<boolean> {
    try {
      const abs = path.join(this.root, rel);
      const st = await fsp.stat(abs); // stamp first: a write racing the read just makes the next start re-read
      const content = await fsp.readFile(abs, 'utf8');
      this.notes.set(rel, { rel, title: titleOf(rel), content, parsed: parseNote(content) });
      this.stamps.set(rel, [st.mtimeMs, st.size]);
      return true;
    } catch {
      return false;
    }
  }

  private doc(n: NoteRec) {
    return { id: n.rel, title: n.title, content: n.content, tags: n.parsed.tags.join(' '), headings: n.parsed.headings.map((h) => h.text).join(' ') };
  }

  private rebuildNames(): void {
    this.byName.clear();
    this.byPath.clear();
    for (const rel of this.notes.keys()) {
      const k = norm(titleOf(rel));
      const arr = this.byName.get(k);
      if (arr) arr.push(rel);
      else this.byName.set(k, [rel]);
      this.byPath.set(norm(rel.replace(/\.md$/i, '')), rel);
    }
  }

  /** Resolve one note's links into out/ghosts sets (pure w.r.t. the name maps). */
  private linkSets(n: NoteRec): { set: Set<string>; gh: Set<string> } {
    const set = new Set<string>();
    const gh = new Set<string>();
    for (const l of n.parsed.links) {
      if (!l.target) continue;
      const r = resolveTarget(l.target, n.rel, this.byName, this.byPath, l.kind);
      if (r && r !== n.rel) set.add(r);
      else if (!r && !/\.[a-z0-9]{1,5}$/i.test(l.target.replace(/\.md$/i, '')) && l.kind === 'wiki') gh.add(l.target.split('/').pop()!.trim());
    }
    return { set, gh };
  }

  private relinkAll(): void {
    this.out.clear();
    this.ghosts.clear();
    for (const n of this.notes.values()) {
      const { set, gh } = this.linkSets(n);
      this.out.set(n.rel, set);
      if (gh.size) this.ghosts.set(n.rel, gh);
    }
  }

  /**
   * 0.0.9: re-resolve one edited note (names unchanged). Returns true when anything the graph shows
   * changed (resolved links, ghost links or tags), so the cached graph can be kept otherwise.
   */
  private relinkOne(rel: string, prevTags: string[]): boolean {
    const n = this.notes.get(rel);
    if (!n) return false;
    const oldOut = this.out.get(rel) ?? new Set<string>();
    const oldGh = this.ghosts.get(rel) ?? new Set<string>();
    const { set, gh } = this.linkSets(n);
    this.out.set(rel, set);
    if (gh.size) this.ghosts.set(rel, gh);
    else this.ghosts.delete(rel);
    return !sameSet(oldOut, set) || !sameSet(oldGh, gh) || prevTags.join('\0') !== n.parsed.tags.join('\0');
  }

  resolve(target: string, from: string): string | null {
    return resolveTarget(target, from, this.byName, this.byPath);
  }

  has(rel: string): boolean {
    return this.notes.has(rel);
  }

  private graphCache = new Map<string, GraphData>();
  private graphCacheVersion = -1;

  /**
   * Graph for the renderer. Large vaults (> COLLAPSE_ABOVE_NOTES) are folder-collapsed unless
   * opts.mode === 'full'; opts.expand opens one folder group. Cached per index version (0.0.8).
   */
  graph(opts: GraphOpts = {}): GraphData {
    if (this.graphCacheVersion !== this.topoVersion) {
      this.graphCache.clear();
      this.graphCacheVersion = this.topoVersion;
    }
    const collapse = opts.mode !== 'full' && this.notes.size > COLLAPSE_ABOVE_NOTES;
    const key = collapse ? `c:${opts.expand ?? ''}` : 'full';
    const hit = this.graphCache.get(key);
    if (hit) return hit;
    const notes = [...this.notes.values()].map((n) => ({ rel: n.rel, title: n.title, tags: n.parsed.tags }));
    const g = collapse ? collapsedNoteGraph(notes, this.out, this.ghosts, this.topoVersion, norm, opts.expand ?? null) : fullNoteGraph(notes, this.out, this.ghosts, this.topoVersion, norm);
    if (this.graphCache.size >= 6) this.graphCache.delete(this.graphCache.keys().next().value as string);
    this.graphCache.set(key, g);
    return g;
  }

  search(q: string, limit = 30): SearchHit[] {
    const query = q.trim();
    if (!query) {
      return [...this.notes.values()]
        .sort((a, b) => a.title.localeCompare(b.title))
        .slice(0, limit)
        .map((n) => ({ rel: n.rel, title: n.title, folder: dirOf(n.rel), snippet: '', score: 0 }));
    }
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!this.searchReady) {
      // First ~0.5 s after launch: title match until the full-text index is built.
      const hits: SearchHit[] = [];
      for (const n of this.notes.values()) {
        const t = n.title.toLowerCase();
        if (words.every((w) => t.includes(w))) hits.push({ rel: n.rel, title: n.title, folder: dirOf(n.rel), snippet: '', score: 1 });
        if (hits.length >= limit) break;
      }
      return hits;
    }
    const res = this.mini.search(query, { combineWith: 'AND' });
    const res2 = res.length ? res : this.mini.search(query, { combineWith: 'OR' });
    return res2.slice(0, limit).map((r) => {
      const n = this.notes.get(r.id as string)!;
      return { rel: n.rel, title: n.title, folder: dirOf(n.rel), snippet: snippet(n.content, [...words, ...r.terms]), score: r.score };
    });
  }

  previews(rels: string[]): Record<string, { preview: string; tags: string[] }> {
    const out: Record<string, { preview: string; tags: string[] }> = {};
    for (const r of rels) {
      const n = this.notes.get(r);
      if (n) out[r] = { preview: previewText(n.content), tags: n.parsed.tags.slice(0, 4) };
    }
    return out;
  }

  listNotes(): { rel: string; title: string }[] {
    return [...this.notes.values()].map((n) => ({ rel: n.rel, title: n.title }));
  }

  noteContent(rel: string): string | undefined {
    return this.notes.get(rel)?.content;
  }

  allNotes(): { rel: string; title: string; content: string }[] {
    return [...this.notes.values()].map((n) => ({ rel: n.rel, title: n.title, content: n.content }));
  }

  noteInfo(rel: string): NoteInfo {
    const n = this.notes.get(rel);
    const backlinks: LinkRef[] = [];
    for (const [src, set] of this.out) {
      if (!set.has(rel)) continue;
      const s = this.notes.get(src)!;
      const lines = s.content.split(/\r?\n/);
      const ctxLines = new Set<number>();
      for (const l of s.parsed.links) if (resolveTarget(l.target, src, this.byName, this.byPath, l.kind) === rel) ctxLines.add(l.line);
      const ctx = [...ctxLines].slice(0, 3).map((i) => (lines[i] ?? '').trim()).join(' … ');
      backlinks.push({ rel: src, title: s.title, context: ctx.slice(0, 300) });
    }
    backlinks.sort((a, b) => a.title.localeCompare(b.title));
    const outgoing: NoteInfo['outgoing'] = [];
    if (n) {
      const seen = new Set<string>();
      for (const l of n.parsed.links) {
        if (!l.target) continue;
        const r = resolveTarget(l.target, rel, this.byName, this.byPath, l.kind);
        const key = r ?? 'x:' + l.target;
        if (seen.has(key)) continue;
        seen.add(key);
        outgoing.push({ target: r ?? l.target, title: r ? titleOf(r) : l.target, resolved: !!r });
      }
    }
    return { rel, title: titleOf(rel), exists: !!n, backlinks, outgoing, tags: n?.parsed.tags ?? [], headings: n?.parsed.headings ?? [] };
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    await this.watcher?.close();
    if (this.cacheTimer) clearTimeout(this.cacheTimer);
    if (this.cacheDirty) await this.saveCache();
  }
}

function snippet(content: string, terms: string[]): string {
  const lower = content.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, at < 0 ? 0 : at - 50);
  const s = content.slice(start, start + 160).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + s;
}

/** Plain-text preview of a note: drop frontmatter, headings markers, link brackets, markup. */
export function previewText(content: string): string {
  let s = content.replace(/^---\r?\n[\s\S]*?\r?\n---\s*\n?/, '');
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/!\[\[[^\]]*\]\]/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  s = s.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, '☐ ').replace(/^\s*[-*+]\s+/gm, '• ');
  s = s.replace(/[*_`>~]/g, '');
  return s.replace(/\n{2,}/g, '\n').trim().slice(0, 280);
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
