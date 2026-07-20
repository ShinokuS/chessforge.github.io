# @chessforge/ai

Stockfish-style поисковый движок Chessforge на TypeScript. Правила, способности,
HP и тайлы исполняются только пакетом `@chessforge/engine`.

## Архитектура

- iterative deepening и aspiration windows;
- fail-soft PVS alpha-beta;
- quiescence для взятий, урона, freeze, push и способностей;
- transposition table с двойным 32-битным ключом;
- TT/capture/killer/counter/history ordering;
- late move reductions с полным re-search;
- отдельные soft/hard time и node limits;
- динамический root split между Web Workers;
- legacy fallback для сравнения и аварийного восстановления.

`endTurn` является настоящим игровым действием, поэтому шахматный null-move
pruning отключён. При extra move знак оценки меняется только после реальной
смены `activePlayer`.

## Использование

```ts
import { chooseCommand, searchPosition } from '@chessforge/ai';

const command = chooseCommand(state, {
  maxDepth: 8,
  timeMs: 2_000,
  nodeLimit: 500_000,
  ttBits: 18,
  skill: 10,
});

const analysis = searchPosition(state, {
  maxDepth: 10,
  timeMs: 5_000,
  nodeLimit: 1_000_000,
});
```

Для принудительного сравнения доступно `engine: 'legacy'`; основной режим —
`engine: 'stockfish'`.

## Benchmark

```bash
pnpm ai:bench

pnpm --filter @chessforge/ai bench -- \
  --depth 5 \
  --nodes 500000 \
  --time-ms 3000
```

Вывод содержит позицию, движок, глубину, nodes, NPS, время, score и лучший ход.

## Проверка

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm ai:bench
```

## Ограничения

Это не форк C++ Stockfish. Его search-подходы адаптированы к Chessforge, где
взятие может наносить частичный урон или замораживать, royal-фигура может
измениться, а extra move не всегда передаёт ход сопернику.
