import {
  appendHistoryFromEvents,
  applyCommand,
  classicBasePlacements,
  createBattlefieldBoard,
  createMatch,
  createPieceInstance,
  createRectBoard,
  formatEventsToHistory,
  getLegalMoves,
  getPieceDefinition,
  listPieceDefinitions,
  resetPieceIdCounter,
  spawnFromPlacements,
  type Coord,
  type GameCommand,
  type LegalMove,
  type MatchState,
  type MoveHistoryEntry,
  type PieceDefId,
  type PlayerId,
  type TileId,
} from '@chessforge/engine';

export type AnalysisMode = 'play' | 'edit';

export type EditorBrush =
  | { kind: 'piece'; defId: PieceDefId; owner: PlayerId }
  | { kind: 'tile'; tileId: TileId }
  | { kind: 'trash' };

export function cloneMatch(state: MatchState): MatchState {
  return structuredClone(state);
}

export function emptyAnalysisBoard(): MatchState {
  resetPieceIdCounter(1);
  return createMatch({
    board: createRectBoard(8, 8, 'plain'),
    pieces: [],
    activePlayer: 'white',
    seed: 1,
  });
}

export function classicAnalysisBoard(): MatchState {
  resetPieceIdCounter(1);
  const placements = classicBasePlacements();
  return createMatch({
    board: createRectBoard(8, 8, 'plain'),
    pieces: [
      ...spawnFromPlacements(placements, 'white'),
      ...spawnFromPlacements(placements, 'black'),
    ],
    activePlayer: 'white',
    seed: 1,
  });
}

export function battlefieldAnalysisBoard(): MatchState {
  resetPieceIdCounter(1);
  const placements = classicBasePlacements();
  return createMatch({
    board: createBattlefieldBoard(),
    pieces: [
      ...spawnFromPlacements(placements, 'white'),
      ...spawnFromPlacements(placements, 'black'),
    ],
    activePlayer: 'white',
    seed: 42,
  });
}

export function setActivePlayer(state: MatchState, player: PlayerId): MatchState {
  const next = cloneMatch(state);
  next.activePlayer = player;
  next.extraMovePieceId = null;
  next.phase = 'play';
  next.winner = null;
  return next;
}

export function placePiece(
  state: MatchState,
  pos: Coord,
  defId: PieceDefId,
  owner: PlayerId,
): MatchState {
  const next = cloneMatch(state);
  next.pieces = next.pieces.filter((p) => !(p.pos.x === pos.x && p.pos.y === pos.y));
  next.pieces.push(createPieceInstance(defId, owner, pos));
  next.phase = 'play';
  next.winner = null;
  next.extraMovePieceId = null;
  return next;
}

export function removePieceAt(state: MatchState, pos: Coord): MatchState {
  const next = cloneMatch(state);
  next.pieces = next.pieces.filter((p) => !(p.pos.x === pos.x && p.pos.y === pos.y));
  next.phase = 'play';
  next.winner = null;
  next.extraMovePieceId = null;
  return next;
}

export function setTileAt(state: MatchState, pos: Coord, tileId: TileId): MatchState {
  const next = cloneMatch(state);
  const row = next.board.tiles[pos.y];
  if (!row) return next;
  row[pos.x] = tileId;
  return next;
}

export function applyEditorBrush(
  state: MatchState,
  pos: Coord,
  brush: EditorBrush,
): MatchState {
  if (brush.kind === 'trash') return removePieceAt(state, pos);
  if (brush.kind === 'tile') return setTileAt(state, pos, brush.tileId);
  return placePiece(state, pos, brush.defId, brush.owner);
}

export type AnalysisHistoryView = {
  moveHistory: MoveHistoryEntry[];
  /** Latest analysis node index for each history ply (for click → jump). */
  plyToNodeIndex: Map<number, number>;
  /** Which history ply the cursor node belongs to (for active highlight). */
  nodePly: (number | null)[];
};

/**
 * @deprecated Linear history — prefer buildTreeHistory / buildMainlineHistory.
 */
export function buildHistoryFromNodes(
  nodes: Array<{
    command: GameCommand | null;
    state: MatchState;
  }>,
): AnalysisHistoryView {
  const plyToNodeIndex = new Map<number, number>();
  const nodePly: (number | null)[] = [];
  if (nodes.length === 0) {
    return { moveHistory: [], plyToNodeIndex, nodePly };
  }

  const opening = nodes[0]!.state;
  let history: MoveHistoryEntry[] = [];
  const openingSkips = opening.openingSkipSequence;
  if (openingSkips && openingSkips.length > 0) {
    history = openingSkips.map((player, idx) => {
      const ply = idx + 1;
      return {
        ply,
        turn: Math.ceil(ply / 2),
        player,
        text: 'Промедление: пропуск первого хода',
        kind: 'ply' as const,
      };
    });
  }
  for (const e of history) {
    if (e.kind === 'ply') plyToNodeIndex.set(e.ply, 0);
  }
  nodePly.push(null);

  let current = opening;
  for (let i = 1; i < nodes.length; i += 1) {
    const command = nodes[i]!.command;
    if (!command) {
      nodePly.push(nodePly[i - 1] ?? null);
      continue;
    }

    const continueExtraMove = Boolean(current.extraMovePieceId);
    const result = applyCommand(current, command);
    if (!result.ok) {
      nodePly.push(nodePly[i - 1] ?? null);
      break;
    }

    const prevByPly = new Map(
      history.filter((e) => e.kind === 'ply').map((e) => [e.ply, e.text] as const),
    );
    history = appendHistoryFromEvents(history, result.events, result.state, {
      continueExtraMove,
    });

    let associatedPly: number | null = null;
    for (const e of history) {
      if (e.kind !== 'ply') continue;
      const prev = prevByPly.get(e.ply);
      if (prev === undefined || prev !== e.text) {
        plyToNodeIndex.set(e.ply, i);
        associatedPly = e.ply;
      }
    }
    if (associatedPly === null && continueExtraMove) {
      for (let j = history.length - 1; j >= 0; j -= 1) {
        const e = history[j];
        if (e?.kind === 'ply') {
          plyToNodeIndex.set(e.ply, i);
          associatedPly = e.ply;
          break;
        }
      }
    }
    if (associatedPly === null) {
      for (let j = history.length - 1; j >= 0; j -= 1) {
        const e = history[j];
        if (e?.kind === 'ply') {
          associatedPly = e.ply;
          break;
        }
      }
    }

    nodePly.push(associatedPly);
    current = result.state;
  }

  return { moveHistory: history, plyToNodeIndex, nodePly };
}

function sq(x: number, y: number): string {
  return `${String.fromCharCode(97 + x)}${y + 1}`;
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
    case 'heartEat':
      return ' (сердцеедка)';
    case 'throwSpear':
      return ' (копье)';
    case 'frontBless':
      return ' (клерик)';
    default:
      return abilityId ? ` (${abilityId})` : '';
  }
}

function formatCommandFallback(
  state: MatchState,
  cmd: Extract<GameCommand, { type: 'move' }>,
): string {
  const piece = state.pieces.find((p) => p.pos.x === cmd.from.x && p.pos.y === cmd.from.y);
  let name = 'Ход';
  if (piece) {
    try {
      name = getPieceDefinition(piece.defId).name;
    } catch {
      name = piece.defId;
    }
  }
  if (cmd.push) return `${name}⇉${sq(cmd.to.x, cmd.to.y)}`;
  return `${name} ${sq(cmd.from.x, cmd.from.y)}→${sq(cmd.to.x, cmd.to.y)}${abilitySuffix(cmd.abilityId)}`;
}

/** Same Russian labels as battle history (abilities, captures, shields…). */
export function formatAnalysisMove(state: MatchState, cmd: GameCommand): string {
  if (cmd.type === 'endTurn') return 'конец хода';
  const result = applyCommand(state, cmd);
  if (result.ok) {
    const entries = formatEventsToHistory(result.events, result.state, 1);
    const ply = entries.find((e) => e.kind === 'ply');
    if (ply?.text) return ply.text;
    const system = entries.find((e) => e.kind === 'system');
    if (system?.text) return system.text;
  }
  return formatCommandFallback(state, cmd);
}

export function tryPlayCommand(
  state: MatchState,
  command: GameCommand,
): { ok: true; state: MatchState } | { ok: false; message: string } {
  const result = applyCommand(state, command);
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, state: result.state };
}

export function moveToCommand(move: LegalMove): GameCommand {
  return {
    type: 'move',
    from: { ...move.from },
    to: { ...move.to },
    ...(move.abilityId !== undefined ? { abilityId: move.abilityId } : {}),
    ...(move.push ? { push: true } : {}),
  };
}

export function legalMovesFrom(state: MatchState, from: Coord): LegalMove[] {
  if (state.phase !== 'play') return [];
  try {
    return getLegalMoves(state, from);
  } catch {
    return [];
  }
}

export function allLegalMoves(state: MatchState): LegalMove[] {
  if (state.phase !== 'play') return [];
  try {
    return getLegalMoves(state);
  } catch {
    return [];
  }
}

/** Base + common roles first, then the rest alphabetically. */
export function palettePieces() {
  const all = listPieceDefinitions();
  const order = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'] as const;
  const base = order.flatMap((role) =>
    all.filter((d) => d.isBase && d.baseRole === role),
  );
  const mods = all
    .filter((d) => !d.isBase)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return [...base, ...mods];
}

export function replayToNodes(
  opening: MatchState,
  commands: GameCommand[],
): Array<{
  command: GameCommand | null;
  label: string;
  by: PlayerId | null;
  state: MatchState;
}> {
  const nodes: Array<{
    command: GameCommand | null;
    label: string;
    by: PlayerId | null;
    state: MatchState;
  }> = [{ command: null, label: 'Старт', by: null, state: cloneMatch(opening) }];
  let current = cloneMatch(opening);
  for (const command of commands) {
    const result = tryPlayCommand(current, command);
    if (!result.ok) break;
    nodes.push({
      command,
      label: formatAnalysisMove(current, command),
      by: current.activePlayer,
      state: result.state,
    });
    current = result.state;
  }
  return nodes;
}

export function evalBarPercent(scoreWhite: number): number {
  if (Math.abs(scoreWhite) >= 500_000) return scoreWhite > 0 ? 100 : 0;
  const x = Math.max(-12, Math.min(12, scoreWhite / 100));
  const p = 1 / (1 + Math.exp(-0.55 * x));
  return Math.round(p * 1000) / 10;
}

