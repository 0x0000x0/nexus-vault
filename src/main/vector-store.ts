// Portable on-disk vector store: manifest + chunks.jsonl + embeddings.f32. Grok Bot.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  CHUNK_MAX_CHARS,
  CHUNK_OVERLAP,
  MAX_CHUNKS_PER_NOTE,
  SNIPPET_MAX_CHARS,
  chunkNote,
} from './semantic-chunk';
import {
  DEFAULT_EMBED_BASE_URL,
  DEFAULT_EMBED_MODEL,
  DOC_PREFIX,
  EMBED_PREFIX_VERSION,
  NOMIC_DIMS,
  QUERY_PREFIX,
  embedTexts,
  l2normalize,
  ollamaReachable,
  type OllamaUnavailableError,
} from './ollama-embed';

export const INDEX_DIR = '.nexus-vectors';
export const INDEX_FORMAT_VERSION = 1;

export interface VectorManifest {
  indexFormatVersion: number;
  model: string;
  dims: number;
  metric: 'cosine';
  chunkMaxChars: number;
  chunkOverlap: number;
  embedPrefixVersion: number;
  docPrefix: string;
  queryPrefix: string;
  createdAt: string;
  updatedAt: string;
  chunkCount: number;
  noteCount: number;
  vaultFingerprint?: string;
}

export interface ChunkMeta {
  id: number;
  rel: string;
  title: string;
  text: string; // snippet ≤500
  startLine: number;
  hash: string;
}

interface NoteRec {
  contentHash: string;
  mtimeMs?: number;
  chunkIds: number[];
}

export interface SemanticHitOut {
  rel: string;
  title: string;
  snippet: string;
  score: number;
  startLine?: number;
}

export interface VectorStoreStatus {
  indexed: number;
  chunks: number;
  model: string;
  ollama: 'ok' | 'down' | 'unknown';
  building: boolean;
  progress?: { done: number; total: number };
  needsRebuild: boolean;
  indexPath: string;
}

function sha1(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function contentHash(title: string, content: string): string {
  return sha1(title + '\n' + content);
}

function atomicWrite(file: string, data: string | Buffer): void {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function resolveIndexDir(vaultPath: string, userDataFallback?: string): string {
  const vaultSide = path.join(vaultPath, INDEX_DIR);
  try {
    fs.mkdirSync(vaultSide, { recursive: true });
    fs.accessSync(vaultSide, fs.constants.W_OK);
    return vaultSide;
  } catch {
    if (userDataFallback) {
      const h = sha1(vaultPath.toLowerCase()).slice(0, 16);
      const alt = path.join(userDataFallback, 'vector-indexes', h);
      fs.mkdirSync(alt, { recursive: true });
      return alt;
    }
    throw new Error('Cannot create vector index directory');
  }
}

export class VectorStore {
  readonly indexPath: string;
  private manifest: VectorManifest;
  private chunks: ChunkMeta[] = [];
  private embeddings: Float32Array = new Float32Array(0);
  private notes = new Map<string, NoteRec>();
  private model: string;
  private baseUrl: string;
  private dims: number;
  private building = false;
  private progress = { done: 0, total: 0 };
  private needsRebuild = false;
  private ollama: 'ok' | 'down' | 'unknown' = 'unknown';
  private queue: Array<{ rel: string; title: string; content: string | null }> = [];
  private queueByRel = new Map<string, number>();
  private workerRunning = false;
  private checkpointTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private abort: AbortController | null = null;

  constructor(
    indexPath: string,
    opts?: { model?: string; baseUrl?: string; dims?: number },
  ) {
    this.indexPath = indexPath;
    this.model = opts?.model ?? DEFAULT_EMBED_MODEL;
    this.baseUrl = opts?.baseUrl ?? DEFAULT_EMBED_BASE_URL;
    this.dims = opts?.dims ?? NOMIC_DIMS;
    this.manifest = this.emptyManifest();
  }

  private emptyManifest(): VectorManifest {
    const now = new Date().toISOString();
    return {
      indexFormatVersion: INDEX_FORMAT_VERSION,
      model: this.model,
      dims: this.dims,
      metric: 'cosine',
      chunkMaxChars: CHUNK_MAX_CHARS,
      chunkOverlap: CHUNK_OVERLAP,
      embedPrefixVersion: EMBED_PREFIX_VERSION,
      docPrefix: DOC_PREFIX,
      queryPrefix: QUERY_PREFIX,
      createdAt: now,
      updatedAt: now,
      chunkCount: 0,
      noteCount: 0,
    };
  }

  /** Load existing index from disk if present and compatible. */
  load(): boolean {
    const manPath = path.join(this.indexPath, 'manifest.json');
    if (!fs.existsSync(manPath)) return false;
    try {
      const man = JSON.parse(fs.readFileSync(manPath, 'utf8')) as VectorManifest;
      if (
        man.indexFormatVersion !== INDEX_FORMAT_VERSION ||
        man.model !== this.model ||
        man.dims !== this.dims ||
        man.embedPrefixVersion !== EMBED_PREFIX_VERSION
      ) {
        this.needsRebuild = true;
        this.manifest = man;
        return false;
      }
      this.manifest = man;
      this.dims = man.dims;
      const jsonl = path.join(this.indexPath, 'chunks.jsonl');
      const f32 = path.join(this.indexPath, 'embeddings.f32');
      const notesPath = path.join(this.indexPath, 'notes.json');
      this.chunks = [];
      if (fs.existsSync(jsonl)) {
        for (const line of fs.readFileSync(jsonl, 'utf8').split('\n')) {
          if (!line.trim()) continue;
          this.chunks.push(JSON.parse(line) as ChunkMeta);
        }
      }
      if (fs.existsSync(f32)) {
        const buf = fs.readFileSync(f32);
        this.embeddings = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      } else {
        this.embeddings = new Float32Array(0);
      }
      this.notes.clear();
      if (fs.existsSync(notesPath)) {
        const obj = JSON.parse(fs.readFileSync(notesPath, 'utf8')) as Record<string, NoteRec>;
        for (const [k, v] of Object.entries(obj)) this.notes.set(k, v);
      }
      // Sanity
      if (this.embeddings.length !== this.chunks.length * this.dims) {
        this.needsRebuild = true;
        return false;
      }
      return true;
    } catch {
      this.needsRebuild = true;
      return false;
    }
  }

  private scheduleCheckpoint(): void {
    this.dirty = true;
    if (this.checkpointTimer) clearTimeout(this.checkpointTimer);
    this.checkpointTimer = setTimeout(() => {
      this.checkpointTimer = null;
      try {
        this.checkpoint();
      } catch {
        /* ignore disk errors; next attempt */
      }
    }, 1500);
    this.checkpointTimer.unref?.();
  }

  /** Rewrite f32 + jsonl + notes + manifest (strategy B). */
  checkpoint(): void {
    if (!this.dirty && fs.existsSync(path.join(this.indexPath, 'manifest.json'))) return;
    fs.mkdirSync(this.indexPath, { recursive: true });
    // Reassign dense ids
    const newChunks: ChunkMeta[] = [];
    const newEmb = new Float32Array(this.chunks.length * this.dims);
    const idMap = new Map<number, number>();
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      idMap.set(c.id, i);
      newChunks.push({ ...c, id: i, text: c.text.slice(0, SNIPPET_MAX_CHARS) });
      newEmb.set(this.embeddings.subarray(c.id * this.dims, c.id * this.dims + this.dims), i * this.dims);
    }
    // Fix notes chunkIds
    for (const rec of this.notes.values()) {
      rec.chunkIds = rec.chunkIds.map((id) => idMap.get(id)).filter((x): x is number => x !== undefined);
    }
    this.chunks = newChunks;
    this.embeddings = newEmb;

    const jsonl = this.chunks.map((c) => JSON.stringify(c)).join('\n') + (this.chunks.length ? '\n' : '');
    atomicWrite(path.join(this.indexPath, 'chunks.jsonl'), jsonl);
    atomicWrite(path.join(this.indexPath, 'embeddings.f32'), Buffer.from(this.embeddings.buffer, this.embeddings.byteOffset, this.embeddings.byteLength));
    const notesObj: Record<string, NoteRec> = {};
    for (const [k, v] of this.notes) notesObj[k] = v;
    atomicWrite(path.join(this.indexPath, 'notes.json'), JSON.stringify(notesObj, null, 0));
    this.manifest.chunkCount = this.chunks.length;
    this.manifest.noteCount = this.notes.size;
    this.manifest.updatedAt = new Date().toISOString();
    this.manifest.model = this.model;
    this.manifest.dims = this.dims;
    atomicWrite(path.join(this.indexPath, 'manifest.json'), JSON.stringify(this.manifest, null, 2));
    this.dirty = false;
  }

  status(): VectorStoreStatus {
    return {
      indexed: this.notes.size,
      chunks: this.chunks.length,
      model: this.model,
      ollama: this.ollama,
      building: this.building || this.workerRunning,
      progress: this.building ? { ...this.progress } : undefined,
      needsRebuild: this.needsRebuild,
      indexPath: this.indexPath,
    };
  }

  size(): number {
    return this.notes.size;
  }

  /** Enqueue note upsert/remove (sync). Serial worker drains async. */
  enqueue(rel: string, title: string, content: string | null): void {
    const existing = this.queueByRel.get(rel);
    if (existing !== undefined) {
      this.queue[existing] = { rel, title, content };
    } else {
      this.queueByRel.set(rel, this.queue.length);
      this.queue.push({ rel, title, content });
    }
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.workerRunning) return;
    this.workerRunning = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        this.queueByRel.delete(job.rel);
        // Re-map remaining indices
        this.queueByRel.clear();
        this.queue.forEach((j, i) => this.queueByRel.set(j.rel, i));
        try {
          if (job.content === null) this.removeSync(job.rel);
          else await this.upsertAsync(job.rel, job.title, job.content);
        } catch {
          this.ollama = 'down';
        }
      }
      this.scheduleCheckpoint();
    } finally {
      this.workerRunning = false;
      if (this.queue.length) void this.pump();
    }
  }

  private removeSync(rel: string): void {
    const rec = this.notes.get(rel);
    if (!rec) return;
    const remove = new Set(rec.chunkIds);
    this.chunks = this.chunks.filter((c) => !remove.has(c.id));
    // Keep embeddings sparse until checkpoint rewrite
    this.notes.delete(rel);
    this.dirty = true;
    this.scheduleCheckpoint();
  }

  private async upsertAsync(rel: string, title: string, content: string): Promise<void> {
    const hash = contentHash(title, content);
    const prev = this.notes.get(rel);
    if (prev && prev.contentHash === hash) return;

    const parts = chunkNote(content);
    if (parts.length === 0) {
      parts.push({ text: title, snippet: title.slice(0, SNIPPET_MAX_CHARS), startLine: 1 });
    }

    const texts = parts.map((p) => title + '\n' + p.text);
    const vectors = await embedTexts(texts, { model: this.model, baseUrl: this.baseUrl, signal: this.abort?.signal });
    this.ollama = 'ok';

    // Remove old chunks
    if (prev) {
      const remove = new Set(prev.chunkIds);
      this.chunks = this.chunks.filter((c) => !remove.has(c.id));
    }

    const newIds: number[] = [];
    // Append: assign next ids from max+1
    let nextId = this.chunks.reduce((m, c) => Math.max(m, c.id), -1) + 1;
    // Grow embeddings buffer
    const need = (nextId + parts.length) * this.dims;
    if (this.embeddings.length < need) {
      const bigger = new Float32Array(Math.max(need, this.embeddings.length * 2 || need));
      bigger.set(this.embeddings);
      this.embeddings = bigger;
    }
    for (let i = 0; i < parts.length; i++) {
      const id = nextId++;
      const p = parts[i];
      this.chunks.push({
        id,
        rel,
        title,
        text: p.snippet.slice(0, SNIPPET_MAX_CHARS),
        startLine: p.startLine,
        hash: sha1(p.text),
      });
      this.embeddings.set(vectors[i], id * this.dims);
      newIds.push(id);
    }
    this.notes.set(rel, { contentHash: hash, chunkIds: newIds });
    this.dirty = true;
  }

  /** Full rebuild from list of notes. */
  async rebuild(
    notes: Iterable<{ rel: string; title: string; content: string }>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    this.abort?.abort();
    this.abort = new AbortController();
    this.building = true;
    this.chunks = [];
    this.embeddings = new Float32Array(0);
    this.notes.clear();
    this.dirty = true;
    const list = [...notes];
    this.progress = { done: 0, total: list.length };
    onProgress?.(0, list.length);
    try {
      const ok = await ollamaReachable(this.baseUrl, this.abort.signal);
      this.ollama = ok ? 'ok' : 'down';
      if (!ok) throw new Error('Ollama unavailable');

      // Process in small batches for progress
      for (let i = 0; i < list.length; i++) {
        this.abort.signal.throwIfAborted();
        const n = list[i];
        await this.upsertAsync(n.rel, n.title, n.content);
        this.progress.done = i + 1;
        onProgress?.(i + 1, list.length);
      }
      this.needsRebuild = false;
      this.manifest = this.emptyManifest();
      this.dirty = true;
      this.checkpoint();
    } finally {
      this.building = false;
    }
  }

  async refreshOllama(): Promise<void> {
    this.ollama = (await ollamaReachable(this.baseUrl)) ? 'ok' : 'down';
  }

  async search(q: string, limit = 20, minScore = 0.38): Promise<SemanticHitOut[]> {
    if (!q.trim() || !this.chunks.length) return [];
    let qVec: Float32Array;
    try {
      const [v] = await embedTexts([q.trim()], {
        model: this.model,
        baseUrl: this.baseUrl,
        asQuery: true,
        signal: this.abort?.signal,
      });
      qVec = v;
      this.ollama = 'ok';
    } catch {
      this.ollama = 'down';
      return [];
    }
    return this.searchWithVector(qVec, limit, minScore);
  }

  private searchWithVector(qVec: Float32Array, limit: number, minScore: number, excludeRel?: string): SemanticHitOut[] {
    const best = new Map<string, SemanticHitOut>();
    for (const c of this.chunks) {
      if (excludeRel && c.rel === excludeRel) continue;
      const off = c.id * this.dims;
      if (off + this.dims > this.embeddings.length) continue;
      let dot = 0;
      for (let i = 0; i < this.dims; i++) dot += qVec[i] * this.embeddings[off + i];
      if (dot <= minScore) continue;
      const prev = best.get(c.rel);
      if (!prev || dot > prev.score) {
        best.set(c.rel, {
          rel: c.rel,
          title: c.title,
          snippet: c.text,
          score: dot,
          startLine: c.startLine,
        });
      }
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Related notes via mean of stored chunk vectors — never re-embed full note text. */
  async related(rel: string, limit = 5, minScore = 0.32): Promise<SemanticHitOut[]> {
    const rec = this.notes.get(rel);
    if (!rec || !rec.chunkIds.length) return [];
    const mean = new Float32Array(this.dims);
    let n = 0;
    for (const id of rec.chunkIds) {
      const off = id * this.dims;
      if (off + this.dims > this.embeddings.length) continue;
      for (let i = 0; i < this.dims; i++) mean[i] += this.embeddings[off + i];
      n++;
    }
    if (!n) return [];
    for (let i = 0; i < this.dims; i++) mean[i] /= n;
    l2normalize(mean);
    return this.searchWithVector(mean, limit + 1, minScore, rel).slice(0, limit);
  }

  close(): void {
    this.abort?.abort();
    if (this.checkpointTimer) {
      clearTimeout(this.checkpointTimer);
      this.checkpointTimer = null;
    }
    if (this.dirty) {
      try {
        this.checkpoint();
      } catch {
        /* */
      }
    }
    this.queue = [];
    this.queueByRel.clear();
    this.chunks = [];
    this.embeddings = new Float32Array(0);
    this.notes.clear();
  }
}

/** Dry-run chunk estimate for CLI guard. */
export function estimateChunkCount(
  notes: Iterable<{ content: string }>,
  opts?: { maxChars?: number; maxChunks?: number },
): number {
  let total = 0;
  for (const n of notes) {
    const parts = chunkNote(n.content, opts);
    total += Math.max(1, parts.length);
  }
  return total;
}

// silence unused import warning for type-only
export type { OllamaUnavailableError };
