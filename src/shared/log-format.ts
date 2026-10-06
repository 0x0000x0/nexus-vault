// Pure log formatting / redaction (no Electron). Grok Bot — Nexus Vault 0.0.5.
export type LogLevel = 'INFO' | 'WARN' | 'ERROR';
export type LogSource = 'main' | 'renderer';
export interface LogEntry {
  ts: string;
  level: LogLevel;
  source: LogSource;
  tag: string;
  message: string;
  stack?: string;
}

export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… (${s.length - max} more chars)`;
}

export function errInfo(e: unknown): { message: string; stack?: string } {
  if (e instanceof Error) return { message: e.message || String(e), stack: e.stack };
  if (e && typeof e === 'object' && 'message' in e) {
    const m = String((e as { message: unknown }).message);
    const st = (e as { stack?: unknown }).stack;
    return { message: m, stack: typeof st === 'string' ? st : undefined };
  }
  return { message: String(e) };
}

/** 4-char base36 from a simple hash of the seed (stable). */
export function shortCode(seed: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0).toString(36).padStart(4, '0').slice(-4);
}

let stamp = 0;
export function errorStamp(): string {
  stamp = (stamp + 1) % 36 ** 4;
  return shortCode(`e${Date.now()}-${stamp}`);
}

export function redact(text: string, secrets?: { token?: string; home?: string }): string {
  let t = text;
  if (secrets?.token && secrets.token.length >= 4) {
    t = t.split(secrets.token).join('[redacted]');
  }
  t = t.replace(/(\bbearer\s+)[A-Za-z0-9\-._~+/]{8,}=*/gi, '$1[redacted]');
  t = t.replace(/(authorization"?\s*[:=]\s*"?)[^"\n,;}]+/gi, '$1[redacted]');
  t = t.replace(/(("?)(?:mcp\.token|token|api[_-]?key|secret|password)\2"?\s*[:=]\s*"?)[^"\s,;}]+/gi, '$1[redacted]');
  if (secrets?.home && secrets.home.length >= 2) {
    // Split on either separator, escape segments, rejoin with [/\\] so Windows + POSIX match.
    const raw = secrets.home.replace(/[/\\]+$/, '');
    const parts = raw.split(/[/\\]/).filter(Boolean);
    const body = parts.map((seg) => seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[/\\\\]');
    // Absolute POSIX homes keep a leading separator so we don't leave a stray '/'.
    const esc = raw.startsWith('/') ? `[/\\\\]${body}` : body;
    if (esc) t = t.replace(new RegExp(esc, 'gi'), '~');
  }
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
  return t;
}

export function formatLine(e: LogEntry): string {
  const level = e.level.padEnd(5);
  const source = e.source.padEnd(8);
  const lines = e.message.replace(/\r\n/g, '\n').split('\n');
  const first = lines[0] ?? '';
  const rest = lines.slice(1);
  let out = `${e.ts} ${level} ${source} ${e.tag} ${first}\n`;
  for (const l of rest) out += `    ${l}\n`;
  if (e.stack) {
    for (const l of e.stack.replace(/\r\n/g, '\n').split('\n')) {
      const s = l.trim();
      if (s.length) out += `    ${s}\n`;
    }
  }
  return out;
}
