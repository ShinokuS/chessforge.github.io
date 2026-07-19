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
import { randomRoomCode, type PeerMessage } from '../online/protocol';
import { isFirebaseConfigured, RoomBus } from '../online/roomBus';
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
 * Online via Firebase Realtime Database (HTTPS).
 * No WebRTC / PeerJS — works on GitHub Pages & Vercel through VPN.
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

  private bus: RoomBus | null = null;
  private hostPlacements: FormationPlacement[] | null = null;
  private isHost = false;
  private guestSeen = false;

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
    if (!this.bus) {
      this.fail('Нет соединения');
      return;
    }
    void this.bus.send(msg).catch(() => {
      this.fail('Не удалось отправить сообщение');
    });
  }

  private guestColor(): PlayerId {
    return this.myColor === 'white' ? 'black' : 'white';
  }

  private bindBus(bus: RoomBus): void {
    this.bus = bus;
    bus.onMessage((msg) => this.onPeerMessage(msg));
    bus.onPeerLeft(() => {
      if (this.status === 'playing' || this.status === 'waiting') {
        if (this.isHost && !this.guestSeen) return;
        this.lastError = 'Соперник отключился';
        this.setStatus('disconnected');
        this.emit([]);
      }
    });
  }

  private onPeerMessage(msg: PeerMessage): void {
    if (msg.type === 'error') {
      this.lastError = msg.message;
      this.emit([]);
      return;
    }

    if (msg.type === 'guestHello' && this.isHost) {
      this.guestSeen = true;
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
      this.matchClockMs =
        Number.isFinite(msg.clockMs) && msg.clockMs > 0
          ? Math.floor(msg.clockMs)
          : INITIAL_CLOCK_MS;
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

    if (msg.type === 'resign') {
      if (this.status !== 'playing' || this.state.phase !== 'play') return;
      if (this.myColor && msg.by === this.myColor) return;
      const winner: PlayerId = msg.by === 'white' ? 'black' : 'white';
      this.state = { ...this.state, phase: 'gameOver', winner };
      this.lastError = null;
      this.emit([{ type: 'GameOver', winner }]);
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
    if (!isFirebaseConfigured()) {
      this.fail(
        'Онлайн не настроен: задайте VITE_FIREBASE_* (Firebase Realtime Database). Инструкция в README.',
      );
      return;
    }

    this.disconnect();
    this.isHost = true;
    this.guestSeen = false;
    this.hostPlacements = placements;
    this.hostSide = options.side;
    this.hostColor = resolveSide(options.side);
    this.matchClockMs =
      Number.isFinite(options.clockMs) && options.clockMs > 0
        ? Math.floor(options.clockMs)
        : INITIAL_CLOCK_MS;
    this.myColor = this.hostColor;
    this.setStatus('connecting');

    try {
      const roomId = randomRoomCode();
      const bus = await RoomBus.createHost(roomId);
      this.roomId = roomId;
      this.bindBus(bus);

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
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Не удалось создать комнату');
    }
  }

  async joinRoom(roomId: string, placements: FormationPlacement[]): Promise<void> {
    const err = validatePlacements(placements);
    if (err) {
      this.fail(err);
      return;
    }
    if (!isFirebaseConfigured()) {
      this.fail(
        'Онлайн не настроен: задайте VITE_FIREBASE_* (Firebase Realtime Database). Инструкция в README.',
      );
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

    try {
      const bus = await RoomBus.joinGuest(code);
      this.bindBus(bus);
      this.lastError = null;
      this.emitStatus();
      this.send({ type: 'guestHello', placements });
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Не удалось войти в комнату');
    }
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
    this.emit([{ type: 'GameOver', winner }]);
  }

  /** Local player resigns; notifies peer. */
  resign(): void {
    if (this.status !== 'playing' || this.state.phase !== 'play' || !this.myColor) return;
    const loser = this.myColor;
    const winner: PlayerId = loser === 'white' ? 'black' : 'white';
    this.state = { ...this.state, phase: 'gameOver', winner };
    this.lastError = null;
    this.send({ type: 'resign', by: loser });
    this.emit([{ type: 'GameOver', winner }]);
  }

  disconnect(): void {
    if (this.bus && (this.status === 'playing' || this.status === 'waiting')) {
      void this.bus.send({ type: 'opponentLeft' });
    }
    const bus = this.bus;
    this.bus = null;
    void bus?.close();
    this.roomId = null;
    this.myColor = null;
    this.hostPlacements = null;
    this.isHost = false;
    this.guestSeen = false;
    this.hostSide = 'white';
    this.hostColor = 'white';
    this.matchClockMs = INITIAL_CLOCK_MS;
    this.state = createDemoMatch();
    this.lastError = null;
    this.setStatus('idle');
  }
}
