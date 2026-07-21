export { evaluate, evaluateSearch, evaluateSearchFast, evaluateSearchQuiet, pieceTacticalValue, isKingEnPrise } from './evaluate.js';
export {
  chooseCommand,
  chooseCommandAsync,
  scoreRootMoves,
  searchPosition,
  searchScoreWhiteAfter,
  searchScoreCommand,
  type ChooseOptions,
  type SearchResult,
} from './search.js';
export { buildAiDeck } from './deck.js';
export { hashPosition, hashPositionPair, type PositionHashPair } from './zobrist.js';
export {
  estimateModStrength,
  featureModBonus,
  isPremiumMod,
} from './heuristics.js';
export { runAiBench, renderBench, type BenchCase, type BenchRow } from './bench.js';
export { canUseClassicFastPath } from './classic/detect.js';
export {
  clampBotId,
  DEFAULT_BOT_ID,
  formatBotLabel,
  getBot,
  isKnownBotId,
  listBots,
  registerBot,
  type Bot,
  type BotCapabilities,
  type BotId,
  type BotMeta,
} from './bots/index.js';
export { forgefishBot } from './bots/forgefish/index.js';
