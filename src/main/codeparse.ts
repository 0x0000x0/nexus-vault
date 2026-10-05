// Import/dependency extraction for code files (JS/TS, Python, Go) + repo detection. Pure; unit-tested. Grok Bot.

export const CODE_EXT = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'cs', 'rb', 'php', 'c', 'h', 'cpp', 'hpp', 'swift', 'vue', 'svelte', 'md', 'css', 'scss', 'html', 'json', 'yml', 'yaml', 'toml', 'sh']);
export const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'vendor', 'target', '__pycache__', 'venv', 'env', 'coverage', 'bower_components', 'Pods', 'DerivedData', 'bin', 'obj', 'release', 'tmp', 'site-packages']);
export const JS_EXT = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte'];

export function extOf(rel: string): string {
  const b = rel.split('/').pop() ?? rel;
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
}

export interface RawImport {
  spec: string;
  line: number;
}

function lineNo(text: string, idx: number): number {
  let n = 0;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Strip comments (keeps string contents and offsets roughly; replaces with spaces). */
function stripComments(text: string, style: 'c' | 'py'): string {
  if (style === 'py') return text.replace(/#[^\n]*/g, (m) => ' '.repeat(m.length));
  return text.replace(/\/\*[\s\S]*?\*\/|(^|[^:\\])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

export function parseImports(rel: string, text: string): RawImport[] {
  const ext = extOf(rel);
  const out: RawImport[] = [];
  if (JS_EXT.includes(ext)) {
    const t = stripComments(text, 'c');
    const res = [/\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"\n]+)['"]/g, /\bexport\s+(?:type\s+)?[\w*{}\s,$]*\s+from\s+['"]([^'"\n]+)['"]/g, /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g, /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g];
    for (const re of res) for (const m of t.matchAll(re)) out.push({ spec: m[1], line: lineNo(text, m.index!) });
  } else if (ext === 'py') {
    const t = stripComments(text, 'py');
    for (const m of t.matchAll(/^[ \t]*from\s+(\.*[\w.]*)\s+import\s+([\w*., \t()]+)/gm)) {
      const base = m[1];
      if (/^\.+$/.test(base)) {
        // from . import a, b  -> each name is a module candidate
        for (const name of m[2].replace(/[()]/g, '').split(',')) {
          const n = name.trim().split(/\s+as\s+/)[0];
          if (n && n !== '*') out.push({ spec: base + n, line: lineNo(text, m.index!) });
        }
      } else out.push({ spec: base, line: lineNo(text, m.index!) });
    }
    for (const m of t.matchAll(/^[ \t]*import\s+([\w., \t]+)/gm)) {
      for (const part of m[1].split(',')) {
        const n = part.trim().split(/\s+as\s+/)[0];
        if (n) out.push({ spec: n, line: lineNo(text, m.index!) });
      }
    }
  } else if (ext === 'go') {
    const t = stripComments(text, 'c');
    for (const m of t.matchAll(/^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm)) out.push({ spec: m[1], line: lineNo(text, m.index!) });
    for (const m of t.matchAll(/^\s*import\s*\(([\s\S]*?)\)/gm)) {
      for (const s of m[1].matchAll(/(?:[\w.]+\s+)?"([^"]+)"/g)) out.push({ spec: s[1], line: lineNo(text, m.index! + s.index!) });
    }
  }
  return out;
}

const norm = (parts: string[]) => {
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
};

/**
 * Resolve an import to a repo file. Returns { file } for internal files, { external } for packages,
 * or null. `files` is the set of indexed rel paths; `goModule` is the go.mod module path.
 */
export function resolveImport(fromRel: string, spec: string, files: Set<string>, goModule: string | null, dirs: Map<string, string[]>): { files?: string[]; external?: string } | null {
  const ext = extOf(fromRel);
  const dir = fromRel.includes('/') ? fromRel.slice(0, fromRel.lastIndexOf('/')) : '';
  if (JS_EXT.includes(ext)) {
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const base = spec.startsWith('/') ? norm(spec.split('/')) : norm([...(dir ? dir.split('/') : []), ...spec.split('/')]);
      const stripped = base.replace(/\.(js|jsx|mjs|cjs)$/, '');
      const cands = [base, ...JS_EXT.map((e) => `${stripped}.${e}`), `${stripped}.d.ts`, ...JS_EXT.map((e) => `${base}/index.${e}`)];
      for (const c of cands) if (files.has(c)) return { files: [c] };
      return null;
    }
    if (spec.startsWith('@/') || spec.startsWith('~/')) {
      const rest = spec.slice(2);
      for (const root of ['src', 'app', '']) {
        const base = root ? `${root}/${rest}` : rest;
        for (const c of [base, ...JS_EXT.map((e) => `${base}.${e}`), ...JS_EXT.map((e) => `${base}/index.${e}`)]) if (files.has(c)) return { files: [c] };
      }
      return null;
    }
    if (spec.startsWith('node:')) return { external: spec };
    const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    return { external: pkg };
  }
  if (ext === 'py') {
    const lead = /^\.+/.exec(spec)?.[0].length ?? 0;
    const mod = spec.slice(lead).split('.').filter(Boolean);
    const roots: string[] = [];
    if (lead) {
      const d = dir ? dir.split('/') : [];
      roots.push(d.slice(0, d.length - (lead - 1)).join('/'));
    } else roots.push('', 'src', dir);
    for (const r of roots) {
      for (let n = mod.length; n >= 1; n--) {
        const p = [r, ...mod.slice(0, n)].filter(Boolean).join('/');
        if (files.has(`${p}.py`)) return { files: [`${p}.py`] };
        if (files.has(`${p}/__init__.py`)) return { files: [`${p}/__init__.py`] };
      }
      if (lead && !mod.length && files.has(`${r ? r + '/' : ''}__init__.py`)) return { files: [`${r ? r + '/' : ''}__init__.py`] };
    }
    return lead ? null : { external: mod[0] };
  }
  if (ext === 'go') {
    if (goModule && (spec === goModule || spec.startsWith(goModule + '/'))) {
      const d = spec.slice(goModule.length).replace(/^\//, '');
      const list = (dirs.get(d) ?? []).filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
      return list.length ? { files: list.slice(0, 6) } : null;
    }
    return { external: spec.split('/').slice(0, spec.includes('.') ? 3 : 1).join('/') };
  }
  return null;
}

/** Decide from the top-level entries whether a folder is a code repo (not an Obsidian vault). */
export function looksLikeRepo(topNames: string[], counts: { code: number; md: number }): boolean {
  const s = new Set(topNames);
  if (s.has('.obsidian')) return false;
  const strong = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'setup.py', 'requirements.txt', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile', 'tsconfig.json'].some((n) => s.has(n));
  if (strong) return true;
  if (s.has('.git') || s.has('src')) return counts.code > counts.md;
  return false;
}
