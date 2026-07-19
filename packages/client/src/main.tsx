import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './app/ErrorBoundary';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

function showBootError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[Chessforge boot]', err);
  root!.innerHTML = `<div style="margin:2rem;font-family:system-ui;color:#e8edd8;max-width:36rem">
    <h1 style="font-size:1.25rem">Не удалось запустить Chessforge</h1>
    <p style="opacity:.85">${message}</p>
    <p style="opacity:.7;font-size:.9rem">Откройте консоль (F12) и проверьте, что запущен <code>pnpm dev</code> по адресу <code>http://localhost:5173/</code>.</p>
  </div>`;
}

async function boot(): Promise<void> {
  const { App } = await import('./app/App');
  createRoot(root!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}

boot().catch(showBootError);
