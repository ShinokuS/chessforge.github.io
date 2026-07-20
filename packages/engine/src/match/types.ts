import type { Coord, PlayerId } from '../board/types.js';

export type TileId = string;
export type PieceDefId = string;
export type PieceRole = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
export type AbilityId =
  | 'retreat'
  | 'royalWarp'
  | 'allyLeap'
  | 'allySwap'
  | 'blessHeal'
  | 'abdicate'
  | 'grantShield'
  | 'designatePromote'
  | 'frontBless'
  | 'curseEnemy'
  | 'spikeTile'
  | 'cloakPawn'
  | 'judgeBless'
  | 'doubleMove';

export type TileDefinition = {
  id: TileId;
  name: string;
  description: string;
  /** If false, pieces cannot enter. */
  passable: boolean;
  spawn?: boolean;
  /**
   * Cap all generated move distances (Chebyshev) to this value.
   * Immune roles ignore the cap (e.g. knight on mud).
   */
  movementCap?: number;
  movementCapImmuneRoles?: ReadonlyArray<PieceRole>;
  /** Bonus applied to leap step length / slide range for listed roles. */
  rangeBonus?: number;
  rangeBonusRoles?: ReadonlyArray<PieceRole>;
  /** Shared id: standing on a cave allows a move to the partner cave. */
  caveGroup?: string;
  /** Entering arms delayed death; still on tile at start of next own turn → die. */
  spikesDoom?: boolean;
  /** After landing, at end of that turn push 1 square backward if free. */
  windPush?: boolean;
  /** Landing grants temporary damage immunity. */
  forestShield?: boolean;
  /** Landing heals +1 HP, then tile becomes plain. */
  mushroomHeal?: boolean;
};

export type BoardSpec = {
  width: number;
  height: number;
  tiles: TileId[][];
};

export type SlidePattern = {
  kind: 'slide';
  directions: ReadonlyArray<Coord>;
  maxRange: number;
};

export type LeapPattern = {
  kind: 'leap';
  offsets: ReadonlyArray<Coord>;
};

export type ConditionalPattern = {
  kind: 'conditional';
  when: 'neverMoved' | 'always';
  patterns: ReadonlyArray<MovementPattern>;
};

export type MovementPattern = SlidePattern | LeapPattern | ConditionalPattern;

export type PieceDefinition = {
  id: PieceDefId;
  name: string;
  baseRole: PieceRole;
  isBase: boolean;
  description: string;
  cost: number;
  rarity: 'common' | 'uncommon' | 'rare';
  movement: ReadonlyArray<MovementPattern>;
  captureOffsets?: ReadonlyArray<Coord>;
  splitCapture?: boolean;
  /** If true, piece never generates capture moves. */
  cannotCapture?: boolean;
  /**
   * Capture-like moves freeze the target instead of dealing damage.
   * Attacker stays put; target skips turns; freezeCooldown applies.
   */
  freezeInsteadOfCapture?: boolean;
  /** Chebyshev radius for freeze targets (default 3). */
  freezeRange?: number;
  /** Own turns the piece cannot freeze after using freeze. */
  freezeCooldownTurns?: number;
  /** How many own turns the target stays frozen (default 1). */
  freezeDurationTurns?: number;
  /** Pawn: may push the piece directly ahead 1 square further (if free). */
  pushForward?: boolean;
  /** Once per match: when damaged, deal the same damage back to the attacker. */
  reflectDamageOnce?: boolean;
  /** If true, piece never generates legal moves (even from buffs / castling). */
  immobile?: boolean;
  /**
   * Buffs the first friendly/enemy? piece on each slide ray (diagonal for bishop).
   * Buff grants king-step moves/attacks.
   */
  lineBuff?: {
    directions: ReadonlyArray<Coord>;
    maxRange: number;
  };
  /** Chebyshev radius: enemy pieces move as if on mud (movementCap 1). */
  marshAuraRadius?: number;
  /** Side skips its first turn if this piece is in the deck. */
  skipFirstTurn?: boolean;
  /** After a normal move, skip this many own turns. */
  postMoveFreezeTurns?: number;
  /** If a friendly king is adjacent, also generate king-step moves. */
  royalEscort?: boolean;
  /** Once per match: after moving, may move again; then frozen `freezeAfter` turns. */
  doubleMoveOnce?: { freezeAfter: number };
  /** Can transform plain tiles into spikes (once per match via spikeTile). */
  spikePlacer?: boolean;
  abilities?: ReadonlyArray<{
    id: AbilityId;
    description: string;
    /**
     * If set, ability is reusable after this many owner end-turns.
     * If omitted, ability is once per match (`abilitiesUsed`).
     */
    cooldownTurns?: number;
  }>;
  maxHp: number;
  attack: number;
};

export type PieceInstance = {
  id: string;
  defId: PieceDefId;
  owner: PlayerId;
  pos: Coord;
  hp: number;
  hasMoved: boolean;
  /** Ability id → already consumed this match (once-per-match abilities). */
  abilitiesUsed: Partial<Record<AbilityId, boolean>>;
  /** Remaining owner-turns before a cooldown ability is available again. */
  abilityCooldowns: Partial<Record<AbilityId, number>>;
  /** Warning: standing on spikes. */
  spikeArmed: boolean;
  /**
   * Own-turn starts spent on spikes while armed.
   * 0 on enter → 1 on first return (grace, can leave) → 2 kills.
   */
  spikeTicks: number;
  /** Remaining own turns this piece cannot move (freeze). */
  frozenTurns: number;
  /** Remaining own turns before freeze is available again (>0 = blocked). */
  freezeCooldown: number;
  /** Push pending from wind: fires after the opponent's turn. */
  windPending: boolean;
  /** Remaining owner-turn ticks of forest / ability damage immunity. */
  shieldTurns: number;
  /**
   * Royal piece: capturing it wins the match.
   * Normally true for kings; abdicate can transfer it to a queen.
   */
  isRoyal: boolean;
  /** Still has one damage-reflect charge (from reflectDamageOnce defs). */
  reflectAvailable: boolean;
  /** Designated by patron queen: promotes to base queen on last rank. */
  promotesToBaseQueen: boolean;
  /** Cannot damage the piece with this id (bishop curse). */
  cursedCannotHarmId?: string;
  /** Opponent-side invisibility ticks (half-turns hidden from enemy UI). */
  invisibleTurns?: number;
  /** First leg of a double-move ability completed; must move again this turn. */
  doubleMoveArmed?: boolean;
};

export type MatchPhase = 'play' | 'gameOver';

export type MatchStateSnapshot = {
  board: BoardSpec;
  pieces: ReadonlyArray<PieceInstance>;
  activePlayer: PlayerId;
  turn: number;
  phase: MatchPhase;
  winner: PlayerId | null;
  seed: number;
};

export type MatchConfig = {
  board: BoardSpec;
  pieces: PieceInstance[];
  activePlayer?: PlayerId;
  seed?: number;
};

export type MatchState = {
  board: BoardSpec;
  pieces: PieceInstance[];
  activePlayer: PlayerId;
  turn: number;
  phase: MatchPhase;
  winner: PlayerId | null;
  seed: number;
  rngStep: number;
  /** Only this piece may move until it completes a double-move sequence. */
  extraMovePieceId?: string | null;
  /** Whether a side already consumed automatic first-turn skip. */
  skipFirstTurnUsed?: Partial<Record<PlayerId, boolean>>;
  /** If at match start one or both sides auto-skipped their first turn. */
  openingSkipSequence?: PlayerId[];
};

/** Soft cap for deck: only modifications spend budget; bases are free. */
export const DECK_COST_CAP = 10;
