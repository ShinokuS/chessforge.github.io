import type { Coord, GameEvent, MatchState } from '@chessforge/engine';
import { getPieceDefinition } from '@chessforge/engine';

export type MoveHistoryEntry = {
  ply: number;
  turn: number;
  player: 'white' | 'black';
  text: string;
  /** Real half-move vs annotation (spikes death, result…). */
  kind: 'ply' | 'system';
};

export type HistoryTurnRow = {
  turn: number;
  white?: MoveHistoryEntry;
  black?: MoveHistoryEntry;
};

export type HistoryDisplayBlock =
  | { type: 'turn'; row: HistoryTurnRow }
  | { type: 'system'; entry: MoveHistoryEntry };

function sq(c: Coord): string {
  return `${String.fromCharCode(97 + c.x)}${c.y + 1}`;
}

function defName(defId: string): string {
  try {
    return getPieceDefinition(defId).name;
  } catch {
    return defId;
  }
}

function pieceName(state: MatchState, pieceId: string): string {
  const p = state.pieces.find((x) => x.id === pieceId);
  if (!p) return 'фигура';
  return defName(p.defId);
}

function ownerOf(state: MatchState, pieceId: string, fallbackPly: number): 'white' | 'black' {
  const p = state.pieces.find((x) => x.id === pieceId);
  if (p) return p.owner;
  return fallbackPly % 2 === 1 ? 'white' : 'black';
}

/** Pair plies into Lichess-style turn rows (N. white black). */
export function groupHistoryForDisplay(entries: MoveHistoryEntry[]): HistoryDisplayBlock[] {
  const blocks: HistoryDisplayBlock[] = [];
  let current: HistoryTurnRow | null = null;

  const flush = () => {
    if (current) {
      blocks.push({ type: 'turn', row: current });
      current = null;
    }
  };

  for (const e of entries) {
    if (e.kind === 'system') {
      flush();
      blocks.push({ type: 'system', entry: e });
      continue;
    }

    if (!current || current.turn !== e.turn) {
      flush();
      current = { turn: e.turn };
    }
    if (e.player === 'white') current.white = e;
    else current.black = e;
  }
  flush();
  return blocks;
}

/** Build chronological move lines from a batch of events after a command. */
export function formatEventsToHistory(
  events: GameEvent[],
  stateAfter: MatchState,
  nextPly: number,
): MoveHistoryEntry[] {
  const entries: MoveHistoryEntry[] = [];
  let ply = nextPly;
  const notes: string[] = [];
  let pendingStrike: Extract<GameEvent, { type: 'Damaged' }> | null = null;
  let pendingFreeze: Extract<GameEvent, { type: 'Frozen' }> | null = null;
  let pendingCapture: Extract<GameEvent, { type: 'Captured' }> | null = null;

  const pushMove = (player: 'white' | 'black', text: string) => {
    const extra = notes.length ? ` · ${notes.join(' · ')}` : '';
    notes.length = 0;
    entries.push({
      ply,
      turn: Math.ceil(ply / 2),
      player,
      text: text + extra,
      kind: 'ply',
    });
    ply += 1;
  };

  const pushSystem = (player: 'white' | 'black', text: string) => {
    entries.push({
      ply,
      turn: Math.ceil(Math.max(1, ply) / 2),
      player,
      text,
      kind: 'system',
    });
  };

  for (const e of events) {
    if (e.type === 'Captured') {
      pendingCapture = e;
    } else if (e.type === 'Damaged') {
      pendingStrike = e;
    } else if (e.type === 'Frozen') {
      pendingFreeze = e;
    } else if (e.type === 'Moved') {
      const ability =
        e.abilityId === 'retreat'
          ? ' (отступление)'
          : e.abilityId === 'royalWarp'
            ? ' (телепорт)'
            : e.abilityId === 'allyLeap'
              ? ' (прыжок)'
              : e.abilityId === 'allySwap'
                ? ' (обмен)'
                : '';
      const name = pieceName(stateAfter, e.pieceId);
      let captureNote = '';
      if (pendingCapture) {
        captureNote = ` × ${defName(pendingCapture.defId)}`;
        pendingCapture = null;
      }
      pushMove(
        ownerOf(stateAfter, e.pieceId, ply),
        `${name} ${sq(e.from)}→${sq(e.to)}${ability}${captureNote}`,
      );
    } else if (e.type === 'Swapped') {
      const name = pieceName(stateAfter, e.pieceId);
      const other = pieceName(stateAfter, e.withPieceId);
      pushMove(
        ownerOf(stateAfter, e.pieceId, ply),
        `${name} обмен с ${other} ${sq(e.from)}⇄${sq(e.to)}`,
      );
    } else if (e.type === 'Castled') {
      const side = e.side === 'kingside' ? '0-0' : '0-0-0';
      pushMove(ownerOf(stateAfter, e.kingId, ply), `Рокировка ${side}`);
    } else if (e.type === 'Teleported') {
      const last = entries[entries.length - 1];
      if (last) last.text += ` · пещера→${sq(e.to)}`;
    } else if (e.type === 'PieceDestroyed' && e.reason === 'spikes') {
      pushSystem(
        ply % 2 === 1 ? 'white' : 'black',
        `Шипы: уничтожена фигура на ${sq(e.at)}`,
      );
    } else if (e.type === 'GameOver') {
      pushSystem(e.winner, `Матч окончен — победа ${e.winner === 'white' ? 'белых' : 'чёрных'}`);
    }
  }

  if (pendingStrike) {
    const atk = pieceName(stateAfter, pendingStrike.byPieceId);
    const tgt = pieceName(stateAfter, pendingStrike.pieceId);
    pushMove(
      ownerOf(stateAfter, pendingStrike.byPieceId, ply),
      `${atk} бьёт ${tgt} на ${sq(pendingStrike.at)} (${pendingStrike.hpLeft} HP)`,
    );
  }

  if (pendingFreeze) {
    const atk = pieceName(stateAfter, pendingFreeze.byPieceId);
    const tgt = pieceName(stateAfter, pendingFreeze.pieceId);
    pushMove(
      ownerOf(stateAfter, pendingFreeze.byPieceId, ply),
      `${atk} замораживает ${tgt} на ${sq(pendingFreeze.at)}`,
    );
  }

  if (pendingCapture) {
    const atk = pieceName(stateAfter, pendingCapture.byPieceId);
    pushMove(
      ownerOf(stateAfter, pendingCapture.byPieceId, ply),
      `${atk} берёт ${defName(pendingCapture.defId)} на ${sq(pendingCapture.at)}`,
    );
  }

  if (notes.length) {
    pushMove(ply % 2 === 1 ? 'white' : 'black', notes.join(' · '));
  }

  return entries;
}
