// Electron main process for Nexus Vault M0. Written by Grok Bot (replaces OpenCode WIP).
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, session, shell, type MenuItemConstructorOptions } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { ARCH_BOARD_KEY, IPC, type BoardFile, type LayoutSettings, type RecentVaultView, type SemanticHit, type SemanticStatus, type ThemePref, type VaultInfo } from '../shared/types';
import type { ArchCache, ArchModel } from '../shared/arch';
import { startMcp, stopMcp, mcpStatus, newToken } from './mcp';
import { type McpBackend } from './mcp-core';
import { type MemoryPacks, type MemoryPolicy, applyPolicy, emptyPacks, policyFor, setPolicy } from '../shared/memory-packs';
import { mergeCitations } from './citations';
import * as memoryStore from './memory-store';
import {
  createSnapshot,
  createSnapshotWithOptions,
  listSnapshots,
  listSnapshotsFromDir,
  restoreSnapshot,
  restoreSnapshotWithOptions,
  deleteSnapshot,
  deleteSnapshotFromDir,
} from './snapshots';
import { VaultIndex } from './indexer';
import { CodeIndex } from './codeindex';
import { collectRootEntries, inferArchitecture, type PackageJsonHint } from './archinfer';
import { layoutArch } from '../shared/arch-layout';
import { detectRepo, extractZip } from './repo';
import crypto from 'node:crypto';
import * as ops from './fileops';
import { addConnectionText, hasLinkTo, linkNameFor, removeLinkText } from './parse';
import { resolveInVault } from './vault';
import { flushSettings, getSettings, updateSettings } from './settings';
import { countNotes, listDir, safeCopy } from './vault';
import { isInside } from './pure';
import { SemanticIndex } from './semantic';
import {
  initLogger,
  installWebContentsHooks,
  lastErrorText,
  logDir,
  logError,
  logFilePath,
  logInfo,
  logWarn,
  flushLogger,
  reportRenderer,
  setBootVaultError,
  setSecret,
  takeBootVaultError,
} from './logger';

if (process.env.NEXUS_USER_DATA) app.setPath('userData', process.env.NEXUS_USER_DATA);
initLogger();

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL;
let win: BrowserWindow | null = null;
let current: VaultInfo | null = null;
let countToken = 0;
let index: VaultIndex | CodeIndex | null = null;
let semanticIdx: SemanticIndex | null = null;
let mcpStarted = false;
let archCache: ArchCache | null = null;

const backendFactory = (): McpBackend => {
  const root = current?.path ?? '';
  const packs = () => currentPacks();
  const hidden = (rel: string) => policyFor(rel, packs()) === 'never';
  return {
    // F: citations — keyword + semantic (if enabled) merged, memory packs applied, path/snippet/startLine per hit.
    search: async (q, limit) => {
      const n = Math.min(50, Math.max(1, limit));
      const kw = index?.search(q, n * 2) ?? [];
      const sem =
        semanticIdx && q.trim() ? await semanticIdx.search(q, n * 2, SEM_MIN) : [];
      const vi = index instanceof VaultIndex ? index : null;
      return mergeCitations(kw, sem, packs(), n, (rel) => vi?.noteContent(rel)).map((c) => ({ rel: c.path, ...c }));
    },
    listNotes: () => (index?.listNotes() ?? []).filter((x) => !hidden(x.rel)),
    readNote: async (rel) => {
      if (hidden(rel)) throw new Error('This note is excluded from AI access (memory pack: Never include)');
      return (await ops.readNote(root, rel)).content;
    },
    backlinks: (rel) =>
      (index?.noteInfo(rel)?.backlinks ?? [])
        .filter((b) => !hidden(b.rel))
        .map((b) => ({
          rel: b.rel,
          title: b.title,
          context: b.context || '',
        })),
    appendNote: async (rel, text) => {
      if (!current || current.readOnly) throw new Error('Vault is read-only');
      if (hidden(rel)) throw new Error('This note is excluded from AI access (memory pack: Never include)');
      const nf = await ops.readNote(root, rel);
      await ops.writeNote(root, rel, nf.content + '\n' + text);
    },
    createNote: async (dir, name, content) => {
      if (!current || current.readOnly) throw new Error('Vault is read-only');
      return ops.createNote(root, dir, name, content);
    },
  };
};


async function startIndex(): Promise<void> {
  await index?.close();
  index = null;
  archCache = null;
  dropSemantic();
  if (!current) return;
  const onChange = (stats: import('../shared/types').IndexStats, fsChange: import('../shared/types').FsChange) => {
    if (index !== idx) return;
    win?.webContents.send(IPC.evIndexChanged, stats);
    if (fsChange.dirs.length || fsChange.files.length) win?.webContents.send(IPC.evFsChanged, fsChange);
  };
  const idx: VaultIndex | CodeIndex =
    current.mode === 'code'
      ? new CodeIndex(current.path, onChange, (label, done, total) => {
          if (index === idx) progress(label, done, total);
        })
      : new VaultIndex(current.path, onChange);
  index = idx;
  idx
    .start()
    .then(() => {
      if (index !== idx) return;
      const st = idx.stats();
      logInfo('index', `index-ready notes=${st.notes} links=${st.links} mode=${current?.mode ?? '?'}`);
      if (getSettings().semanticSearch) buildSemantic();
      if (current?.mode === 'code' && idx instanceof CodeIndex) void buildArchModel(false);
    })
    .catch((e) => logError('index', 'index start failed', e));
}

// ---------- B: vector semantic search (Ollama nomic-embed-text + .nexus-vectors; OFF by default) ----------
/** L2-normalized nomic cosine floor (was 0.08 for hashing-trick). Calibrate on sample queries. */
const SEM_MIN = 0.38;
const SEM_MIN_RELATED = 0.32;

function buildSemantic(): void {
  dropSemantic();
  if (!(index instanceof VaultIndex)) {
    logWarn('semantic', 'semantic index skipped (not a notes VaultIndex)');
    return;
  }
  if (!current) return;
  const s = getSettings();
  const idx = new SemanticIndex({
    vaultPath: current.path,
    userData: app.getPath('userData'),
    model: s.embedModel,
    baseUrl: s.embedBaseUrl,
  });
  const loaded = idx.load();
  index.onNote = (rel, n) => (n ? idx.upsert(rel, n.title, n.content) : idx.remove(rel));
  semanticIdx = idx;
  void idx.refreshOllama().then(() => {
    const st = idx.status();
    logInfo('semantic', `semantic load ok=${loaded} notes=${st.indexed} chunks=${st.chunks} ollama=${st.ollama} needsRebuild=${st.needsRebuild}`);
    // If empty index and ollama up, kick a background rebuild
    if ((!loaded || st.indexed === 0 || st.needsRebuild) && st.ollama === 'ok' && index instanceof VaultIndex) {
      const notes = index.allNotes().map((n) => ({ rel: n.rel, title: n.title, content: n.content }));
      void idx
        .rebuild(notes, (done, total) => progress('Semantic index', done, total))
        .then(() => {
          progress('', 0, 0);
          logInfo('semantic', `semantic rebuild done size=${idx.size()}`);
        })
        .catch((e) => {
          progress('', 0, 0);
          logWarn('semantic', `semantic rebuild failed: ${e instanceof Error ? e.message : e}`);
        });
    }
  });
}
function dropSemantic(): void {
  if (index instanceof VaultIndex) index.onNote = null;
  semanticIdx?.close();
  semanticIdx = null;
}
function semanticStatus(): SemanticStatus {
  const enabled = getSettings().semanticSearch;
  const st = semanticIdx?.status();
  return {
    enabled,
    indexed: st?.indexed ?? 0,
    chunks: st?.chunks,
    model: st?.model ?? getSettings().embedModel,
    ollama: st?.ollama ?? 'unknown',
    building: st?.building,
    progress: st?.progress,
    needsRebuild: st?.needsRebuild,
    indexPath: st?.indexPath,
  };
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showAndFocus());
}

function showAndFocus(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.moveTop();
}

function copiesRoot(): string {
  return path.join(app.getPath('documents'), 'Nexus Vault Copies');
}

function isCopyPath(p: string): boolean {
  try {
    return isInside(fs.realpathSync(copiesRoot()), p);
  } catch {
    return false;
  }
}

function progress(label: string, done: number, total: number): void {
  win?.webContents.send(IPC.evProgress, { label, done, total });
}

function reposRoot(): string {
  return path.join(app.getPath('userData'), 'repos');
}

/** Cached packs for the current vault (for MCP/semantic filtering). */
export function currentPacks(): MemoryPacks {
  return memoryStore.cachedPacks(current?.path);
}

/** Board layout for read-only repos lives in app data, keyed by repo path (never inside the repo). */
function codeBoardFile(repo: string): string {
  const h = crypto.createHash('sha1').update(repo.toLowerCase()).digest('hex').slice(0, 16);
  return path.join(app.getPath('userData'), 'code-boards', `${h}.json`);
}

/** Architecture model cache for read-only repos (userData only, never inside the repo). */
function codeArchFile(repo: string): string {
  const h = crypto.createHash('sha1').update(repo.toLowerCase()).digest('hex').slice(0, 16);
  return path.join(app.getPath('userData'), 'code-arch', `${h}.json`);
}

async function readArchCache(repo: string): Promise<ArchCache | null> {
  try {
    const raw = await fs.promises.readFile(codeArchFile(repo), 'utf8');
    const j = JSON.parse(raw) as ArchCache;
    if (j?.version === 1 && j.model?.version === 1) return j;
  } catch {
    /* miss */
  }
  return null;
}

async function writeArchCache(repo: string, cache: ArchCache): Promise<void> {
  const f = codeArchFile(repo);
  await fs.promises.mkdir(path.dirname(f), { recursive: true });
  await fs.promises.writeFile(f, JSON.stringify(cache), 'utf8');
}

async function readPackageJsonHint(root: string): Promise<PackageJsonHint | null> {
  try {
    const raw = await fs.promises.readFile(path.join(root, 'package.json'), 'utf8');
    const j = JSON.parse(raw) as PackageJsonHint;
    return {
      name: typeof j.name === 'string' ? j.name : undefined,
      workspaces: j.workspaces,
      dependencies: j.dependencies,
      devDependencies: j.devDependencies,
      main: typeof j.main === 'string' ? j.main : undefined,
    };
  } catch {
    return null;
  }
}

async function listRootEntries(root: string): Promise<string[]> {
  try {
    return (await fs.promises.readdir(root)).filter((n) => !n.startsWith('.'));
  } catch {
    return [];
  }
}

async function findMarkerFiles(root: string, rels: string[]): Promise<string[]> {
  const markers: string[] = [];
  for (const r of rels) {
    if (/(^|\/)electron-vite\.config\.(ts|js|mjs|cjs)$/.test(r)) markers.push(r);
  }
  // also check root for configs not in code index
  for (const name of ['electron-vite.config.ts', 'electron-vite.config.js', 'electron-vite.config.mjs', 'go.mod', 'Cargo.toml', 'pyproject.toml']) {
    try {
      await fs.promises.access(path.join(root, name));
      if (!markers.includes(name)) markers.push(name);
    } catch {
      /* */
    }
  }
  return markers;
}

async function buildArchModel(force = false): Promise<ArchModel | null> {
  if (!current || current.mode !== 'code' || !(index instanceof CodeIndex) || !index.ready) return null;
  const repo = current.path;
  if (!force && archCache?.model) return archCache.model;
  progress('Building architecture…', 0, 1);
  try {
    const rels = index.rels();
    const packageJson = await readPackageJsonHint(repo);
    const rootEntries = await listRootEntries(repo);
    const markerFiles = await findMarkerFiles(repo, rels);
    const model = inferArchitecture({
      rootName: current.name,
      rels,
      edges: index.importEdges(),
      externals: index.externalPackages(),
      packageJson,
      rootEntries: rootEntries.length ? rootEntries : collectRootEntries(rels),
      markerFiles,
    });
    const prev = archCache ?? (await readArchCache(repo));
    const cache: ArchCache = {
      version: 1,
      model,
      preferredView: prev?.preferredView ?? 'architecture',
      archUserEdited: force ? false : (prev?.archUserEdited ?? false),
      updatedAt: Date.now(),
    };
    archCache = cache;
    await writeArchCache(repo, cache);
    // Seed / refresh __arch__ board layout in code-boards (userData) unless user edited
    try {
      const boardPath = codeBoardFile(repo);
      const board = await ops.readBoardAt(boardPath);
      const existing = board.boards[ARCH_BOARD_KEY];
      // Only auto-seed when empty or forced rebuild — never clobber a saved layout
      if (!existing?.nodes?.length || force) {
        const laid = layoutArch(model);
        board.boards[ARCH_BOARD_KEY] = laid;
        await ops.writeBoardAt(boardPath, board);
        cache.archUserEdited = false;
        archCache = cache;
        await writeArchCache(repo, cache);
      }
    } catch (e) {
      logWarn('arch', `arch board seed failed: ${e instanceof Error ? e.message : e}`);
    }
    progress('', 1, 1);
    logInfo('arch', `arch-ready heuristic=${model.stats.heuristic} nodes=${model.nodes.length} edges=${model.edges.length} truncated=${model.stats.truncated}`);
    return model;
  } catch (e) {
    progress('', 0, 0);
    logWarn('arch', `arch build failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}


function setTitle(): void {
  win?.setTitle(current ? `Nexus Vault — ${current.name}` : 'Nexus Vault');
}

function startCount(): void {
  const token = ++countToken;
  const v = current;
  if (!v) return;
  countNotes(
    v.path,
    (count, done) => {
      if (token === countToken) win?.webContents.send(IPC.evNoteCount, { vaultPath: v.path, count, done });
    },
    () => token !== countToken,
  ).catch(() => undefined);
}

async function openVault(p: string, isCopy?: boolean, opts: { mode?: 'notes' | 'code'; source?: string } = {}): Promise<VaultInfo> {
  const real = await fs.promises.realpath(p);
  const st = await fs.promises.stat(real);
  if (!st.isDirectory()) throw new Error('Not a folder');
  const prev = getSettings().recentVaults.find((r) => r.path === real);
  const mode = opts.mode ?? (prev?.mode === 'code' || (await detectRepo(real)) ? 'code' : 'notes');
  const source = opts.source ?? prev?.source;
  current = { name: path.basename(real), path: real, isCopy: isCopy ?? isCopyPath(real), mode, readOnly: mode === 'code', ...(source ? { source } : {}) };
  const s = getSettings();
  const recent = [{ name: current.name, path: real, isCopy: current.isCopy, lastOpened: Date.now(), mode, ...(source ? { source } : {}) }, ...s.recentVaults.filter((r) => r.path !== real)];
  updateSettings({ recentVaults: recent.slice(0, 25), lastVaultPath: real });
  setTitle();
  startCount();
  void memoryStore.loadPacks(current).catch(() => undefined); // warm cache for MCP/semantic policy
  void startIndex();
  logInfo('vault', `vault-open name=${current.name} mode=${mode} copy=${!!current.isCopy} readOnly=${current.readOnly}`);
  return current;
}

function closeVault(): void {
  current = null;
  countToken++;
  void index?.close();
  index = null;
  archCache = null;
  updateSettings({ lastVaultPath: undefined });
  setTitle();
}

function requireVault(root: string): string {
  if (!current || current.path !== root) throw new Error('Vault is not open');
  return current.path;
}

function registerIpc(): void {
  const handle = (ch: string, fn: (...a: any[]) => any) =>
    ipcMain.handle(ch, async (e, ...args) => {
      try {
        return await fn(e, ...args);
      } catch (err) {
        logError('ipc', `${ch} failed`, err);
        throw err;
      }
    });
  handle(IPC.getSettings, () => getSettings());
  handle(IPC.setTheme, (_e, t: ThemePref) => {
    const s = updateSettings({ theme: t });
    nativeTheme.themeSource = s.theme;
    return s.theme;
  });
  handle(IPC.setLayout, (_e, l: Partial<LayoutSettings>) => updateSettings({ layout: { ...getSettings().layout, ...l } }).layout);
  handle(IPC.getRecent, (): RecentVaultView[] => getSettings().recentVaults.map((r) => ({ ...r, exists: fs.existsSync(r.path) })));
  handle(IPC.removeRecent, (_e, p: string) => {
    updateSettings({ recentVaults: getSettings().recentVaults.filter((r) => r.path !== p) });
  });
  handle(IPC.pickFolder, async (_e, title: string) => {
    const r = win
      ? await dialog.showOpenDialog(win, { title, properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ title, properties: ['openDirectory'] });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });
  handle(IPC.confirmReal, async (_e, p: string) => {
    if (await detectRepo(p)) return 'real'; // code repos open read-only; no copy needed
    const opts = {
      type: 'warning' as const,
      title: 'Open the real vault?',
      message: `You are opening your REAL vault:\n${p}`,
      detail:
        'Nexus Vault can now edit notes, create/rename/delete files and draw links into notes. Every change is backed up into .nexus-backups and deletes go to the vault .trash folder, but a safe copy is strongly recommended while testing.',
      buttons: ['Open real vault', 'Make a safe copy instead', 'Cancel'],
      defaultId: 1,
      cancelId: 2,
      noLink: true,
    };
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    return (['real', 'copy', 'cancel'] as const)[r.response] ?? 'cancel';
  });
  handle(IPC.openVault, (_e, p: string) => openVault(p));
  handle(IPC.safeCopy, async (_e, src: string) => {
    const dest = await safeCopy(src, copiesRoot());
    logInfo('vault', 'safe-copy created');
    return openVault(dest, true);
  });
  handle(IPC.closeVault, () => closeVault());
  handle(IPC.getCurrent, () => {
    if (current) startCount(); // renderer just (re)loaded: send a fresh count
    return current;
  });
  handle(IPC.listDir, (_e, root: string, rel: string) => listDir(requireVault(root), rel));
  handle(IPC.memoryGet, async () => {
    if (!current) return emptyPacks();
    return memoryStore.loadPacks(current);
  });
  handle(IPC.memorySet, async (_e, folder: string, policy: MemoryPolicy | null) => {
    if (!current) return emptyPacks();
    const cur = await memoryStore.loadPacks(current);
    return memoryStore.savePacks(current, setPolicy(cur, folder, policy));
  });

  handle('mcp:status', () => {
    const s = getSettings().mcp;
    const st = mcpStatus();
    return {
      enabled: s.enabled,
      running: st.running,
      port: s.port,
      readOnly: s.readOnly,
      token: s.token,
      url: `http://127.0.0.1:${s.port}/mcp`,
      error: st.error,
    };
  });
  handle('mcp:set', async (_e, patch: { enabled?: boolean; readOnly?: boolean; port?: number }) => {
    const s = getSettings();
    let token = s.mcp.token;
    const enabled = patch.enabled !== undefined ? !!patch.enabled : s.mcp.enabled;
    if (enabled && !token) token = newToken();
    const ps = {
      enabled,
      port: patch.port !== undefined ? Math.max(1024, Math.min(65535, Number(patch.port) || 27124)) : s.mcp.port,
      token,
      readOnly: patch.readOnly !== undefined ? !!patch.readOnly : s.mcp.readOnly,
    };
    updateSettings({ mcp: ps });
    setSecret('token', ps.token);
    stopMcp();
    mcpStarted = false;
    if (ps.enabled) {
      startMcp(backendFactory, ps);
      mcpStarted = true;
    }
    const st = mcpStatus();
    return {
      enabled: ps.enabled,
      running: st.running,
      port: ps.port,
      readOnly: ps.readOnly,
      token: ps.token,
      url: `http://127.0.0.1:${ps.port}/mcp`,
      error: st.error,
    };
  });
  handle('mcp:regen-token', () => {
    const s = getSettings();
    const token = newToken();
    const ps = { ...s.mcp, token };
    updateSettings({ mcp: ps });
    setSecret('token', token);
    if (ps.enabled) {
      stopMcp();
      startMcp(backendFactory, ps);
      mcpStarted = true;
    }
    const st = mcpStatus();
    return {
      enabled: ps.enabled,
      running: st.running,
      port: ps.port,
      readOnly: ps.readOnly,
      token: ps.token,
      url: `http://127.0.0.1:${ps.port}/mcp`,
      error: st.error,
    };
  });

  handle(IPC.snapList, async () => {
    if (!current) return [];
    if (current.readOnly) {
      const h = crypto.createHash('sha1').update(current.path.toLowerCase()).digest('hex');
      return listSnapshotsFromDir(path.join(app.getPath('userData'), 'snapshots', h));
    }
    return listSnapshots(current.path);
  });
  handle(IPC.snapCreate, async (_e, label?: string) => {
    if (!current) throw new Error('No vault is open');
    const sendProg = (done: number, total: number) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.evProgress, { label: label || 'Snapshot', done, total });
    };
    if (current.readOnly) {
      const h = crypto.createHash('sha1').update(current.path.toLowerCase()).digest('hex');
      return createSnapshotWithOptions(
        {
          snapshotsDir: path.join(app.getPath('userData'), 'snapshots', h),
          boardFile: codeBoardFile(current.path),
          includeNotes: false,
          vaultRoot: current.path,
        },
        label,
        sendProg,
      );
    }
    return createSnapshot(current.path, label, sendProg);
  });
  handle(IPC.snapRestore, async (_e, id: string) => {
    if (!current) throw new Error('No vault is open');
    if (current.readOnly) {
      const h = crypto.createHash('sha1').update(current.path.toLowerCase()).digest('hex');
      return restoreSnapshotWithOptions(
        {
          snapshotsDir: path.join(app.getPath('userData'), 'snapshots', h),
          boardFile: codeBoardFile(current.path),
          includeNotes: false,
          vaultRoot: current.path,
        },
        id,
      );
    }
    return restoreSnapshot(current.path, id);
  });
  handle(IPC.snapDelete, async (_e, id: string) => {
    if (!current) throw new Error('No vault is open');
    if (current.readOnly) {
      const h = crypto.createHash('sha1').update(current.path.toLowerCase()).digest('hex');
      return deleteSnapshotFromDir(path.join(app.getPath('userData'), 'snapshots', h), id);
    }
    return deleteSnapshot(current.path, id);
  });

  // ---- M1/M2: notes, file ops, index, board
  const v = () => {
    if (!current) throw new Error('No vault is open');
    return current.path;
  };
  /** Same as v() but refuses when the open folder is a read-only code repo. */
  const vw = () => {
    if (current?.readOnly) throw new Error('This is a read-only code repo. Nexus Vault never modifies repo files.');
    return v();
  };
  handle(IPC.readNote, (_e, rel: string) => ops.readNote(v(), rel));
  handle(IPC.writeNote, async (_e, rel: string, content: string, mtime?: number) => {
    const r = await ops.writeNote(vw(), rel, content, mtime);
    index?.touch(rel);
    return r;
  });
  handle(IPC.createNote, async (_e, dir: string, name: string | null, content?: string) => {
    const rel = await ops.createNote(vw(), dir, name, content ?? '');
    index?.touch(rel);
    return rel;
  });
  handle(IPC.createFolder, async (_e, dir: string, name: string | null) => {
    const rel = await ops.createFolder(vw(), dir, name);
    index?.touchDir(rel);
    return rel;
  });
  handle(IPC.renamePath, async (_e, rel: string, name: string) => {
    const root = vw();
    const isDir = (await fs.promises.stat(await resolveInVault(root, rel))).isDirectory();
    const nrel = await ops.renamePath(root, rel, name);
    if (nrel !== rel) {
      await ops.renameInBoard(root, rel, nrel);
      if (isDir) index?.touchDir(rel);
      else {
        index?.touch(rel, 'remove');
        index?.touch(nrel);
      }
    }
    return nrel;
  });
  handle(IPC.deletePath, async (_e, rel: string) => {
    const root = vw();
    const abs = await resolveInVault(root, rel);
    const isDir = (await fs.promises.stat(abs)).isDirectory();
    const opts = {
      type: 'warning' as const,
      title: 'Delete',
      message: `Delete ${isDir ? 'folder' : 'file'} "${path.basename(abs)}"?`,
      detail: `It will be moved to the vault's .trash folder (recoverable).${isDir ? ' Everything inside the folder goes with it.' : ''}`,
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (r.response !== 0) return null;
    const to = await ops.deletePath(root, rel);
    if (isDir) index?.touchDir(rel);
    else index?.touch(rel, 'remove');
    return to;
  });
  handle(IPC.duplicatePath, async (_e, rel: string) => {
    const nrel = await ops.duplicatePath(vw(), rel);
    index?.touch(nrel);
    index?.touchDir(nrel);
    return nrel;
  });
  handle(IPC.revealPath, async (_e, rel: string) => shell.showItemInFolder(await resolveInVault(v(), rel)));
  handle(IPC.copyPath, async (_e, rel: string) => {
    const abs = await resolveInVault(v(), rel);
    clipboard.writeText(abs);
    return abs;
  });
  handle(IPC.getGraph, () => index?.graph() ?? { nodes: [], links: [], version: -1 });
  handle(IPC.search, (_e, q: string) => index?.search(q) ?? []);
  handle(IPC.semanticStatus, () => semanticStatus());
  handle(IPC.setSemantic, (_e, enabled: boolean) => {
    updateSettings({ semanticSearch: enabled === true });
    if (enabled === true) {
      if (!semanticIdx && index instanceof VaultIndex && index.ready) buildSemantic();
    } else dropSemantic();
    return semanticStatus();
  });
  handle(IPC.semanticSearch, async (_e, q: string): Promise<SemanticHit[]> => {
    if (!semanticIdx || typeof q !== 'string' || !q.trim()) return [];
    const hits = await semanticIdx.search(q, 20, SEM_MIN);
    return applyPolicy(hits, currentPacks());
  });
  handle(IPC.semanticRelated, async (_e, rel: string): Promise<SemanticHit[]> => {
    if (!semanticIdx || typeof rel !== 'string') return [];
    const hits = await semanticIdx.related(rel, 8, SEM_MIN_RELATED);
    return applyPolicy(hits, currentPacks()).slice(0, 5);
  });
  handle(IPC.semanticRebuild, async () => {
    if (!semanticIdx || !(index instanceof VaultIndex)) return semanticStatus();
    const notes = index.allNotes().map((n) => ({ rel: n.rel, title: n.title, content: n.content }));
    try {
      await semanticIdx.rebuild(notes, (done, total) => progress('Semantic index', done, total));
      progress('', 0, 0);
    } catch (e) {
      progress('', 0, 0);
      logWarn('semantic', `rebuild IPC failed: ${e instanceof Error ? e.message : e}`);
    }
    return semanticStatus();
  });
  handle(IPC.getNoteInfo, (_e, rel: string) => index?.noteInfo(rel) ?? null);
  handle('index:links', () => index?.links() ?? []);
  handle(IPC.previews, (_e, rels: string[]) => index?.previews(rels) ?? {});
  handle(IPC.listNotes, () => ({ notes: index?.listNotes() ?? [], stats: index?.stats() ?? null, ready: !!index?.ready }));
  handle(IPC.readBoard, () => (current?.readOnly ? ops.readBoardAt(codeBoardFile(current.path)) : ops.readBoard(v())));
  handle(IPC.writeBoard, (_e, data: BoardFile) => (current?.readOnly ? ops.writeBoardAt(codeBoardFile(current.path), data) : ops.writeBoard(v(), data)));
  handle(IPC.archGet, async () => {
    if (!current || current.mode !== 'code') return null;
    if (archCache?.model) return archCache.model;
    const disk = await readArchCache(current.path);
    if (disk) {
      archCache = disk;
      return disk.model;
    }
    return buildArchModel(false);
  });
  handle(IPC.archRebuild, async () => {
    if (!current || current.mode !== 'code') throw new Error('Architecture is only available for code repos');
    if (!(index instanceof CodeIndex) || !index.ready) throw new Error('Code index is not ready yet');
    const m = await buildArchModel(true);
    if (!m) throw new Error('Could not build architecture');
    return m;
  });
  handle('vault:pick-repo', async (_e, kind: 'folder' | 'zip') => {
    const opts =
      kind === 'zip'
        ? { title: 'Choose a repo .zip (e.g. GitHub "Download ZIP")', properties: ['openFile' as const], filters: [{ name: 'Zip archives', extensions: ['zip'] }] }
        : { title: 'Choose a code project folder', properties: ['openDirectory' as const] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });
  handle(IPC.openCode, async (_e, p: string) => {
    const st = await fs.promises.stat(p);
    if (st.isFile()) {
      if (!/\.zip$/i.test(p)) throw new Error('Drop a folder or a .zip file');
      progress('Extracting zip…', 0, st.size);
      const dir = await extractZip(p, reposRoot(), (d, t) => progress('Extracting zip…', d, t));
      logInfo('repo', 'zip extracted', undefined, dir);
      return openVault(dir, false, { mode: 'code', source: p });
    }
    return openVault(p, false, { mode: 'code' });
  });
  handle(IPC.pickImage, async () => {
    const opts = { title: 'Choose an image', properties: ['openFile' as const], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return null;
    const rel = await ops.importImage(vw(), r.filePaths[0]);
    index?.touchDir(rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
    return rel;
  });
  handle(IPC.readImage, (_e, rel: string) => ops.readImage(v(), rel));
  handle(IPC.openExternal, async (_e, url: string) => {
    // Only on explicit user action (double-click on a link card); opens the system browser, not the app.
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) links can be opened');
    await shell.openExternal(url);
  });
  handle(IPC.addConnection, async (_e, src: string, target: string, label?: string) => {
    const root = vw();
    if (!(index instanceof VaultIndex)) throw new Error('Index not ready');
    const note = await ops.readNote(root, src);
    if (hasLinkTo(note.content, src, target, index.byName, index.byPath)) return false;
    await ops.writeNote(root, src, addConnectionText(note.content, linkNameFor(target, index.byName), label || undefined));
    index.touch(src);
    return true;
  });
  handle(IPC.removeConnection, async (_e, src: string, target: string) => {
    const root = vw();
    if (!(index instanceof VaultIndex)) throw new Error('Index not ready');
    const note = await ops.readNote(root, src);
    const next = removeLinkText(note.content, src, target, index.byName, index.byPath);
    if (next === note.content) return false;
    await ops.writeNote(root, src, next);
    index.touch(src);
    return true;
  });

  handle(IPC.logReport, (_e, payload: { level?: string; tag?: string; message: string; stack?: string }) =>
    reportRenderer(payload ?? { message: '' }),
  );
  handle(IPC.logOpenFolder, async () => {
    await shell.openPath(logDir());
    return logDir();
  });
  handle(IPC.logCopyLast, () => {
    const text = lastErrorText() || 'No errors recorded in this session.';
    clipboard.writeText(text);
    return true;
  });
  handle(IPC.logInfo, () => {
    const file = logFilePath();
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      size = 0;
    }
    return { file, dir: logDir(), size };
  });
  handle(IPC.logBootError, () => takeBootVaultError());
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    { label: 'File', submenu: [{ role: 'quit', label: 'Exit' }] },
    { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Nexus Vault',
          click: () =>
            void dialog.showMessageBox({
              type: 'info',
              title: 'About Nexus Vault',
              message: `Nexus Vault ${app.getVersion()}`,
              detail:
                'Local-first. No account, no network, no telemetry.\nLicense: Apache-2.0\nCopyright 2026 Jesse Lugo\n\nError log: ' +
                logFilePath() +
                ' (local only, never uploaded)',
            }),
        },
        { type: 'separator' },
        {
          label: 'Open log folder',
          click: () => {
            void shell.openPath(logDir());
          },
        },
        {
          label: 'Copy last error',
          click: () => {
            clipboard.writeText(lastErrorText() || 'No errors recorded in this session.');
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function lockDownNetwork(): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const ok = u.startsWith('file:') || u.startsWith('devtools:') || u.startsWith('data:') || u.startsWith('blob:') || (isDev && !!devUrl && (u.startsWith(devUrl) || u.startsWith(devUrl.replace('http', 'ws'))));
    if (!ok) logWarn('network', 'blocked request', undefined, u);
    cb({ cancel: !ok });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
}

function createWindow(): void {
  const s = getSettings();
  const b = s.windowBounds;
  win = new BrowserWindow({
    title: 'Nexus Vault',
    width: b?.width ?? 1280,
    height: b?.height ?? 800,
    x: b?.x,
    y: b?.y,
    minWidth: 1000,
    minHeight: 650,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#f7f7f5',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  if (b?.maximized) win.maximize();

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!(isDev && process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL))) e.preventDefault();
  });
  installWebContentsHooks(win.webContents, 'window');

  win.once('ready-to-show', showAndFocus);
  // Fallback: never stay invisible if ready-to-show is missed.
  setTimeout(() => {
    if (win && !win.isVisible()) showAndFocus();
  }, 3000);

  const saveBounds = () => {
    if (!win || win.isMinimized()) return;
    const maximized = win.isMaximized();
    const nb = maximized ? (getSettings().windowBounds ?? win.getNormalBounds()) : win.getBounds();
    updateSettings({ windowBounds: { ...nb, maximized } });
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('close', () => {
    saveBounds();
    flushSettings();
  });
  win.on('closed', () => (win = null));

  if (isDev && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (process.env.NEXUS_SCREENSHOT) setupScreenshot(win, process.env.NEXUS_SCREENSHOT);
}

/** Test-only hook: run JS steps (";;"-separated; "SHOT <path>" captures, "WAIT <ms>" sleeps), then quit. */
function setupScreenshot(w: BrowserWindow, out: string): void {
  w.webContents.on('console-message', (e) => console.log('[renderer]', e.level, e.message));
  w.webContents.once('did-finish-load', async () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const shot = async (file: string) => {
      const img = await w.webContents.capturePage();
      fs.writeFileSync(file, img.toPNG());
      console.log('[screenshot] saved', file);
    };
    await wait(Number(process.env.NEXUS_SCREENSHOT_WAIT ?? 2500));
    const script = process.env.NEXUS_SCREENSHOT_JS;
    if (script) {
      for (const raw of script.split(';;')) {
        const step = raw.trim();
        if (!step) continue;
        if (step.startsWith('SHOT ')) await shot(step.slice(5).trim());
        else if (step.startsWith('WAIT ')) await wait(Number(step.slice(5)));
        else {
          const r = await w.webContents.executeJavaScript(step).catch((e) => `ERR ${e}`);
          if (r !== undefined) console.log('[step]', String(r).slice(0, 300));
          await wait(400);
        }
      }
    }
    if (out !== '-') {
      await wait(800);
      await shot(out);
    }
    app.quit();
  });
}

app.whenReady().then(async () => {
  logInfo(
    'app',
    `app-start version=${app.getVersion()} electron=${process.versions.electron} chrome=${process.versions.chrome} node=${process.versions.node} platform=${process.platform} arch=${process.arch} packaged=${app.isPackaged} userData=${logDir()}`,
  );
  nativeTheme.themeSource = getSettings().theme;
  nativeTheme.on('updated', () => win?.webContents.send(IPC.evSystemTheme, nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));
  lockDownNetwork();
  registerIpc();
  app.on('will-quit', () => { stopMcp(); mcpStarted = false; });
  if (getSettings().mcp.enabled) {
    const s = getSettings().mcp;
    const token = s.token || newToken();
    if (!s.token) updateSettings({ mcp: { ...s, token } });
    setSecret('token', token);
    startMcp(backendFactory, { ...getSettings().mcp, token });
    mcpStarted = true;
  } else if (getSettings().mcp.token) {
    setSecret('token', getSettings().mcp.token);
  }
  buildMenu();
  const startPath = process.env.NEXUS_VAULT_OPEN || getSettings().lastVaultPath;
  if (startPath) {
    if (fs.existsSync(startPath)) {
      try {
        await openVault(startPath);
      } catch (e) {
        current = null;
        logError('vault', 'startup vault-open failed', e);
        setBootVaultError(e instanceof Error ? e.message : String(e));
      }
    } else {
      logWarn('vault', `startup vault path missing: (redacted)`);
    }
  }
  createWindow();
  setTitle();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  flushSettings();
  flushLogger();
  app.quit();
});
