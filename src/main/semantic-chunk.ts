// Pure chunking for vector semantic search (testable without Ollama). Grok Bot.
export const CHUNK_MAX_CHARS = 4000;
export const CHUNK_OVERLAP = 300;
export const MAX_CHUNKS_PER_NOTE = 80;
export const SNIPPET_MAX_CHARS = 500;

export interface TextChunk {
  text: string; // full text for embedding (not persisted)
  snippet: string; // ≤ SNIPPET_MAX_CHARS for disk / UI
  startLine: number; // 1-based
}

function snippetOf(text: string, max = SNIPPET_MAX_CHARS): string {
  const t = text.trim();
  if (t.length <= max) return t;
  let s = t.slice(0, max);
  const ls = s.lastIndexOf(' ');
  if (ls > max * 0.6) s = s.slice(0, ls);
  return s;
}

/** 1-based line number of `needle` start inside `content` (exact indexOf). */
export function startLineOf(content: string, needle: string, fromIndex = 0): number {
  const idx = content.indexOf(needle, fromIndex);
  if (idx < 0) {
    // fallback: first non-empty line of needle
    const first = needle.trim().split('\n')[0]?.trim() ?? '';
    if (!first) return 1;
    const i2 = content.indexOf(first, fromIndex);
    if (i2 < 0) return 1;
    return content.slice(0, i2).split('\n').length;
  }
  return content.slice(0, idx).split('\n').length;
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+\S/.test(line.trim());
}

/**
 * Paragraph aggregation with heading-aware splits, overlap, and per-note cap.
 * Returns chunks with full text (for embed) + capped snippet + startLine.
 */
export function chunkNote(
  content: string,
  opts?: { maxChars?: number; overlap?: number; maxChunks?: number },
): TextChunk[] {
  const maxChars = opts?.maxChars ?? CHUNK_MAX_CHARS;
  const overlap = opts?.overlap ?? CHUNK_OVERLAP;
  const maxChunks = opts?.maxChunks ?? MAX_CHUNKS_PER_NOTE;

  const raw = content.replace(/\r\n/g, '\n');
  if (!raw.trim()) return [];

  // Split into blocks on blank lines; keep heading boundaries as hard splits when packing.
  const paragraphs = raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const blocks: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= maxChars) {
      blocks.push(p);
      continue;
    }
    // Huge paragraph: split on heading lines or hard-wrap by lines
    const lines = p.split('\n');
    let cur = '';
    for (const line of lines) {
      if (isHeading(line) && cur.length > maxChars * 0.4) {
        blocks.push(cur.trim());
        cur = line;
      } else if (cur.length + 1 + line.length > maxChars && cur) {
        blocks.push(cur.trim());
        cur = line;
      } else {
        cur = cur ? cur + '\n' + line : line;
      }
    }
    if (cur.trim()) blocks.push(cur.trim());
  }

  const packed: string[] = [];
  let current = '';
  for (const b of blocks) {
    if (!current) {
      current = b;
      continue;
    }
    if (isHeading(b) && current.length > maxChars * 0.5) {
      packed.push(current);
      current = b;
    } else if (current.length + 2 + b.length <= maxChars) {
      current += '\n\n' + b;
    } else {
      packed.push(current);
      // overlap: take tail of previous
      if (overlap > 0 && current.length > overlap) {
        const tail = current.slice(-overlap);
        const cut = tail.indexOf(' ');
        const ov = cut > 0 ? tail.slice(cut + 1) : tail;
        current = ov + '\n\n' + b;
        if (current.length > maxChars) current = b;
      } else {
        current = b;
      }
    }
  }
  if (current) packed.push(current);

  // Cap: always merge pairs (truncate if needed) so length strictly decreases
  let chunks = packed;
  while (chunks.length > maxChunks) {
    const merged: string[] = [];
    for (let i = 0; i < chunks.length; i += 2) {
      if (i + 1 < chunks.length) {
        const join = (chunks[i] + "\n\n" + chunks[i + 1]).slice(0, maxChars * 2);
        merged.push(join);
      } else {
        merged.push(chunks[i]);
      }
    }
    if (merged.length >= chunks.length) {
      chunks = chunks.slice(0, maxChunks);
      break;
    }
    chunks = merged;
  }

  const out: TextChunk[] = [];
  let searchFrom = 0;
  for (const text of chunks) {
    const startLine = startLineOf(raw, text.slice(0, Math.min(80, text.length)), Math.max(0, searchFrom - 50));
    searchFrom = raw.indexOf(text.slice(0, 40), searchFrom);
    if (searchFrom < 0) searchFrom = 0;
    else searchFrom += 1;
    out.push({ text, snippet: snippetOf(text), startLine });
  }
  return out;
}
