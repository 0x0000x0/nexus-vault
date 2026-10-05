import { ipcMain, dialog } from 'electron';
import { Channels } from '../../shared/ipc.js';
import * as vaultHandlers from './vault.js';
import * as fsHandlers from './fs.js';
import * as settingsHandlers from './settings.js';

export function registerIpcHandlers(): void {
  ipcMain.handle('renderer:open-vault', async (_e, payload) => {
    return vaultHandlers.openVault(payload.path, payload.type);
  });

  ipcMain.handle('renderer:close-vault', async () => {
    return vaultHandlers.closeVault();
  });

  ipcMain.handle('renderer:get-recent-vaults', async () => {
    return vaultHandlers.getRecentVaults();
  });

  ipcMain.handle('renderer:remove-recent-vault', async (_e, path: string) => {
    return settingsHandlers.removeRecentVault(path);
  });

  ipcMain.handle('renderer:safe-copy-vault', async (_e, payload) => {
    return vaultHandlers.safeCopyVault(payload.sourcePath);
  });

  ipcMain.handle('renderer:list-dir', async (_e, payload) => {
    return fsHandlers.listDir(payload.vaultRoot, payload.relPath);
  });

  ipcMain.handle('renderer:read-file', async (_e, payload) => {
    return fsHandlers.readFile(payload.vaultRoot, payload.relPath);
  });

  ipcMain.handle('renderer:get-settings', async () => {
    return settingsHandlers.loadSettings();
  });

  ipcMain.handle('renderer:save-settings', async (_e, payload) => {
    return settingsHandlers.saveSettings(payload);
  });

  ipcMain.handle('renderer:open-folder-dialog', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : { path: result.filePaths[0] };
  });

  ipcMain.handle('renderer:confirm-dialog', async (_e, payload: { title: string; message: string; buttons: string[] }) => {
    const result = await dialog.showMessageBox({
      type: 'question',
      title: payload.title,
      message: payload.message,
      buttons: payload.buttons,
      defaultId: 0,
      cancelId: payload.buttons.length - 1,
    });
    return result.response;
  });

  ipcMain.handle('renderer:open-settings', async () => {
    // Placeholder for settings window
    return null;
  });
}