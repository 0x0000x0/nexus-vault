import { describe, expect, it } from 'vitest';
import type { ArchModel } from '../../src/shared/arch';
import { layoutArch, nodesInsideGroup } from '../../src/shared/arch-layout';
import { inferArchitecture, collectRootEntries } from '../../src/main/archinfer';

function electronModel(): ArchModel {
  const rels = [
    'electron-vite.config.ts',
    'src/main/index.ts',
    'src/main/vault.ts',
    'src/preload/index.ts',
    'src/renderer/src/App.tsx',
    'src/renderer/src/components/Board.tsx',
  ];
  return inferArchitecture({
    rootName: 'app',
    rels,
    edges: [
      ['src/main/index.ts', 'src/main/vault.ts'],
      ['src/renderer/src/App.tsx', 'src/renderer/src/components/Board.tsx'],
    ],
    externals: [{ name: 'react', count: 2 }],
    packageJson: { name: 'app', dependencies: { electron: '1' } },
    rootEntries: collectRootEntries(rels),
    markerFiles: ['electron-vite.config.ts'],
  });
}

describe('arch-layout', () => {
  it('places children inside parent bbox', () => {
    const model = electronModel();
    const board = layoutArch(model);
    const sys = board.nodes.find((n) => n.id === model.rootId)!;
    expect(sys).toBeTruthy();
    const kids = board.nodes.filter((n) => n.id !== sys.id);
    for (const k of kids) {
      // nested groups should be within system (with small float tolerance)
      expect(k.x).toBeGreaterThanOrEqual(sys.x - 1);
      expect(k.y).toBeGreaterThanOrEqual(sys.y - 1);
      expect(k.x + k.w).toBeLessThanOrEqual(sys.x + sys.w + 1);
      expect(k.y + k.h).toBeLessThanOrEqual(sys.y + sys.h + 1);
    }
  });

  it('stable ids across rebuild with same model', () => {
    const model = electronModel();
    const a = layoutArch(model);
    const b = layoutArch(model);
    expect(a.nodes.map((n) => n.id).sort()).toEqual(b.nodes.map((n) => n.id).sort());
    expect(a.nodes.map((n) => `${n.id}:${n.x},${n.y}`).sort()).toEqual(b.nodes.map((n) => `${n.id}:${n.x},${n.y}`).sort());
  });

  it('edge endpoints resolve to board nodes', () => {
    const model = electronModel();
    const board = layoutArch(model);
    const ids = new Set(board.nodes.map((n) => n.id));
    for (const e of board.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  it('nodesInsideGroup finds nested children', () => {
    const model = electronModel();
    const board = layoutArch(model);
    const main = board.nodes.find((n) => n.id === 'arch:app:main');
    if (main) {
      const inside = nodesInsideGroup(board, main.id);
      expect(inside.every((n) => n.x >= main.x && n.y >= main.y)).toBe(true);
    }
  });
});
