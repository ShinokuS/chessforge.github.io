import type { WebSocket } from 'ws';
import { randomRoomCode, type WireClientMessage, type WireServerMessage } from './protocol.js';

type Seat = {
  ws: WebSocket;
  role: 'host' | 'guest';
};

type Room = {
  id: string;
  host: Seat | null;
  guest: Seat | null;
};

function send(ws: WebSocket, msg: WireServerMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(msg));
}

/**
 * Thin room relay: two sockets per room, opaque JSON forward.
 * No game logic — host client remains authoritative.
 */
export class RoomHub {
  private rooms = new Map<string, Room>();
  private bySocket = new Map<WebSocket, { roomId: string; role: 'host' | 'guest' }>();

  handle(ws: WebSocket, msg: WireClientMessage): void {
    if (msg.type === 'create') {
      this.create(ws);
      return;
    }
    if (msg.type === 'join') {
      this.join(ws, msg.roomId);
      return;
    }
    if (msg.type === 'forward') {
      this.forward(ws, msg.data);
      return;
    }
    send(ws, { type: 'error', message: 'Неизвестная команда' });
  }

  private create(ws: WebSocket): void {
    this.leave(ws);

    let roomId = '';
    for (let i = 0; i < 8; i++) {
      const id = randomRoomCode();
      if (!this.rooms.has(id)) {
        roomId = id;
        break;
      }
    }
    if (!roomId) {
      send(ws, { type: 'error', message: 'Не удалось создать комнату' });
      return;
    }

    const room: Room = { id: roomId, host: { ws, role: 'host' }, guest: null };
    this.rooms.set(roomId, room);
    this.bySocket.set(ws, { roomId, role: 'host' });
    send(ws, { type: 'created', roomId });
  }

  private join(ws: WebSocket, rawId: string): void {
    this.leave(ws);

    const roomId = rawId.trim().toLowerCase();
    const room = this.rooms.get(roomId);
    if (!room) {
      send(ws, { type: 'error', message: 'Комната не найдена' });
      return;
    }
    if (!room.host) {
      send(ws, { type: 'error', message: 'Хост ещё не в комнате' });
      return;
    }
    if (room.guest) {
      send(ws, { type: 'error', message: 'Комната уже занята' });
      return;
    }

    room.guest = { ws, role: 'guest' };
    this.bySocket.set(ws, { roomId, role: 'guest' });
    send(ws, { type: 'joined', roomId });
    send(room.host.ws, { type: 'ready' });
    send(ws, { type: 'ready' });
  }

  private forward(ws: WebSocket, data: unknown): void {
    const meta = this.bySocket.get(ws);
    if (!meta) {
      send(ws, { type: 'error', message: 'Сначала создайте или войдите в комнату' });
      return;
    }
    const room = this.rooms.get(meta.roomId);
    if (!room) {
      send(ws, { type: 'error', message: 'Комната закрыта' });
      return;
    }
    const peer = meta.role === 'host' ? room.guest : room.host;
    if (!peer) {
      send(ws, { type: 'error', message: 'Соперник ещё не подключён' });
      return;
    }
    send(peer.ws, { type: 'forward', data });
  }

  leave(ws: WebSocket): void {
    const meta = this.bySocket.get(ws);
    if (!meta) return;
    this.bySocket.delete(ws);

    const room = this.rooms.get(meta.roomId);
    if (!room) return;

    if (meta.role === 'host') {
      if (room.guest) {
        send(room.guest.ws, { type: 'peerLeft' });
        this.bySocket.delete(room.guest.ws);
      }
      this.rooms.delete(meta.roomId);
      return;
    }

    room.guest = null;
    if (room.host) {
      send(room.host.ws, { type: 'peerLeft' });
    }
  }
}
