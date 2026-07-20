import { coordsEqual, inBounds } from '../board/types.js';
import type { PlayerId } from '../board/types.js';
import { findCavePartner, getTileDef, isPassable } from '../board/board.js';
import { getPieceDefinition } from '../defs/catalog.js';
import type { AbilityId, MatchState, PieceInstance } from '../match/types.js';
import { findLegalMove, getLegalMovesForPiece, type LegalMove } from '../pieces/movement.js';
import type { ApplyResult, GameCommand, GameEvent } from './types.js';

/** Search clone: isolated piece copies + shared board until a move mutates tiles. */
function cloneStateForSearch(state: MatchState): MatchState {
  return {
    ...state,
    board: state.board,
    pieces: state.pieces.map(copyPieceFull),
    extraMovePieceId: state.extraMovePieceId ?? null,
    ...(state.skipFirstTurnUsed ? { skipFirstTurnUsed: { ...state.skipFirstTurnUsed } } : {}),
    ...(state.openingSkipSequence
      ? { openingSkipSequence: [...state.openingSkipSequence] }
      : {}),
  };
}

function copyPieceFull(p: PieceInstance): PieceInstance {
  return {
    ...p,
    pos: { ...p.pos },
    abilitiesUsed: { ...p.abilitiesUsed },
    abilityCooldowns: { ...(p.abilityCooldowns ?? {}) },
  };
}

function copyPieceAt(state: MatchState, index: number): PieceInstance {
  const c = copyPieceFull(state.pieces[index]!);
  state.pieces[index] = c;
  return c;
}

function copyPieceById(state: MatchState, id: string): PieceInstance | undefined {
  const index = state.pieces.findIndex((p) => p.id === id);
  if (index < 0) return undefined;
  return copyPieceAt(state, index);
}

function ensureMutableTiles(state: MatchState): void {
  state.board = {
    ...state.board,
    tiles: state.board.tiles.map((row) => [...row]),
  };
}

function cloneState(state: MatchState): MatchState {
  return {
    ...state,
    board: {
      ...state.board,
      tiles: state.board.tiles.map((row) => [...row]),
    },
    pieces: state.pieces.map((p) => ({
      ...p,
      pos: { ...p.pos },
      abilitiesUsed: { ...p.abilitiesUsed },
      abilityCooldowns: { ...(p.abilityCooldowns ?? {}) },
    })),
    extraMovePieceId: state.extraMovePieceId ?? null,
    ...(state.skipFirstTurnUsed ? { skipFirstTurnUsed: { ...state.skipFirstTurnUsed } } : {}),
    ...(state.openingSkipSequence
      ? { openingSkipSequence: [...state.openingSkipSequence] }
      : {}),
  };
}

function opponent(p: PlayerId): PlayerId {
  return p === 'white' ? 'black' : 'white';
}

function facingSign(owner: PlayerId): number {
  return owner === 'white' ? 1 : -1;
}

export function isRoyalPiece(p: PieceInstance): boolean {
  return Boolean(p.isRoyal);
}

function checkWinner(pieces: PieceInstance[]): PlayerId | null {
  const whiteRoyal = pieces.some((p) => p.owner === 'white' && isRoyalPiece(p));
  const blackRoyal = pieces.some((p) => p.owner === 'black' && isRoyalPiece(p));
  if (whiteRoyal && !blackRoyal) return 'white';
  if (blackRoyal && !whiteRoyal) return 'black';

  const whiteAlive = pieces.some((p) => p.owner === 'white');
  const blackAlive = pieces.some((p) => p.owner === 'black');
  if (whiteAlive && !blackAlive) return 'white';
  if (blackAlive && !whiteAlive) return 'black';
  return null;
}

function destroyPiece(
  state: MatchState,
  pieceId: string,
  events: GameEvent[],
  reason?: string,
): void {
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece) return;
  events.push({
    type: 'PieceDestroyed',
    pieceId,
    at: { ...piece.pos },
    ...(reason !== undefined ? { reason } : {}),
  });
  state.pieces = state.pieces.filter((p) => p.id !== pieceId);
}

function hasShield(p: PieceInstance): boolean {
  return (p.shieldTurns ?? 0) > 0;
}

function lastRankY(owner: PlayerId, boardHeight: number): number {
  return owner === 'white' ? boardHeight - 1 : 0;
}

function tryPromote(state: MatchState, piece: PieceInstance, events: GameEvent[]): void {
  if (!piece.promotesToBaseQueen) return;
  if (piece.pos.y !== lastRankY(piece.owner, state.board.height)) return;
  if (getPieceDefinition(piece.defId).baseRole !== 'pawn') return;
  piece.defId = 'queen';
  piece.promotesToBaseQueen = false;
  piece.hp = getPieceDefinition('queen').maxHp;
  events.push({
    type: 'Promoted',
    pieceId: piece.id,
    toDefId: 'queen',
    at: { ...piece.pos },
  });
}

function resolveSpikeDeathsFor(state: MatchState, owner: PlayerId, events: GameEvent[]): void {
  for (const p of [...state.pieces]) {
    if (p.owner !== owner || !p.spikeArmed) continue;
    const tile = getTileDef(state.board, p.pos);
    if (!tile?.spikesDoom) {
      p.spikeArmed = false;
      p.spikeTicks = 0;
      continue;
    }
    p.spikeTicks += 1;
    if (p.spikeTicks >= 2) {
      destroyPiece(state, p.id, events, 'spikes');
    }
  }
}

function resolveWindPushes(state: MatchState, owner: PlayerId, events: GameEvent[]): void {
  for (const p of [...state.pieces]) {
    if (p.owner !== owner || !p.windPending) continue;
    p.windPending = false;
    const tile = getTileDef(state.board, p.pos);
    if (!tile?.windPush) continue;

    const back = {
      x: p.pos.x,
      y: p.pos.y - facingSign(p.owner),
    };
    if (!inBounds(back, state.board.width, state.board.height)) continue;
    if (!isPassable(state.board, back)) continue;
    if (state.pieces.some((o) => coordsEqual(o.pos, back))) continue;

    const from = { ...p.pos };
    p.pos = { ...back };
    events.push({
      type: 'TileTriggered',
      tileId: 'wind',
      pieceId: p.id,
      at: { ...back },
      note: `push:${from.x},${from.y}`,
    });
    applyEnterTile(state, p, events, { skipWindArm: true });
  }
}

function applyEnterTile(
  state: MatchState,
  piece: PieceInstance,
  events: GameEvent[],
  opts?: { skipWindArm?: boolean },
): void {
  const tile = getTileDef(state.board, piece.pos);

  if (!tile?.spikesDoom) {
    piece.spikeArmed = false;
    piece.spikeTicks = 0;
  }

  if (tile?.spikesDoom) {
    piece.spikeArmed = true;
    piece.spikeTicks = 0;
    events.push({
      type: 'TileTriggered',
      tileId: tile.id,
      pieceId: piece.id,
      at: { ...piece.pos },
      note: 'armed',
    });
  }

  if (tile?.forestShield) {
    piece.shieldTurns = Math.max(piece.shieldTurns ?? 0, 2);
    events.push({
      type: 'TileTriggered',
      tileId: tile.id,
      pieceId: piece.id,
      at: { ...piece.pos },
      note: 'shield',
    });
  }

  if (tile?.mushroomHeal) {
    piece.hp += 1;
    ensureMutableTiles(state);
    const row = state.board.tiles[piece.pos.y];
    if (row) row[piece.pos.x] = 'plain';
    events.push({
      type: 'TileTriggered',
      tileId: tile.id,
      pieceId: piece.id,
      at: { ...piece.pos },
      note: 'heal',
    });
  }

  if (tile?.windPush && !opts?.skipWindArm) {
    piece.windPending = true;
    events.push({
      type: 'TileTriggered',
      tileId: tile.id,
      pieceId: piece.id,
      at: { ...piece.pos },
      note: 'wind',
    });
  } else if (!tile?.windPush) {
    piece.windPending = false;
  }
}

function shouldSkipFirstTurn(state: MatchState, player: PlayerId): boolean {
  const used = state.skipFirstTurnUsed?.[player] ?? false;
  if (used) return false;
  const hasSkipPiece = state.pieces.some(
    (p) => p.owner === player && getPieceDefinition(p.defId).skipFirstTurn,
  );
  if (!hasSkipPiece) return false;
  const movedAlready = state.pieces.some((p) => p.owner === player && p.hasMoved);
  return !movedAlready;
}

function markSkipUsed(state: MatchState, player: PlayerId): void {
  state.skipFirstTurnUsed = {
    ...(state.skipFirstTurnUsed ?? {}),
    [player]: true,
  };
}

/** Cleric passive: once per match, +1 HP to the first allied piece ahead (mover's side). */
function resolveClericFrontBless(state: MatchState, events: GameEvent[]): void {
  for (const cleric of state.pieces) {
    if (cleric.owner !== state.activePlayer) continue;
    const def = getPieceDefinition(cleric.defId);
    if (!def.abilities?.some((a) => a.id === 'frontBless')) continue;
    if (cleric.abilitiesUsed.frontBless) continue;

    const fwd = facingSign(cleric.owner);
    let target: PieceInstance | null = null;
    for (let step = 1; step < 8; step++) {
      const pos = { x: cleric.pos.x, y: cleric.pos.y + fwd * step };
      if (!inBounds(pos, state.board.width, state.board.height)) break;
      const hit = state.pieces.find((p) => coordsEqual(p.pos, pos));
      if (!hit) continue;
      if (hit.owner !== cleric.owner) break;
      target = hit;
      break;
    }
    if (!target) continue;

    target.hp += 1;
    cleric.abilitiesUsed = { ...cleric.abilitiesUsed, frontBless: true };
    events.push({ type: 'AbilityUsed', pieceId: cleric.id, abilityId: 'frontBless' });
    events.push({
      type: 'Healed',
      pieceId: target.id,
      byPieceId: cleric.id,
      at: { ...target.pos },
      hp: target.hp,
    });
  }
}

function doSingleTurnSwitch(state: MatchState, events: GameEvent[]): void {
  // A forced mid-turn sequence must not leak into the opponent's turn.
  if (state.extraMovePieceId) {
    const armed = state.pieces.find((p) => p.id === state.extraMovePieceId);
    if (armed) armed.doubleMoveArmed = false;
    state.extraMovePieceId = null;
  }

  const previous = state.activePlayer;

  for (const p of state.pieces) {
    if ((p.invisibleTurns ?? 0) > 0) p.invisibleTurns = (p.invisibleTurns ?? 0) - 1;
  }

  for (const p of state.pieces) {
    if (p.owner !== previous) continue;
    if ((p.frozenTurns ?? 0) > 0) p.frozenTurns -= 1;
    if ((p.freezeCooldown ?? 0) > 0) p.freezeCooldown -= 1;
    if ((p.shieldTurns ?? 0) > 0) p.shieldTurns -= 1;
    if (p.abilityCooldowns) {
      for (const key of Object.keys(p.abilityCooldowns) as AbilityId[]) {
        const left = p.abilityCooldowns[key] ?? 0;
        if (left > 0) {
          p.abilityCooldowns[key] = left - 1;
          if ((p.abilityCooldowns[key] ?? 0) <= 0) delete p.abilityCooldowns[key];
        }
      }
    }
  }

  const next = opponent(previous);
  state.activePlayer = next;
  if (next === 'white') {
    state.turn += 1;
  }
  events.push({
    type: 'TurnEnded',
    previous,
    next,
    turn: state.turn,
  });
  resolveWindPushes(state, next, events);
  resolveSpikeDeathsFor(state, next, events);
}

function endTurn(state: MatchState, events: GameEvent[]): void {
  if (state.phase === 'play' && shouldSkipFirstTurn(state, state.activePlayer)) {
    const skipped = state.activePlayer;
    markSkipUsed(state, skipped);
    events.push({ type: 'TurnSkipped', player: skipped, reason: 'skipFirstTurn' });
  }
  doSingleTurnSwitch(state, events);
  while (state.phase === 'play' && shouldSkipFirstTurn(state, state.activePlayer)) {
    const skipped = state.activePlayer;
    markSkipUsed(state, skipped);
    events.push({ type: 'TurnSkipped', player: skipped, reason: 'skipFirstTurn' });
    doSingleTurnSwitch(state, events);
  }
}

function maybeGameOver(state: MatchState, events: GameEvent[]): void {
  const winner = checkWinner(state.pieces);
  if (!winner) return;
  state.phase = 'gameOver';
  state.winner = winner;
  events.push({ type: 'GameOver', winner });
}

function consumeAbility(
  piece: PieceInstance,
  abilityId: AbilityId,
  events: GameEvent[],
): { pendingCooldown: { pieceId: string; abilityId: AbilityId; turns: number } | null } {
  const def = getPieceDefinition(piece.defId);
  const meta = def.abilities?.find((a) => a.id === abilityId);
  events.push({ type: 'AbilityUsed', pieceId: piece.id, abilityId });
  if (meta?.cooldownTurns !== undefined) {
    return {
      pendingCooldown: {
        pieceId: piece.id,
        abilityId,
        turns: meta.cooldownTurns,
      },
    };
  }
  piece.abilitiesUsed[abilityId] = true;
  return { pendingCooldown: null };
}

export function applyCommand(state: MatchState, command: GameCommand): ApplyResult {
  return applyCommandImpl(state, command, null);
}

/** Apply a move already validated by movegen — skips findLegalMove and uses a search clone. */
export function applyKnownMove(state: MatchState, move: LegalMove): ApplyResult {
  const command: GameCommand = {
    type: 'move',
    from: { ...move.from },
    to: { ...move.to },
    ...(move.abilityId !== undefined ? { abilityId: move.abilityId } : {}),
    ...(move.push ? { push: true } : {}),
  };
  return applyCommandImpl(state, command, move);
}

/** One-time clone at search root; in-place make/unmake mutates this copy. */
export function cloneForSearch(state: MatchState): MatchState {
  return cloneStateForSearch(state);
}

function applyCommandImpl(
  state: MatchState,
  command: GameCommand,
  knownMove: LegalMove | null,
): ApplyResult {
  if (state.phase !== 'play') {
    return { ok: false, code: 'wrong_phase', message: 'Match is not in play phase' };
  }

  const next = knownMove ? cloneStateForSearch(state) : cloneState(state);
  const events: GameEvent[] = [];
  let pendingFreezeCooldown: { pieceId: string; turns: number } | null = null;
  let pendingAbilityCooldown: {
    pieceId: string;
    abilityId: AbilityId;
    turns: number;
  } | null = null;
  let pendingPostMoveFreeze: { pieceId: string; turns: number } | null = null;

  if (command.type === 'endTurn') {
    if (next.extraMovePieceId) {
      const extraPiece = next.pieces.find((piece) => piece.id === next.extraMovePieceId);
      if (extraPiece?.doubleMoveArmed) {
        extraPiece.doubleMoveArmed = false;
      }
      next.extraMovePieceId = null;
    }
    endTurn(next, events);
    maybeGameOver(next, events);
    return { ok: true, state: next, events };
  }

  if (command.type === 'move') {
    const pieceIndex = next.pieces.findIndex((p) => coordsEqual(p.pos, command.from));
    if (pieceIndex < 0) {
      return { ok: false, code: 'no_piece', message: 'No piece at source square' };
    }
    let piece = knownMove ? copyPieceAt(next, pieceIndex) : next.pieces[pieceIndex]!;
    if (piece.owner !== next.activePlayer) {
      return { ok: false, code: 'not_your_turn', message: 'Piece does not belong to active player' };
    }

    let deferEndTurn = false;
    let chosen: LegalMove;
    if (knownMove) {
      chosen = knownMove;
    } else {
      const legal = findLegalMove(
        next,
        command.from,
        command.to,
        command.abilityId,
        command.push,
      );
      const legalFallback = legal ?? findLegalMove(next, command.from, command.to);
      if (!legalFallback) {
        return { ok: false, code: 'illegal', message: 'Move is not legal' };
      }
      const resolved = command.abilityId
        ? legalFallback.abilityId === command.abilityId
          ? legalFallback
          : findLegalMove(next, command.from, command.to, command.abilityId)
        : command.push
          ? legalFallback.push
            ? legalFallback
            : findLegalMove(next, command.from, command.to, undefined, true)
          : legalFallback;
      if (!resolved) {
        return { ok: false, code: 'illegal', message: 'Move is not legal' };
      }
      chosen = resolved;
    }
    if (command.push && !chosen.push) {
      return { ok: false, code: 'illegal', message: 'Push is not legal' };
    }

    const searchCow = knownMove !== null;
    const mut = (p: PieceInstance): PieceInstance => {
      if (!searchCow) return p;
      const idx = next.pieces.findIndex((x) => x.id === p.id);
      return idx >= 0 ? copyPieceAt(next, idx) : p;
    };

    if (chosen.abilityId) {
      const consumed = consumeAbility(piece, chosen.abilityId, events);
      pendingAbilityCooldown = consumed.pendingCooldown;
    }

    if (chosen.castle) {
      const rank = piece.pos.y;
      const rookFromX = chosen.castle === 'kingside' ? 7 : 0;
      const rookToX = chosen.castle === 'kingside' ? 5 : 3;
      let rook = next.pieces.find(
        (p) =>
          p.owner === piece.owner &&
          getPieceDefinition(p.defId).baseRole === 'rook' &&
          p.pos.y === rank &&
          p.pos.x === rookFromX &&
          !p.hasMoved,
      );
      if (!rook) {
        return { ok: false, code: 'illegal', message: 'Castling rook not available' };
      }
      rook = mut(rook);

      const kingFrom = { ...piece.pos };
      const rookFrom = { ...rook.pos };
      piece.pos = { ...command.to };
      piece.hasMoved = true;
      rook.pos = { x: rookToX, y: rank };
      rook.hasMoved = true;

      events.push({
        type: 'Castled',
        side: chosen.castle,
        kingId: piece.id,
        rookId: rook.id,
        kingFrom,
        kingTo: { ...command.to },
        rookFrom,
        rookTo: { ...rook.pos },
      });
      applyEnterTile(next, piece, events);
      applyEnterTile(next, rook, events);
    } else if (chosen.push && chosen.targetPieceId) {
      const victim = next.pieces.find((p) => p.id === chosen.targetPieceId);
      if (!victim) {
        return { ok: false, code: 'illegal', message: 'Push target missing' };
      }
      if (hasShield(victim)) {
        return { ok: false, code: 'illegal', message: 'Target is shielded' };
      }
      const from = { ...victim.pos };
      victim.pos = { ...command.to };
      piece.hasMoved = true;
      events.push({
        type: 'Pushed',
        pieceId: victim.id,
        byPieceId: piece.id,
        from,
        to: { ...command.to },
      });
      applyEnterTile(next, victim, events);
    } else if (chosen.abilityId === 'allySwap' && chosen.targetPieceId) {
      const target = next.pieces.find((p) => p.id === chosen.targetPieceId);
      if (!target) {
        return { ok: false, code: 'illegal', message: 'Swap target missing' };
      }
      const from = { ...piece.pos };
      const to = { ...target.pos };
      piece.pos = { ...to };
      target.pos = { ...from };
      piece.hasMoved = true;
      events.push({
        type: 'Swapped',
        pieceId: piece.id,
        withPieceId: target.id,
        from,
        to,
      });
      applyEnterTile(next, piece, events);
      applyEnterTile(next, target, events);
    } else if (chosen.abilityId === 'abdicate' && chosen.targetPieceId) {
      const target = next.pieces.find((p) => p.id === chosen.targetPieceId);
      if (!target) {
        return { ok: false, code: 'illegal', message: 'Abdicate target missing' };
      }
      if (getPieceDefinition(target.defId).baseRole !== 'queen') {
        return { ok: false, code: 'illegal', message: 'Abdicate requires a queen' };
      }
      piece.isRoyal = false;
      target.isRoyal = true;
      piece.hasMoved = true;
      events.push({
        type: 'TitleTransferred',
        fromPieceId: piece.id,
        toPieceId: target.id,
      });
    } else if (chosen.abilityId === 'grantShield' && chosen.targetPieceId) {
      const target = next.pieces.find((p) => p.id === chosen.targetPieceId);
      if (!target) {
        return { ok: false, code: 'illegal', message: 'Shield target missing' };
      }
      target.shieldTurns = Math.max(target.shieldTurns ?? 0, 3);
      piece.hasMoved = true;
      events.push({
        type: 'ShieldGranted',
        pieceId: target.id,
        byPieceId: piece.id,
        turns: 2,
      });
    } else if (chosen.abilityId === 'designatePromote' && chosen.targetPieceId) {
      const target = next.pieces.find((p) => p.id === chosen.targetPieceId);
      if (!target) {
        return { ok: false, code: 'illegal', message: 'Designate target missing' };
      }
      if (getPieceDefinition(target.defId).baseRole !== 'pawn') {
        return { ok: false, code: 'illegal', message: 'Designate requires a pawn' };
      }
      target.promotesToBaseQueen = true;
      piece.hasMoved = true;
      events.push({
        type: 'Designated',
        pieceId: target.id,
        byPieceId: piece.id,
      });
    } else if (
      (chosen.abilityId === 'blessHeal' ||
        chosen.abilityId === 'frontBless' ||
        chosen.abilityId === 'judgeBless') &&
      chosen.targetPieceId
    ) {
      const target = next.pieces.find((p) => p.id === chosen.targetPieceId);
      if (!target) {
        return { ok: false, code: 'illegal', message: 'Heal target missing' };
      }
      // Temporary overheal is allowed (same as mushroom tiles).
      target.hp += 1;
      piece.hasMoved = true;
      events.push({
        type: 'Healed',
        pieceId: target.id,
        byPieceId: piece.id,
        at: { ...target.pos },
        hp: target.hp,
      });
    } else if (chosen.abilityId === 'curseEnemy' && chosen.targetPieceId) {
      const target = next.pieces.find((p) => p.id === chosen.targetPieceId);
      if (!target) {
        return { ok: false, code: 'illegal', message: 'Curse target missing' };
      }
      if (target.owner === piece.owner) {
        return { ok: false, code: 'illegal', message: 'Cannot curse an ally' };
      }
      target.cursedCannotHarmId = piece.id;
      piece.hasMoved = true;
      events.push({
        type: 'Cursed',
        pieceId: target.id,
        byPieceId: piece.id,
        cannotHarmPieceId: piece.id,
      });
    } else if (chosen.abilityId === 'cloakPawn' && chosen.targetPieceId) {
      const target = next.pieces.find((p) => p.id === chosen.targetPieceId);
      if (!target) {
        return { ok: false, code: 'illegal', message: 'Cloak target missing' };
      }
      if (getPieceDefinition(target.defId).baseRole !== 'pawn') {
        return { ok: false, code: 'illegal', message: 'Cloak requires a pawn' };
      }
      target.invisibleTurns = 4;
      piece.hasMoved = true;
      events.push({
        type: 'Cloaked',
        pieceId: target.id,
        byPieceId: piece.id,
        turns: 4,
      });
    } else if (chosen.abilityId === 'spikeTile') {
      ensureMutableTiles(next);
      const row = next.board.tiles[command.to.y];
      if (!row) {
        return { ok: false, code: 'illegal', message: 'Invalid tile' };
      }
      if (row[command.to.x] !== 'plain') {
        return { ok: false, code: 'illegal', message: 'Only plain tiles can become spikes' };
      }
      row[command.to.x] = 'spikes';
      piece.hasMoved = true;
      events.push({
        type: 'TileChanged',
        at: { ...command.to },
        fromTileId: 'plain',
        toTileId: 'spikes',
        byPieceId: piece.id,
      });
      const occupant = next.pieces.find((p) => coordsEqual(p.pos, command.to));
      if (occupant) {
        occupant.spikeArmed = true;
        occupant.spikeTicks = 0;
        events.push({
          type: 'TileTriggered',
          tileId: 'spikes',
          pieceId: occupant.id,
          at: { ...command.to },
          note: 'armed',
        });
      }
    } else {
      let moved = true;
      const moverDef = getPieceDefinition(piece.defId);

      if (chosen.captures && chosen.targetPieceId) {
        let target = next.pieces.find((p) => p.id === chosen.targetPieceId);
        if (target) {
          target = mut(target);
          if (piece.cursedCannotHarmId && target.id === piece.cursedCannotHarmId) {
            return {
              ok: false,
              code: 'illegal',
              message: 'Cursed piece cannot harm this bishop',
            };
          }
          if (hasShield(target)) {
            return { ok: false, code: 'illegal', message: 'Target is shielded by forest' };
          }
          if (moverDef.freezeInsteadOfCapture) {
            if ((piece.freezeCooldown ?? 0) > 0) {
              return { ok: false, code: 'illegal', message: 'Freeze on cooldown' };
            }
            const duration = moverDef.freezeDurationTurns ?? 1;
            target.frozenTurns = Math.max(target.frozenTurns ?? 0, duration);
            pendingFreezeCooldown = {
              pieceId: piece.id,
              turns: moverDef.freezeCooldownTurns ?? 3,
            };
            events.push({
              type: 'Frozen',
              pieceId: target.id,
              byPieceId: piece.id,
              at: { ...command.to },
              from: { ...piece.pos },
            });
            moved = false;
          } else {
            const atk = moverDef.attack;
            target.hp -= atk;
            const reflect =
              target.reflectAvailable && atk > 0
                ? (() => {
                    target.reflectAvailable = false;
                    return atk;
                  })()
                : 0;

            if (target.hp <= 0) {
              events.push({
                type: 'Captured',
                pieceId: target.id,
                byPieceId: piece.id,
                at: { ...command.to },
                defId: target.defId,
              });
              destroyPiece(next, target.id, events, 'capture');
            } else {
              events.push({
                type: 'Damaged',
                pieceId: target.id,
                byPieceId: piece.id,
                at: { ...command.to },
                from: { ...piece.pos },
                hpLeft: target.hp,
              });
              moved = false;
            }

            if (reflect > 0) {
              const attacker = next.pieces.find((p) => p.id === piece.id);
              if (attacker) {
                attacker.hp -= reflect;
                events.push({
                  type: 'Reflected',
                  pieceId: attacker.id,
                  byPieceId: target.id,
                  damage: reflect,
                });
                if (attacker.hp <= 0) {
                  events.push({
                    type: 'Captured',
                    pieceId: attacker.id,
                    byPieceId: target.id,
                    at: { ...attacker.pos },
                    defId: attacker.defId,
                  });
                  destroyPiece(next, attacker.id, events, 'reflect');
                  moved = false;
                }
              }
            }
          }
        }
      }

      const stillAlive = next.pieces.some((p) => p.id === piece.id);
      if (stillAlive && moved) {
        const from = { ...piece.pos };
        piece.pos = { ...command.to };
        piece.hasMoved = true;
        events.push({
          type: 'Moved',
          pieceId: piece.id,
          from,
          to: { ...command.to },
          ...(chosen.abilityId !== undefined ? { abilityId: chosen.abilityId } : {}),
        });
        applyEnterTile(next, piece, events);
        tryPromote(next, piece, events);

        if (moverDef.postMoveFreezeTurns) {
          pendingPostMoveFreeze = {
            pieceId: piece.id,
            turns: moverDef.postMoveFreezeTurns,
          };
        }

        if (moverDef.doubleMoveOnce && !piece.abilitiesUsed.doubleMove) {
          if (piece.doubleMoveArmed) {
            piece.doubleMoveArmed = false;
            next.extraMovePieceId = null;
            piece.abilitiesUsed = { ...piece.abilitiesUsed, doubleMove: true };
            pendingPostMoveFreeze = {
              pieceId: piece.id,
              turns: moverDef.doubleMoveOnce.freezeAfter,
            };
            events.push({
              type: 'AbilityUsed',
              pieceId: piece.id,
              abilityId: 'doubleMove',
            });
          } else {
            piece.doubleMoveArmed = true;
            next.extraMovePieceId = piece.id;
            const followUps = getLegalMovesForPiece(next, piece);
            if (followUps.length === 0) {
              // No second move available — spend the charge without freezing.
              piece.doubleMoveArmed = false;
              next.extraMovePieceId = null;
              piece.abilitiesUsed = { ...piece.abilitiesUsed, doubleMove: true };
              events.push({
                type: 'AbilityUsed',
                pieceId: piece.id,
                abilityId: 'doubleMove',
              });
            } else {
              deferEndTurn = true;
            }
          }
        }
      } else if (stillAlive) {
        piece.hasMoved = true;
      }
    }

    maybeGameOver(next, events);
    if (next.phase === 'play') {
      resolveClericFrontBless(next, events);
    }
    if (next.phase === 'play' && !deferEndTurn) {
      endTurn(next, events);
      if (pendingFreezeCooldown) {
        const freezer = next.pieces.find((p) => p.id === pendingFreezeCooldown!.pieceId);
        if (freezer) freezer.freezeCooldown = pendingFreezeCooldown.turns;
      }
      if (pendingAbilityCooldown) {
        const caster = next.pieces.find((p) => p.id === pendingAbilityCooldown!.pieceId);
        if (caster) {
          caster.abilityCooldowns = {
            ...caster.abilityCooldowns,
            [pendingAbilityCooldown.abilityId]: pendingAbilityCooldown.turns,
          };
        }
      }
      if (pendingPostMoveFreeze) {
        const frozen = next.pieces.find((p) => p.id === pendingPostMoveFreeze!.pieceId);
        if (frozen) {
          frozen.frozenTurns = Math.max(
            frozen.frozenTurns ?? 0,
            pendingPostMoveFreeze.turns,
          );
        }
      }
      maybeGameOver(next, events);
    }
    return { ok: true, state: next, events };
  }

  return { ok: false, code: 'illegal', message: 'Unknown command' };
}

/** Snapshot for in-place search make/unmake (zero alloc per node when fast path hits). */
export type SearchUndo = {
  pieces: PieceInstance[];
  board: MatchState['board'];
  activePlayer: PlayerId;
  turn: number;
  phase: MatchState['phase'];
  winner: MatchState['winner'];
  extraMovePieceId: string | null;
  skipFirstTurnUsed?: MatchState['skipFirstTurnUsed'];
};

export function searchUnmake(state: MatchState, undo: SearchUndo): void {
  state.pieces = undo.pieces;
  state.board = undo.board;
  state.activePlayer = undo.activePlayer;
  state.turn = undo.turn;
  state.phase = undo.phase;
  state.winner = undo.winner;
  state.extraMovePieceId = undo.extraMovePieceId;
  if (undo.skipFirstTurnUsed !== undefined) {
    state.skipFirstTurnUsed = undo.skipFirstTurnUsed;
  } else {
    delete state.skipFirstTurnUsed;
  }
}

function snapBoard(board: MatchState['board']): MatchState['board'] {
  return {
    ...board,
    tiles: board.tiles.map((row) => [...row]),
  };
}

function snapSearch(state: MatchState): SearchUndo {
  return {
    pieces: state.pieces.map(copyPieceFull),
    board: snapBoard(state.board),
    activePlayer: state.activePlayer,
    turn: state.turn,
    phase: state.phase,
    winner: state.winner,
    extraMovePieceId: state.extraMovePieceId ?? null,
    skipFirstTurnUsed: state.skipFirstTurnUsed
      ? { ...state.skipFirstTurnUsed }
      : undefined,
  };
}

function applyEnterTileSearch(state: MatchState, piece: PieceInstance): void {
  const tile = getTileDef(state.board, piece.pos);
  if (!tile?.spikesDoom) {
    piece.spikeArmed = false;
    piece.spikeTicks = 0;
  }
  if (tile?.spikesDoom) {
    piece.spikeArmed = true;
    piece.spikeTicks = 0;
  }
  if (tile?.forestShield) {
    piece.shieldTurns = Math.max(piece.shieldTurns ?? 0, 2);
  }
  if (tile?.mushroomHeal) {
    piece.hp += 1;
    ensureMutableTiles(state);
    const row = state.board.tiles[piece.pos.y];
    if (row) row[piece.pos.x] = 'plain';
  }
  if (tile?.windPush) {
    piece.windPending = true;
  } else {
    piece.windPending = false;
  }
}

const SEARCH_EVENTS: GameEvent[] = [];

/** In-place quiet/lethal capture — returns null → caller uses applyKnownMove. */
export function searchMakeMove(state: MatchState, move: LegalMove): SearchUndo | null {
  if (state.phase !== 'play' || move.abilityId || move.push || move.castle) return null;

  const moverIdx = state.pieces.findIndex((p) => coordsEqual(p.pos, move.from));
  if (moverIdx < 0) return null;
  if (state.pieces[moverIdx]!.owner !== state.activePlayer) return null;

  const undo = snapSearch(state);
  state.pieces = undo.pieces.map(copyPieceFull);
  state.board = snapBoard(undo.board);

  const piece = copyPieceAt(state, moverIdx);
  const moverDef = getPieceDefinition(piece.defId);
  if (moverDef.doubleMoveOnce && !piece.abilitiesUsed.doubleMove) {
    searchUnmake(state, undo);
    return null;
  }

  if (move.captures && move.targetPieceId) {
    const tIdx = state.pieces.findIndex((p) => p.id === move.targetPieceId);
    if (tIdx < 0) {
      searchUnmake(state, undo);
      return null;
    }
    const target = copyPieceAt(state, tIdx);
    if (moverDef.freezeInsteadOfCapture || moverDef.attack <= 0) {
      searchUnmake(state, undo);
      return null;
    }
    if ((target.shieldTurns ?? 0) > 0) {
      searchUnmake(state, undo);
      return null;
    }
    target.hp -= moverDef.attack;
    if (target.hp <= 0) {
      state.pieces.splice(tIdx, 1);
    } else {
      searchUnmake(state, undo);
      return null;
    }
  }

  piece.pos = { ...move.to };
  piece.hasMoved = true;
  applyEnterTileSearch(state, piece);
  tryPromote(state, piece, SEARCH_EVENTS);
  maybeGameOver(state, SEARCH_EVENTS);
  if (state.phase === 'play') {
    resolveClericFrontBless(state, SEARCH_EVENTS);
    endTurn(state, SEARCH_EVENTS);
    maybeGameOver(state, SEARCH_EVENTS);
  }
  return undo;
}

export function searchMakeEndTurn(state: MatchState): SearchUndo | null {
  if (state.phase !== 'play') return null;
  const undo = snapSearch(state);
  endTurn(state, SEARCH_EVENTS);
  maybeGameOver(state, SEARCH_EVENTS);
  return undo;
}
