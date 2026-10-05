import { BrowserWindow, nativeTheme } from 'electron';

export function setupThemeSync(win: BrowserWindow): void {
  const sendTheme = () => {
    win.webContents.send('main:theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  };

  nativeTheme.on('updated', sendTheme);
  sendTheme();
}