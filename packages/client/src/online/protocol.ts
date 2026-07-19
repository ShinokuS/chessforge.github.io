import type { FormationPlacement, GameCommand, PlayerId } from '@chessforge/engine';

/** Messages over PeerJS data connection (host = white is authoritative). */
export type PeerMessage =
  | { type: 'guestHello'; placements: FormationPlacement[] }
  | {
      type: 'matchStart';
      roomId: string;
      seed: number;
      white: FormationPlacement[];
      black: FormationPlacement[];
    }
  | { type: 'command'; command: GameCommand; by: PlayerId }
  | { type: 'commandRequest'; command: GameCommand }
  | { type: 'error'; message: string }
  | { type: 'opponentLeft' };

export function peerIdForRoom(roomId: string): string {
  return `chessforge-${roomId.toLowerCase()}`;
}

export function randomRoomCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]!;
  }
  return out;
}
