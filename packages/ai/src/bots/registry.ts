import type { Bot, BotId, BotMeta } from './types.js';

export const DEFAULT_BOT_ID: BotId = 'forgefish';

const bots = new Map<BotId, Bot>();

export function registerBot(bot: Bot): void {
  bots.set(bot.meta.id, bot);
}

export function getBot(id: BotId | undefined | null): Bot {
  if (id && bots.has(id)) return bots.get(id)!;
  const fallback = bots.get(DEFAULT_BOT_ID);
  if (!fallback) {
    throw new Error(`AI bot registry is empty (missing default "${DEFAULT_BOT_ID}")`);
  }
  return fallback;
}

export function listBots(): BotMeta[] {
  const all = [...bots.values()].map((b) => b.meta);
  return all.sort((a, b) => {
    if (a.id === DEFAULT_BOT_ID) return -1;
    if (b.id === DEFAULT_BOT_ID) return 1;
    return a.label.localeCompare(b.label, 'ru');
  });
}

export function formatBotLabel(meta: BotMeta): string {
  return meta.deprecated ? `${meta.label} (неактуален)` : meta.label;
}

export function isKnownBotId(id: string): boolean {
  return bots.has(id);
}

export function clampBotId(id: string | undefined | null): BotId {
  if (id && bots.has(id)) return id;
  return DEFAULT_BOT_ID;
}
