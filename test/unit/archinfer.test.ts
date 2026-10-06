import { describe, expect, it } from 'vitest';
import { collectRootEntries, inferArchitecture, type ArchInferInput } from '../../src/main/archinfer';

function base(partial: Partial<ArchInferInput> & { rels: string[] }): ArchInferInput {
  return {
    rootName: 'demo',
    edges: [],
    externals: [],
    packageJson: null,
    rootEntries: collectRootEntries(partial.rels),
    markerFiles: [],
    ...partial,
  };
}

describe('archinfer', () => {
  it('electron-vite fixture → Main / Preload / Renderer apps', () => {
    const rels = [
      'package.json',
      'electron-vite.config.ts',
      'src/main/index.ts',
      'src/main/vault.ts',
      'src/main/settings.ts',
      'src/preload/index.ts',
      'src/renderer/src/App.tsx',
      'src/renderer/src/components/BoardPane.tsx',
      'src/shared/types.ts',
    ];
    const edges: [string, string][] = [
      ['src/main/index.ts', 'src/main/vault.ts'],
      ['src/main/index.ts', 'src/main/settings.ts'],
      ['src/renderer/src/App.tsx', 'src/renderer/src/components/BoardPane.tsx'],
      ['src/main/index.ts', 'src/shared/types.ts'],
    ];
    const model = inferArchitecture(
      base({
        rels,
        edges,
        packageJson: { name: 'nexus-vault', main: './out/main/index.js', dependencies: { electron: '38.0.0' } },
        markerFiles: ['electron-vite.config.ts'],
        externals: [{ name: 'electron', count: 5 }, { name: 'react', count: 3 }],
      }),
    );
    expect(model.stats.heuristic).toBe('electron');
    expect(model.nodes.find((n) => n.id === 'arch:system:root')?.name).toBe('nexus-vault');
    expect(model.nodes.some((n) => n.id === 'arch:app:main')).toBe(true);
    expect(model.nodes.some((n) => n.id === 'arch:app:preload')).toBe(true);
    expect(model.nodes.some((n) => n.id === 'arch:app:renderer')).toBe(true);
    expect(model.nodes.some((n) => n.kind === 'external' && n.name === 'electron')).toBe(true);
    expect(model.edges.length).toBeGreaterThan(0);
    expect(model.stats.importsParsed).toBe(true);
  });

  it('npm workspaces → N apps under one system', () => {
    const rels = [
      'package.json',
      'apps/web/src/index.ts',
      'apps/web/package.json',
      'apps/api/src/server.ts',
      'packages/ui/src/Button.tsx',
      'packages/ui/src/index.ts',
    ];
    const edges: [string, string][] = [
      ['apps/web/src/index.ts', 'packages/ui/src/Button.tsx'],
      ['apps/api/src/server.ts', 'packages/ui/src/index.ts'],
    ];
    const model = inferArchitecture(
      base({
        rels,
        edges,
        packageJson: { name: 'acme', workspaces: ['apps/*', 'packages/*'] },
      }),
    );
    expect(model.stats.heuristic).toBe('monorepo');
    const apps = model.nodes.filter((n) => n.kind === 'app' || n.kind === 'store');
    expect(apps.length).toBeGreaterThanOrEqual(3);
    expect(model.edges.some((e) => (e.weight ?? 0) >= 1)).toBe(true);
  });

  it('generic repo → system + top folders', () => {
    const rels = ['cmd/main.go', 'internal/db/db.go', 'pkg/util/x.go', 'README.md'];
    const model = inferArchitecture(
      base({
        rels,
        edges: [['cmd/main.go', 'internal/db/db.go']],
      }),
    );
    expect(model.stats.heuristic).toBe('generic');
    expect(model.nodes.some((n) => n.kind === 'system')).toBe(true);
    expect(model.nodes.some((n) => n.name === 'cmd' || n.name === 'internal' || n.name === 'pkg')).toBe(true);
  });

  it('aggregates import edge weights across folders', () => {
    const rels = ['a/x.ts', 'a/y.ts', 'b/z.ts'];
    const edges: [string, string][] = [
      ['a/x.ts', 'b/z.ts'],
      ['a/y.ts', 'b/z.ts'],
    ];
    const model = inferArchitecture(base({ rels, edges }));
    const e = model.edges.find((ed) => ed.weight && ed.weight >= 2);
    expect(e).toBeTruthy();
  });

  it('language-without-parser → folder-only + importsParsed false when only .rs', () => {
    const rels = ['src/lib.rs', 'src/main.rs', 'Cargo.toml'];
    const model = inferArchitecture(base({ rels, edges: [] }));
    expect(model.stats.importsParsed).toBe(false);
    expect(model.nodes.some((n) => n.kind === 'system')).toBe(true);
  });

  it('skips IGNORE_DIRS in top folders', () => {
    const rels = ['src/a.ts', 'node_modules/x/index.js', 'dist/bundle.js'];
    const model = inferArchitecture(base({ rels }));
    expect(model.nodes.some((n) => n.name === 'node_modules')).toBe(false);
    expect(model.nodes.some((n) => n.name === 'dist')).toBe(false);
  });
});
