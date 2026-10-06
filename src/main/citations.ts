// F: citations — merge keyword + semantic hits into citable sources (path, title, snippet, startLine), honouring memory packs. Pure. Grok Bot.
import { applyPolicy, type MemoryPacks } from '../shared/memory-packs';

export interface Citation {
  path: string;
  title: string;
  folder: string;
  snippet: string;
  score: number;
  startLine?: number;
  source: 'keyword' | 'semantic';
}

interface HitLike {
  rel: string;
  title: string;
  folder?: string;
  snippet: string;
  score: number;
  /** Optional 1-based line from vector chunk metadata (preferred over snippet re-search). */
  startLine?: number;
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 1-based line where `snippet` starts inside `content` (whitespace-insensitive); undefined if not found. */
export function lineOf(content: string, snippet: string): number | undefined {
  const words = snippet.replace(/^…/, '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length || !content) return undefined;
  // try progressively shorter prefixes (first/last word may be cut mid-word)
  for (let n = words.length; n >= 1; n--) {
    const parts = words.slice(0, n).map(escRe);
    const m = new RegExp(parts.join('\\s+')).exec(content);
    if (m) return content.slice(0, m.index).split('\n').length;
    if (n > 1) {
      const m2 = new RegExp(words.slice(1, n).map(escRe).join('\\s+')).exec(content);
      if (m2) return content.slice(0, m2.index).split('\n').length;
    }
  }
  return undefined;
}

function folderOf(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

/** Keyword hits first, then semantic hits not already present; 'never' folders dropped, 'always' folders first. */
export function mergeCitations(
  keyword: HitLike[],
  semantic: HitLike[],
  packs: MemoryPacks,
  limit: number,
  contentOf?: (rel: string) => string | undefined,
): Citation[] {
  const seen = new Set<string>();
  const all: (Citation & { rel: string })[] = [];
  const add = (h: HitLike, source: Citation['source']) => {
    if (seen.has(h.rel)) return;
    seen.add(h.rel);
    all.push({
      rel: h.rel,
      path: h.rel,
      title: h.title,
      folder: h.folder ?? folderOf(h.rel),
      snippet: h.snippet,
      score: h.score,
      source,
      ...(typeof h.startLine === 'number' && h.startLine > 0 ? { startLine: h.startLine } : {}),
    });
  };
  keyword.forEach((h) => add(h, 'keyword'));
  semantic.forEach((h) => add(h, 'semantic'));
  return applyPolicy(all, packs)
    .slice(0, Math.max(1, limit))
    .map(({ rel, ...c }) => {
      if (typeof c.startLine === 'number' && c.startLine > 0) return c;
      const content = contentOf?.(rel);
      const line = content !== undefined && c.snippet ? lineOf(content, c.snippet) : undefined;
      return line !== undefined ? { ...c, startLine: line } : c;
    });
}

/** Markdown citation for an AI answer. */
export function citeText(c: Pick<Citation, 'path' | 'title' | 'startLine'>): string {
  return `[${c.title}](${encodeURI(c.path)}${c.startLine ? `#L${c.startLine}` : ''})`;
}
