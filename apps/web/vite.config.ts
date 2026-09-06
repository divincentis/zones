import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Aliases straight to engine source (not dist) so editing the engine during
// development hot-reloads immediately with no separate build step.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@zones/engine': path.resolve(import.meta.dirname, '../../packages/engine/src/index.ts'),
    },
  },
});
