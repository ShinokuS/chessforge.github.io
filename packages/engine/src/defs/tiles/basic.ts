import type { TileDefinition } from '../../match/types.js';
import type { PieceRole } from '../../match/types.js';

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
    'Парный портал: стоя на пещере, можно сходить на другую свободную пещеру той же пары (вместо обычного хода). Телепорт не срабатывает сам при входе.',
  passable: true,
  caveGroup: 'default',
};

export const lakeTile: TileDefinition = {
  id: 'lake',
  name: 'Озеро',
  description: 'Непроходимо: фигуры не могут вставать на эту клетку.',
  passable: false,
};

export const windTile: TileDefinition = {
  id: 'wind',
  name: 'Ветер',
  description:
    'Встав на клетку, фигура ждёт ход противника: после него её сносит на 1 клетку назад (от направления стороны), если целевая клетка свободна и проходима.',
  passable: true,
  windPush: true,
};

export const forestTile: TileDefinition = {
  id: 'forest',
  name: 'Лес',
  description:
    'Укрытие: фигура, вступившая на лес, неуязвима один свой ход (её нельзя ударить, съесть или заморозить, пока щит активен).',
  passable: true,
  forestShield: true,
};

export const mushroomTile: TileDefinition = {
  id: 'mushroom',
  name: 'Гриб',
  description:
    'Усиление: фигура, вступившая на гриб, получает +1 HP. После этого клетка становится равниной.',
  passable: true,
  mushroomHeal: true,
};

export const TILE_DEFS = [
  plainTile,
  mudTile,
  spikesTile,
  mountainTile,
  caveTile,
  lakeTile,
  windTile,
  forestTile,
  mushroomTile,
] as const;

/** Terrain pool for random symmetric battlefield generation. */
export const GENERATABLE_TILE_IDS = [
  'mud',
  'spikes',
  'mountain',
  'cave',
  'lake',
  'wind',
  'forest',
  'mushroom',
] as const;
