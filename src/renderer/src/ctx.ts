// App-wide actions shared by tree, board, graph and note panel (Grok Bot).
import { createContext, useContext } from 'react';
import type { GraphData, VaultInfo } from '../../shared/types';

export interface AppActions {
  vault: VaultInfo;
  graph: GraphData;
  indexVersion: number;
  ask: (title: string, initial?: string, opts?: { okLabel?: string; placeholder?: string; selectBase?: boolean }) => Promise<string | null>;
  notify: (text: string, err?: boolean) => void;
  openNote: (rel: string, opts?: { edit?: boolean }) => void;
  select: (rel: string | null) => void;
  showInGraph: (rel: string) => void;
  openOnBoard: (rel: string, kind?: 'file' | 'folder') => void;
  newNote: (dir: string) => Promise<string | null>;
  newFolder: (dir: string) => Promise<string | null>;
  renamed: (oldRel: string, newRel: string) => void;
  deleted: (rel: string) => void;
}

export const Ctx = createContext<AppActions | null>(null);
export function useApp(): AppActions {
  const c = useContext(Ctx);
  if (!c) throw new Error('AppActions missing');
  return c;
}

export function errMsg(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
export const baseName = (rel: string) => rel.split('/').pop() ?? rel;
export const noteTitle = (rel: string) => baseName(rel).replace(/\.md$/i, '');

const PALETTE = ['#8b6cf6', '#46a758', '#e0823d', '#3e8ed0', '#d6409f', '#c9a227', '#12a594', '#e5534b', '#6e56cf', '#0090ff'];
/** Stable color per top-level folder (root notes are grey). */
export function folderColor(folder: string, folders: string[]): string {
  if (!folder) return '#8a8a8a';
  const i = folders.indexOf(folder);
  if (i >= 0) return PALETTE[i % PALETTE.length];
  let h = 0;
  for (const c of folder) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
