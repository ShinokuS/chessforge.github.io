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
  cost: 0,
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
  cost: 1,
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
    'Модификация пешки: классическое движение, но 2 HP — чтобы убить, нужно дважды атаковать. Удар по HP не сдвигает атакующего: в истории ходов видно «кто бьёт кого», на доске подсвечиваются клетки удара.',
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

/** Ходит как пешка; бьёт только прямо вперёд на 2. */
export const spearmanDef: PieceDefinition = {
  id: 'spearman',
  name: 'Копейщик',
  baseRole: 'pawn',
  isBase: false,
  description:
    'Модификация пешки: ходит как обычная пешка (вперёд 1, со старта 2). Атакует только прямо вперёд на 1 или 2 клетки — диагональных взятий нет.',
  cost: 2,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  splitCapture: true,
  captureOffsets: [
    { x: 0, y: 1 },
    { x: 0, y: 2 },
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
  cost: 0,
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
  description:
    'Модификация ладьи: ортогональный ход не дальше 3 клеток. Раз за партию может перепрыгнуть через соседнюю союзную фигуру на клетку сразу за ней.',
  cost: 3,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'slide', directions: ORTHO, maxRange: 3 }],
  abilities: [
    {
      id: 'allyLeap',
      description: 'Один раз: прыжок через соседнего союзника на пустую клетку за ним.',
    },
  ],
};

/** Ходит на 1 как король; освобождает бюджет колоды. */
export const sentryDef: PieceDefinition = {
  id: 'sentry',
  name: 'Часовой',
  baseRole: 'rook',
  isBase: false,
  description:
    'Модификация ладьи: ходит и бьёт только на 1 клетку в любом направлении (как король). Даёт −2 к стоимости колоды.',
  cost: -2,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'leap', offsets: ALL_DIRS }],
};

export const knightDef: PieceDefinition = {
  id: 'knight',
  name: 'Конь',
  baseRole: 'knight',
  isBase: true,
  description: 'Классический конь: ход буквой «Г», перепрыгивает фигуры.',
  cost: 0,
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
  cost: 1,
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
  cost: 2,
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
  cost: 0,
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
    'Модификация слона: не атакует. Усиливает первую союзную фигуру на каждой своей диагонали (луч блокируется любой фигурой). Усиленная фигура дополнительно ходит и бьёт как король вокруг себя.',
  cost: 2,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 0,
  cannotCapture: true,
  movement: [{ kind: 'slide', directions: DIAG, maxRange: 8 }],
  lineBuff: { directions: DIAG, maxRange: 8 },
};

/** Раз за матч обмен с союзником на диагонали атаки. */
export const exchangerDef: PieceDefinition = {
  id: 'exchanger',
  name: 'Сменщик',
  baseRole: 'bishop',
  isBase: false,
  description:
    'Модификация слона: ходит и бьёт по диагонали как обычный слон. Один раз за матч может поменяться местами с союзной фигурой, которая стоит на его диагональном луче атаки (первая фигура на луче, если это союзник).',
  cost: 2,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'slide', directions: DIAG, maxRange: 8 }],
  abilities: [
    {
      id: 'allySwap',
      description:
        'Один раз: обмен позициями с союзником на диагональном луче (луч блокируется любой фигурой).',
    },
  ],
};

export const queenDef: PieceDefinition = {
  id: 'queen',
  name: 'Ферзь',
  baseRole: 'queen',
  isBase: true,
  description: 'Классический ферзь: любой луч.',
  cost: 0,
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
  cost: 3,
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

/**
 * Не ест фигуры: заморозка врага в квадрате радиусом 3 (чебышёв).
 * После заморозки — 3 хода перезарядки.
 */
export const cryomancerDef: PieceDefinition = {
  id: 'cryomancer',
  name: 'Чародейка',
  baseRole: 'queen',
  isBase: false,
  description:
    'Модификация ферзя: ходит по лучам как ферзь, но не бьёт и не ест. Вместо этого может заморозить врага в любой клетке квадрата радиусом 3 вокруг себя (сама остаётся на месте). Замороженная фигура пропускает 1 ход (голубая подсветка). После заморозки — перезарядка 3 своих хода.',
  cost: 5,
  rarity: 'rare',
  maxHp: 1,
  attack: 0,
  freezeInsteadOfCapture: true,
  freezeRange: 3,
  freezeCooldownTurns: 3,
  movement: [{ kind: 'slide', directions: ALL_DIRS, maxRange: 8 }],
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
  cost: 3,
  rarity: 'rare',
  maxHp: 1,
  attack: 1,
  movement: [
    { kind: 'leap', offsets: ALL_DIRS },
    { kind: 'leap', offsets: KNIGHT_OFFSETS },
  ],
};

/** Не ходит; освобождает 3 очка бюджета колоды. */
export const anchorDef: PieceDefinition = {
  id: 'anchor',
  name: 'Якорь',
  baseRole: 'king',
  isBase: false,
  description:
    'Модификация короля: не может ходить (и рокироваться). Даёт −3 к стоимости колоды — бюджет на остальные модификации.',
  cost: -3,
  rarity: 'rare',
  maxHp: 1,
  attack: 0,
  cannotCapture: true,
  immobile: true,
  movement: [],
};

export const PIECE_DEFS = [
  pawnDef,
  skirmisherDef,
  ironcladDef,
  spearmanDef,
  rookDef,
  sprinterDef,
  sentryDef,
  knightDef,
  lancerDef,
  outriderDef,
  bishopDef,
  chaplainDef,
  exchangerDef,
  queenDef,
  regentDef,
  cryomancerDef,
  kingDef,
  wardenDef,
  anchorDef,
] as const;
