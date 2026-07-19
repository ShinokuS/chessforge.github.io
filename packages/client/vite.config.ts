import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => {
  // Local dev: `/`. Pages CI sets VITE_BASE=/<repo>/
  const base = command === 'serve' ? '/' : process.env.VITE_BASE || '/';

  return {
    base,
    plugins: [react()],
    resolve: {
      alias: {
        '@chessforge/engine': path.resolve(root, '../engine/src/index.ts'),
        '@chessforge/ai': path.resolve(root, '../ai/src/index.ts'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
