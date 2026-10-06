// Localhost-only Ollama embedding client (nomic-embed-text). Grok Bot.
export const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
export const DEFAULT_EMBED_BASE_URL = 'http://127.0.0.1:11434';
export const NOMIC_DIMS = 768;
export const EMBED_PREFIX_VERSION = 1;
export const DOC_PREFIX = 'search_document: ';
export const QUERY_PREFIX = 'search_query: ';

export class OllamaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OllamaUnavailableError';
  }
}

export class EmbedUrlRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbedUrlRejectedError';
  }
}

/** Allow only loopback HTTP endpoints (privacy: never send vault text off-machine). */
export function assertLoopbackEmbedUrl(baseUrl: string): string {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new EmbedUrlRejectedError('embedBaseUrl is not a valid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new EmbedUrlRejectedError('embedBaseUrl must be http(s)');
  }
  const host = u.hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]' && host !== '::1') {
    throw new EmbedUrlRejectedError('embedBaseUrl must be localhost / 127.0.0.1 / ::1');
  }
  // Prefer http for local ollama
  return u.origin;
}

export function normalizeEmbedBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_EMBED_BASE_URL;
  try {
    return assertLoopbackEmbedUrl(raw.trim());
  } catch {
    return DEFAULT_EMBED_BASE_URL;
  }
}

export function normalizeEmbedModel(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_EMBED_MODEL;
  const m = raw.trim().slice(0, 128);
  return /^[\w./:-]+$/.test(m) ? m : DEFAULT_EMBED_MODEL;
}

export function l2normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

function toFloat32(arr: number[]): Float32Array {
  return l2normalize(Float32Array.from(arr));
}

async function postJson(
  url: string,
  body: unknown,
  signal?: AbortSignal,
  timeoutMs = 60_000,
): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const msg = `Ollama HTTP ${res.status}`;
      throw new OllamaUnavailableError(msg);
    }
    return await res.json();
  } catch (e) {
    if (e instanceof OllamaUnavailableError) throw e;
    throw new OllamaUnavailableError(e instanceof Error ? e.message : 'Ollama request failed');
  } finally {
    clearTimeout(t);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Batch embed via POST /api/embed; fallback to /api/embeddings per text. Chunks requests to ≤16. */
export async function embedTexts(
  texts: string[],
  opts?: { model?: string; baseUrl?: string; signal?: AbortSignal; asQuery?: boolean },
): Promise<Float32Array[]> {
  if (!texts.length) return [];
  const base = assertLoopbackEmbedUrl(opts?.baseUrl ?? DEFAULT_EMBED_BASE_URL);
  const model = opts?.model ?? DEFAULT_EMBED_MODEL;
  const prefix = opts?.asQuery ? QUERY_PREFIX : DOC_PREFIX;
  const input = texts.map((t) => prefix + t);
  const out: Float32Array[] = [];
  const BATCH = 16;
  for (let i = 0; i < input.length; i += BATCH) {
    opts?.signal?.throwIfAborted?.();
    const slice = input.slice(i, i + BATCH);
    try {
      const data = await postJson(`${base}/api/embed`, { model, input: slice, options: { num_thread: 8 } }, opts?.signal, 180_000);
      const emb: number[][] | undefined = data?.embeddings;
      if (Array.isArray(emb) && emb.length === slice.length) {
        for (const row of emb) out.push(toFloat32(row));
        continue;
      }
      throw new OllamaUnavailableError('bad batch response');
    } catch {
      for (const t of slice) {
        opts?.signal?.throwIfAborted?.();
        const data = await postJson(`${base}/api/embeddings`, { model, prompt: t, options: { num_thread: 8 } }, opts?.signal, 90_000);
        const row: number[] | undefined = data?.embedding;
        if (!Array.isArray(row)) throw new OllamaUnavailableError('missing embedding');
        out.push(toFloat32(row));
      }
    }
  }
  return out;
}

export async function ollamaReachable(baseUrl?: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const base = assertLoopbackEmbedUrl(baseUrl ?? DEFAULT_EMBED_BASE_URL);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    signal?.addEventListener('abort', () => ctrl.abort());
    try {
      const res = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
      return res.ok;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return false;
  }
}
