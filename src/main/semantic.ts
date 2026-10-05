// Local semantic search: hashing-trick embeddings (no model download, no network, no deps). Grok Bot.
// FNV-1a 32-bit offset basis and prime
const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function fnv1a(str: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

const STOPWORDS = new Set([
  'the', 'and', 'of', 'to', 'in', 'is', 'it', 'you', 'that', 'he', 'for',
  'was', 'with', 'as', 'his', 'they', 'this', 'but', 'not', 'are', 'from',
  'or', 'which', 'has', 'had', 'will', 'would', 'could', 'should', 'may',
  'might', 'must', 'its', 'her', 'who', 'been', 'were', 'than', 'some',
  'such', 'both', 'through', 'about', 'over', 'between', 'out', 'up', 'down',
  'off', 'same', 'other', 'each', 'do', 'does', 'did', 'my', 'your', 'yours',
  'ours', 'ourselves', 'anyone', 'anything', 'something', 'nothing',
  'everything', 'anybody', 'nobody', 'somebody', 'everybody',
]);

export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return words
    .filter(w => w.length >= 2 && !STOPWORDS.has(w))
    // light plural stemming so "orchards" ~ "orchard"
    .map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

export function embed(text: string, dim = 512): Float32Array {
  const tokens = tokenize(text);
  const vec = new Float32Array(dim);

  const items: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    items.push(tokens[i]);
    if (i < tokens.length - 1) {
      items.push(tokens[i] + ' ' + tokens[i + 1]);
    }
  }

  for (const item of items) {
    const h = fnv1a(item);
    const idx = (h % dim + dim) % dim;
    const sign = ((h >> 1) & 1) ? -1 : 1;
    vec[idx] += sign;
  }

  // Sublinear weighting: log(1 + |v|)
  for (let i = 0; i < dim; i++) {
    if (vec[i] !== 0) {
      vec[i] = Math.sign(vec[i]) * Math.log1p(Math.abs(vec[i]));
    }
  }

  // L2-normalise
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      vec[i] /= norm;
    }
  }

  return vec;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na2 = 0;
  let nb2 = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na2 += a[i] * a[i];
    nb2 += b[i] * b[i];
  }
  if (na2 === 0 || nb2 === 0) return 0;
  return dot / (Math.sqrt(na2) * Math.sqrt(nb2));
}

export function chunk(text: string, maxChars = 1200): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const result: string[] = [];
  let current = '';

  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (trimmed === '') continue;

    if (current === '') {
      current = trimmed;
    } else if (current.length + 1 + trimmed.length <= maxChars) {
      current += ' ' + trimmed;
    } else {
      result.push(current);
      current = trimmed;
    }
  }

  if (current !== '') {
    result.push(current);
  }

  return result;
}

export class SemanticIndex {
  private entries = new Map<string, {
    title: string;
    chunks: Array<{ embedding: Float32Array; text: string }>;
  }>();

  upsert(rel: string, title: string, content: string): void {
    const chunks = chunk(content);
    if (chunks.length === 0) chunks.push(title);
    // title is mixed into every chunk so title words count for matching
    const vecs = chunks.map(c => embed(title + '\n' + c));
    this.entries.set(rel, { title, chunks: vecs.map((emb, i) => ({ embedding: emb, text: chunks[i] })) });
  }

  remove(rel: string): void {
    this.entries.delete(rel);
  }

  search(q: string, limit = 20, minScore = -1): { rel: string; title: string; snippet: string; score: number }[] {
    const qEmbed = embed(q);
    const results: Array<{ rel: string; title: string; score: number; snippet: string }> = [];

    for (const [rel, { title, chunks }] of this.entries.entries()) {
      let bestScore = -1;
      let bestSnippet = '';

      for (const { embedding, text } of chunks) {
        const s = cosine(qEmbed, embedding);
        if (s > bestScore) {
          bestScore = s;
          let snippet = text.trim().slice(0, 200);
          const ls = snippet.lastIndexOf(' ');
          if (ls > 0 && ls < snippet.length - 1) {
            snippet = snippet.slice(0, ls);
          }
          bestSnippet = snippet;
        }
      }

      if (bestScore > minScore) results.push({ rel, title, score: bestScore, snippet: bestSnippet });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map(r => ({ rel: r.rel, title: r.title, snippet: r.snippet, score: r.score }));
  }

  related(rel: string, limit = 5, minScore = -1): { rel: string; title: string; snippet: string; score: number }[] {
    const entry = this.entries.get(rel);
    if (!entry) return [];

    // Use the content of the note as a query, search then filter out self
    const queryText = entry.chunks.map(c => c.text).join(' ');
    const all = this.search(queryText, limit + 1, minScore);
    const filtered = all.filter(r => r.rel !== rel);
    return filtered.slice(0, limit);
  }

  close(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}