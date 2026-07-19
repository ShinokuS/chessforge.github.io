import type { DataConnection } from 'peerjs';
import {
  applyCommand,
  createDemoMatch,
  createMatchFromPlacements,
  getLegalMoves,
  type FormationPlacement,
  type GameCommand,
  type GameEvent,
  type MatchState,
  type PlayerId,
} from '@chessforge/engine';
import type { GameSessionListener } from './GameSession';
import {
  buildInviteUrl,
  peerIdForRoom,
  randomRoomCode,
  type PeerMessage,
} from '../online/protocol';
import { validatePlacements } from '../online/validate';

export type OnlineStatus =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'playing'
  | 'disconnected'
  | 'error';

type PeerCtor = typeof import('peerjs').Peer;
type PeerInstance = InstanceType<PeerCtor>;

async function loadPeer(): Promise<PeerCtor> {
  const mod = await import('peerjs');
  if (typeof mod.Peer === 'function') return mod.Peer;
  const d = mod.default as unknown;
  if (typeof d === 'function') return d as PeerCtor;
  if (
    d &&
    typeof d === 'object' &&
    typeof (d as { Peer?: PeerCtor }).Peer === 'function'
  ) {
    return (d as { Peer: PeerCtor }).Peer;
  }
  throw new Error('PeerJS не загрузился');
}

/**
 * P2P online session via PeerJS (works on GitHub Pages — no game server).
 * Host (white) is authoritative for match state and command validation.
 * PeerJS is lazy-loaded so the main app boots without it.
 */
export class OnlineGameSession {
  private state: MatchState = createDemoMatch();
  private listeners = new Set<GameSessionListener>();
  private lastError: string | null = null;
  private status: OnlineStatus = 'idle';
  private roomId: string | null = null;
  private myColor: PlayerId | null = null;
  private statusListeners = new Set<() => void>();

  private peer: PeerInstance | null = null;
  private conn: DataConnection | null = null;
  private hostPlacements: FormationPlacement[] | null = null;
  private isHost = false;

  getState(): MatchState {
    return this.state;
  }

  getStatus(): OnlineStatus {
    return this.status;
  }

  getRoomId(): string | null {
    return this.roomId;
  }

  getMyColor(): PlayerId | null {
    return this.myColor;
  }

  getInviteUrl(): string | null {
    if (!this.roomId) return null;
    return buildInviteUrl(this.roomId);
  }

  getLegalMovesFrom(from: { x: number; y: number }) {
    return getLegalMoves(this.state, from);
  }

  subscribe(listener: GameSessionListener): () => void {
    this.listeners.add(listener);
    listener({ state: this.state, events: [], lastError: this.lastError });
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    listener();
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private emitStatus(): void {
    for (const l of this.statusListeners) l();
  }

  private setStatus(status: OnlineStatus): void {
    this.status = status;
    this.emitStatus();
  }

  private emit(events: GameEvent[]): void {
    for (const l of this.listeners) {
      l({ state: this.state, events, lastError: this.lastError });
    }
  }

  private fail(message: string): void {
    this.lastError = message;
    this.setStatus('error');
    this.emit([]);
  }

  private send(msg: PeerMessage): void {
    if (!this.conn?.open) {
      this.fail('Нет соединения с соперником');
      return;
    }
    this.conn.send(msg);
  }

  private bindConnection(conn: DataConnection): void {
    this.conn = conn;
    conn.on('data', (raw) => {
      this.onPeerMessage(raw as PeerMessage);
    });
    conn.on('close', () => {
      if (this.status === 'playing' || this.status === 'waiting') {
        this.lastError = 'Соперник отключился';
        this.setStatus('disconnected');
        this.emit([]);
      }
    });
    conn.on('error', () => {
      this.fail('Ошибка канала связи');
    });
  }

  private onPeerMessage(msg: PeerMessage): void {
    if (msg.type === 'error') {
      this.lastError = msg.message;
      this.emit([]);
      return;
    }

    if (msg.type === 'guestHello' && this.isHost) {
      const err = validatePlacements(msg.placements);
      if (err) {
        this.send({ type: 'error', message: err });
        return;
      }
      if (!this.hostPlacements || !this.roomId) return;
      const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
      this.state = createMatchFromPlacements(this.hostPlacements, msg.placements, seed);
      this.myColor = 'white';
      this.lastError = null;
      this.setStatus('playing');
      this.send({
        type: 'matchStart',
        roomId: this.roomId,
        seed,
        white: this.hostPlacements,
        black: msg.placements,
      });
      this.emit([]);
      return;
    }

    if (msg.type === 'matchStart' && !this.isHost) {
      this.roomId = msg.roomId;
      this.myColor = 'black';
      this.state = createMatchFromPlacements(msg.white, msg.black, msg.seed);
      this.lastError = null;
      this.setStatus('playing');
      this.emit([]);
      return;
    }

    if (msg.type === 'commandRequest' && this.isHost) {
      if (this.state.phase !== 'play' || this.state.activePlayer !== 'black') {
        this.send({ type: 'error', message: 'Сейчас не ваш ход' });
        return;
      }
      const result = applyCommand(this.state, msg.command);
      if (!result.ok) {
        this.send({ type: 'error', message: result.message });
        return;
      }
      this.state = result.state;
      this.lastError = null;
      this.send({ type: 'command', command: msg.command, by: 'black' });
      this.emit(result.events);
      return;
    }

    if (msg.type === 'command') {
      if (this.isHost && msg.by === 'white') return;
      if (this.isHost && msg.by === 'black') return;
      const result = applyCommand(this.state, msg.command);
      if (!result.ok) {
        this.lastError = result.message;
        this.emit([]);
        return;
      }
      this.lastError = null;
      this.state = result.state;
      this.emit(result.events);
      return;
    }

    if (msg.type === 'opponentLeft') {
      this.lastError = 'Соперник покинул комнату';
      this.setStatus('disconnected');
      this.emit([]);
    }
  }

  private destroyPeer(): void {
    try {
      this.conn?.close();
    } catch {
      /* ignore */
    }
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    this.conn = null;
    this.peer = null;
  }

  async createRoom(placements: FormationPlacement[]): Promise<void> {
    const err = validatePlacements(placements);
    if (err) {
      this.fail(err);
      return;
    }

    this.disconnect();
    this.isHost = true;
    this.hostPlacements = placements;
    this.myColor = 'white';
    this.setStatus('connecting');

    let Peer: PeerCtor;
    try {
      Peer = await loadPeer();
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Не удалось загрузить PeerJS');
      return;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      const roomId = randomRoomCode();
      const peer = new Peer(peerIdForRoom(roomId), { debug: 0 });
      this.peer = peer;

      try {
        await new Promise<void>((resolve, reject) => {
          peer.on('open', () => resolve());
          peer.on('error', (e) => reject(e));
        });

        this.roomId = roomId;
        this.setStatus('waiting');
        this.lastError = null;
        this.emit([]);

        peer.on('connection', (conn) => {
          if (this.conn?.open) {
            conn.close();
            return;
          }
          this.bindConnection(conn);
        });

        peer.on('disconnected', () => {
          if (this.status === 'waiting' || this.status === 'playing') {
            this.lastError = 'Потеряно соединение с сетью PeerJS';
            this.setStatus('disconnected');
            this.emit([]);
          }
        });
        return;
      } catch (e) {
        lastError = e;
        try {
          peer.destroy();
        } catch {
          /* ignore */
        }
        this.peer = null;
      }
    }

    this.fail(
      lastError instanceof Error
        ? lastError.message
        : 'Не удалось создать комнату. Попробуйте ещё раз.',
    );
  }

  async joinRoom(roomId: string, placements: FormationPlacement[]): Promise<void> {
    const err = validatePlacements(placements);
    if (err) {
      this.fail(err);
      return;
    }

    const code = roomId.trim().toLowerCase();
    if (!code) {
      this.fail('Укажите код комнаты');
      return;
    }

    this.disconnect();
    this.isHost = false;
    this.hostPlacements = null;
    this.myColor = 'black';
    this.roomId = code;
    this.setStatus('connecting');

    let Peer: PeerCtor;
    try {
      Peer = await loadPeer();
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Не удалось загрузить PeerJS');
      return;
    }

    const peer = new Peer({ debug: 0 });
    this.peer = peer;

    try {
      await new Promise<void>((resolve, reject) => {
        peer.on('open', () => resolve());
        peer.on('error', (e) => reject(e));
      });
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Не удалось подключиться');
      return;
    }

    const conn = peer.connect(peerIdForRoom(code), { reliable: true });
    this.bindConnection(conn);

    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          reject(new Error('Комната не отвечает. Проверьте код и что хост ещё ждёт.'));
        }, 15_000);
        conn.on('open', () => {
          clearTimeout(t);
          resolve();
        });
        conn.on('error', (e) => {
          clearTimeout(t);
          reject(e);
        });
      });
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Не удалось войти в комнату');
      return;
    }

    this.send({ type: 'guestHello', placements });
  }

  submitCommand(command: GameCommand): boolean {
    if (this.status !== 'playing' || !this.myColor) {
      this.lastError = 'Матч не активен';
      this.emit([]);
      return false;
    }
    if (this.state.activePlayer !== this.myColor) {
      this.lastError = 'Сейчас ход соперника';
      this.emit([]);
      return false;
    }

    if (this.isHost) {
      const result = applyCommand(this.state, command);
      if (!result.ok) {
        this.lastError = result.message;
        this.emit([]);
        return false;
      }
      this.state = result.state;
      this.lastError = null;
      this.send({ type: 'command', command, by: 'white' });
      this.emit(result.events);
      return true;
    }

    this.send({ type: 'commandRequest', command });
    return true;
  }

  disconnect(): void {
    if (this.conn?.open) {
      try {
        this.conn.send({ type: 'opponentLeft' } satisfies PeerMessage);
      } catch {
        /* ignore */
      }
    }
    this.destroyPeer();
    this.roomId = null;
    this.myColor = null;
    this.hostPlacements = null;
    this.isHost = false;
    this.state = createDemoMatch();
    this.lastError = null;
    this.setStatus('idle');
  }
}
