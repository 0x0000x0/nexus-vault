// Electron main process for Nexus Vault M0. Written by Grok Bot (replaces OpenCode WIP).
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, type MenuItemConstructorOptions } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { IPC, type LayoutSettings, type RecentVaultView, type ThemePref, type VaultInfo } from '../shared/types';
import { flushSettings, getSettings, updateSettings } from './settings';
import { countNotes, listDir, safeCopy } from './vault';
import { isInside } from './pure';

if (process.env.NEXUS_USER_DATA) app.setPath('userData', process.env.NEXUS_USER_DATA);

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL;
let win: BrowserWindow | null = null;
let current: VaultInfo | null = null;
let countToken = 0;

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

async function openVault(p: string, isCopy?: boolean): Promise<VaultInfo> {
  const real = await fs.promises.realpath(p);
  const st = await fs.promises.stat(real);
  if (!st.isDirectory()) throw new Error('Not a folder');
  current = { name: path.basename(real), path: real, isCopy: isCopy ?? isCopyPath(real) };
  const s = getSettings();
  const recent = [{ name: current.name, path: real, isCopy: current.isCopy, lastOpened: Date.now() }, ...s.recentVaults.filter((r) => r.path !== real)];
  updateSettings({ recentVaults: recent.slice(0, 15), lastVaultPath: real });
  setTitle();
  startCount();
  return current;
}

function closeVault(): void {
  current = null;
  countToken++;
  updateSettings({ lastVaultPath: undefined });
  setTitle();
}

function requireVault(root: string): string {
  if (!current || current.path !== root) throw new Error('Vault is not open');
  return current.path;
}

function registerIpc(): void {
  ipcMain.handle(IPC.getSettings, () => getSettings());
  ipcMain.handle(IPC.setTheme, (_e, t: ThemePref) => {
    const s = updateSettings({ theme: t });
    nativeTheme.themeSource = s.theme;
    return s.theme;
  });
  ipcMain.handle(IPC.setLayout, (_e, l: Partial<LayoutSettings>) => updateSettings({ layout: { ...getSettings().layout, ...l } }).layout);
  ipcMain.handle(IPC.getRecent, (): RecentVaultView[] => getSettings().recentVaults.map((r) => ({ ...r, exists: fs.existsSync(r.path) })));
  ipcMain.handle(IPC.removeRecent, (_e, p: string) => {
    updateSettings({ recentVaults: getSettings().recentVaults.filter((r) => r.path !== p) });
  });
  ipcMain.handle(IPC.pickFolder, async (_e, title: string) => {
    const r = win
      ? await dialog.showOpenDialog(win, { title, properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ title, properties: ['openDirectory'] });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });
  ipcMain.handle(IPC.confirmReal, async (_e, p: string) => {
    const opts = {
      type: 'warning' as const,
      title: 'Open the real vault?',
      message: `You are opening your REAL vault:\n${p}`,
      detail:
        'Nexus Vault M0 is read-only, so this is safe today. Future versions will be able to write to the vault. A safe copy is recommended while testing.',
      buttons: ['Open real vault', 'Make a safe copy instead', 'Cancel'],
      defaultId: 1,
      cancelId: 2,
      noLink: true,
    };
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    return (['real', 'copy', 'cancel'] as const)[r.response] ?? 'cancel';
  });
  ipcMain.handle(IPC.openVault, (_e, p: string) => openVault(p));
  ipcMain.handle(IPC.safeCopy, async (_e, src: string) => {
    const dest = await safeCopy(src, copiesRoot());
    return openVault(dest, true);
  });
  ipcMain.handle(IPC.closeVault, () => closeVault());
  ipcMain.handle(IPC.getCurrent, () => {
    if (current) startCount(); // renderer just (re)loaded: send a fresh count
    return current;
  });
  ipcMain.handle(IPC.listDir, (_e, root: string, rel: string) => listDir(requireVault(root), rel));
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
              detail: 'Local-first. No account, no network, no telemetry.\nLicense: Apache-2.0\nCopyright 2026 Jesse Lugo',
            }),
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
    if (!ok) console.warn('[blocked request]', u);
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

/** Test-only hook: expand a few folders, select a note, capture the window, quit. */
function setupScreenshot(w: BrowserWindow, out: string): void {
  w.webContents.on('console-message', (e) => console.log('[renderer]', e.level, e.message));
  w.webContents.on('preload-error', (_e, p, err) => console.log('[preload-error]', p, err));
  w.webContents.once('did-finish-load', async () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await wait(1500);
    const script = process.env.NEXUS_SCREENSHOT_JS;
    if (script) {
      for (const step of script.split(';;')) {
        await w.webContents.executeJavaScript(step).catch((e) => console.error('screenshot step failed', e));
        await wait(400);
      }
    }
    await wait(800);
    const img = await w.webContents.capturePage();
    fs.writeFileSync(out, img.toPNG());
    console.log('[screenshot] saved', out, `visible=${w.isVisible()} focused=${w.isFocused()}`);
    app.quit();
  });
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = getSettings().theme;
  nativeTheme.on('updated', () => win?.webContents.send(IPC.evSystemTheme, nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));
  lockDownNetwork();
  registerIpc();
  buildMenu();
  const startPath = process.env.NEXUS_VAULT_OPEN || getSettings().lastVaultPath;
  if (startPath && fs.existsSync(startPath)) {
    try {
      await openVault(startPath);
    } catch {
      current = null;
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
  app.quit();
});
