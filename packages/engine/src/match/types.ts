import type { Coord, PlayerId } from '../board/types.js';

export type TileId = string;
export type PieceDefId = string;
export type PieceRole = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
export type AbilityId = 'retreat' | 'royalWarp' | 'allyLeap' | 'allySwap';

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
   * Attacker stays put; target skips its next turn; freezeCooldown applies.
   */
  freezeInsteadOfCapture?: boolean;
  /** Chebyshev radius for freeze targets (default 3). */
  freezeRange?: number;
  /** Own turns the piece cannot freeze after using freeze. */
  freezeCooldownTurns?: number;
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
  abilities?: ReadonlyArray<{
    id: AbilityId;
    description: string;
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
  /** Ability id → already consumed this match. */
  abilitiesUsed: Partial<Record<AbilityId, boolean>>;
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
  /** Remaining owner-turn ticks of forest damage immunity. */
  shieldTurns: number;
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
};

/** Soft cap for deck: only modifications spend budget; bases are free. */
export const DECK_COST_CAP = 10;
