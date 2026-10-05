import { app, BrowserWindow, session, nativeTheme, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from './ipc/handlers.js';
import { setupSecurity } from './security.js';
import { createMenu } from './menu.js';
import { setupThemeSync } from './theme.js';
import { initializeFromEnv, getCurrentVault, closeVault } from './ipc/vault.js';
import { loadSettings, saveWindowBounds } from './ipc/settings.js';
import { countNotes } from './utils/note-counter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let noteCountInterval: NodeJS.Timeout | null = null;

function createWindow(): void {
  const settings = loadSettings();
  const bounds = settings.windowBounds || { width: 1280, height: 800, x: undefined, y: undefined };

  mainWindow = new BrowserWindow({
    title: 'Nexus Vault',
    minWidth: 1000,
    minHeight: 650,
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, '../preload/index.js'),
      spellcheck: false,
    },
  });

  if (bounds.maximized) {
    mainWindow.maximize();
  }

  setupSecurity(mainWindow);
  createMenu(mainWindow);
  setupThemeSync(mainWindow);

  mainWindow.once('ready-to-show', async () => {
    mainWindow?.show();
    const vault = await initializeFromEnv();
    if (vault) {
      startNoteCounter(vault.path);
      mainWindow?.webContents.send('vault-opened', vault);
      updateTitle(vault);
    }
  });

  mainWindow.on('close', async () => {
    if (mainWindow) {
      const bounds = mainWindow.getBounds();
      const maximized = mainWindow.isMaximized();
      await saveWindowBounds({ ...bounds, maximized });
    }
    stopNoteCounter();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.NEXUS_SCREENSHOT) {
    mainWindow.webContents.on('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 1500));
      const image = await mainWindow!.webContents.capturePage();
      const fs = await import('node:fs/promises');
      await fs.writeFile(process.env.NEXUS_SCREENSHOT!, image.toPNG());
      app.quit();
    });
  }
}

function updateTitle(vault: { name: string } | null): void {
  if (mainWindow) {
    mainWindow.setTitle(vault ? `Nexus Vault — ${vault.name}` : 'Nexus Vault');
  }
}

function startNoteCounter(vaultRoot: string): void {
  stopNoteCounter();
  noteCountInterval = setInterval(async () => {
    const count = await countNotes(vaultRoot, (c, done) => {
      mainWindow?.webContents.send('main:note-count-progress', { vaultRoot, count: c, done });
    });
    mainWindow?.webContents.send('main:note-count-progress', { vaultRoot, count, done: true });
  }, 5000);
  countNotes(vaultRoot, (c, done) => {
    mainWindow?.webContents.send('main:note-count-progress', { vaultRoot, count: c, done });
  });
}

function stopNoteCounter(): void {
  if (noteCountInterval) {
    clearInterval(noteCountInterval);
    noteCountInterval = null;
  }
}

ipcMain.on('vault-closed', () => {
  closeVault();
  stopNoteCounter();
  updateTitle(null);
  mainWindow?.webContents.send('vault-closed');
});

app.whenReady().then(() => {
  if (process.env.NEXUS_USER_DATA) {
    app.setPath('userData', process.env.NEXUS_USER_DATA);
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');