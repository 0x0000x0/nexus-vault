import { describe, expect, it } from 'vitest';
import { looksLikeRepo, parseImports, resolveImport } from '../../src/main/codeparse';

const files = new Set(['src/a.ts', 'src/b/index.tsx', 'src/c.js', 'pkg/mod.py', 'pkg/__init__.py', 'pkg/sub/x.py', 'cmd/main.go', 'internal/db/db.go', 'internal/db/db_test.go']);
const dirs = new Map<string, string[]>([['internal/db', ['internal/db/db.go', 'internal/db/db_test.go']]]);

describe('code imports', () => {
  it('parses + resolves JS/TS', () => {
    const imps = parseImports('src/a.ts', "import x from './b';\n// import y from './nope'\nexport * from './c.js'\nconst z = require('react')\nimport type { T } from '@scope/pkg/sub'");
    expect(imps.map((i) => i.spec)).toEqual(['./b', './c.js', 'react', '@scope/pkg/sub'].sort((a, b) => imps.findIndex((i) => i.spec === a) - imps.findIndex((i) => i.spec === b)));
    expect(resolveImport('src/a.ts', './b', files, null, dirs)).toEqual({ files: ['src/b/index.tsx'] });
    expect(resolveImport('src/a.ts', './c.js', files, null, dirs)).toEqual({ files: ['src/c.js'] });
    expect(resolveImport('src/a.ts', '@scope/pkg/sub', files, null, dirs)).toEqual({ external: '@scope/pkg' });
  });
  it('parses + resolves Python', () => {
    const imps = parseImports('pkg/sub/x.py', 'import os, pkg.mod\nfrom .. import mod\nfrom pkg.sub import x as y\n');
    expect(imps.map((i) => i.spec).sort()).toEqual(['..mod', 'os', 'pkg.mod', 'pkg.sub'].sort());
    expect(resolveImport('pkg/sub/x.py', 'pkg.mod', files, null, dirs)).toEqual({ files: ['pkg/mod.py'] });
    expect(resolveImport('pkg/sub/x.py', '..mod', files, null, dirs)).toEqual({ files: ['pkg/mod.py'] });
    expect(resolveImport('pkg/sub/x.py', 'os', files, null, dirs)).toEqual({ external: 'os' });
  });
  it('parses + resolves Go', () => {
    const imps = parseImports('cmd/main.go', 'package main\nimport (\n  "fmt"\n  db "example.com/app/internal/db"\n)\n');
    expect(imps.map((i) => i.spec)).toEqual(['fmt', 'example.com/app/internal/db']);
    expect(resolveImport('cmd/main.go', 'example.com/app/internal/db', files, 'example.com/app', dirs)).toEqual({ files: ['internal/db/db.go'] });
  });
  it('detects repos vs vaults', () => {
    expect(looksLikeRepo(['package.json', 'src'], { code: 1, md: 0 })).toBe(true);
    expect(looksLikeRepo(['.obsidian', '.git', 'package.json'], { code: 9, md: 1 })).toBe(false);
    expect(looksLikeRepo(['.git', 'Notes'], { code: 0, md: 40 })).toBe(false);
  });
});
