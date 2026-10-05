// Shared memory-packs types and pure helpers (main + renderer). Grok Bot.
export type MemoryPolicy = 'always' | 'when-relevant' | 'never';

export type MemoryPacks = {
  version: 1;
  folders: Record<string, MemoryPolicy>;
};

const VALID: ReadonlySet<string> = new Set(['always', 'when-relevant', 'never']);

export function emptyPacks(): MemoryPacks {
  return { version: 1, folders: {} };
}

export function normalizePacks(raw: unknown): MemoryPacks {
  if (!raw || typeof raw !== 'object') return emptyPacks();
  const obj = raw as Record<string, unknown>;
  const source =
    obj.folders && typeof obj.folders === 'object' && !Array.isArray(obj.folders)
      ? (obj.folders as Record<string, unknown>)
      : obj;
  const folders: Record<string, MemoryPolicy> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key.includes('..')) continue;
    if (key === 'version' && source === obj) continue; // skip when raw was flat-mixed
    if (typeof value !== 'string' || !VALID.has(value)) continue;
    folders[key] = value as MemoryPolicy;
  }
  return { version: 1, folders };
}

/** Policy for a note or folder path. Notes start at their parent folder. */
export function policyFor(rel: string, packs: MemoryPacks): MemoryPolicy {
  const norm = (rel || '').replace(/\\/g, '/');
  const parts = norm.split('/').filter((p) => p.length > 0);
  const last = parts[parts.length - 1] ?? '';
  const looksLikeFile = last.includes('.');
  let cur = looksLikeFile
    ? parts.slice(0, -1).join('/')
    : parts.join('/');
  for (;;) {
    if (Object.prototype.hasOwnProperty.call(packs.folders, cur)) return packs.folders[cur]!;
    if (cur === '') return 'when-relevant';
    cur = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/')) : '';
  }
}

export function explicitPolicy(folder: string, packs: MemoryPacks): MemoryPolicy | undefined {
  return Object.prototype.hasOwnProperty.call(packs.folders, folder) ? packs.folders[folder] : undefined;
}

/** Immutable. null removes; 'when-relevant' also removes (default everywhere). */
export function setPolicy(packs: MemoryPacks, folder: string, p: MemoryPolicy | null): MemoryPacks {
  const folders: Record<string, MemoryPolicy> = { ...packs.folders };
  if (p === null || p === 'when-relevant') delete folders[folder];
  else folders[folder] = p;
  return { version: 1, folders };
}

/** Drop 'never' hits; stable-sort 'always' hits first. */
export function applyPolicy<T extends { rel: string; score?: number }>(hits: T[], packs: MemoryPacks): T[] {
  const kept: { hit: T; idx: number; always: boolean }[] = [];
  for (let i = 0; i < hits.length; i++) {
    const p = policyFor(hits[i].rel, packs);
    if (p === 'never') continue;
    kept.push({ hit: hits[i], idx: i, always: p === 'always' });
  }
  kept.sort((a, b) => {
    if (a.always !== b.always) return a.always ? -1 : 1;
    return a.idx - b.idx;
  });
  return kept.map((k) => k.hit);
}

export function alwaysFolders(packs: MemoryPacks): string[] {
  return Object.entries(packs.folders)
    .filter(([, p]) => p === 'always')
    .map(([f]) => f);
}
