export interface VaultInfo {
  name: string;
  path: string;
  type: 'copy' | 'real';
  lastOpened: number;
  exists: boolean;
}

export interface LayoutSettings {
  treeWidth: number;
  toolStripExpanded: boolean;
  paneRatio: number;
  paneOrder: 'board-graph' | 'graph-board';
  view: 'graph' | 'split' | 'board';
}

export interface Settings {
  theme: 'light' | 'dark' | 'system';
  recentVaults: VaultInfo[];
  lastVaultPath?: string;
  windowBounds?: Electron.Rectangle;
  layout: LayoutSettings;
}

export interface DirEntry {
  name: string;
  relPath: string;
  type: 'folder' | 'file';
  isFolderNote?: boolean;
  childCount?: number;
  extension?: string;
}

export interface SafeCopyResult {
  destPath: string;
  skipped: string[];
}

export interface ListDirResult {
  entries: DirEntry[];
}

export interface NoteCountProgress {
  vaultRoot: string;
  count: number;
  done: boolean;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized?: boolean;
}