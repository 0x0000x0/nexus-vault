import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
  deleteSnapshot,
  createSnapshotWithOptions,
  restoreSnapshotWithOptions,
  listSnapshotsFromDir,
  deleteSnapshotFromDir,
} from '../../src/main/snapshots';

let root: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'nv-snap-'));
  await fsp.mkdir(path.join(root, 'sub'), { recursive: true });
  await fsp.mkdir(path.join(root, '.trash'), { recursive: true });
  await fsp.mkdir(path.join(root, '.nexus'), { recursive: true });
  await fsp.writeFile(path.join(root, 'a.md'), 'alpha original');
  await fsp.writeFile(path.join(root, 'sub', 'b.md'), 'bravo');
  await fsp.writeFile(path.join(root, '.trash', 'x.md'), 'trashed');
  await fsp.writeFile(path.join(root, '.nexus', 'board.json'), '{"version":1,"boards":{}}');
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe('snapshots', () => {
  it('create lists restore delete (notes mode)', async () => {
    const info = await createSnapshot(root, 'first');
    expect(info.fileCount).toBe(3); // a.md, sub/b.md, _board.json
    expect(info.label).toBe('first');
    const listed = await listSnapshots(root);
    expect(listed[0].id).toBe(info.id);

    await fsp.writeFile(path.join(root, 'a.md'), 'alpha CHANGED');
    await fsp.writeFile(path.join(root, 'c.md'), 'charlie new');

    const result = await restoreSnapshot(root, info.id);
    expect(await fsp.readFile(path.join(root, 'a.md'), 'utf8')).toBe('alpha original');
    expect(fs.existsSync(path.join(root, 'c.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.trash', `restore-${info.id}`, 'c.md'))).toBe(true);
    expect(result.preRestoreId).toBeTruthy();
    expect(result.preRestoreId).not.toBe(info.id);
    const after = await listSnapshots(root);
    expect(after.some((s) => s.id === result.preRestoreId)).toBe(true);

    await deleteSnapshot(root, info.id);
    expect((await listSnapshots(root)).some((s) => s.id === info.id)).toBe(false);
  });

  it('code-mode options never write under vaultRoot', async () => {
    const userData = await fsp.mkdtemp(path.join(os.tmpdir(), 'nv-ud-'));
    const boardFile = path.join(userData, 'board.json');
    await fsp.writeFile(boardFile, '{"version":1,"boards":{"x":{}}}');
    const snapshotsDir = path.join(userData, 'snapshots', 'abc');
    const info = await createSnapshotWithOptions({
      snapshotsDir,
      boardFile,
      includeNotes: false,
      vaultRoot: root,
    }, 'code');
    expect(info.fileCount).toBe(1);
    expect(fs.existsSync(path.join(root, '.nexus', 'snapshots'))).toBe(false);
    expect(fs.existsSync(path.join(snapshotsDir, info.id, '_board.json'))).toBe(true);
    await fsp.writeFile(boardFile, '{"version":1,"boards":{}}');
    await restoreSnapshotWithOptions(
      { snapshotsDir, boardFile, includeNotes: false, vaultRoot: root },
      info.id,
    );
        expect(JSON.parse(await fsp.readFile(boardFile, 'utf8')).boards.x).toBeTruthy();
    for (const s of await listSnapshotsFromDir(snapshotsDir)) {
      await deleteSnapshotFromDir(snapshotsDir, s.id);
    }
    expect(await listSnapshotsFromDir(snapshotsDir)).toEqual([]);
    await fsp.rm(userData, { recursive: true, force: true });

  });
});
