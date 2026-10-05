// Minimal typed bridge exposed as window.nexus. Grok Bot.
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC, type FsChange, type IndexStats, type NoteCount, type ProgressInfo } from '../shared/types';
import type { NexusApi } from '../shared/api';

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const h = (_e: IpcRendererEvent, v: T) => cb(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

const inv =
  (ch: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(ch, ...args);

const api: NexusApi = {
  getSettings: inv(IPC.getSettings),
  setTheme: inv(IPC.setTheme),
  setLayout: inv(IPC.setLayout),
  getRecent: inv(IPC.getRecent),
  removeRecent: inv(IPC.removeRecent),
  pickFolder: inv(IPC.pickFolder),
  confirmReal: inv(IPC.confirmReal),
  openVault: inv(IPC.openVault),
  safeCopy: inv(IPC.safeCopy),
  closeVault: inv(IPC.closeVault),
  getCurrent: inv(IPC.getCurrent),
  listDir: inv(IPC.listDir),
  readNote: inv(IPC.readNote),
  writeNote: inv(IPC.writeNote),
  createNote: inv(IPC.createNote),
  createFolder: inv(IPC.createFolder),
  renamePath: inv(IPC.renamePath),
  deletePath: inv(IPC.deletePath),
  duplicatePath: inv(IPC.duplicatePath),
  revealPath: inv(IPC.revealPath),
  copyPath: inv(IPC.copyPath),
  getGraph: inv(IPC.getGraph),
  search: inv(IPC.search),
  getNoteInfo: inv(IPC.getNoteInfo),
  listNotes: inv(IPC.listNotes),
  previews: inv(IPC.previews),
  fileLinks: inv('index:links'),
  readBoard: inv(IPC.readBoard),
  writeBoard: inv(IPC.writeBoard),
  pickImage: inv(IPC.pickImage),
  readImage: inv(IPC.readImage),
  openExternal: inv(IPC.openExternal),
  openCode: inv(IPC.openCode),
  pickRepo: inv('vault:pick-repo'),
  pathForFile: (f: File) => webUtils.getPathForFile(f),
  onProgress: (cb) => on<ProgressInfo>(IPC.evProgress, cb),
  addConnection: inv(IPC.addConnection),
  removeConnection: inv(IPC.removeConnection),
  onNoteCount: (cb) => on<NoteCount>(IPC.evNoteCount, cb),
  onSystemTheme: (cb) => on<'light' | 'dark'>(IPC.evSystemTheme, cb),
  onIndexChanged: (cb) => on<IndexStats>(IPC.evIndexChanged, cb),
  onFsChanged: (cb) => on<FsChange>(IPC.evFsChanged, cb),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('nexus', api);
