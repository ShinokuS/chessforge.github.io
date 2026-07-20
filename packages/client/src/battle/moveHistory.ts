/** Re-export history helpers from the engine (single source of truth). */
export {
  formatEventsToHistory,
  appendHistoryFromEvents,
  groupHistoryForDisplay,
  assignDisplayTurns,
  historyTextForViewer,
  historyForViewer,
  type MoveHistoryEntry,
  type HistoryTurnRow,
  type HistoryDisplayBlock,
} from '@chessforge/engine';
