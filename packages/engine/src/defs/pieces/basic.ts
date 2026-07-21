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
 * Заморозка на 2 хода; после — 4 хода перезарядки.
 */
export const cryomancerDef: PieceDefinition = {
  id: 'cryomancer',
  name: 'Чародейка',
  baseRole: 'queen',
  isBase: false,
  description:
    'Модификация ферзя: ходит по лучам как ферзь, но не бьёт и не ест. Вместо этого может заморозить врага в квадрате радиусом 3 (сама остаётся на месте). Заморозка на 2 хода цели. После — перезарядка 4 своих хода.',
  cost: 5,
  rarity: 'rare',
  maxHp: 1,
  attack: 0,
  freezeInsteadOfCapture: true,
  freezeRange: 3,
  freezeDurationTurns: 2,
  freezeCooldownTurns: 4,
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

/** Толкает фигуру прямо перед собой на клетку дальше. */
export const ramDef: PieceDefinition = {
  id: 'ram',
  name: 'Таран',
  baseRole: 'pawn',
  isBase: false,
  description:
    'Модификация пешки: ходит как обычная пешка. Вместо хода может толкнуть фигуру прямо перед собой на одну клетку дальше, если та свободна и проходима. Сам остаётся на месте.',
  cost: 1,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  pushForward: true,
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

/** Один раз за матч отражает полученный урон в атакующего. */
export const bristlingDef: PieceDefinition = {
  id: 'bristling',
  name: 'Шип',
  baseRole: 'pawn',
  isBase: false,
  description:
    'Модификация пешки: классическое движение. Один раз за партию при получении урона автоматически наносит такой же урон атакующей фигуре.',
  cost: 2,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  reflectDamageOnce: true,
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

/** Конь + прыжок на 2 клетки прямо вперёд. */
export const courserDef: PieceDefinition = {
  id: 'courser',
  name: 'Скакун',
  baseRole: 'knight',
  isBase: false,
  description:
    'Модификация коня: обычные прыжки коня, плюс может ходить и бить на 2 клетки прямо вперёд.',
  cost: 3,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  movement: [
    { kind: 'leap', offsets: KNIGHT_OFFSETS },
    { kind: 'leap', offsets: [{ x: 0, y: 2 }] },
  ],
};

/** Ходит как король, 4 HP. */
export const bastionDef: PieceDefinition = {
  id: 'bastion',
  name: 'Бастион',
  baseRole: 'bishop',
  isBase: false,
  description:
    'Модификация слона: ходит и бьёт на 1 клетку в любом направлении (как король). Имеет 4 HP.',
  cost: 3,
  rarity: 'uncommon',
  maxHp: 4,
  attack: 1,
  movement: [{ kind: 'leap', offsets: ALL_DIRS }],
};

/** Щит союзнику на 2 хода, КД 4. */
export const aegisDef: PieceDefinition = {
  id: 'aegis',
  name: 'Эгида',
  baseRole: 'rook',
  isBase: false,
  description:
    'Модификация ладьи: обычные ходы. Может дать любой союзной фигуре неуязвимость на 2 хода (вместо хода). Перезарядка 4 хода.',
  cost: 4,
  rarity: 'rare',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'slide', directions: ORTHO, maxRange: 8 }],
  abilities: [
    {
      id: 'grantShield',
      description: 'Неуязвимость союзнику на 2 хода. Перезарядка 4.',
      cooldownTurns: 4,
    },
  ],
};

/** Назначить пешку на превращение в ферзя. */
export const patronDef: PieceDefinition = {
  id: 'patron',
  name: 'Покровительница',
  baseRole: 'queen',
  isBase: false,
  description:
    'Модификация ферзя: обычные ходы. Один раз за партию может назначить союзную пешку: если она дойдёт до последней горизонтали, превратится в базового ферзя.',
  cost: 3,
  rarity: 'rare',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'slide', directions: ALL_DIRS, maxRange: 8 }],
  abilities: [
    {
      id: 'designatePromote',
      description: 'Один раз: назначить пешку на превращение в ферзя.',
    },
  ],
};

/** Лечение союзника +1 HP в радиусе 3, КД 4. */
export const hierophantDef: PieceDefinition = {
  id: 'hierophant',
  name: 'Кардинал',
  baseRole: 'king',
  isBase: false,
  description:
    'Модификация короля: обычные ходы. Вместо хода может дать +1 HP союзной фигуре в радиусе 3. Перезарядка 4 хода.',
  cost: 5,
  rarity: 'rare',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'leap', offsets: ALL_DIRS }],
  abilities: [
    {
      id: 'blessHeal',
      description: '+1 HP союзнику в радиусе 3. Перезарядка 4.',
      cooldownTurns: 4,
    },
  ],
};

/** Раз отдать королевский титул ферзю. */
export const dynastDef: PieceDefinition = {
  id: 'dynast',
  name: 'Династий',
  baseRole: 'king',
  isBase: false,
  description:
    'Модификация короля: обычные ходы. Один раз за партию может передать титул короля союзному ферзю. После этого для победы нужно уничтожить фигуру с титулом (ферзя), а не этого короля.',
  cost: 6,
  rarity: 'rare',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'leap', offsets: ALL_DIRS }],
  abilities: [
    {
      id: 'abdicate',
      description: 'Один раз: передать титул короля союзному ферзю.',
    },
  ],
};

/** Ход только на 1 вперёд; раз за матч авто +1 HP союзнику на клетке прямо перед собой. */
export const clericDef: PieceDefinition = {
  id: 'cleric',
  name: 'Клерик',
  baseRole: 'pawn',
  isBase: false,
  description:
    'Модификация пешки: ходит только на 1 клетку вперёд. Один раз за партию автоматически даёт +1 HP союзной фигуре на клетке непосредственно перед собой (даже если она уже на максимуме HP).',
  cost: 3,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  splitCapture: true,
  captureOffsets: [
    { x: -1, y: 1 },
    { x: 1, y: 1 },
  ],
  movement: [{ kind: 'leap', offsets: [{ x: 0, y: 1 }] }],
  abilities: [
    {
      id: 'frontBless',
      description: 'Пассивно раз за матч: +1 HP союзнику на клетке прямо перед собой.',
    },
  ],
};

/** Враги в радиусе 2 ходят как по топи. */
export const quagmireDef: PieceDefinition = {
  id: 'quagmire',
  name: 'Топь',
  baseRole: 'rook',
  isBase: false,
  description:
    'Модификация ладьи: обычные ходы. Вражеские фигуры в радиусе 2 клеток замедляются — их ход ограничен одной клеткой, как на топи.',
  cost: 4,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  marshAuraRadius: 2,
  movement: [{ kind: 'slide', directions: ORTHO, maxRange: 8 }],
};

/** Пропуск первого хода стороны; −3 к бюджету колоды. */
export const sluggardDef: PieceDefinition = {
  id: 'sluggard',
  name: 'Промедление',
  baseRole: 'rook',
  isBase: false,
  description:
    'Модификация ладьи: обычные ходы. Если эта фигура в колоде — вы пропускаете первый ход. Даёт −3 к стоимости колоды.',
  cost: -3,
  rarity: 'rare',
  maxHp: 1,
  attack: 1,
  skipFirstTurn: true,
  movement: [{ kind: 'slide', directions: ORTHO, maxRange: 8 }],
};

/** Атаки наносят 2 HP за удар. */
export const reaverDef: PieceDefinition = {
  id: 'reaver',
  name: 'Каратель',
  baseRole: 'bishop',
  isBase: false,
  description: 'Модификация слона: обычные ходы. Каждая атака наносит 2 HP.',
  cost: 4,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 2,
  movement: [{ kind: 'slide', directions: DIAG, maxRange: 8 }],
};

/** Раз за матч проклятие: враг не может вредить этому слону. */
export const hexerDef: PieceDefinition = {
  id: 'hexer',
  name: 'Проклинатель',
  baseRole: 'bishop',
  isBase: false,
  description:
    'Модификация слона: обычные ходы. Один раз за партию может наложить проклятие на вражескую фигуру — она не сможет атаковать или наносить урон этому слону.',
  cost: 4,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'slide', directions: DIAG, maxRange: 8 }],
  abilities: [
    {
      id: 'curseEnemy',
      description: 'Один раз: проклясть вражескую фигуру.',
    },
  ],
};

/** Раз за матч двойной ход, затем 2 хода стоит на месте. */
export const wayfarerDef: PieceDefinition = {
  id: 'wayfarer',
  name: 'Странник',
  baseRole: 'bishop',
  isBase: false,
  description:
    'Модификация слона: обычные ходы. Один раз за партию после хода может сходить ещё раз (или отказаться кнопкой «Закончить ход»). После второго хода стоит на месте 2 своих хода.',
  cost: 5,
  rarity: 'rare',
  maxHp: 1,
  attack: 1,
  doubleMoveOnce: { freezeAfter: 2 },
  movement: [{ kind: 'slide', directions: DIAG, maxRange: 8 }],
};

/** Раз за матч бросок копья: 2 HP по врагу на клетке конь-хода, без перемещения. */
export const javelinDef: PieceDefinition = {
  id: 'javelin',
  name: 'Копьеносец',
  baseRole: 'knight',
  isBase: false,
  description:
    'Модификация коня: обычные прыжки. Один раз за партию может вместо хода метнуть копье — нанести 2 HP вражеской фигуре на любой доступной клетке коня, оставаясь на месте.',
  cost: 4,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'leap', offsets: KNIGHT_OFFSETS }],
  abilities: [
    {
      id: 'throwSpear',
      description: 'Один раз: копьё — 2 HP по врагу на клетке конь-хода.',
    },
  ],
};

/** Рядом с королём ходит ещё и как король. */
export const escortDef: PieceDefinition = {
  id: 'escort',
  name: 'Эскорт',
  baseRole: 'knight',
  isBase: false,
  description:
    'Модификация коня: обычные прыжки коня. Если король на соседней клетке — дополнительно может ходить и атаковать как король.',
  cost: 1,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  royalEscort: true,
  movement: [{ kind: 'leap', offsets: KNIGHT_OFFSETS }],
};

/** 4 HP; после хода 1 ход стоит на месте. */
export const juggernautDef: PieceDefinition = {
  id: 'juggernaut',
  name: 'Тяжёлый конь',
  baseRole: 'knight',
  isBase: false,
  description:
    'Модификация коня: ходит как обычный конь, 4 HP. После каждого хода пропускает следующий свой ход.',
  cost: 4,
  rarity: 'uncommon',
  maxHp: 4,
  attack: 1,
  postMoveFreezeTurns: 1,
  movement: [{ kind: 'leap', offsets: KNIGHT_OFFSETS }],
};

/** Раз за матч снимает все бонусные HP у вражеской фигуры (до 1). */
export const hearteaterDef: PieceDefinition = {
  id: 'hearteater',
  name: 'Сердцеедка',
  baseRole: 'queen',
  isBase: false,
  description:
    'Модификация ферзя: обычные ходы. Один раз за партию может снять все бонусные HP у любой вражеской фигуры — остаётся 1 HP.',
  cost: 3,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'slide', directions: ALL_DIRS, maxRange: 8 }],
  abilities: [
    {
      id: 'heartEat',
      description: 'Один раз: снять бонусные HP у вражеской фигуры (до 1 HP).',
    },
  ],
};

/** Превращает равнину в шипы; фигура на клетке погибнет, если не уйдёт. */
export const thornqueenDef: PieceDefinition = {
  id: 'thornqueen',
  name: 'Шиповник',
  baseRole: 'queen',
  isBase: false,
  description:
    'Модификация ферзя: обычные ходы. Один раз за партию может превратить равнину в шипы. Если на клетке стоит фигура, у неё есть свой ход, чтобы уйти — иначе погибнет.',
  cost: 3,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  spikePlacer: true,
  movement: [{ kind: 'slide', directions: ALL_DIRS, maxRange: 8 }],
  abilities: [
    {
      id: 'spikeTile',
      description: 'Один раз: превратить равнину в шипы.',
    },
  ],
};

/** Раз за матч делает пешку невидимой для соперника на 2 его хода. */
export const veilqueenDef: PieceDefinition = {
  id: 'veilqueen',
  name: 'Покров',
  baseRole: 'queen',
  isBase: false,
  description:
    'Модификация ферзя: обычные ходы. Один раз за партию может скрыть любую свою пешку на 2 хода соперника — он не видит её в свой ход и во время вашего хода между ними.',
  cost: 6,
  rarity: 'rare',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'slide', directions: ALL_DIRS, maxRange: 8 }],
  abilities: [
    {
      id: 'cloakPawn',
      description: 'Один раз: невидимость своей пешки на 2 хода соперника.',
    },
  ],
};

/** После 10-го хода при перевесе по фигурам — раз +1 HP союзнику вместо хода. */
export const judgeDef: PieceDefinition = {
  id: 'judge',
  name: 'Судья',
  baseRole: 'king',
  isBase: false,
  description:
    'Модификация короля: обычные ходы. После 10-го хода, если у вас больше фигур на доске, один раз за партию может вместо хода дать +1 HP любой своей фигуре.',
  cost: 2,
  rarity: 'uncommon',
  maxHp: 1,
  attack: 1,
  movement: [{ kind: 'leap', offsets: ALL_DIRS }],
  abilities: [
    {
      id: 'judgeBless',
      description: 'Один раз после 10-го хода при перевесе: +1 HP союзнику.',
    },
  ],
};

export const PIECE_DEFS = [
  pawnDef,
  skirmisherDef,
  ironcladDef,
  spearmanDef,
  ramDef,
  bristlingDef,
  rookDef,
  sprinterDef,
  sentryDef,
  aegisDef,
  knightDef,
  lancerDef,
  javelinDef,
  outriderDef,
  courserDef,
  bishopDef,
  chaplainDef,
  reaverDef,
  exchangerDef,
  bastionDef,
  queenDef,
  regentDef,
  hearteaterDef,
  cryomancerDef,
  patronDef,
  kingDef,
  wardenDef,
  anchorDef,
  hierophantDef,
  dynastDef,
  clericDef,
  quagmireDef,
  sluggardDef,
  hexerDef,
  wayfarerDef,
  escortDef,
  juggernautDef,
  thornqueenDef,
  veilqueenDef,
  judgeDef,
] as const;
