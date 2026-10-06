// Electron facade for local error log. Grok Bot — Nexus Vault 0.0.5.
import { app, dialog, shell, type WebContents } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendLine, readTail, LOG_NAME } from './log-file';
import { clip, errInfo, formatLine, redact, shortCode, type LogEntry, type LogLevel, type LogSource } from '../shared/log-format';

let dir = '';
let inited = false;
let fails = 0;
let disabled = false;
const ring: string[] = [];
const RING_CAP = 20;
const secrets: { token?: string; home?: string } = {};
let rendererReports = 0;
let rendererWindowStart = 0;
let bootVaultError: string | null = null;

export function setBootVaultError(msg: string | null): void {
  bootVaultError = msg;
}
export function takeBootVaultError(): string | null {
  const m = bootVaultError;
  bootVaultError = null;
  return m;
}

export function setSecret(name: 'token', value: string): void {
  if (name === 'token') secrets.token = value || undefined;
}

function resolveDir(): string {
  try {
    return path.join(app.getPath('userData'), 'logs');
  } catch {
    try {
      return path.join(app.getPath('appData'), app.getName(), 'logs');
    } catch {
      return path.join(os.tmpdir(), 'nexus-vault-logs');
    }
  }
}

export function initLogger(): void {
  if (inited) return;
  inited = true;
  dir = resolveDir();
  try {
    secrets.home = os.homedir();
  } catch {
    /* ignore */
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  installProcessHandlers();
  installAppChildProcessHook();
}

export function logDir(): string {
  if (!dir) dir = resolveDir();
  return dir;
}
export function logFilePath(): string {
  return path.join(logDir(), LOG_NAME);
}

function pushRing(line: string): void {
  ring.push(line.trimEnd());
  while (ring.length > RING_CAP) ring.shift();
}

export function log(level: LogLevel, source: LogSource, tag: string, message: string, err?: unknown): void {
  if (disabled) return;
  if (!inited) initLogger();
  const info = err !== undefined ? errInfo(err) : undefined;
  const msg = redact(clip(String(message).split('\n')[0] ?? '', 2000), secrets);
  let stack: string | undefined;
  if (info?.stack) stack = redact(clip(info.stack, 4000), secrets);
  else if (err !== undefined && info && info.message && info.message !== message) {
    // err was a plain value / message-only
  }
  // If message already includes err text via caller, still attach stack when present.
  if (err !== undefined && !stack && info?.message && !String(message).includes(info.message)) {
    // keep message as-is
  }
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    source,
    tag: clip(tag, 40),
    message: msg + (info && level === 'ERROR' && info.message && !msg.includes(info.message) ? `: ${redact(clip(info.message, 500), secrets)}` : ''),
    stack,
  };
  const line = formatLine(entry);
  pushRing(line);
  const ok = appendLine(logDir(), line, () => {
    fails++;
    if (fails >= 5 && !disabled) {
      disabled = true;
      console.error('[logger] disabled after 5 consecutive write failures');
    }
  });
  if (ok) fails = 0;
}

export function logInfo(tag: string, message: string, err?: unknown, extra?: string): void {
  log('INFO', 'main', tag, extra ? `${message} ${extra}` : message, err);
}
export function logWarn(tag: string, message: string, err?: unknown, extra?: string): void {
  log('WARN', 'main', tag, extra ? `${message} ${extra}` : message, err);
}
export function logError(tag: string, message: string, err?: unknown): void {
  log('ERROR', 'main', tag, message, err);
}

/** Newest ERROR from ring, else file tail; plus a few preceding lines. */
export function lastErrorText(): string {
  for (let i = ring.length - 1; i >= 0; i--) {
    if (/\bERROR\b/.test(ring[i]!)) {
      const start = Math.max(0, i - 4);
      return ring.slice(start, i + 1).join('\n');
    }
  }
  const tail = readTail(logDir(), 40);
  if (!tail) return '';
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/\bERROR\b/.test(lines[i]!)) {
      const start = Math.max(0, i - 4);
      return lines.slice(start, i + 1).join('\n');
    }
  }
  return lines.slice(-8).join('\n');
}

export function flushLogger(): void {
  /* sync writes already flushed */
}

export function reportRenderer(payload: {
  level?: string;
  tag?: string;
  message: string;
  stack?: string;
}): { code: string } {
  const now = Date.now();
  if (now - rendererWindowStart > 60_000) {
    rendererWindowStart = now;
    rendererReports = 0;
  }
  rendererReports++;
  if (rendererReports > 60) {
    if (rendererReports === 61) log('WARN', 'renderer', 'rate-limit', `log-renderer-flood dropped=${rendererReports - 60}`);
    return { code: shortCode(payload.message || 'flood') };
  }
  const level: LogLevel = payload.level === 'WARN' ? 'WARN' : 'ERROR';
  const tag = clip(String(payload.tag ?? 'renderer'), 40);
  const message = clip(String(payload.message ?? ''), 2000);
  const stack = payload.stack ? clip(String(payload.stack), 4000) : undefined;
  log(level, 'renderer', tag, message, stack ? { message: '', stack } : undefined);
  return { code: shortCode(message) };
}

export function installProcessHandlers(): void {
  process.on('uncaughtException', (err) => {
    logError('process', 'uncaughtException', err);
    try {
      const r = dialog.showMessageBoxSync({
        type: 'error',
        title: 'Nexus Vault — main process error',
        message: 'A JavaScript error occurred in the main process.',
        detail: clip(errInfo(err).message, 800) + `\n\nError log: ${logFilePath()}`,
        buttons: ['Open log folder', 'OK'],
        defaultId: 1,
        noLink: true,
      });
      if (r === 0) void shell.openPath(logDir());
    } catch {
      /* ignore dialog failures */
    }
  });
  process.on('unhandledRejection', (reason) => {
    logError('process', 'unhandledRejection', reason);
  });
}

export function installWebContentsHooks(wc: WebContents, label: string): void {
  wc.on('render-process-gone', (_e, details) => {
    logError('webContents', `${label} render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });
  wc.on('unresponsive', () => logWarn('webContents', `${label} unresponsive`));
  wc.on('responsive', () => logInfo('webContents', `${label} responsive`));
  wc.on('preload-error', (_e, script, err) => {
    logError('webContents', `${label} preload-error ${script}`, err);
  });
  try {
    (wc as unknown as { on: (ev: string, cb: (...a: unknown[]) => void) => void }).on('child-process-gone', (...args: unknown[]) => {
      const details = (args[1] ?? {}) as { type?: string; reason?: string; exitCode?: number };
      logError('webContents', `${label} child-process-gone type=${details?.type} reason=${details?.reason} exitCode=${details?.exitCode}`);
    });
  } catch {
    /* ignore */
  }
}

let childGoneHooked = false;
export function installAppChildProcessHook(): void {
  if (childGoneHooked) return;
  childGoneHooked = true;
  app.on('child-process-gone', (_e, details) => {
    logError('process', `child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`);
  });
}
