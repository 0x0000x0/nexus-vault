// 0.0.9 speed: remember settled graph positions per vault/view so reopening needs no layout. Grok Bot.
const PREFIX = 'nvpos:';
const INDEX = 'nvpos:index';
const MAX_KEYS = 12;

export type PosMap = Map<string, [number, number]>;

export function loadPositions(key: string): PosMap {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return new Map();
    const o = JSON.parse(raw) as { ids: string[]; xy: number[] };
    const m: PosMap = new Map();
    for (let i = 0; i < o.ids.length; i++) m.set(o.ids[i], [o.xy[2 * i], o.xy[2 * i + 1]]);
    return m;
  } catch {
    return new Map();
  }
}

export function savePositions(key: string, nodes: { id?: string | number; x?: number; y?: number }[]): void {
  try {
    const ids: string[] = [];
    const xy: number[] = [];
    for (const n of nodes) {
      if (n.x === undefined || n.y === undefined || !Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
      ids.push(String(n.id));
      xy.push(Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10);
    }
    let idx: string[] = [];
    try {
      idx = JSON.parse(localStorage.getItem(INDEX) ?? '[]') as string[];
    } catch {
      idx = [];
    }
    idx = [key, ...idx.filter((k) => k !== key)];
    for (const old of idx.slice(MAX_KEYS)) localStorage.removeItem(PREFIX + old);
    localStorage.setItem(INDEX, JSON.stringify(idx.slice(0, MAX_KEYS)));
    localStorage.setItem(PREFIX + key, JSON.stringify({ ids, xy }));
  } catch {
    /* quota or disabled storage: cache is best-effort */
  }
}
