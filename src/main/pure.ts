// Pure helpers with no Electron dependency, unit-tested (Grok Bot).
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_LAYOUT, LIMITS, type DirEntry, type Settings } from '../shared/types';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortEntries<T extends Pick<DirEntry, 'name' | 'kind'>>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
}

/** Reject relative paths that are absolute or try to climb out. '' means the vault root. */
export function isRelPathSafe(rel: string): boolean {
  if (rel === '') return true;
  if (typeof rel !== 'string' || rel.includes('\0')) return false;
  if (path.isAbsolute(rel) || path.win32.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return false;
  const parts = rel.split(/[\\/]+/);
  return !parts.some((p) => p === '..');
}

/** True if `child` equals `root` or is inside it (both already resolved/real). */
export function isInside(root: string, child: string, p: typeof path = path): boolean {
  const rel = p.relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function safeCopyBaseName(folderName: string, d: Date): string {
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${folderName} (copy ${stamp})`;
}

/** Pick a non-existing name: base, base 2, base 3 ... */
export function uniqueName(base: string, exists: (name: string) => boolean): string {
  if (!exists(base)) return base;
  for (let i = 2; i < 10000; i++) {
    const n = `${base} ${i}`;
    if (!exists(n)) return n;
  }
  throw new Error('Could not find a free folder name');
}

function clamp(n: unknown, lo: number, hi: number, dflt: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

/** Merge parsed JSON with defaults and validate every field. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const m = r.mcp;
  const l = (r.layout && typeof r.layout === 'object' ? r.layout : {}) as Record<string, any>;
  const theme = r.theme === 'light' || r.theme === 'dark' ? r.theme : 'system';
  const recent = Array.isArray(r.recentVaults)
    ? r.recentVaults
        .filter((v: any) => v && typeof v.path === 'string' && typeof v.name === 'string')
        .map((v: any) => ({ name: v.name, path: v.path, isCopy: !!v.isCopy, lastOpened: Number(v.lastOpened) || 0, mode: (v.mode === 'code' ? 'code' : 'notes') as 'code' | 'notes', ...(typeof v.source === 'string' ? { source: v.source } : {}) }))
        .slice(0, 25)
    : [];
  const wb = r.windowBounds;
  const mcpEnabled = typeof m?.enabled === 'boolean' ? m.enabled : false;
  const mcpPort = ((m?.port as number) || 27124);
  const mcpPortValidated = mcpPort < 1024 || mcpPort > 65535 ? 27124 : mcpPort;
  const mcpToken = m?.token !== undefined && m?.token !== null ? String(m.token) : '';
  const mcpReadOnly = m?.readOnly === false ? false : true;

  return {
    theme,
    recentVaults: recent,
    lastVaultPath: typeof r.lastVaultPath === 'string' ? r.lastVaultPath : undefined,
    windowBounds:
      wb && typeof wb.width === 'number' && typeof wb.height === 'number'
        ? { x: wb.x, y: wb.y, width: Math.max(1000, wb.width), height: Math.max(650, wb.height), maximized: !!wb.maximized }
        : undefined,
    layout: {
      treeWidth: clamp(l.treeWidth, LIMITS.treeMin, LIMITS.treeMax, DEFAULT_LAYOUT.treeWidth),
      toolStripExpanded: typeof l.toolStripExpanded === 'boolean' ? l.toolStripExpanded : DEFAULT_LAYOUT.toolStripExpanded,
      paneRatio: clamp(l.paneRatio, 0.1, 0.9, DEFAULT_LAYOUT.paneRatio),
      paneOrder: l.paneOrder === 'graph-board' ? 'graph-board' : 'board-graph',
      view: l.view === 'graph' || l.view === 'board' ? l.view : 'split',
      notePanelOpen: typeof l.notePanelOpen === 'boolean' ? l.notePanelOpen : DEFAULT_LAYOUT.notePanelOpen,
      notePanelWidth: clamp(l.notePanelWidth, LIMITS.noteMin, LIMITS.noteMax, DEFAULT_LAYOUT.notePanelWidth),
      graphNodeSize: clamp(l.graphNodeSize, 0.3, 3, DEFAULT_LAYOUT.graphNodeSize),
      graphLinkWidth: clamp(l.graphLinkWidth, 0.3, 3, DEFAULT_LAYOUT.graphLinkWidth),
    },
    mcp: {
      enabled: mcpEnabled,
      port: mcpPortValidated,
      token: mcpToken,
      readOnly: mcpReadOnly,
    },
  };
}
