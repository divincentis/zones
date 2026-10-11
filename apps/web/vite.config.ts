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
  build: {
    // The entry files keep fixed names — index.js, index.css — so index.html
    // never changes and a deploy is always "the same three files, newer".
    // Chunks loaded later (the 3D view, the PDF writer) are hashed instead:
    // they are fetched by an index.js that may be a few minutes older or
    // newer than the copy of the chunk a browser has cached, and under a
    // fixed name the two could be from different builds. A hashed name can
    // only ever be the chunk that index.js was built with.
    // scripts/deploy.sh rsyncs with --delete, so old hashes do not pile up.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
}));
