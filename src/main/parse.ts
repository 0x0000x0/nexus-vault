// Markdown note parser: links, tags, headings (Obsidian rules, simplified). Pure; unit-tested. Grok Bot.

export interface ParsedLink {
  target: string; // link target without #heading / |alias, '' for self links
  display: string; // text shown to the reader
  embed: boolean;
  kind: 'wiki' | 'md';
  line: number; // 0-based line index in the original text
}

export interface ParsedNote {
  links: ParsedLink[];
  tags: string[];
  headings: { level: number; text: string }[];
}

/** Replace a regex match with spaces of the same length (keeps offsets + line numbers stable). */
function blank(s: string, re: RegExp): string {
  return s.replace(re, (m) => m.replace(/[^\n]/g, ' '));
}

/** Blank out regions where links/tags must be ignored: fenced code, inline code, comments, math. */
export function maskIgnored(text: string): string {
  let s = text;
  s = blank(s, /^(```|~~~)[^\n]*\n[\s\S]*?(^\1[^\n]*$|(?![\s\S]))/gm);
  s = blank(s, /<!--[\s\S]*?-->/g);
  s = blank(s, /%%[\s\S]*?%%/g);
  s = blank(s, /\$\$[\s\S]*?\$\$/g);
  s = blank(s, /(`+)[^`\n][\s\S]*?\1/g);
  return s;
}

export function splitFrontmatter(text: string): { fm: string; bodyStart: number } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/.exec(text);
  return m ? { fm: m[1], bodyStart: m[0].length } : { fm: '', bodyStart: 0 };
}

const WIKI = /(!?)\[\[([^\[\]\n]+?)\]\]/g;
const MDLINK = /(!?)\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\)/g;
const TAG = /(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

function lineAt(starts: number[], idx: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= idx) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function parseWikiInner(inner: string): { target: string; display: string } {
  const pipe = inner.indexOf('|');
  const left = pipe >= 0 ? inner.slice(0, pipe) : inner;
  const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : '';
  const hash = left.indexOf('#');
  const target = (hash >= 0 ? left.slice(0, hash) : left).trim();
  const display = alias || (target ? left.replace(/#\^?/g, ' > ').trim() : left.replace(/^#\^?/, '').trim());
  return { target, display: alias || (target ? target.split('/').pop()! : display) };
}

export function parseNote(text: string): ParsedNote {
  const masked = maskIgnored(text);
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  const links: ParsedLink[] = [];
  for (const m of masked.matchAll(WIKI)) {
    const { target, display } = parseWikiInner(m[2]);
    links.push({ target, display, embed: m[1] === '!', kind: 'wiki', line: lineAt(starts, m.index!) });
  }
  for (const m of masked.matchAll(MDLINK)) {
    let url = m[3].startsWith('<') ? m[3].slice(1, -1) : m[3];
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#')) continue; // external / self anchors
    url = url.split('#')[0];
    try {
      url = decodeURIComponent(url);
    } catch {
      /* keep raw */
    }
    if (!url) continue;
    links.push({ target: url, display: m[2], embed: m[1] === '!', kind: 'md', line: lineAt(starts, m.index!) });
  }
  const { fm, bodyStart } = splitFrontmatter(text);
  const tags = new Set<string>();
  const body = masked.slice(bodyStart);
  for (const m of body.matchAll(TAG)) tags.add(m[2].toLowerCase());
  if (fm) {
    const inline = /^tags?:\s*\[?([^\n\]]*)\]?\s*$/im.exec(fm);
    if (inline && inline[1].trim()) inline[1].split(/[,\s]+/).forEach((t) => t && tags.add(t.replace(/^#|["']/g, '').toLowerCase()));
    const list = /^tags?:\s*\n((?:\s*-\s*.+\n?)+)/im.exec(fm);
    if (list) list[1].split('\n').forEach((l) => {
      const t = l.replace(/^\s*-\s*/, '').replace(/^#|["']/g, '').trim();
      if (t) tags.add(t.toLowerCase());
    });
  }
  tags.delete('');
  const headings: { level: number; text: string }[] = [];
  for (const m of body.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t#]*$/gm)) headings.push({ level: m[1].length, text: m[2] });
  return { links, tags: [...tags], headings };
}

export function titleOf(rel: string): string {
  const base = rel.split('/').pop() ?? rel;
  return base.replace(/\.md$/i, '');
}

export function norm(s: string): string {
  return s.normalize('NFC').toLowerCase();
}

/**
 * Resolve a link target to a note path. `byName` maps lower-case basename (no .md) -> rel paths,
 * `byPath` maps lower-case rel path (no .md) -> rel path.
 */
export function resolveTarget(
  target: string,
  sourceRel: string,
  byName: Map<string, string[]>,
  byPath: Map<string, string>,
  kind: 'wiki' | 'md' = 'wiki',
): string | null {
  if (!target) return null;
  let t = target.replace(/\\/g, '/').trim();
  if (/\.[a-z0-9]{1,5}$/i.test(t) && !/\.md$/i.test(t)) return null; // attachment
  t = t.replace(/\.md$/i, '');
  const key = norm(t);
  const srcDir = sourceRel.includes('/') ? sourceRel.slice(0, sourceRel.lastIndexOf('/')) : '';
  // relative path (md links, or ./ ../ wiki links)
  if (kind === 'md' || t.startsWith('./') || t.startsWith('../')) {
    const parts = (srcDir ? srcDir.split('/') : []).concat(t.split('/'));
    const out: string[] = [];
    for (const p of parts) {
      if (p === '..') out.pop();
      else if (p !== '.' && p !== '') out.push(p);
    }
    const hit = byPath.get(norm(out.join('/')));
    if (hit) return hit;
  }
  const exact = byPath.get(key.replace(/^\//, ''));
  if (exact) return exact;
  if (key.includes('/')) {
    const suffix = '/' + key;
    let best: string | null = null;
    for (const [k, v] of byPath) if (k.endsWith(suffix) && (!best || v.length < best.length)) best = v;
    if (best) return best;
    return null;
  }
  const cands = byName.get(key);
  if (!cands || cands.length === 0) return null;
  if (cands.length === 1) return cands[0];
  const same = cands.find((c) => (c.includes('/') ? c.slice(0, c.lastIndexOf('/')) : '') === srcDir);
  if (same) return same;
  return [...cands].sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)[0];
}

// ---------- link writing (## Connections) ----------

/** Escape a string for use inside a RegExp. */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Name to write in a [[link]]: basename if unique, else path without .md. */
export function linkNameFor(targetRel: string, byName: Map<string, string[]>): string {
  const t = titleOf(targetRel);
  const c = byName.get(norm(t));
  return c && c.length > 1 ? targetRel.replace(/\.md$/i, '') : t;
}

/** True if text already links (wiki or md) to the given link name / rel path. */
export function hasLinkTo(text: string, sourceRel: string, targetRel: string, byName: Map<string, string[]>, byPath: Map<string, string>): boolean {
  return parseNote(text).links.some((l) => resolveTarget(l.target, sourceRel, byName, byPath, l.kind) === targetRel);
}

/** Append `- [[name]]` (or `- label:: [[name]]`) under the first `## Connections` heading, creating it at the end if needed. */
export function addConnectionText(text: string, name: string, label?: string): string {
  const item = label ? `- ${label}:: [[${name}]]` : `- [[${name}]]`;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const h = lines.findIndex((l) => /^#{1,6}\s+connections\s*$/i.test(l.trim()));
  if (h < 0) {
    let base = text.replace(/\s+$/, '');
    base = base ? base + eol + eol : '';
    return `${base}## Connections${eol}${eol}${item}${eol}`;
  }
  const level = (/^(#+)/.exec(lines[h].trim()) ?? ['', '##'])[1].length;
  let end = lines.length;
  for (let i = h + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s/.exec(lines[i]);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  let insertAt = end;
  while (insertAt > h + 1 && lines[insertAt - 1].trim() === '') insertAt--;
  if (insertAt === h + 1) {
    lines.splice(insertAt, 0, '', item);
  } else lines.splice(insertAt, 0, item);
  let out = lines.join(eol);
  if (!out.endsWith(eol)) out += eol;
  return out;
}

/** Remove links to the target but keep their visible text: `[[Roadmap]]` -> `Roadmap`. */
export function removeLinkText(text: string, sourceRel: string, targetRel: string, byName: Map<string, string[]>, byPath: Map<string, string>): string {
  const masked = maskIgnored(text);
  const edits: { start: number; end: number; repl: string }[] = [];
  for (const m of masked.matchAll(WIKI)) {
    const { target, display } = parseWikiInner(m[2]);
    if (m[1] === '!') continue;
    if (resolveTarget(target, sourceRel, byName, byPath, 'wiki') === targetRel) edits.push({ start: m.index!, end: m.index! + m[0].length, repl: display });
  }
  for (const m of masked.matchAll(MDLINK)) {
    if (m[1] === '!') continue;
    let url = m[3].startsWith('<') ? m[3].slice(1, -1) : m[3];
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) continue;
    try {
      url = decodeURIComponent(url.split('#')[0]);
    } catch {
      /* raw */
    }
    if (resolveTarget(url, sourceRel, byName, byPath, 'md') === targetRel) edits.push({ start: m.index!, end: m.index! + m[0].length, repl: m[2] });
  }
  if (!edits.length) return text;
  let out = text;
  edits.sort((x, y) => y.start - x.start);
  for (const e of edits) out = out.slice(0, e.start) + e.repl + out.slice(e.end);
  return out;
}

export { esc as escapeRegExp };
