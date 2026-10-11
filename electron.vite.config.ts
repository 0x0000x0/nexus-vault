import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    // 0.0.9: index-host = the index utilityProcess entry
    build: { outDir: 'out/main', rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), 'index-host': resolve(__dirname, 'src/main/index-host.ts') } } },
  },
  preload: {
    build: { outDir: 'out/preload', rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts'), output: { format: 'cjs', entryFileNames: '[name].js' } } },
  },
  renderer: {
    root: 'src/renderer',
    base: './',
    esbuild: { jsx: 'automatic' },
    build: { outDir: 'out/renderer', rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
  },
});
