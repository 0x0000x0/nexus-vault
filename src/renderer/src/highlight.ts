// Tiny, dependency-free syntax highlighter for the read-only code viewer (Grok Bot).
const KW: Record<string, string> = {
  js: 'import export from as default function return const let var if else for while do switch case break continue new class extends super this typeof instanceof in of try catch finally throw async await yield interface type enum implements public private protected readonly static null undefined true false void delete',
  py: 'import from as def return if elif else for while in not and or is class try except finally raise with lambda yield pass break continue global nonlocal None True False async await self',
  go: 'package import func return if else for range switch case default break continue go defer select chan map struct interface type const var nil true false make new',
  rs: 'use mod fn pub let mut const static struct enum impl trait for in if else match loop while return self Self crate super as where dyn move ref true false',
  c: 'int char float double void long short unsigned signed struct union enum typedef const static return if else for while do switch case break continue sizeof include define class public private protected namespace using template new delete true false null nullptr',
};
const FAMILY: Record<string, string> = { ts: 'js', tsx: 'js', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', vue: 'js', svelte: 'js', java: 'c', kt: 'c', cs: 'c', swift: 'c', php: 'js', py: 'py', rb: 'py', go: 'go', rs: 'rs', c: 'c', h: 'c', cpp: 'c', hpp: 'c' };

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

export function highlight(code: string, ext: string): string {
  const fam = FAMILY[ext];
  if (!fam) return esc(code);
  const kws = new Set(KW[fam].split(' '));
  const hashComment = fam === 'py';
  const re = hashComment
    ? /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d[\d_.xXa-fA-F]*\b)|([A-Za-z_$][\w$]*)/g
    : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d[\d_.xXa-fA-F]*\b)|([A-Za-z_$][\w$]*)/g;
  let out = '';
  let last = 0;
  for (const m of code.matchAll(re)) {
    out += esc(code.slice(last, m.index));
    const t = esc(m[0]);
    if (m[1]) out += `<span class="tk-c">${t}</span>`;
    else if (m[2]) out += `<span class="tk-s">${t}</span>`;
    else if (m[3]) out += `<span class="tk-n">${t}</span>`;
    else if (kws.has(m[0])) out += `<span class="tk-k">${t}</span>`;
    else out += t;
    last = m.index! + m[0].length;
  }
  return out + esc(code.slice(last));
}
