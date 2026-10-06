// Semantic search façade: VectorStore + Ollama embeddings (replaces FNV hashing-trick). Grok Bot.
export { cosine } from './semantic-math';
export { chunkNote as chunk, CHUNK_MAX_CHARS, SNIPPET_MAX_CHARS } from './semantic-chunk';
export {
  VectorStore,
  resolveIndexDir,
  estimateChunkCount,
  INDEX_DIR,
  type SemanticHitOut,
  type VectorStoreStatus,
} from './vector-store';
export {
  embedTexts,
  ollamaReachable,
  normalizeEmbedBaseUrl,
  normalizeEmbedModel,
  DEFAULT_EMBED_MODEL,
  DEFAULT_EMBED_BASE_URL,
  NOMIC_DIMS,
  OllamaUnavailableError,
} from './ollama-embed';

import { VectorStore, resolveIndexDir, type SemanticHitOut } from './vector-store';
import { DEFAULT_EMBED_BASE_URL, DEFAULT_EMBED_MODEL } from './ollama-embed';

/** Thin async façade matching previous SemanticIndex call sites (now async search/related). */
export class SemanticIndex {
  private store: VectorStore;

  constructor(opts: { vaultPath: string; userData?: string; model?: string; baseUrl?: string }) {
    const dir = resolveIndexDir(opts.vaultPath, opts.userData);
    this.store = new VectorStore(dir, {
      model: opts.model ?? DEFAULT_EMBED_MODEL,
      baseUrl: opts.baseUrl ?? DEFAULT_EMBED_BASE_URL,
    });
  }

  get vectorStore(): VectorStore {
    return this.store;
  }

  load(): boolean {
    return this.store.load();
  }

  /** Sync enqueue — Ollama work runs on serial async worker. */
  upsert(rel: string, title: string, content: string): void {
    this.store.enqueue(rel, title, content);
  }

  remove(rel: string): void {
    this.store.enqueue(rel, '', null);
  }

  async search(q: string, limit = 20, minScore = 0.38): Promise<SemanticHitOut[]> {
    return this.store.search(q, limit, minScore);
  }

  async related(rel: string, limit = 5, minScore = 0.32): Promise<SemanticHitOut[]> {
    return this.store.related(rel, limit, minScore);
  }

  async rebuild(
    notes: Iterable<{ rel: string; title: string; content: string }>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    return this.store.rebuild(notes, onProgress);
  }

  close(): void {
    this.store.close();
  }

  size(): number {
    return this.store.size();
  }

  status() {
    return this.store.status();
  }

  async refreshOllama(): Promise<void> {
    return this.store.refreshOllama();
  }
}
