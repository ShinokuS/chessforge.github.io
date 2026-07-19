import type { FormationPlacement, GameCommand, MatchState, PlayerId } from '@chessforge/engine';

/** Game-level messages forwarded through the WS relay (host authoritative). */
export type PeerMessage =
  | { type: 'guestHello'; placements: FormationPlacement[] }
  | { type: 'guestRejoin' }
  | {
      type: 'matchStart';
      roomId: string;
      seed: number;
      white: FormationPlacement[];
      black: FormationPlacement[];
      clockMs: number;
      yourColor: PlayerId;
    }
  | {
      type: 'resync';
      roomId: string;
      state: MatchState;
      clockMs: number;
      yourColor: PlayerId;
    }
  | { type: 'command'; command: GameCommand; by: PlayerId }
  | { type: 'commandRequest'; command: GameCommand }
  | { type: 'ping'; t: number }
  | { type: 'pong'; t: number }
  | { type: 'error'; message: string }
  | { type: 'opponentLeft' };

/** Client → relay */
export type WireClientMessage =
  | { type: 'create' }
  | { type: 'join'; roomId: string }
  | { type: 'forward'; data: PeerMessage };

/** Relay → client */
export type WireServerMessage =
  | { type: 'created'; roomId: string }
  | { type: 'joined'; roomId: string }
  | { type: 'ready' }
  | { type: 'forward'; data: PeerMessage }
  | { type: 'peerLeft' }
  | { type: 'error'; message: string };

export function randomRoomCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]!;
  }
  return out;
}

/** Resolve WebSocket URL for the room relay. */
export function resolveRelayUrl(): string | null {
  const fromEnv = (import.meta.env.VITE_WS_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv;

  if (import.meta.env.DEV) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  return null;
}
