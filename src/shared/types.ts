// Shared types and IPC channel names (written by Grok Bot, replacing OpenCode WIP).
export type ThemePref = 'light' | 'dark' | 'system';
export type ViewMode = 'graph' | 'split' | 'board';
export type PaneOrder = 'board-graph' | 'graph-board';

export interface LayoutSettings {
  treeWidth: number;
  toolStripExpanded: boolean;
  paneRatio: number; // fraction of main area given to the LEFT pane
  paneOrder: PaneOrder;
  view: ViewMode;
}

export interface RecentVault {
  name: string;
  path: string;
  isCopy: boolean;
  lastOpened: number;
}

export interface RecentVaultView extends RecentVault {
  exists: boolean;
}

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

export interface Settings {
  theme: ThemePref;
  recentVaults: RecentVault[];
  lastVaultPath?: string;
  windowBounds?: WindowBounds;
  layout: LayoutSettings;
}

export interface VaultInfo {
  name: string;
  path: string;
  isCopy: boolean;
}

export interface DirEntry {
  name: string;
  relPath: string; // always forward slashes
  kind: 'folder' | 'file';
  ext: string; // lower-case, without dot; '' for folders
  isFolderNote?: boolean;
  childCount?: number;
}

export interface NoteCount {
  vaultPath: string;
  count: number;
  done: boolean;
}

export const DEFAULT_LAYOUT: LayoutSettings = {
  treeWidth: 240,
  toolStripExpanded: true,
  paneRatio: 0.5,
  paneOrder: 'board-graph',
  view: 'split',
};

export const LIMITS = {
  treeMin: 180,
  treeMax: 480,
  toolCollapsed: 44,
  toolExpanded: 72,
  paneMin: 280,
} as const;

export const IPC = {
  getSettings: 'settings:get',
  setTheme: 'settings:set-theme',
  setLayout: 'settings:set-layout',
  getRecent: 'vault:get-recent',
  removeRecent: 'vault:remove-recent',
  pickFolder: 'vault:pick-folder',
  confirmReal: 'vault:confirm-real',
  openVault: 'vault:open',
  safeCopy: 'vault:safe-copy',
  closeVault: 'vault:close',
  getCurrent: 'vault:get-current',
  listDir: 'fs:list-dir',
  // main -> renderer events
  evNoteCount: 'ev:note-count',
  evSystemTheme: 'ev:system-theme',
  evVaultChanged: 'ev:vault-changed',
} as const;
