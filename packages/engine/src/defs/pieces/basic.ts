import type { PieceDefinition, PieceRole } from '../../match/types.js';

const ORTHO = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
] as const;

const DIAG = [
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
] as const;

const ALL_DIRS = [...ORTHO, ...DIAG] as const;

const KNIGHT_OFFSETS = [
  { x: 1, y: 2 },
  { x: 2, y: 1 },
  { x: -1, y: 2 },
  { x: -2, y: 1 },
  { x: 1, y: -2 },
  { x: 2, y: -1 },
  { x: -1, y: -2 },
  { x: -2, y: -1 },
] as const;

export const ROLE_LABELS: Record<PieceRole, string> = {
  king: 'Король',
  queen: 'Ферзь',
  rook: 'Ладья',
  bishop: 'Слон',
  knight: 'Конь',
  pawn: 'Пешка',
};

export const pawnDef: PieceDefinition = {
  id: 'pawn',
  name: 'Пешка',
  baseRole: 'pawn',
  isBase: true,
  description:
    'Классическая пешка: на 1 вперёд (со старта на 2), бьёт по диагонали вперёд.',
  cost: 1,
  rarity: 'common',
  maxHp: 1,
  attack: 1,
  splitCapture: true,
  captureOffsets: [
    { x: -1, y: 1 },
    { x: 1, y: 1 },
  ],
  movement: [
    { kind: 'leap', offsets: [{ x: 0, y: 1 }] },
    {
      kind: 'conditional',
      when: 'neverMoved',
      patterns: [{ kind: 'leap', offsets: [{ x: 0, y: 2 }] }],
    },
  ],
};

/** Ходит вперёд и по диагонали; бьёт вперёд и по диагонали. */
export const skirmisherDef: PieceDefinition = {
  id: 'skirmisher',
  name: 'Стрелок',
  baseRole: 'pawn',
  isBase: false,
  description:
    'Модификация пешки: ходит на 1 вперёд или по диагонали вперёд; атакует вперёд и по диагонали.',
  cost: 2,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  splitCapture: true,
  captureOffsets: [
    { x: 0, y: 1 },
    { x: -1, y: 1 },
    { x: 1, y: 1 },
  ],
  movement: [
    {
      kind: 'leap',
      offsets: [
        { x: 0, y: 1 },
        { x: -1, y: 1 },
        { x: 1, y: 1 },
      ],
    },
  ],
};

/** Нужно два попадания, чтобы убить. */
export const ironcladDef: PieceDefinition = {
  id: 'ironclad',
  name: 'Панцирная',
  baseRole: 'pawn',
  isBase: false,
  description:
    'Модификация пешки: классическое движение, но 2 HP — чтобы убить, нужно дважды атаковать.',
  cost: 2,
  rarity: 'uncommon',
  maxHp: 2,
  attack: 1,
  splitCapture: true,
  captureOffsets: [
    { x: -1, y: 1 },
    { x: 1, y: 1 },
  ],
  movement: [
    { kind: 'leap', offsets: [{ x: 0, y: 1 }] },
    {
      kind: 'conditional',
      when: 'neverMoved',
      patterns: [{ kind: 'leap', offsets: [{ x: 0, y: 2 }] }],
    },
  ],
};

export const rookDef: PieceDefinition = {
  id: 'rook',
  name: 'Ладья',
  baseRole: 'rook',
  isBase: true,
  description: 'Классическая ладья: любое число клеток по горизонтали и вертикали.',
  cost: 5,
  rarity: 'common',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'slide', directions: ORTHO, maxRange: 8 }],
};

export const sprinterDef: PieceDefinition = {
  id: 'sprinter',
  name: 'Спринтер',
  baseRole: 'rook',
  isBase: false,
  description: 'Модификация ладьи: ортогональный ход не дальше 3 клеток.',
  cost: 3,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'slide', directions: ORTHO, maxRange: 3 }],
};

export const knightDef: PieceDefinition = {
  id: 'knight',
  name: 'Конь',
  baseRole: 'knight',
  isBase: true,
  description: 'Классический конь: ход буквой «Г», перепрыгивает фигуры.',
  cost: 3,
  rarity: 'common',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'leap', offsets: KNIGHT_OFFSETS }],
};

export const lancerDef: PieceDefinition = {
  id: 'lancer',
  name: 'Улан',
  baseRole: 'knight',
  isBase: false,
  description: 'Модификация коня: прыжок ровно на 2 по горизонтали/вертикали.',
  cost: 3,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  movement: [
    {
      kind: 'leap',
      offsets: [
        { x: 0, y: 2 },
        { x: 0, y: -2 },
        { x: 2, y: 0 },
        { x: -2, y: 0 },
      ],
    },
  ],
};

/** Раз за партию — отступление ладьёй назад. */
export const outriderDef: PieceDefinition = {
  id: 'outrider',
  name: 'Рейтар',
  baseRole: 'knight',
  isBase: false,
  description:
    'Модификация коня: обычный ход «Г». Один раз за партию может отступить назад по прямой как ладья на любое число клеток.',
  cost: 4,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'leap', offsets: KNIGHT_OFFSETS }],
  abilities: [
    {
      id: 'retreat',
      description: 'Один раз: ход назад по вертикали как ладья.',
    },
  ],
};

export const bishopDef: PieceDefinition = {
  id: 'bishop',
  name: 'Слон',
  baseRole: 'bishop',
  isBase: true,
  description: 'Классический слон: любое число клеток по диагонали.',
  cost: 3,
  rarity: 'common',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'slide', directions: DIAG, maxRange: 8 }],
};

/** Не атакует; баффает первую фигуру на диагонали. */
export const chaplainDef: PieceDefinition = {
  id: 'chaplain',
  name: 'Капеллан',
  baseRole: 'bishop',
  isBase: false,
  description:
    'Модификация слона: не атакует. Усиливает первую фигуру на каждой своей диагонали (луч блокируется фигурой). Усиленная фигура дополнительно ходит и бьёт как король вокруг себя.',
  cost: 4,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 0,
  cannotCapture: true,
  movement: [{ kind: 'slide', directions: DIAG, maxRange: 8 }],
  lineBuff: { directions: DIAG, maxRange: 8 },
};

export const queenDef: PieceDefinition = {
  id: 'queen',
  name: 'Ферзь',
  baseRole: 'queen',
  isBase: true,
  description: 'Классический ферзь: любой луч.',
  cost: 9,
  rarity: 'rare',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'slide', directions: ALL_DIRS, maxRange: 8 }],
};

/** Раз за партию телепорт к королю. */
export const regentDef: PieceDefinition = {
  id: 'regent',
  name: 'Регентша',
  baseRole: 'queen',
  isBase: false,
  description:
    'Модификация ферзя: обычные ходы ферзя. Один раз за партию может телепортироваться на пустую клетку рядом со своим королём.',
  cost: 10,
  rarity: 'rare',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'slide', directions: ALL_DIRS, maxRange: 8 }],
  abilities: [
    {
      id: 'royalWarp',
      description: 'Один раз: телепорт на пустую клетку рядом с королём.',
    },
  ],
};

export const kingDef: PieceDefinition = {
  id: 'king',
  name: 'Король',
  baseRole: 'king',
  isBase: true,
  description: 'Классический король: на 1 клетку в любом направлении. Потеря — поражение.',
  cost: 0,
  rarity: 'rare',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'leap', offsets: ALL_DIRS }],
};

export const wardenDef: PieceDefinition = {
  id: 'warden',
  name: 'Страж',
  baseRole: 'king',
  isBase: false,
  description: 'Модификация короля: шаг на 1 + прыжки коня.',
  cost: 4,
  rarity: 'rare',
  maxHp: 1,
  attack: 1,
  movement: [
    { kind: 'leap', offsets: ALL_DIRS },
    { kind: 'leap', offsets: KNIGHT_OFFSETS },
  ],
};

export const PIECE_DEFS = [
  pawnDef,
  skirmisherDef,
  ironcladDef,
  rookDef,
  sprinterDef,
  knightDef,
  lancerDef,
  outriderDef,
  bishopDef,
  chaplainDef,
  queenDef,
  regentDef,
  kingDef,
  wardenDef,
] as const;
