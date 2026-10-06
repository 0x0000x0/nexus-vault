// Global renderer error → IPC. Grok Bot — Nexus Vault 0.0.5.
import { clip, errInfo } from '../../shared/log-format';

const WINDOW_MS = 60_000;
const MAX = 20;
let count = 0;
let windowStart = 0;
let suppressed = 0;

function report(tag: string, e: unknown, where?: string): void {
  try {
    const now = Date.now();
    if (now - windowStart > WINDOW_MS) {
      windowStart = now;
      count = 0;
      suppressed = 0;
    }
    count++;
    if (count > MAX) {
      suppressed++;
      if (suppressed === 1) {
        void window.nexus.reportError({
          level: 'ERROR',
          tag: 'rate-limit',
          message: `${MAX} further renderer errors suppressed`,
        });
      }
      return;
    }
    const info = errInfo(e);
    const message = clip(where ? `${info.message} @ ${where}` : info.message, 2000);
    const stack = info.stack ? clip(info.stack, 4000) : undefined;
    void window.nexus.reportError({ level: 'ERROR', tag, message, stack });
  } catch {
    /* never throw from global handlers */
  }
}

export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (e) => {
    const where = e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined;
    report('window.onerror', e.error ?? e.message, where);
  });
  window.addEventListener('unhandledrejection', (e) => {
    report('unhandledrejection', e.reason);
  });
}
