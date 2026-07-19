import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@chessforge/engine': path.resolve(root, '../engine/src/index.ts'),
      '@chessforge/ai': path.resolve(root, '../ai/src/index.ts'),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
