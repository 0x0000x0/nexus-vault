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
  notePanelOpen: boolean;
  notePanelWidth: number;
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
  notePanelOpen: true,
  notePanelWidth: 380,
};

export const LIMITS = {
  treeMin: 180,
  treeMax: 480,
  toolCollapsed: 44,
  toolExpanded: 72,
  paneMin: 280,
  noteMin: 280,
  noteMax: 900,
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
  readNote: 'note:read',
  writeNote: 'note:write',
  createNote: 'fs:create-note',
  createFolder: 'fs:create-folder',
  renamePath: 'fs:rename',
  deletePath: 'fs:delete',
  duplicatePath: 'fs:duplicate',
  revealPath: 'fs:reveal',
  copyPath: 'fs:copy-path',
  getGraph: 'index:graph',
  search: 'index:search',
  getNoteInfo: 'index:note-info',
  listNotes: 'index:list-notes',
  readBoard: 'board:read',
  writeBoard: 'board:write',
  pickImage: 'board:pick-image',
  readImage: 'board:read-image',
  openExternal: 'board:open-external',
  addConnection: 'link:add',
  removeConnection: 'link:remove',
  // main -> renderer events
  evNoteCount: 'ev:note-count',
  evSystemTheme: 'ev:system-theme',
  evVaultChanged: 'ev:vault-changed',
  evIndexChanged: 'ev:index-changed',
  evFsChanged: 'ev:fs-changed',
} as const;

// ---------- M1: index / graph / notes ----------
export interface GraphNode {
  id: string; // vault-relative path of the note, or "ghost:<name>" for unresolved links
  title: string;
  folder: string; // top-level folder ('' = root)
  ghost?: boolean;
  degree: number;
  tags: string[];
}
export interface GraphLink {
  source: string;
  target: string;
}
export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  version: number;
}
export interface SearchHit {
  rel: string;
  title: string;
  folder: string;
  snippet: string;
  score: number;
}
export interface LinkRef {
  rel: string; // the other note
  title: string;
  context: string; // line containing the link
}
export interface NoteInfo {
  rel: string;
  title: string;
  exists: boolean;
  backlinks: LinkRef[];
  outgoing: { target: string; title: string; resolved: boolean }[];
  tags: string[];
  headings: { level: number; text: string }[];
}
export interface NoteFile {
  rel: string;
  content: string;
  mtimeMs: number;
}
export interface IndexStats {
  notes: number;
  links: number;
  version: number;
}
export interface FsChange {
  dirs: string[]; // parent dirs (vault-relative) that changed
  files: string[];
}

// ---------- M2: board ----------
export type BoardNodeType = 'note' | 'folder' | 'text' | 'group' | 'image' | 'link';
export interface BoardNode {
  id: string;
  type: BoardNodeType;
  x: number;
  y: number;
  w: number;
  h: number;
  file?: string; // note/folder/image: vault-relative path
  text?: string; // text card body, group label
  url?: string; // link card
  color?: string;
}
export interface BoardEdge {
  id: string;
  from: string; // node id
  to: string;
  label?: string;
  link?: boolean; // true if this edge mirrors a [[link]] written into the source note
}
export interface BoardData {
  nodes: BoardNode[];
  edges: BoardEdge[];
  hidden: string[]; // auto cards (file paths) the user removed from this board
  view?: { x: number; y: number; k: number };
}
export interface BoardFile {
  version: 1;
  boards: Record<string, BoardData>; // key = folder rel path ('' = vault root)
}
