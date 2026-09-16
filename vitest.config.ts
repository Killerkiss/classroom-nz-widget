import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const alias = {
  '@shared': resolve('src/shared'),
  '@main': resolve('src/main'),
  '@renderer': resolve('src/renderer/src'),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/unit/**/*.test.ts', 'src/{shared,main,preload}/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}', 'test/renderer/**/*.test.{ts,tsx}'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/shared/core/**'],
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
    },
  },
});
