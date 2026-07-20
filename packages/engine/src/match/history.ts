import type { Coord, PlayerId } from '../board/types.js';
import type { MatchState } from './types.js';
import type { GameEvent } from '../commands/types.js';
import { getPieceDefinition } from '../defs/catalog.js';

export type MoveHistoryEntry = {
  ply: number;
  turn: number;
  player: 'white' | 'black';
  text: string;
  /** Real half-move vs annotation (spikes death, result…). */
  kind: 'ply' | 'system';
  /**
   * If set, opponents see a redacted line while this piece still has cloak
   * (`invisibleTurns > 0`). Owner always sees `text`.
   */
  cloakPieceId?: string;
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

function ownerOf(
  state: MatchState,
  pieceId: string,
  fallback: PlayerId,
): PlayerId {
  const p = state.pieces.find((x) => x.id === pieceId);
  if (p) return p.owner;
  return fallback;
}

function abilitySuffix(abilityId: string | undefined): string {
  switch (abilityId) {
    case 'retreat':
      return ' (отступление)';
    case 'royalWarp':
      return ' (телепорт)';
    case 'allyLeap':
      return ' (прыжок)';
    case 'allySwap':
      return ' (обмен)';
    case 'blessHeal':
      return ' (лечение)';
    case 'abdicate':
      return ' (титул)';
    case 'grantShield':
      return ' (щит)';
    case 'designatePromote':
      return ' (назначение)';
    case 'curseEnemy':
      return ' (проклятие)';
    case 'cloakPawn':
      return ' (покров)';
    case 'spikeTile':
      return ' (шипы)';
    case 'judgeBless':
      return ' (приговор)';
    case 'frontBless':
      return ' (клерик)';
    default:
      return '';
  }
}

/**
 * Lichess-style turn numbers for a sequence of side-to-move actions.
 * Same-side continuations (e.g. Wayfarer double-move) stay on one turn.
 */
export function assignDisplayTurns(players: PlayerId[]): number[] {
  const turns: number[] = [];
  let turn = 0;
  let last: PlayerId | null = null;
  for (const player of players) {
    if (player === 'white') {
      if (last !== 'white') turn += 1;
    } else if (last !== 'white') {
      turn += 1;
    }
    turns.push(Math.max(1, turn));
    last = player;
  }
  return turns;
}

function cloakStillActive(state: MatchState, pieceId: string): boolean {
  const p = state.pieces.find((x) => x.id === pieceId);
  return Boolean(p && (p.invisibleTurns ?? 0) > 0);
}

/**
 * History line for a viewer. Cloaked-pawn plies stay `???` / `Покров` for the
 * opponent until the cloak expires (or the piece leaves the board).
 */
export function historyTextForViewer(
  entry: MoveHistoryEntry,
  viewer: PlayerId | null,
  state: MatchState,
): string {
  if (!entry.cloakPieceId) return entry.text;
  if (viewer && entry.player === viewer) return entry.text;
  if (!cloakStillActive(state, entry.cloakPieceId)) return entry.text;
  if (entry.text.startsWith('Покров')) return 'Покров';
  return '???';
}

/** Apply viewer redaction to a full history list (keeps pairing metadata). */
export function historyForViewer(
  entries: MoveHistoryEntry[],
  viewer: PlayerId | null,
  state: MatchState,
): MoveHistoryEntry[] {
  return entries.map((e) => {
    const text = historyTextForViewer(e, viewer, state);
    return text === e.text ? e : { ...e, text };
  });
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

  const assignSide = (row: HistoryTurnRow, e: MoveHistoryEntry) => {
    const key = e.player === 'white' ? 'white' : 'black';
    const prev = row[key];
    // Safety: never overwrite — concatenate. Keep latest ply id for UI cursor.
    row[key] = prev ? { ...e, text: `${prev.text} · ${e.text}` } : e;
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
    assignSide(current, e);
  }
  flush();
  return blocks;
}

export type FormatHistoryOptions = {
  /**
   * Second half of a deferred extra move (e.g. Wayfarer double-move).
   * Extends this ply instead of allocating a new one — keeps white|black pairing.
   */
  continueFrom?: MoveHistoryEntry;
};

/**
 * Append a command's events onto the running history.
 * When `continueExtraMove` is set, the batch extends the last ply (no new ply/turn).
 */
export function appendHistoryFromEvents(
  history: MoveHistoryEntry[],
  events: GameEvent[],
  stateAfter: MatchState,
  options?: { continueExtraMove?: boolean },
): MoveHistoryEntry[] {
  if (events.length === 0) return history;

  if (options?.continueExtraMove) {
    let lastPlyIdx = -1;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i]?.kind === 'ply') {
        lastPlyIdx = i;
        break;
      }
    }
    if (lastPlyIdx >= 0) {
      const lastPly = history[lastPlyIdx]!;
      const batch = formatEventsToHistory(events, stateAfter, lastPly.ply, {
        continueFrom: lastPly,
      });
      if (batch.length === 0) return history;

      const next = history.slice();
      for (const entry of batch) {
        if (
          entry.kind === 'ply' &&
          entry.ply === lastPly.ply &&
          entry.player === lastPly.player
        ) {
          next[lastPlyIdx] = entry;
        } else {
          next.push(entry);
        }
      }
      return next;
    }
  }

  const nextPly = history.filter((e) => e.kind === 'ply').length + 1;
  return [...history, ...formatEventsToHistory(events, stateAfter, nextPly)];
}

/**
 * Build history from a batch of events after one command.
 *
 * Rules:
 * - Exactly one ply per consumed turn (move / ability-as-turn / TurnSkipped).
 * - Side effects (passive heal, cave teleport, reflect, promote…) attach as notes
 *   to that ply — they must NOT increment the ply counter.
 * - A deferred extra-move follow-up must use `continueFrom` so it does not mint a new ply.
 */
export function formatEventsToHistory(
  events: GameEvent[],
  stateAfter: MatchState,
  nextPly: number,
  options?: FormatHistoryOptions,
): MoveHistoryEntry[] {
  const entries: MoveHistoryEntry[] = [];
  let ply = nextPly;
  const continueFrom = options?.continueFrom;

  /** Who is expected to move for the next ply (alternating). */
  let expectedPlayer: PlayerId = continueFrom
    ? continueFrom.player
    : nextPly % 2 === 1
      ? 'white'
      : 'black';

  let mainPlayer: PlayerId | null = null;
  let mainText: string | null = null;
  let mainCloakPieceId: string | undefined =
    continueFrom?.cloakPieceId ?? undefined;
  const notes: string[] = [];

  let pendingStrike: Extract<GameEvent, { type: 'Damaged' }> | null = null;
  let pendingFreeze: Extract<GameEvent, { type: 'Frozen' }> | null = null;
  let pendingCapture: Extract<GameEvent, { type: 'Captured' }> | null = null;

  const markCloakIfActive = (pieceId: string) => {
    const p = stateAfter.pieces.find((x) => x.id === pieceId);
    if (p && (p.invisibleTurns ?? 0) > 0) {
      mainCloakPieceId = pieceId;
    }
  };

  const pushPly = (player: PlayerId, text: string) => {
    entries.push({
      ply,
      turn: Math.ceil(ply / 2),
      player,
      text,
      kind: 'ply',
      ...(mainCloakPieceId ? { cloakPieceId: mainCloakPieceId } : {}),
    });
    ply += 1;
    expectedPlayer = player === 'white' ? 'black' : 'white';
    mainCloakPieceId = undefined;
  };

  const pushSystem = (player: PlayerId, text: string) => {
    entries.push({
      ply,
      turn: Math.ceil(Math.max(1, ply) / 2),
      player,
      text,
      kind: 'system',
    });
  };

  const setMain = (player: PlayerId, text: string) => {
    if (mainText === null) {
      mainPlayer = player;
      mainText = text;
    } else {
      notes.push(text);
    }
  };

  /** Side-effect note on the current ply (never starts a new ply). */
  const addNote = (text: string) => {
    notes.push(text);
  };

  const flushMain = () => {
    if (mainText === null || mainPlayer === null) return;
    const extra = notes.length ? ` · ${notes.join(' · ')}` : '';
    if (continueFrom) {
      entries.push({
        ...continueFrom,
        text: `${continueFrom.text} · ${mainText}${extra}`,
        ...(mainCloakPieceId || continueFrom.cloakPieceId
          ? { cloakPieceId: mainCloakPieceId ?? continueFrom.cloakPieceId }
          : {}),
      });
    } else {
      pushPly(mainPlayer, mainText + extra);
    }
    mainText = null;
    mainPlayer = null;
    notes.length = 0;
  };

  for (const e of events) {
    if (e.type === 'Captured') {
      pendingCapture = e;
    } else if (e.type === 'Damaged') {
      pendingStrike = e;
    } else if (e.type === 'Frozen') {
      pendingFreeze = e;
    } else if (e.type === 'Moved') {
      let captureNote = '';
      if (pendingCapture) {
        captureNote = ` × ${defName(pendingCapture.defId)}`;
        pendingCapture = null;
      }
      markCloakIfActive(e.pieceId);
      if (continueFrom) {
        // Continuation: path only — piece name already in the first half.
        setMain(
          ownerOf(stateAfter, e.pieceId, expectedPlayer),
          `${sq(e.from)}→${sq(e.to)}${abilitySuffix(e.abilityId)}${captureNote}`,
        );
      } else {
        const name = pieceName(stateAfter, e.pieceId);
        setMain(
          ownerOf(stateAfter, e.pieceId, expectedPlayer),
          `${name} ${sq(e.from)}→${sq(e.to)}${abilitySuffix(e.abilityId)}${captureNote}`,
        );
      }
    } else if (e.type === 'Castled') {
      const side = e.side === 'kingside' ? '0-0' : '0-0-0';
      setMain(ownerOf(stateAfter, e.kingId, expectedPlayer), `Рокировка ${side}`);
    } else if (e.type === 'Swapped') {
      const name = pieceName(stateAfter, e.pieceId);
      const other = pieceName(stateAfter, e.withPieceId);
      setMain(
        ownerOf(stateAfter, e.pieceId, expectedPlayer),
        `${name} обмен с ${other} ${sq(e.from)}⇄${sq(e.to)}`,
      );
    } else if (e.type === 'Pushed') {
      setMain(
        ownerOf(stateAfter, e.byPieceId, expectedPlayer),
        `Таран: ${pieceName(stateAfter, e.pieceId)} ${sq(e.from)}→${sq(e.to)}`,
      );
    } else if (e.type === 'Healed') {
      const text = `лечение ${pieceName(stateAfter, e.pieceId)} (${e.hp} HP)`;
      if (mainText === null) {
        setMain(
          ownerOf(stateAfter, e.byPieceId, expectedPlayer),
          `Лечение ${pieceName(stateAfter, e.pieceId)} (${e.hp} HP)`,
        );
      } else {
        addNote(text);
      }
    } else if (e.type === 'ShieldGranted') {
      setMain(
        ownerOf(stateAfter, e.byPieceId, expectedPlayer),
        `Щит → ${pieceName(stateAfter, e.pieceId)}`,
      );
    } else if (e.type === 'TitleTransferred') {
      setMain(
        ownerOf(stateAfter, e.fromPieceId, expectedPlayer),
        `Титул → ${pieceName(stateAfter, e.toPieceId)}`,
      );
    } else if (e.type === 'Designated') {
      setMain(
        ownerOf(stateAfter, e.byPieceId, expectedPlayer),
        `Назначение ${pieceName(stateAfter, e.pieceId)}`,
      );
    } else if (e.type === 'Cursed') {
      setMain(
        ownerOf(stateAfter, e.byPieceId, expectedPlayer),
        `Проклятие → ${pieceName(stateAfter, e.pieceId)}`,
      );
    } else if (e.type === 'Cloaked') {
      mainCloakPieceId = e.pieceId;
      setMain(
        ownerOf(stateAfter, e.byPieceId, expectedPlayer),
        `Покров → ${pieceName(stateAfter, e.pieceId)}`,
      );
    } else if (e.type === 'TileChanged') {
      setMain(
        ownerOf(stateAfter, e.byPieceId, expectedPlayer),
        `Шипы на ${sq(e.at)}`,
      );
    } else if (e.type === 'Teleported') {
      addNote(`пещера→${sq(e.to)}`);
    } else if (e.type === 'Promoted') {
      addNote(`превращение в ферзя на ${sq(e.at)}`);
    } else if (e.type === 'Reflected') {
      addNote(`отражение (${e.damage})`);
    } else if (e.type === 'TileTriggered') {
      if (e.note === 'heal') addNote(`гриб +1 HP`);
      else if (e.note === 'shield') addNote(`щит леса`);
      else if (e.note === 'armed') addNote(`шипы`);
      else if (e.note.startsWith('push:')) addNote(`ветер`);
    } else if (e.type === 'PieceDestroyed' && e.reason === 'spikes') {
      // Flush the turn action first so spike death stays a system line.
      flushMain();
      pushSystem(expectedPlayer, `Шипы: уничтожена фигура на ${sq(e.at)}`);
    } else if (e.type === 'TurnSkipped' && e.reason === 'skipFirstTurn') {
      flushMain();
      pushPly(e.player, 'Промедление: пропуск первого хода');
    } else if (e.type === 'GameOver') {
      flushMain();
      pushSystem(e.winner, `Матч окончен — победа ${e.winner === 'white' ? 'белых' : 'чёрных'}`);
    }
    // AbilityUsed / TurnEnded — ignored for text; they don't create plies.
  }

  if (pendingStrike && mainText === null) {
    const atk = pieceName(stateAfter, pendingStrike.byPieceId);
    const tgt = pieceName(stateAfter, pendingStrike.pieceId);
    setMain(
      ownerOf(stateAfter, pendingStrike.byPieceId, expectedPlayer),
      `${atk} бьёт ${tgt} на ${sq(pendingStrike.at)} (${pendingStrike.hpLeft} HP)`,
    );
  } else if (pendingStrike) {
    const tgt = pieceName(stateAfter, pendingStrike.pieceId);
    addNote(`удар по ${tgt} (${pendingStrike.hpLeft} HP)`);
  }

  if (pendingFreeze && mainText === null) {
    const atk = pieceName(stateAfter, pendingFreeze.byPieceId);
    const tgt = pieceName(stateAfter, pendingFreeze.pieceId);
    setMain(
      ownerOf(stateAfter, pendingFreeze.byPieceId, expectedPlayer),
      `${atk} замораживает ${tgt} на ${sq(pendingFreeze.at)}`,
    );
  } else if (pendingFreeze) {
    const tgt = pieceName(stateAfter, pendingFreeze.pieceId);
    addNote(`заморозка ${tgt}`);
  }

  if (pendingCapture && mainText === null) {
    const atk = pieceName(stateAfter, pendingCapture.byPieceId);
    setMain(
      ownerOf(stateAfter, pendingCapture.byPieceId, expectedPlayer),
      `${atk} берёт ${defName(pendingCapture.defId)} на ${sq(pendingCapture.at)}`,
    );
  }

  flushMain();
  return entries;
}
