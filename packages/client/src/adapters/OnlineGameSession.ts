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
  resolveRelayUrl,
  type PeerMessage,
  type WireClientMessage,
  type WireServerMessage,
} from '../online/protocol';
import { validatePlacements } from '../online/validate';
import { resolveSide, type SidePreference } from '../battle/settings';
import { INITIAL_CLOCK_MS } from '../battle/clock';

export type OnlineStatus =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'playing'
  | 'disconnected'
  | 'error';

export type CreateRoomOptions = {
  clockMs: number;
  side: SidePreference;
};

/**
 * Online session over a WebSocket room relay (VPN-friendly).
 * Host browser remains authoritative for match state.
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

  private ws: WebSocket | null = null;
  private hostPlacements: FormationPlacement[] | null = null;
  private isHost = false;
  private peerReady = false;

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

  private wireSend(msg: WireClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.fail('Нет соединения с сервером');
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  private send(msg: PeerMessage): void {
    if (!this.peerReady && msg.type !== 'guestHello') {
      // guestHello is sent right after ready; other msgs need peer
    }
    this.wireSend({ type: 'forward', data: msg });
  }

  private guestColor(): PlayerId {
    return this.myColor === 'white' ? 'black' : 'white';
  }

  private closeSocket(): void {
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
    this.peerReady = false;
  }

  private connectSocket(): Promise<void> {
    const url = resolveRelayUrl();
    if (!url) {
      return Promise.reject(
        new Error(
          'Онлайн-сервер не настроен. Для GitHub Pages задайте VITE_WS_URL=wss://…/ws',
        ),
      );
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const t = window.setTimeout(() => {
        reject(new Error('Таймаут подключения к серверу'));
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }, 12_000);

      ws.onopen = () => {
        window.clearTimeout(t);
        resolve();
      };
      ws.onerror = () => {
        window.clearTimeout(t);
        reject(new Error('Не удалось подключиться к серверу'));
      };
      ws.onmessage = (ev) => {
        this.onWireMessage(ev.data);
      };
      ws.onclose = () => {
        if (this.status === 'waiting' || this.status === 'playing' || this.status === 'connecting') {
          this.lastError = 'Соединение с сервером потеряно';
          this.setStatus('disconnected');
          this.emit([]);
        }
      };
    });
  }

  private onWireMessage(raw: unknown): void {
    let msg: WireServerMessage;
    try {
      msg = JSON.parse(String(raw)) as WireServerMessage;
    } catch {
      return;
    }

    if (msg.type === 'error') {
      this.lastError = msg.message;
      this.setStatus('error');
      this.emit([]);
      return;
    }

    if (msg.type === 'created') {
      this.roomId = msg.roomId;
      return;
    }

    if (msg.type === 'joined') {
      this.roomId = msg.roomId;
      return;
    }

    if (msg.type === 'ready') {
      this.peerReady = true;
      this.lastError = null;
      if (this.isHost) {
        // stay waiting until guestHello → matchStart
        this.emitStatus();
      }
      return;
    }

    if (msg.type === 'peerLeft') {
      this.peerReady = false;
      this.lastError = 'Соперник отключился';
      this.setStatus('disconnected');
      this.emit([]);
      return;
    }

    if (msg.type === 'forward') {
      this.onPeerMessage(msg.data);
    }
  }

  private onPeerMessage(msg: PeerMessage): void {
    if (msg.type === 'ping' || msg.type === 'pong' || msg.type === 'guestRejoin' || msg.type === 'resync') {
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

    try {
      await this.connectSocket();
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Не удалось подключиться');
      return;
    }

    this.wireSend({ type: 'create' });

    // Wait until server assigns roomId
    const roomId = await this.waitForRoomId(8_000);
    if (!roomId) {
      this.fail('Сервер не выдал код комнаты');
      return;
    }

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
  }

  private waitForRoomId(ms: number): Promise<string | null> {
    if (this.roomId) return Promise.resolve(this.roomId);
    return new Promise((resolve) => {
      const start = Date.now();
      const id = window.setInterval(() => {
        if (this.roomId) {
          window.clearInterval(id);
          resolve(this.roomId);
          return;
        }
        if (Date.now() - start > ms || this.status === 'error') {
          window.clearInterval(id);
          resolve(null);
        }
      }, 50);
    });
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
    this.roomId = null;
    this.setStatus('connecting');

    try {
      await this.connectSocket();
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Не удалось подключиться');
      return;
    }

    this.wireSend({ type: 'join', roomId: code });

    const ready = await this.waitUntil(
      () => this.peerReady || this.status === 'error',
      15_000,
    );
    if (this.status === 'error') return;
    if (!ready) {
      this.fail('Комната не отвечает. Проверьте код и что хост ещё ждёт.');
      return;
    }

    this.send({ type: 'guestHello', placements });
  }

  private waitUntil(pred: () => boolean, ms: number): Promise<boolean> {
    if (pred()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const start = Date.now();
      const id = window.setInterval(() => {
        if (pred()) {
          window.clearInterval(id);
          resolve(true);
          return;
        }
        if (Date.now() - start > ms) {
          window.clearInterval(id);
          resolve(false);
        }
      }, 50);
    });
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
    if (this.ws?.readyState === WebSocket.OPEN && this.peerReady) {
      try {
        this.ws.send(
          JSON.stringify({
            type: 'forward',
            data: { type: 'opponentLeft' } satisfies PeerMessage,
          } satisfies WireClientMessage),
        );
      } catch {
        /* ignore */
      }
    }
    this.closeSocket();
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
