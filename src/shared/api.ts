// Type of the window.nexus bridge (implemented in src/preload/index.ts). Grok Bot.
import type { DirEntry, LayoutSettings, NoteCount, RecentVaultView, Settings, ThemePref, VaultInfo } from './types';

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
  onNoteCount(cb: (n: NoteCount) => void): () => void;
  onSystemTheme(cb: (t: 'light' | 'dark') => void): () => void;
  platform: string;
}
