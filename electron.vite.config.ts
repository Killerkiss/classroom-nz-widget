import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const shared = resolve('src/shared');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': shared, '@main': resolve('src/main') },
    },
    build: {
      rollupOptions: { input: { index: resolve('src/main/index.ts') } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': shared },
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        // A sandboxed preload must be CommonJS — Electron does not load an ES
        // module preload when sandbox is enabled, and the bridge silently never
        // runs, leaving window.api undefined.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: {
      alias: { '@shared': shared, '@renderer': resolve('src/renderer/src') },
    },
    build: {
      rollupOptions: {
        input: {
          // Two entry points: the always-on-top widget, and a normal settings window.
          index: resolve('src/renderer/index.html'),
          settings: resolve('src/renderer/settings.html'),
        },
      },
    },
  },
});
