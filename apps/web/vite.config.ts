import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Aliases straight to engine source (not dist) so editing the engine during
// development hot-reloads immediately with no separate build step.
//
// base is set only for production builds: the app deploys to
// zbcad.com/zones/, so built asset URLs need that subpath, but dev server
// URLs should stay at the root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/zones/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@zones/engine': path.resolve(import.meta.dirname, '../../packages/engine/src/index.ts'),
    },
  },
}));
