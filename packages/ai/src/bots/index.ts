import { registerBot } from './registry.js';
import { legacyBot, chooseLegacy, chooseLegacyAsync, searchLegacyPosition } from './legacy/index.js';
import { forgefishBot } from './forgefish/index.js';
import { stockfishBot } from './stockfish/index.js';

registerBot(forgefishBot);
registerBot(stockfishBot);
registerBot(legacyBot);

export type { Bot, BotCapabilities, BotId, BotMeta } from './types.js';
export {
  clampBotId,
  DEFAULT_BOT_ID,
  formatBotLabel,
  getBot,
  isKnownBotId,
  listBots,
  registerBot,
} from './registry.js';
export { stockfishBot } from './stockfish/index.js';
export { forgefishBot } from './forgefish/index.js';
export { legacyBot, chooseLegacy, chooseLegacyAsync, searchLegacyPosition } from './legacy/index.js';
