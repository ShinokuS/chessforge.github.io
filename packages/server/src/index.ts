import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { WireClientMessage } from './protocol.js';
import { RoomHub } from './rooms.js';

const PORT = Number(process.env.PORT ?? 8787);
const hub = new RoomHub();

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ok\n');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Chessforge relay\n');
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (raw) => {
    let msg: WireClientMessage;
    try {
      msg = JSON.parse(String(raw)) as WireClientMessage;
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Некорректное сообщение' }));
      return;
    }
    hub.handle(ws, msg);
  });

  ws.on('close', () => {
    hub.leave(ws);
  });
});

server.listen(PORT, () => {
  console.log(`[chessforge-relay] ws://localhost:${PORT}/ws`);
});
