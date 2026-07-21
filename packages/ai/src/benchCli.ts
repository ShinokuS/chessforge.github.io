#!/usr/bin/env node
import { renderBench, runAiBench } from './bench.js';

declare const process: {
  argv: string[];
  exitCode?: number;
};

function value(argv: string[], name: string, fallback: number): number {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const parsed = Number(argv[index + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const argv = process.argv.slice(2);
try {
  const rows = runAiBench({
    maxDepth: value(argv, '--depth', 4),
    timeMs: value(argv, '--time-ms', 2_000),
    nodeLimit: value(argv, '--nodes', 300_000),
    ttBits: value(argv, '--tt-bits', 18),
    compareLegacy: argv.includes('--compare-legacy'),
    compareForgefish: argv.includes('--compare-forgefish') || argv.includes('--compare'),
  });
  console.log(argv.includes('--json') ? JSON.stringify(rows, null, 2) : renderBench(rows));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
