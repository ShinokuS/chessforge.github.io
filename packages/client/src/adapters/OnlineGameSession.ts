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
import {
  HEARTBEAT_MS,
  HEARTBEAT_TIMEOUT_MS,
  JOIN_TIMEOUT_MS,
  RECONNECT_ATTEMPTS,
  RECONNECT_BASE_DELAY_MS,
  peerClientOptions,
} from '../online/peerConfig';

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
  id: string;
  disconnected: boolean;
  destroyed: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, cb: (...args: any[]) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off?(event: string, cb: (...args: any[]) => void): void;
  connect(id: string, options?: { reliable?: boolean; serialization?: string }): DataConn;
  reconnect(): void;
  destroy(): void;
};

type DataConn = {
  open: boolean;
  peer: string;
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * P2P online session via PeerJS.
 * Host is authoritative. Includes TURN, signaling reconnect, heartbeat and resync.
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
  private guestPlacements: FormationPlacement[] | null = null;
  private isHost = false;
  private intentionalLeave = false;
  private reconnecting = false;
  private matchStarted = false;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastPongAt = 0;
  private PeerCtor: PeerCtor | null = null;

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
    this.stopHeartbeat();
    this.lastError = message;
    this.setStatus('error');
    this.emit([]);
  }

  private trySend(msg: PeerMessage): boolean {
    if (!this.conn?.open) return false;
    try {
      this.conn.send(msg);
      return true;
    } catch {
      return false;
    }
  }

  private send(msg: PeerMessage): void {
    if (!this.trySend(msg)) {
      if (this.status === 'playing' || this.status === 'reconnecting') {
        void this.beginReconnect('Нет соединения с соперником — переподключение…');
        return;
      }
      this.fail('Нет соединения с соперником');
    }
  }

  private guestColor(): PlayerId {
    return this.myColor === 'white' ? 'black' : 'white';
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastPongAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (this.intentionalLeave || this.reconnecting) return;
      if (this.status !== 'playing' && this.status !== 'waiting') return;
      if (!this.conn?.open) {
        void this.beginReconnect('Канал закрыт — переподключение…');
        return;
      }
      if (Date.now() - this.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
        void this.beginReconnect('Связь потеряна — переподключение…');
        return;
      }
      this.trySend({ type: 'ping', t: Date.now() });
    }, HEARTBEAT_MS);
  }

  private bindPeerLifecycle(peer: PeerInstance): void {
    peer.on('disconnected', () => {
      if (this.intentionalLeave || peer.destroyed) return;
      if (this.status === 'idle' || this.status === 'error') return;
      this.lastError = 'Сигнальный сервер недоступен — переподключение…';
      this.setStatus(
        this.status === 'waiting' || this.status === 'playing' || this.status === 'reconnecting'
          ? 'reconnecting'
          : this.status,
      );
      this.emit([]);
      try {
        peer.reconnect();
      } catch {
        void this.beginReconnect('Не удалось восстановить сигнал');
      }
    });

    peer.on('error', (err: unknown) => {
      if (this.intentionalLeave) return;
      const msg =
        err && typeof err === 'object' && 'type' in err
          ? String((err as { type: string }).type)
          : '';
      // peer-unavailable etc. during reconnect — handled by retry loop
      if (msg === 'peer-unavailable' || msg === 'network' || msg === 'server-error') {
        if (this.status === 'playing' || this.status === 'reconnecting' || this.status === 'waiting') {
          void this.beginReconnect('Сбой сети — переподключение…');
          return;
        }
      }
    });
  }

  private bindConnection(conn: DataConn): void {
    this.conn = conn;
    conn.on('data', (raw: unknown) => {
      this.onPeerMessage(raw as PeerMessage);
    });
    conn.on('close', () => {
      if (this.intentionalLeave) return;
      if (this.conn !== conn) return;
      if (this.status === 'playing' || this.status === 'waiting' || this.status === 'reconnecting') {
        void this.beginReconnect('Соединение оборвалось — переподключение…');
      }
    });
    conn.on('error', () => {
      if (this.intentionalLeave) return;
      if (this.status === 'playing' || this.status === 'waiting') {
        void this.beginReconnect('Ошибка канала — переподключение…');
      }
    });
    this.startHeartbeat();
  }

  private cloneState(state: MatchState): MatchState {
    return structuredClone(state);
  }

  private sendResync(): void {
    if (!this.isHost || !this.roomId || !this.myColor) return;
    this.trySend({
      type: 'resync',
      roomId: this.roomId,
      state: this.cloneState(this.state),
      clockMs: this.matchClockMs,
      yourColor: this.guestColor(),
    });
  }

  private onPeerMessage(msg: PeerMessage): void {
    if (msg.type === 'ping') {
      this.trySend({ type: 'pong', t: msg.t });
      return;
    }
    if (msg.type === 'pong') {
      this.lastPongAt = Date.now();
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

      if (this.matchStarted) {
        // Late hello while match already running → treat as rejoin
        this.guestPlacements = msg.placements;
        this.sendResync();
        this.lastError = null;
        this.setStatus('playing');
        this.emit([]);
        return;
      }

      const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
      const hostColor = this.hostColor;
      const guestColor: PlayerId = hostColor === 'white' ? 'black' : 'white';
      const white =
        hostColor === 'white' ? this.hostPlacements : msg.placements;
      const black =
        hostColor === 'white' ? msg.placements : this.hostPlacements;

      this.guestPlacements = msg.placements;
      this.state = createMatchFromPlacements(white, black, seed);
      this.myColor = hostColor;
      this.matchStarted = true;
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

    if (msg.type === 'guestRejoin' && this.isHost) {
      if (!this.matchStarted) return;
      this.sendResync();
      this.lastError = null;
      if (this.status === 'reconnecting') this.setStatus('playing');
      this.emit([]);
      return;
    }

    if (msg.type === 'matchStart' && !this.isHost) {
      this.roomId = msg.roomId;
      this.myColor = msg.yourColor;
      this.matchClockMs = msg.clockMs > 0 ? msg.clockMs : INITIAL_CLOCK_MS;
      this.state = createMatchFromPlacements(msg.white, msg.black, msg.seed);
      this.matchStarted = true;
      this.reconnecting = false;
      this.lastError = null;
      this.setStatus('playing');
      this.emit([]);
      return;
    }

    if (msg.type === 'resync' && !this.isHost) {
      this.roomId = msg.roomId;
      this.myColor = msg.yourColor;
      this.matchClockMs = msg.clockMs > 0 ? msg.clockMs : INITIAL_CLOCK_MS;
      this.state = this.cloneState(msg.state);
      this.matchStarted = true;
      this.reconnecting = false;
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
      this.intentionalLeave = true;
      this.stopHeartbeat();
      this.lastError = 'Соперник покинул комнату';
      this.setStatus('disconnected');
      this.emit([]);
    }
  }

  private closeConnOnly(): void {
    this.stopHeartbeat();
    try {
      this.conn?.close();
    } catch {
      /* ignore */
    }
    this.conn = null;
  }

  private destroyPeer(): void {
    this.stopHeartbeat();
    this.closeConnOnly();
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    this.peer = null;
  }

  private async ensurePeerCtor(): Promise<PeerCtor> {
    if (this.PeerCtor) return this.PeerCtor;
    this.PeerCtor = await loadPeer();
    return this.PeerCtor;
  }

  private async beginReconnect(reason: string): Promise<void> {
    if (this.intentionalLeave || this.reconnecting) return;
    if (this.status === 'idle' || this.status === 'error' || this.status === 'disconnected') {
      return;
    }
    // Waiting host: keep peer alive, only refresh signaling
    if (this.isHost && this.status === 'waiting' && this.peer && !this.peer.destroyed) {
      this.lastError = reason;
      this.setStatus('reconnecting');
      this.emit([]);
      try {
        if (this.peer.disconnected) this.peer.reconnect();
      } catch {
        /* ignore */
      }
      // Host waiting doesn't need data conn yet
      setTimeout(() => {
        if (this.intentionalLeave) return;
        if (this.status === 'reconnecting' && this.isHost && !this.matchStarted) {
          this.lastError = null;
          this.setStatus('waiting');
          this.emit([]);
        }
      }, 2_000);
      return;
    }

    this.reconnecting = true;
    this.lastError = reason;
    this.setStatus('reconnecting');
    this.emit([]);
    this.closeConnOnly();

    for (let attempt = 0; attempt < RECONNECT_ATTEMPTS; attempt++) {
      if (this.intentionalLeave) return;
      const delay = RECONNECT_BASE_DELAY_MS * Math.pow(1.5, attempt);
      await sleep(delay);
      if (this.intentionalLeave) return;

      try {
        if (this.isHost) {
          await this.reconnectAsHost();
        } else {
          await this.reconnectAsGuest();
        }
        this.reconnecting = false;
        this.lastError = null;
        this.setStatus(this.matchStarted ? 'playing' : 'waiting');
        this.emit([]);
        return;
      } catch {
        // try again
      }
    }

    this.reconnecting = false;
    this.lastError = 'Не удалось восстановить соединение. Выйдите и зайдите снова.';
    this.setStatus('disconnected');
    this.emit([]);
  }

  private async reconnectAsHost(): Promise<void> {
    if (!this.roomId || !this.hostPlacements) {
      throw new Error('no room');
    }
    const Peer = await this.ensurePeerCtor();

    // Prefer signaling reconnect on same peer id (room code)
    if (this.peer && !this.peer.destroyed) {
      if (this.peer.disconnected) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('signal timeout')), 10_000);
          const onOpen = () => {
            clearTimeout(t);
            resolve();
          };
          this.peer!.on('open', onOpen);
          try {
            this.peer!.reconnect();
          } catch (e) {
            clearTimeout(t);
            reject(e);
          }
        });
      }
      // Wait for guest to connect again — host connection handler already set
      // If we already have open conn, done
      if (this.conn?.open) return;

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('guest timeout')), 12_000);
        const check = setInterval(() => {
          if (this.conn?.open) {
            clearInterval(check);
            clearTimeout(t);
            if (this.matchStarted) this.sendResync();
            resolve();
          }
        }, 200);
      });
      return;
    }

    // Recreate peer with same room id
    const peer = new Peer(peerIdForRoom(this.roomId), peerClientOptions());
    this.peer = peer;
    this.bindPeerLifecycle(peer);

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('open timeout')), 12_000);
      peer.on('open', () => {
        clearTimeout(t);
        resolve();
      });
      peer.on('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });

    peer.on('connection', (conn) => {
      if (this.conn?.open) {
        // Replace stale connection
        try {
          this.conn.close();
        } catch {
          /* ignore */
        }
      }
      this.bindConnection(conn);
      conn.on('open', () => {
        if (this.matchStarted) this.sendResync();
      });
    });

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('guest timeout')), 15_000);
      const check = setInterval(() => {
        if (this.conn?.open) {
          clearInterval(check);
          clearTimeout(t);
          resolve();
        }
      }, 200);
    });
  }

  private async reconnectAsGuest(): Promise<void> {
    if (!this.roomId || !this.guestPlacements) {
      throw new Error('no room');
    }
    const Peer = await this.ensurePeerCtor();
    this.destroyPeer();

    const peer = new Peer(peerClientOptions());
    this.peer = peer;
    this.bindPeerLifecycle(peer);

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('open timeout')), 12_000);
      peer.on('open', () => {
        clearTimeout(t);
        resolve();
      });
      peer.on('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });

    const conn = peer.connect(peerIdForRoom(this.roomId), {
      reliable: true,
      serialization: 'json',
    });
    this.bindConnection(conn);

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('connect timeout')), JOIN_TIMEOUT_MS);
      conn.on('open', () => {
        clearTimeout(t);
        resolve();
      });
      conn.on('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });

    if (this.matchStarted) {
      this.send({ type: 'guestRejoin' });
      // Wait briefly for resync
      await sleep(500);
    } else {
      this.send({ type: 'guestHello', placements: this.guestPlacements });
    }
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
    this.intentionalLeave = false;
    this.isHost = true;
    this.hostPlacements = placements;
    this.guestPlacements = null;
    this.hostSide = options.side;
    this.hostColor = resolveSide(options.side);
    this.matchClockMs = options.clockMs > 0 ? options.clockMs : INITIAL_CLOCK_MS;
    this.myColor = this.hostColor;
    this.matchStarted = false;
    this.setStatus('connecting');

    let Peer: PeerCtor;
    try {
      Peer = await this.ensurePeerCtor();
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Не удалось загрузить PeerJS');
      return;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      const roomId = randomRoomCode();
      const peer = new Peer(peerIdForRoom(roomId), peerClientOptions());
      this.peer = peer;
      this.bindPeerLifecycle(peer);

      try {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('Таймаут сигнального сервера')), 15_000);
          peer.on('open', () => {
            clearTimeout(t);
            resolve();
          });
          peer.on('error', (e) => {
            clearTimeout(t);
            reject(e);
          });
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
          if (this.conn?.open && this.conn !== conn) {
            try {
              this.conn.close();
            } catch {
              /* ignore */
            }
          }
          this.bindConnection(conn);
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
    this.intentionalLeave = false;
    this.isHost = false;
    this.hostPlacements = null;
    this.guestPlacements = placements;
    this.myColor = null;
    this.roomId = code;
    this.matchStarted = false;
    this.setStatus('connecting');

    let Peer: PeerCtor;
    try {
      Peer = await this.ensurePeerCtor();
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Не удалось загрузить PeerJS');
      return;
    }

    const peer = new Peer(peerClientOptions());
    this.peer = peer;
    this.bindPeerLifecycle(peer);

    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Таймаут сигнального сервера')), 15_000);
        peer.on('open', () => {
          clearTimeout(t);
          resolve();
        });
        peer.on('error', (e) => {
          clearTimeout(t);
          reject(e);
        });
      });
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Не удалось подключиться');
      return;
    }

    const conn = peer.connect(peerIdForRoom(code), {
      reliable: true,
      serialization: 'json',
    });
    this.bindConnection(conn);

    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          reject(new Error('Комната не отвечает. Проверьте код и что хост ещё ждёт.'));
        }, JOIN_TIMEOUT_MS);
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
    if (this.status === 'reconnecting') {
      this.lastError = 'Переподключение… подождите';
      this.emit([]);
      return false;
    }
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
    this.intentionalLeave = true;
    this.reconnecting = false;
    this.matchStarted = false;
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
    this.guestPlacements = null;
    this.isHost = false;
    this.hostSide = 'white';
    this.hostColor = 'white';
    this.matchClockMs = INITIAL_CLOCK_MS;
    this.state = createDemoMatch();
    this.lastError = null;
    this.setStatus('idle');
  }
}
