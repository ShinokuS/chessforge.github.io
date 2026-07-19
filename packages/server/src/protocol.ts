/** Wire protocol: server only relays; game messages stay in PeerMessage on the client. */

export type WireClientMessage =
  | { type: "create" }
  | { type: "join"; roomId: string }
  | { type: "forward"; data: unknown };

export type WireServerMessage =
  | { type: "created"; roomId: string }
  | { type: "joined"; roomId: string }
  /** Both seats filled — safe to exchange game messages. */
  | { type: "ready" }
  | { type: "forward"; data: unknown }
  | { type: "peerLeft" }
  | { type: "error"; message: string };

export function randomRoomCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]!;
  }
  return out;
}
