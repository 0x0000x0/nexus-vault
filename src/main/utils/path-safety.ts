import fs from 'node:fs/promises';
import path from 'node:path';

export async function resolveInsideVault(vaultRoot: string, relPath: string): Promise<string> {
  if (path.isAbsolute(relPath) || relPath === '' || relPath.includes('..')) {
    throw new Error('Path escape attempt');
  }
  const requested = path.join(vaultRoot, relPath);
  const realRoot = await fs.realpath(vaultRoot);
  const realRequested = await fs.realpath(requested).catch(() => {
    throw new Error('Not found');
  });
  if (!realRequested.startsWith(realRoot + path.sep) && realRequested !== realRoot) {
    throw new Error('Symlink escape attempt');
  }
  return realRequested;
}