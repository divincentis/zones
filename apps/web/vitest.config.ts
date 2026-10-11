import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Separate from vite.config.ts on purpose: the suites here cover the pure
// modules under src/lib (no JSX, no DOM), so they need the engine alias and
// nothing else — in particular not the React plugin, which targets the app's
// own newer Vite rather than the one Vitest runs on.
export default defineConfig({
  resolve: {
    alias: {
      '@zones/engine': path.resolve(import.meta.dirname, '../../packages/engine/src/index.ts'),
    },
  },
  test: { include: ['test/**/*.test.ts'] },
});
