import {
  applyCommand,
  classicBasePlacements,
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
  peerIdForRoom,
  randomRoomCode,
  type PeerMessage,
} from '../online/protocol';
import { validatePlacements } from '../online/validate';
import { resolveSide, type SidePreference } from '../battle/settings';
import { INITIAL_CLOCK_MS } from '../battle/clock';

export type OnlineStatus =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'playing'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export type CreateRoomOptions = {
  clockMs: number;
  side: SidePreference;
};

type PeerCtor = new (...args: any[]) => PeerInstance;

type PeerInstance = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, cb: (...args: any[]) => void): void;
  connect(id: string, options?: { reliable?: boolean }): DataConn;
  destroy(): void;
};

type DataConn = {
  open: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, cb: (...args: any[]) => void): void;
  send(data: unknown): void;
  close(): void;
};

async function loadPeer(): Promise<PeerCtor> {
  const mod = await import('peerjs');
  if (typeof mod.Peer === 'function') return mod.Peer as unknown as PeerCtor;
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
 * P2P online session via PeerJS (default cloud ICE — most reliable for VPN).
 * Host is authoritative regardless of board color.
 */
export class OnlineGameSession {
  private state: MatchState = createDemoMatch();
  private listeners = new Set<GameSessionListener>();
  private lastError: string | null = null;
  private status: OnlineStatus = 'idle';
  private roomId: string | null = null;
  private myColor: PlayerId | null = null;
  private statusListeners = new Set<() => void>();
  private matchClockMs = INITIAL_CLOCK_MS;
  private hostSide: SidePreference = 'white';
  private hostColor: PlayerId = 'white';

  private peer: PeerInstance | null = null;
  private conn: DataConn | null = null;
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

  getMatchClockMs(): number {
    return this.matchClockMs;
  }

  getHostSidePreference(): SidePreference {
    return this.hostSide;
  }

  getLegalMovesFrom(from: { x: number; y: number }) {
    if (this.status !== 'playing') return [];
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

  private guestColor(): PlayerId {
    return this.myColor === 'white' ? 'black' : 'white';
  }

  private bindConnection(conn: DataConn): void {
    this.conn = conn;
    conn.on('data', (raw: unknown) => {
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
    if (msg.type === 'ping' || msg.type === 'pong' || msg.type === 'guestRejoin' || msg.type === 'resync') {
      // Legacy/ignored — kept for protocol compat with older tabs
      return;
    }

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
      const hostColor = this.hostColor;
      const guestColor: PlayerId = hostColor === 'white' ? 'black' : 'white';
      const white =
        hostColor === 'white' ? this.hostPlacements : msg.placements;
      const black =
        hostColor === 'white' ? msg.placements : this.hostPlacements;

      this.state = createMatchFromPlacements(white, black, seed);
      this.myColor = hostColor;
      this.lastError = null;
      this.setStatus('playing');
      this.send({
        type: 'matchStart',
        roomId: this.roomId,
        seed,
        white,
        black,
        clockMs: this.matchClockMs,
        yourColor: guestColor,
      });
      this.emit([]);
      return;
    }

    if (msg.type === 'matchStart' && !this.isHost) {
      this.roomId = msg.roomId;
      this.myColor = msg.yourColor;
      this.matchClockMs = msg.clockMs > 0 ? msg.clockMs : INITIAL_CLOCK_MS;
      this.state = createMatchFromPlacements(msg.white, msg.black, msg.seed);
      this.lastError = null;
      this.setStatus('playing');
      this.emit([]);
      return;
    }

    if (msg.type === 'commandRequest' && this.isHost) {
      if (this.status !== 'playing' || !this.myColor) return;
      const guest = this.guestColor();
      if (this.state.phase !== 'play' || this.state.activePlayer !== guest) {
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
      this.send({ type: 'command', command: msg.command, by: guest });
      this.emit(result.events);
      return;
    }

    if (msg.type === 'command') {
      if (this.isHost) return;
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

  async createRoom(
    placements: FormationPlacement[],
    options: CreateRoomOptions,
  ): Promise<void> {
    const err = validatePlacements(placements);
    if (err) {
      this.fail(err);
      return;
    }

    this.disconnect();
    this.isHost = true;
    this.hostPlacements = placements;
    this.hostSide = options.side;
    this.hostColor = resolveSide(options.side);
    this.matchClockMs = options.clockMs > 0 ? options.clockMs : INITIAL_CLOCK_MS;
    this.myColor = this.hostColor;
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
      // Default PeerJS options only — custom TURN/heartbeat made VPN worse
      const peer = new Peer(peerIdForRoom(roomId), { debug: 0 });
      this.peer = peer;

      try {
        await new Promise<void>((resolve, reject) => {
          peer.on('open', () => resolve());
          peer.on('error', (e) => reject(e));
        });

        this.roomId = roomId;
        const previewWhite =
          this.hostColor === 'black' ? classicBasePlacements() : placements;
        const previewBlack =
          this.hostColor === 'black' ? placements : classicBasePlacements();
        this.state = createMatchFromPlacements(
          previewWhite,
          previewBlack,
          (Date.now() >>> 0) || 1,
        );
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
    this.myColor = null;
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
      this.send({ type: 'command', command, by: this.myColor });
      this.emit(result.events);
      return true;
    }

    this.send({ type: 'commandRequest', command });
    return true;
  }

  endByTimeout(winner: PlayerId): void {
    if (this.status !== 'playing' || this.state.phase !== 'play') return;
    this.state = { ...this.state, phase: 'gameOver', winner };
    this.lastError = null;
    this.emit([]);
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
    this.hostSide = 'white';
    this.hostColor = 'white';
    this.matchClockMs = INITIAL_CLOCK_MS;
    this.state = createDemoMatch();
    this.lastError = null;
    this.setStatus('idle');
  }
}
