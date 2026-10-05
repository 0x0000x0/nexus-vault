// Minimal typed bridge exposed as window.nexus. Grok Bot.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type DirEntry, type LayoutSettings, type NoteCount, type RecentVaultView, type Settings, type ThemePref, type VaultInfo } from '../shared/types';
import type { NexusApi } from '../shared/api';

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const h = (_e: IpcRendererEvent, v: T) => cb(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

const api: NexusApi = {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.getSettings),
  setTheme: (t: ThemePref): Promise<ThemePref> => ipcRenderer.invoke(IPC.setTheme, t),
  setLayout: (l: Partial<LayoutSettings>): Promise<LayoutSettings> => ipcRenderer.invoke(IPC.setLayout, l),
  getRecent: (): Promise<RecentVaultView[]> => ipcRenderer.invoke(IPC.getRecent),
  removeRecent: (p: string): Promise<void> => ipcRenderer.invoke(IPC.removeRecent, p),
  pickFolder: (title: string): Promise<string | null> => ipcRenderer.invoke(IPC.pickFolder, title),
  confirmReal: (p: string): Promise<'real' | 'copy' | 'cancel'> => ipcRenderer.invoke(IPC.confirmReal, p),
  openVault: (p: string): Promise<VaultInfo> => ipcRenderer.invoke(IPC.openVault, p),
  safeCopy: (src: string): Promise<VaultInfo> => ipcRenderer.invoke(IPC.safeCopy, src),
  closeVault: (): Promise<void> => ipcRenderer.invoke(IPC.closeVault),
  getCurrent: (): Promise<VaultInfo | null> => ipcRenderer.invoke(IPC.getCurrent),
  listDir: (root: string, rel: string): Promise<DirEntry[]> => ipcRenderer.invoke(IPC.listDir, root, rel),
  onNoteCount: (cb: (n: NoteCount) => void) => on<NoteCount>(IPC.evNoteCount, cb),
  onSystemTheme: (cb: (t: 'light' | 'dark') => void) => on<'light' | 'dark'>(IPC.evSystemTheme, cb),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('nexus', api);
