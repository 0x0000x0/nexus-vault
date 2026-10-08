// Type of the window.nexus bridge (implemented in src/preload/index.ts). Grok Bot.
import type { ArchModel } from './arch';
import type { BoardFile, DirEntry, FsChange, ProgressInfo, GraphData, GraphOpts, IndexStats, LayoutSettings, NoteCount, NoteFile, NoteInfo, RecentVaultView, SearchHit, Settings, ThemePref, VaultInfo, MemoryPacks, MemoryPolicy, SnapshotInfo } from './types';

export interface NexusApi {
  getSettings(): Promise<Settings>;
  setTheme(t: ThemePref): Promise<ThemePref>;
  setLayout(l: Partial<LayoutSettings>): Promise<LayoutSettings>;
  getRecent(): Promise<RecentVaultView[]>;
  removeRecent(p: string): Promise<void>;
  pickFolder(title: string): Promise<string | null>;
  confirmReal(p: string): Promise<'real' | 'copy' | 'cancel'>;
  openVault(p: string): Promise<VaultInfo>;
  safeCopy(src: string): Promise<VaultInfo>;
  closeVault(): Promise<void>;
  getCurrent(): Promise<VaultInfo | null>;
  listDir(root: string, rel: string): Promise<DirEntry[]>;
  // notes + file ops (all paths vault-relative, forward slashes)
  readNote(rel: string): Promise<NoteFile>;
  writeNote(rel: string, content: string, expectedMtime?: number): Promise<NoteFile>;
  createNote(dir: string, name: string | null, content?: string): Promise<string>;
  createFolder(dir: string, name: string | null): Promise<string>;
  renamePath(rel: string, newName: string): Promise<string>;
  deletePath(rel: string): Promise<string | null>;
  duplicatePath(rel: string): Promise<string>;
  revealPath(rel: string): Promise<void>;
  copyPath(rel: string): Promise<string>;
  // index
  getGraph(opts?: GraphOpts): Promise<GraphData>;
  search(q: string): Promise<SearchHit[]>;
  getNoteInfo(rel: string): Promise<NoteInfo | null>;
  /** Resolved links; pass `among` to get only links between those files (cheap for Board cards). */
  fileLinks(among?: string[]): Promise<[string, string][]>;
  previews(rels: string[]): Promise<Record<string, { preview: string; tags: string[] }>>;
  listNotes(): Promise<{ notes: { rel: string; title: string }[]; stats: IndexStats | null; ready: boolean }>;
  // MCP methods
  mcpStatus(): Promise<{ enabled: boolean; running: boolean; port: number; readOnly: boolean; token: string; url: string; error?: string }>;
  mcpSet(patch: { enabled?: boolean; readOnly?: boolean; port?: number }): Promise<{ enabled: boolean; running: boolean; port: number; readOnly: boolean; token: string; url: string; error?: string }>;
  mcpRegenToken(): Promise<{ enabled: boolean; running: boolean; port: number; readOnly: boolean; token: string; url: string; error?: string }>;
  // board
  readBoard(): Promise<BoardFile>;
  writeBoard(data: BoardFile): Promise<void>;
  pickImage(): Promise<string | null>;
  readImage(rel: string): Promise<string>;
  openExternal(url: string): Promise<void>;
  /** Open a code repo folder or .zip (extracted into app data) in read-only code architecture mode. */
  openCode(pathOrZip: string): Promise<VaultInfo>;
  pickRepo(kind: 'folder' | 'zip'): Promise<string | null>;
  /** Real filesystem path of a dropped File (Electron webUtils). */
  pathForFile(f: File): string;
  onProgress(cb: (p: ProgressInfo) => void): () => void;
  addConnection(src: string, target: string, label?: string): Promise<boolean>;
  removeConnection(src: string, target: string): Promise<boolean>;
  // events
  onNoteCount(cb: (n: NoteCount) => void): () => void;
  onSystemTheme(cb: (t: 'light' | 'dark') => void): () => void;
  onIndexChanged(cb: (s: IndexStats) => void): () => void;
  onFsChanged(cb: (c: FsChange) => void): () => void;
  platform: string;
  // B: local semantic search (OFF by default)
  semanticStatus(): Promise<import('./types').SemanticStatus>;
  setSemantic(enabled: boolean): Promise<import('./types').SemanticStatus>;
  semanticSearch(q: string): Promise<import('./types').SemanticHit[]>;
  semanticRelated(rel: string): Promise<import('./types').SemanticHit[]>;
  semanticRebuild(): Promise<import('./types').SemanticStatus>;

  memoryGet(): Promise<MemoryPacks>;
  memorySet(folder: string, policy: MemoryPolicy | null): Promise<MemoryPacks>;

  snapList(): Promise<SnapshotInfo[]>;
  snapCreate(label?: string): Promise<SnapshotInfo>;
  snapRestore(id: string): Promise<{ restored: number; trashed: number; preRestoreId: string }>;
  snapDelete(id: string): Promise<void>;

  reportError(e: { level?: 'WARN' | 'ERROR'; tag?: string; message: string; stack?: string }): Promise<{ code: string }>;
  openLogFolder(): Promise<string>;
  copyLastError(): Promise<boolean>;
  logInfo(): Promise<{ file: string; dir: string; size: number }>;
  bootError(): Promise<string | null>;

  /** Architecture model for code mode (null if not ready / not code). */
  archGet(): Promise<ArchModel | null>;
  /** Force re-infer architecture from current CodeIndex. */
  archRebuild(): Promise<ArchModel>;
}
