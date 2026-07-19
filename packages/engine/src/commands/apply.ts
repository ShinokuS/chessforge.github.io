import { coordsEqual, inBounds } from '../board/types.js';
import type { PlayerId } from '../board/types.js';
import { findCavePartner, getTileDef, isPassable } from '../board/board.js';
import { getPieceDefinition } from '../defs/catalog.js';
import type { MatchState, PieceInstance } from '../match/types.js';
import { findLegalMove } from '../pieces/movement.js';
import type { ApplyResult, GameCommand, GameEvent } from './types.js';

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
    })),
  };
}

function opponent(p: PlayerId): PlayerId {
  return p === 'white' ? 'black' : 'white';
}

function facingSign(owner: PlayerId): number {
  return owner === 'white' ? 1 : -1;
}

function isKingPiece(p: PieceInstance): boolean {
  return getPieceDefinition(p.defId).baseRole === 'king';
}

function checkWinner(pieces: PieceInstance[]): PlayerId | null {
  const whiteKing = pieces.some((p) => p.owner === 'white' && isKingPiece(p));
  const blackKing = pieces.some((p) => p.owner === 'black' && isKingPiece(p));
  if (whiteKing && !blackKing) return 'white';
  if (blackKing && !whiteKing) return 'black';

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
    // First own-turn after landing is grace; die only from the second.
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
    // Enter destination without re-arming wind on the same resolution pass
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
    // Survive through this turn's endTick and the next own turn.
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

function endTurn(state: MatchState, events: GameEvent[]): void {
  const previous = state.activePlayer;

  for (const p of state.pieces) {
    if (p.owner !== previous) continue;
    if ((p.frozenTurns ?? 0) > 0) p.frozenTurns -= 1;
    if ((p.freezeCooldown ?? 0) > 0) p.freezeCooldown -= 1;
    if ((p.shieldTurns ?? 0) > 0) p.shieldTurns -= 1;
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
  // Wind pushes after the opponent has moved — resolve for the side about to play.
  resolveWindPushes(state, next, events);
  resolveSpikeDeathsFor(state, next, events);
}

function maybeGameOver(state: MatchState, events: GameEvent[]): void {
  const winner = checkWinner(state.pieces);
  if (!winner) return;
  state.phase = 'gameOver';
  state.winner = winner;
  events.push({ type: 'GameOver', winner });
}

export function applyCommand(state: MatchState, command: GameCommand): ApplyResult {
  if (state.phase !== 'play') {
    return { ok: false, code: 'wrong_phase', message: 'Match is not in play phase' };
  }

  const next = cloneState(state);
  const events: GameEvent[] = [];
  /** Set after endTurn so the freeze turn itself does not eat a cooldown tick. */
  let pendingFreezeCooldown: { pieceId: string; turns: number } | null = null;

  if (command.type === 'endTurn') {
    endTurn(next, events);
    maybeGameOver(next, events);
    return { ok: true, state: next, events };
  }

  if (command.type === 'move') {
    const piece = next.pieces.find((p) => coordsEqual(p.pos, command.from));
    if (!piece) {
      return { ok: false, code: 'no_piece', message: 'No piece at source square' };
    }
    if (piece.owner !== next.activePlayer) {
      return { ok: false, code: 'not_your_turn', message: 'Piece does not belong to active player' };
    }

    const legal = findLegalMove(next, command.from, command.to, command.abilityId);
    const legalFallback =
      legal ??
      findLegalMove(next, command.from, command.to);
    if (!legalFallback) {
      return { ok: false, code: 'illegal', message: 'Move is not legal' };
    }
    const chosen = command.abilityId
      ? legalFallback.abilityId === command.abilityId
        ? legalFallback
        : findLegalMove(next, command.from, command.to, command.abilityId)
      : legalFallback;
    if (!chosen) {
      return { ok: false, code: 'illegal', message: 'Move is not legal' };
    }

    if (chosen.abilityId) {
      piece.abilitiesUsed[chosen.abilityId] = true;
      events.push({
        type: 'AbilityUsed',
        pieceId: piece.id,
        abilityId: chosen.abilityId,
      });
    }

    if (chosen.castle) {
      const rank = piece.pos.y;
      const rookFromX = chosen.castle === 'kingside' ? 7 : 0;
      const rookToX = chosen.castle === 'kingside' ? 5 : 3;
      const rook = next.pieces.find(
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
    } else {
      let moved = true;
      const moverDef = getPieceDefinition(piece.defId);

      if (chosen.captures && chosen.targetPieceId) {
        const target = next.pieces.find((p) => p.id === chosen.targetPieceId);
        if (target) {
          if (hasShield(target)) {
            return { ok: false, code: 'illegal', message: 'Target is shielded by forest' };
          }
          if (moverDef.freezeInsteadOfCapture) {
            if ((piece.freezeCooldown ?? 0) > 0) {
              return { ok: false, code: 'illegal', message: 'Freeze on cooldown' };
            }
            target.frozenTurns = Math.max(target.frozenTurns ?? 0, 1);
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
          }
        }
      }

      if (moved) {
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
      } else {
        piece.hasMoved = true;
      }
    }

    maybeGameOver(next, events);
    if (next.phase === 'play') {
      endTurn(next, events);
      if (pendingFreezeCooldown) {
        const freezer = next.pieces.find((p) => p.id === pendingFreezeCooldown!.pieceId);
        if (freezer) freezer.freezeCooldown = pendingFreezeCooldown.turns;
      }
      maybeGameOver(next, events);
    }
    return { ok: true, state: next, events };
  }

  return { ok: false, code: 'illegal', message: 'Unknown command' };
}
