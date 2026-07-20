import type { GameCommand, MatchState, PlayerId } from '@chessforge/engine';

export type SavedGameSource = 'ai' | 'online';

export type SavedGame = {
  id: string;
  savedAt: number;
  source: SavedGameSource;
  title: string;
  winner: PlayerId | null;
  opening: MatchState;
  commands: GameCommand[];
  myColor: PlayerId | null;
};

export type GameReplay = {
  opening: MatchState;
  commands: GameCommand[];
};

const STORAGE_KEY = 'chessforge.saved-games.v1';
const MAX_GAMES = 40;

let memoryStore: string | null = null;

function storageGet(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return memoryStore;
  }
}

function storageSet(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    memoryStore = value;
  }
}

function readAll(): SavedGame[] {
  const raw = storageGet();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { games?: SavedGame[] };
    if (!Array.isArray(parsed.games)) return [];
    return parsed.games.filter(
      (g) =>
        g &&
        typeof g.id === 'string' &&
        g.opening &&
        Array.isArray(g.commands),
    );
  } catch {
    return [];
  }
}

function writeAll(games: SavedGame[]): void {
  storageSet(JSON.stringify({ version: 1, games }));
}

export function listSavedGames(): SavedGame[] {
  return readAll().sort((a, b) => b.savedAt - a.savedAt);
}

export function getSavedGame(id: string): SavedGame | null {
  return readAll().find((g) => g.id === id) ?? null;
}

export function deleteSavedGame(id: string): void {
  writeAll(readAll().filter((g) => g.id !== id));
}

export function saveGameReplay(input: {
  source: SavedGameSource;
  opening: MatchState;
  commands: GameCommand[];
  winner?: PlayerId | null;
  myColor?: PlayerId | null;
  title?: string;
}): SavedGame {
  const winner =
    input.winner ??
    (input.opening.phase === 'gameOver' ? input.opening.winner : null) ??
    null;
  // Prefer final winner from last position if commands were applied.
  let finalWinner = winner;
  if (input.commands.length > 0) {
    // Opening may still be in play; caller should pass winner from current state.
  }
  const title =
    input.title ??
    defaultTitle(input.source, finalWinner, input.commands.length);

  const game: SavedGame = {
    id: `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: Date.now(),
    source: input.source,
    title,
    winner: finalWinner,
    opening: structuredClone(input.opening),
    commands: input.commands.map((c) => structuredClone(c)),
    myColor: input.myColor ?? null,
  };

  const next = [game, ...readAll().filter((g) => g.id !== game.id)].slice(
    0,
    MAX_GAMES,
  );
  writeAll(next);
  return game;
}

function defaultTitle(
  source: SavedGameSource,
  winner: PlayerId | null,
  moves: number,
): string {
  const vs = source === 'ai' ? 'ИИ' : 'Онлайн';
  const result = winner
    ? `победа ${winner === 'white' ? 'белых' : 'чёрных'}`
    : 'без результата';
  return `${vs} · ${result} · ${moves} ход.`;
}

export function formatSavedAt(ts: number): string {
  try {
    return new Date(ts).toLocaleString('ru-RU', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(ts);
  }
}
