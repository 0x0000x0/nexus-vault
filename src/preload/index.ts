import { contextBridge, ipcRenderer } from 'electron';
import type { Settings, VaultInfo, DirEntry, SafeCopyResult, NoteCountProgress, LayoutSettings } from '../shared/index.js';

const api = {
  ipc: {
    invoke: <T extends keyof typeof import('../shared/ipc.js').Channels>(
      channel: T,
      payload: typeof import('../shared/ipc.js').Channels[T]['payload']
    ): Promise<typeof import('../shared/ipc.js').Channels[T] extends { return: infer R } ? R : void> => {
      return ipcRenderer.invoke(channel, payload);
    },
    on: (channel: string, callback: (...args: unknown[]) => void) => {
      ipcRenderer.on(channel, (_e, ...args) => callback(...args));
      return () => ipcRenderer.removeListener(channel, callback);
    },
  },
  vault: {
    open: (path: string, type: 'copy' | 'real') => api.ipc.invoke('renderer:open-vault', { path, type }),
    close: () => api.ipc.invoke('renderer:close-vault'),
    getRecent: () => api.ipc.invoke('renderer:get-recent-vaults'),
    removeRecent: (path: string) => api.ipc.invoke('renderer:remove-recent-vault', path),
    safeCopy: (sourcePath: string) => api.ipc.invoke('renderer:safe-copy-vault', { sourcePath }),
    onOpened: (callback: (vault: VaultInfo) => void) => api.ipc.on('vault-opened', callback),
    onClosed: (callback: () => void) => api.ipc.on('vault-closed', callback),
  },
  fs: {
    listDir: (vaultRoot: string, relPath: string) => api.ipc.invoke('renderer:list-dir', { vaultRoot, relPath }),
    readFile: (vaultRoot: string, relPath: string) => api.ipc.invoke('renderer:read-file', { vaultRoot, relPath }),
  },
  settings: {
    get: () => api.ipc.invoke('renderer:get-settings'),
    save: (settings: Partial<Settings>) => api.ipc.invoke('renderer:save-settings', settings),
  },
  theme: {
    onChange: (callback: (theme: 'light' | 'dark') => void) => api.ipc.on('main:theme-changed', callback),
  },
  noteCount: {
    onProgress: (callback: (progress: NoteCountProgress) => void) => api.ipc.on('main:note-count-progress', callback),
  },
};

contextBridge.exposeInMainWorld('nexus', api);

export type NexusAPI = typeof api;