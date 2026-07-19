import type { PieceRole, TileDefinition } from '../../match/types.js';

export const plainTile: TileDefinition = {
  id: 'plain',
  name: 'Равнина',
  description: 'Обычная клетка без эффектов.',
  passable: true,
  spawn: true,
};

export const mudTile: TileDefinition = {
  id: 'mud',
  name: 'Топь',
  description:
    'Любая фигура с этой клетки ходит не дальше чем на 1 клетку. Не действует на коня (и другие роли с иммунитетом).',
  passable: true,
  movementCap: 1,
  movementCapImmuneRoles: ['knight'] satisfies PieceRole[],
};

export const spikesTile: TileDefinition = {
  id: 'spikes',
  name: 'Шипы',
  description:
    'Опасность: после входа у фигуры есть ещё один свой ход, чтобы уйти. Если к началу следующего своего хода она всё ещё на шипах — погибает.',
  passable: true,
  spikesDoom: true,
};

export const mountainTile: TileDefinition = {
  id: 'mountain',
  name: 'Гора',
  description:
    'Высота: некоторым фигурам (например пешке) даёт +1 к дальности хода с этой клетки.',
  passable: true,
  rangeBonus: 1,
  rangeBonusRoles: ['pawn'],
};

export const caveTile: TileDefinition = {
  id: 'cave',
  name: 'Пещера',
  description:
    'Парный портал: вступив на одну пещеру, фигура мгновенно перемещается на другую свободную пещеру той же пары.',
  passable: true,
  caveGroup: 'default',
};

export const lakeTile: TileDefinition = {
  id: 'lake',
  name: 'Озеро',
  description: 'Непроходимо: фигуры не могут вставать на эту клетку.',
  passable: false,
};

export const TILE_DEFS = [
  plainTile,
  mudTile,
  spikesTile,
  mountainTile,
  caveTile,
  lakeTile,
] as const;
