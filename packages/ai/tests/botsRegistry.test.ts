import { describe, expect, it } from 'vitest';
import {
  clampBotId,
  DEFAULT_BOT_ID,
  getBot,
  listBots,
} from '../src/index.js';

describe('bot registry', () => {
  it('registers stockfish, forgefish and legacy', () => {
    const ids = listBots().map((b) => b.id).sort();
    expect(ids).toEqual(['forgefish', 'legacy', 'stockfish']);
  });

  it('defaults unknown ids to forgefish', () => {
    expect(clampBotId('nope')).toBe(DEFAULT_BOT_ID);
    expect(getBot(undefined).meta.id).toBe('forgefish');
    expect(getBot('legacy').meta.capabilities.rootSplit).toBe(false);
    expect(getBot('stockfish').meta.capabilities.lazySmp).toBe(true);
  });

  it('marks legacy engines as deprecated in labels', () => {
    const stockfish = getBot('stockfish').meta;
    const legacy = getBot('legacy').meta;
    const forgefish = getBot('forgefish').meta;
    expect(stockfish.deprecated).toBe(true);
    expect(legacy.deprecated).toBe(true);
    expect(forgefish.deprecated).toBeFalsy();
  });
});
