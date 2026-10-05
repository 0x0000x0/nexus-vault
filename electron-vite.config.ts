import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    build: { outDir: 'out/main', rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') } },
  },
  preload: {
    build: { outDir: 'out/preload', rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts'), output: { format: 'cjs', entryFileNames: '[name].js' } } },
  },
  renderer: {
    root: 'src/renderer',
    base: './',
    esbuild: { jsx: 'automatic' },
    define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.1') },
    build: { outDir: 'out/renderer', rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
  },
});
