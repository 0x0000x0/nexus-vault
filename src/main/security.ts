import { BrowserWindow, session } from 'electron';

export function setupSecurity(win: BrowserWindow): void {
  const isDev = process.env.NODE_ENV === 'development';
  const allowedOrigins = ['file://', 'devtools://'];
  if (isDev) {
    allowedOrigins.push('http://localhost:5173');
  }

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    const allowed = allowedOrigins.some(origin => url.startsWith(origin));
    callback({ cancel: !allowed });
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.webContents.on('will-navigate', (e, url) => {
    const allowed = allowedOrigins.some(origin => url.startsWith(origin));
    if (!allowed) {
      e.preventDefault();
    }
  });
}