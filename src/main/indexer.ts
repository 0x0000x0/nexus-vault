// In-memory vault index (notes, links, tags, headings, full-text) kept fresh by chokidar. Grok Bot.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import MiniSearch from 'minisearch';
import type { FsChange, GraphData, GraphNode, IndexStats, LinkRef, NoteInfo, SearchHit } from '../shared/types';
import { norm, parseNote, resolveTarget, titleOf, type ParsedNote } from './parse';
import { logWarn } from './logger';

interface NoteRec {
  rel: string;
  title: string;
  content: string;
  parsed: ParsedNote;
}

const toRel = (root: string, abs: string) => path.relative(root, abs).split(path.sep).join('/');
const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const topFolder = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '');

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
  ready = false;
  /** Optional per-note change hook (semantic index). null content = removed. */
  onNote: ((rel: string, note: { title: string; content: string } | null) => void) | null = null;

  constructor(root: string, private onChange: (stats: IndexStats, fsChange: FsChange) => void) {
    this.root = root;
  }

  private newMini() {
    return new MiniSearch<{ id: string; title: string; content: string; tags: string; headings: string }>({
      fields: ['title', 'content', 'tags', 'headings'],
      storeFields: ['title'],
      searchOptions: { boost: { title: 4, headings: 2, tags: 2 }, prefix: true, fuzzy: 0.15 },
    });
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
    for (let i = 0; i < files.length; i += 32) {
      if (this.closed) return;
      await Promise.all(files.slice(i, i + 32).map((r) => this.load(r)));
    }
    this.rebuildNames();
    this.mini.addAll([...this.notes.values()].map((n) => this.doc(n)));
    this.relinkAll();
    this.ready = true;
    this.version++;
    this.emit({ dirs: [], files: [] });
    this.startWatcher();
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
    const q = (kind: 'upsert' | 'remove' | 'dir') => (abs: string) => {
      const rel = toRel(this.root, abs);
      this.pendingDirs.add(dirOf(rel));
      if (kind === 'dir') this.pendingDirs.add(rel);
      else if (rel.toLowerCase().endsWith('.md')) this.pending.set(rel, kind);
      this.schedule();
    };
    this.watcher.on('add', q('upsert')).on('change', q('upsert')).on('unlink', q('remove'));
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
    this.pendingDirs.add(dirOf(rel));
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
    const batch = [...this.pending];
    const dirs = [...this.pendingDirs];
    this.pending.clear();
    this.pendingDirs.clear();
    let namesChanged = false;
    for (const [rel, kind] of batch) {
      const had = this.notes.has(rel);
      if (had) this.mini.discard(rel);
      if (kind === 'remove' || !(await this.load(rel))) {
        this.notes.delete(rel);
        namesChanged = namesChanged || had;
        if (had) this.onNote?.(rel, null);
      } else {
        namesChanged = namesChanged || !had;
        const n = this.notes.get(rel)!;
        this.mini.add(this.doc(n));
        this.onNote?.(rel, { title: n.title, content: n.content });
      }
    }
    if (batch.length) {
      if (namesChanged) this.rebuildNames();
      this.relinkAll();
      this.version++;
    }
    this.emit({ dirs, files: batch.map(([r]) => r) });
  }

  private emit(fsChange: FsChange): void {
    this.onChange(this.stats(), fsChange);
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
    return { notes: this.notes.size, links, version: this.version };
  }

  private async load(rel: string): Promise<boolean> {
    try {
      const content = await fsp.readFile(path.join(this.root, rel), 'utf8');
      this.notes.set(rel, { rel, title: titleOf(rel), content, parsed: parseNote(content) });
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

  private relinkAll(): void {
    this.out.clear();
    this.ghosts.clear();
    for (const n of this.notes.values()) {
      const set = new Set<string>();
      const gh = new Set<string>();
      for (const l of n.parsed.links) {
        if (!l.target) continue;
        const r = resolveTarget(l.target, n.rel, this.byName, this.byPath, l.kind);
        if (r && r !== n.rel) set.add(r);
        else if (!r && !/\.[a-z0-9]{1,5}$/i.test(l.target.replace(/\.md$/i, '')) && l.kind === 'wiki') gh.add(l.target.split('/').pop()!.trim());
      }
      this.out.set(n.rel, set);
      if (gh.size) this.ghosts.set(n.rel, gh);
    }
  }

  resolve(target: string, from: string): string | null {
    return resolveTarget(target, from, this.byName, this.byPath);
  }

  has(rel: string): boolean {
    return this.notes.has(rel);
  }

  graph(): GraphData {
    const nodes = new Map<string, GraphNode>();
    const links: { source: string; target: string }[] = [];
    for (const n of this.notes.values()) nodes.set(n.rel, { id: n.rel, title: n.title, folder: topFolder(n.rel), degree: 0, tags: n.parsed.tags });
    for (const [src, set] of this.out) {
      for (const t of set) {
        links.push({ source: src, target: t });
        nodes.get(src)!.degree++;
        const tn = nodes.get(t);
        if (tn) tn.degree++;
      }
    }
    for (const [src, gh] of this.ghosts) {
      for (const g of gh) {
        const id = `ghost:${norm(g)}`;
        if (!nodes.has(id)) nodes.set(id, { id, title: g, folder: '', ghost: true, degree: 0, tags: [] });
        nodes.get(id)!.degree++;
        nodes.get(src)!.degree++;
        links.push({ source: src, target: id });
      }
    }
    return { nodes: [...nodes.values()], links, version: this.version };
  }

  search(q: string, limit = 30): SearchHit[] {
    const query = q.trim();
    if (!query) {
      return [...this.notes.values()]
        .sort((a, b) => a.title.localeCompare(b.title))
        .slice(0, limit)
        .map((n) => ({ rel: n.rel, title: n.title, folder: dirOf(n.rel), snippet: '', score: 0 }));
    }
    const res = this.mini.search(query, { combineWith: 'AND' });
    const res2 = res.length ? res : this.mini.search(query, { combineWith: 'OR' });
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
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
