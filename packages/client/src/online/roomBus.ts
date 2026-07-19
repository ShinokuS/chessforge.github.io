import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getDatabase,
  ref,
  set,
  push,
  onChildAdded,
  onValue,
  onDisconnect,
  remove,
  update,
  type Database,
  type Unsubscribe,
} from 'firebase/database';
import type { PeerMessage } from './protocol';

export type Seat = 'host' | 'guest';

type Envelope = {
  from: Seat;
  msg: PeerMessage;
  at: number;
};

let app: FirebaseApp | null = null;
let db: Database | null = null;

function requiredEnv(name: string): string {
  const v = (import.meta.env[name] as string | undefined)?.trim();
  if (!v) {
    throw new Error(
      `Нет ${name}. Онлайн через Firebase Realtime Database. Пропишите VITE_FIREBASE_* — см. README.`,
    );
  }
  return v;
}

export function isFirebaseConfigured(): boolean {
  return Boolean(
    (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined)?.trim() &&
      (import.meta.env.VITE_FIREBASE_DATABASE_URL as string | undefined)?.trim() &&
      (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined)?.trim() &&
      (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined)?.trim(),
  );
}

function getDb(): Database {
  if (db) return db;
  app = initializeApp({
    apiKey: requiredEnv('VITE_FIREBASE_API_KEY'),
    authDomain: requiredEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    databaseURL: requiredEnv('VITE_FIREBASE_DATABASE_URL'),
    projectId: requiredEnv('VITE_FIREBASE_PROJECT_ID'),
  });
  db = getDatabase(app);
  return db;
}

/**
 * Room bus over Firebase RTDB (HTTPS). No WebRTC.
 * Works from GitHub Pages / Vercel, including behind VPN.
 */
export class RoomBus {
  private unsubs: Unsubscribe[] = [];
  private seen = new Set<string>();

  constructor(
    readonly roomId: string,
    readonly seat: Seat,
  ) {}

  private root() {
    return ref(getDb(), `rooms/${this.roomId}`);
  }

  static async createHost(roomId: string): Promise<RoomBus> {
    const bus = new RoomBus(roomId, 'host');
    const database = getDb();
    const roomRef = ref(database, `rooms/${roomId}`);
    await set(roomRef, {
      host: true,
      guest: false,
      createdAt: Date.now(),
    });
    await onDisconnect(roomRef).remove();
    return bus;
  }

  static async joinGuest(roomId: string): Promise<RoomBus> {
    const database = getDb();
    const roomRef = ref(database, `rooms/${roomId}`);

    await new Promise<void>((resolve, reject) => {
      let unsub: Unsubscribe | null = null;
      const t = window.setTimeout(() => {
        unsub?.();
        reject(new Error('Комната не найдена или хост офлайн'));
      }, 12_000);

      unsub = onValue(
        roomRef,
        (snap) => {
          if (!snap.exists()) return;
          window.clearTimeout(t);
          unsub?.();
          void (async () => {
            try {
              await update(roomRef, { guest: true });
              await onDisconnect(ref(database, `rooms/${roomId}/guest`)).set(false);
              resolve();
            } catch (e) {
              reject(e instanceof Error ? e : new Error('Не удалось войти'));
            }
          })();
        },
        (err) => {
          window.clearTimeout(t);
          unsub?.();
          reject(err);
        },
      );
    });

    return new RoomBus(roomId, 'guest');
  }

  onMessage(handler: (msg: PeerMessage) => void): void {
    const msgsRef = ref(getDb(), `rooms/${this.roomId}/msgs`);
    const off = onChildAdded(msgsRef, (snap) => {
      const key = snap.key;
      if (!key || this.seen.has(key)) return;
      this.seen.add(key);
      const val = snap.val() as Envelope | null;
      if (!val?.msg || val.from === this.seat) return;
      handler(val.msg);
    });
    this.unsubs.push(off);
  }

  onPeerLeft(handler: () => void): void {
    if (this.seat === 'host') {
      let hadGuest = false;
      const off = onValue(ref(getDb(), `rooms/${this.roomId}/guest`), (snap) => {
        if (snap.val() === true) {
          hadGuest = true;
          return;
        }
        if (hadGuest) handler();
      });
      this.unsubs.push(off);
      return;
    }
    const off = onValue(this.root(), (snap) => {
      if (!snap.exists()) handler();
    });
    this.unsubs.push(off);
  }

  async send(msg: PeerMessage): Promise<void> {
    const msgsRef = ref(getDb(), `rooms/${this.roomId}/msgs`);
    await push(msgsRef, {
      from: this.seat,
      msg,
      at: Date.now(),
    } satisfies Envelope);
  }

  async close(): Promise<void> {
    for (const off of this.unsubs) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this.unsubs = [];
    try {
      if (this.seat === 'host') {
        await remove(this.root());
      } else {
        await update(this.root(), { guest: false });
      }
    } catch {
      /* ignore */
    }
  }
}
