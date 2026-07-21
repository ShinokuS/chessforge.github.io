import { create } from 'zustand';
import { clampBotId, DEFAULT_BOT_ID, type BotId } from '@chessforge/ai';
import type { AbilityId, Coord, GameEvent, MatchState, PlayerId } from '@chessforge/engine';
import { GameSession } from '../adapters/GameSession';
import { OnlineGameSession } from '../adapters/OnlineGameSession';
import { LocalCollectionRepository } from '../repositories/LocalCollectionRepository';
import type { Deck } from '../repositories/types.js';
import {
  appendHistoryFromEvents,
  type MoveHistoryEntry,
} from '../battle/moveHistory';
import { buildReplayPositions } from '../battle/replay';
import {
  advanceClocks,
  freshClocks,
  switchClock,
  type MatchClocks,
} from '../battle/clock';
import {
  clampAiStrength,
  timePresetMs,
  type AiStrengthLevel,
  type SidePreference,
  type TimePresetId,
} from '../battle/settings';
import {
  clampAnalysisDepth,
  clampAnalysisThreads,
  clampAnalysisTimeMs,
  DEFAULT_ANALYSIS_BOT_ID,
  DEFAULT_ANALYSIS_DEPTH,
  DEFAULT_ANALYSIS_TIME_MS,
  defaultAnalysisThreads,
  type AnalysisDepth,
  type AnalysisThreads,
  type AnalysisTimeMs,
} from '../analysis/analysisSettings';
import { type AnalyzedPly } from '../battle/analyzeGame';
import { isArmableAbility, type ArmedAction } from '../battle/abilities';
import { saveGameReplay, type SavedGame } from '../repositories/savedGames';

export type AppView = 'battle' | 'analysis' | 'collection' | 'deck' | 'library';
export type BattleMode = 'ai' | 'online';

const STRENGTH_STORAGE_KEY = 'chessforge.engine-strength.v1';
const AI_BOT_STORAGE_KEY = 'chessforge.ai-bot.v1';
const ANALYSIS_ENGINE_STORAGE_KEY = 'chessforge.analysis-engine.v6';

function readStoredAiStrength(): AiStrengthLevel {
  try {
    const raw = localStorage.getItem(STRENGTH_STORAGE_KEY);
    if (!raw) return 6;
    const parsed = JSON.parse(raw) as { ai?: number };
    return clampAiStrength(parsed.ai ?? 6);
  } catch {
    return 6;
  }
}

function writeStoredAiStrength(ai: AiStrengthLevel): void {
  try {
    localStorage.setItem(STRENGTH_STORAGE_KEY, JSON.stringify({ ai }));
  } catch {
    /* ignore */
  }
}

function readStoredAiBotId(): BotId {
  try {
    const raw = localStorage.getItem(AI_BOT_STORAGE_KEY);
    if (!raw) return DEFAULT_BOT_ID;
    const parsed = JSON.parse(raw) as { botId?: string };
    return clampBotId(parsed.botId);
  } catch {
    return DEFAULT_BOT_ID;
  }
}

function writeStoredAiBotId(botId: BotId): void {
  try {
    localStorage.setItem(AI_BOT_STORAGE_KEY, JSON.stringify({ botId }));
  } catch {
    /* ignore */
  }
}

type StoredAnalysisEngine = {
  timeMs: AnalysisTimeMs;
  depth: AnalysisDepth;
  threads: AnalysisThreads;
  botId: BotId;
};

function readStoredAnalysisEngine(): StoredAnalysisEngine {
  try {
    const raw = localStorage.getItem(ANALYSIS_ENGINE_STORAGE_KEY);
    if (!raw) {
      return {
        timeMs: DEFAULT_ANALYSIS_TIME_MS,
        depth: DEFAULT_ANALYSIS_DEPTH,
        threads: defaultAnalysisThreads(),
        botId: DEFAULT_ANALYSIS_BOT_ID,
      };
    }
    const parsed = JSON.parse(raw) as {
      timeMs?: number;
      depth?: number;
      threads?: number;
      botId?: string;
    };
    return {
      timeMs: clampAnalysisTimeMs(parsed.timeMs ?? DEFAULT_ANALYSIS_TIME_MS),
      depth: clampAnalysisDepth(parsed.depth ?? DEFAULT_ANALYSIS_DEPTH),
      threads: clampAnalysisThreads(parsed.threads ?? defaultAnalysisThreads()),
      botId: clampBotId(parsed.botId ?? DEFAULT_ANALYSIS_BOT_ID),
    };
  } catch {
    return {
      timeMs: DEFAULT_ANALYSIS_TIME_MS,
      depth: DEFAULT_ANALYSIS_DEPTH,
      threads: defaultAnalysisThreads(),
      botId: DEFAULT_ANALYSIS_BOT_ID,
    };
  }
}

function writeStoredAnalysisEngine(next: StoredAnalysisEngine): void {
  try {
    localStorage.setItem(ANALYSIS_ENGINE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export type LastMoveHighlight = {
  from: Coord;
  to: Coord;
};

export type EndBanner = {
  kind: 'victory' | 'timeout' | 'resign';
  winner: PlayerId;
  /** Who resigned (only for kind === 'resign'). */
  loser?: PlayerId;
};

export type GameAnalysis = {
  status: 'idle' | 'running' | 'done' | 'error';
  progress: { done: number; total: number };
  plies: AnalyzedPly[];
  positions: MatchState[];
  /** 0 = стартовая позиция, n = после n-го полухода. */
  cursor: number;
  error: string | null;
};

const idleAnalysis = (): GameAnalysis => ({
  status: 'idle',
  progress: { done: 0, total: 0 },
  plies: [],
  positions: [],
  cursor: 0,
  error: null,
});

function lastMoveFromEvents(events: GameEvent[]): LastMoveHighlight | null {
  let from: Coord | null = null;
  let to: Coord | null = null;
  for (const e of events) {
    if (e.type === 'Moved') {
      from = e.from;
      to = e.to;
    } else if (e.type === 'Castled') {
      from = e.kingFrom;
      to = e.kingTo;
    } else if (e.type === 'Swapped') {
      from = e.from;
      to = e.to;
    } else if (e.type === 'Damaged' || e.type === 'Frozen') {
      from = e.from;
      to = e.at;
    } else if (e.type === 'Teleported') {
      if (from) to = e.to;
      else {
        from = e.from;
        to = e.to;
      }
    }
  }
  return from && to ? { from, to } : null;
}

type AppStore = {
  view: AppView;
  setView: (view: AppView) => void;
  battleMode: BattleMode;
  setBattleMode: (mode: BattleMode) => void;
  aiPlaying: boolean;
  aiStrength: AiStrengthLevel;
  setAiStrength: (v: AiStrengthLevel) => void;
  aiBotId: BotId;
  setAiBotId: (v: BotId) => void;
  /** Analysis board max search time (ms). */
  analysisTimeMs: AnalysisTimeMs;
  setAnalysisTimeMs: (v: AnalysisTimeMs) => void;
  /** Analysis board max search depth. */
  analysisDepth: AnalysisDepth;
  setAnalysisDepth: (v: AnalysisDepth) => void;
  /** Analysis board worker threads (no upper cap). */
  analysisThreads: AnalysisThreads;
  setAnalysisThreads: (v: AnalysisThreads) => void;
  analysisBotId: BotId;
  setAnalysisBotId: (v: BotId) => void;
  aiTimePreset: TimePresetId;
  setAiTimePreset: (v: TimePresetId) => void;
  onlineTimePreset: TimePresetId;
  setOnlineTimePreset: (v: TimePresetId) => void;
  onlineSide: SidePreference;
  setOnlineSide: (v: SidePreference) => void;
  session: GameSession;
  online: OnlineGameSession;
  state: MatchState;
  events: GameEvent[];
  moveHistory: MoveHistoryEntry[];
  lastMove: LastMoveHighlight | null;
  /** Piece defIds captured by each side (Lichess-style material). */
  captures: { white: string[]; black: string[] };
  clocks: MatchClocks;
  endBanner: EndBanner | null;
  analysis: GameAnalysis;
  lastError: string | null;
  selected: Coord | null;
  setSelected: (c: Coord | null) => void;
  /** Armed optional action (curse, heal, spikes, ram push…) — null = normal move mode. */
  abilityArmed: ArmedAction | null;
  setAbilityArmed: (id: ArmedAction | null) => void;
  repo: LocalCollectionRepository;
  activeDeckId: string;
  setActiveDeckId: (id: string) => void;
  refreshMeta: () => void;
  cards: ReturnType<LocalCollectionRepository['listCards']>;
  decks: Deck[];
  submitMove: (to: Coord, abilityId?: AbilityId) => void;
  /** Decline optional second move (e.g. Wayfarer) without spending the ability. */
  finishExtraMove: () => void;
  startAiMatch: () => void;
  restart: () => void;
  saveDeck: (deck: Deck, opts?: { startBattle?: boolean; makeActive?: boolean }) => void;
  deleteDeck: (id: string) => void;
  canControl: (owner: PlayerId) => boolean;
  resetClocks: (active: PlayerId | null, initialMs?: number) => void;
  tickClock: () => void;
  dismissEndBanner: () => void;
  /** Save finished AI/online game and open it on the Analysis tab. */
  saveAndOpenAnalysis: () => SavedGame | null;
  /** Analysis tab loads this saved game id once, then clears. */
  pendingAnalysisId: string | null;
  consumePendingAnalysisId: () => string | null;
  setAnalysisCursor: (cursor: number) => void;
  clearAnalysis: () => void;
  /** Live game history scrubber: 'live' = current position, number = replay index. */
  liveReviewCursor: number | 'live';
  liveReviewPositions: MatchState[];
  setLiveReviewCursor: (cursor: number | 'live') => void;
  goToLivePosition: () => void;
  resign: () => void;
};

const repo = new LocalCollectionRepository();
const session = new GameSession('offline-ai');
const online = new OnlineGameSession();

const initialRoom =
  typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('room') ?? '')
    : '';

function openingSkipEntries(state: MatchState): MoveHistoryEntry[] {
  const openingSkips = state.openingSkipSequence;
  if (!openingSkips || openingSkips.length === 0) return [];
  return openingSkips.map((player, idx) => {
    const ply = idx + 1;
    return {
      ply,
      turn: Math.ceil(ply / 2),
      player,
      text: 'Промедление: пропуск первого хода',
      kind: 'ply',
    };
  });
}

function syncLiveReview(
  battleMode: BattleMode,
  session: GameSession,
  online: OnlineGameSession,
  prevCursor: number | 'live',
  prevPositions: MatchState[],
): { liveReviewCursor: number | 'live'; liveReviewPositions: MatchState[] } {
  const active = battleMode === 'online' ? online : session;
  const replay = active.getReplay();
  if (!replay) {
    return { liveReviewCursor: 'live', liveReviewPositions: [] };
  }
  const positions = buildReplayPositions(replay.opening, replay.commands);
  if (positions.length <= 1) {
    return { liveReviewCursor: 'live', liveReviewPositions: positions };
  }
  const wasAtLive =
    prevCursor === 'live' ||
    (typeof prevCursor === 'number' && prevCursor >= Math.max(0, prevPositions.length - 1));
  if (wasAtLive) {
    return { liveReviewCursor: 'live', liveReviewPositions: positions };
  }
  const c = Math.max(
    0,
    Math.min(typeof prevCursor === 'number' ? prevCursor : 0, positions.length - 1),
  );
  if (c >= positions.length - 1) {
    return { liveReviewCursor: 'live', liveReviewPositions: positions };
  }
  return { liveReviewCursor: c, liveReviewPositions: positions };
}

export const useAppStore = create<AppStore>((set, get) => {
  const appendEvents = (
    mode: BattleMode,
    state: MatchState,
    events: GameEvent[],
    lastError: string | null,
  ) => {
    if (get().battleMode !== mode) return;
    if (events.length === 0) {
      const currentMoveHistory = get().moveHistory;
      const entries = openingSkipEntries(state);
      // matchStart / restart emit empty batches on a fresh turn-1 board.
      const freshOpening =
        state.phase === 'play' && state.turn === 1 && !state.extraMovePieceId;
      if (freshOpening && (currentMoveHistory.length === 0 || entries.length > 0 || mode === 'online')) {
        const liveReview = syncLiveReview(
          mode,
          get().session,
          get().online,
          get().liveReviewCursor,
          get().liveReviewPositions,
        );
        set({
          state,
          events,
          lastError,
          moveHistory: entries,
          lastMove: null,
          ...liveReview,
          ...(mode === 'online'
            ? { captures: { white: [] as string[], black: [] as string[] } }
            : {}),
        });
      } else if (entries.length > 0 && currentMoveHistory.length === 0) {
        const liveReview = syncLiveReview(
          mode,
          get().session,
          get().online,
          get().liveReviewCursor,
          get().liveReviewPositions,
        );
        set({
          state,
          events,
          lastError,
          moveHistory: entries,
          lastMove: null,
          ...liveReview,
        });
      } else {
        set({ state, events, lastError });
      }
      return;
    }
    const { moveHistory, clocks, captures } = get();
    const beforeState = get().state;
    const continueExtraMove = Boolean(beforeState.extraMovePieceId);
    const seeded =
      moveHistory.length === 0 ? openingSkipEntries(state) : moveHistory;
    const nextHistory = appendHistoryFromEvents(seeded, events, state, {
      continueExtraMove,
    });
    const move = lastMoveFromEvents(events);

    let nextClocks = clocks;
    let endBanner = get().endBanner;
    const nextCaptures = {
      white: [...captures.white],
      black: [...captures.black],
    };
    for (const e of events) {
      if (e.type === 'Captured') {
        const victim = beforeState.pieces.find((p) => p.id === e.pieceId);
        if (victim) {
          const capturer = victim.owner === 'white' ? 'black' : 'white';
          nextCaptures[capturer].push(e.defId);
        }
      }
      if (e.type === 'TurnEnded') {
        nextClocks = switchClock(nextClocks, e.next);
      }
      if (e.type === 'GameOver') {
        nextClocks = {
          ...advanceClocks(nextClocks).clocks,
          active: null,
          lastTickAt: null,
        };
        const existing = get().endBanner;
        if (existing?.kind === 'resign' || existing?.kind === 'timeout') {
          endBanner = existing;
        } else if (events.length === 1) {
          endBanner = {
            kind: 'resign',
            winner: e.winner,
            loser: e.winner === 'white' ? 'black' : 'white',
          };
        } else {
          endBanner = { kind: 'victory', winner: e.winner };
        }
      }
    }

    set({
      state,
      events,
      lastError,
      clocks: nextClocks,
      endBanner,
      captures: nextCaptures,
      moveHistory: nextHistory,
      ...syncLiveReview(
        mode,
        get().session,
        get().online,
        get().liveReviewCursor,
        get().liveReviewPositions,
      ),
      ...(move ? { lastMove: move } : {}),
    });
  };

  queueMicrotask(() => {
    session.subscribe(({ state, events, lastError }) => {
      appendEvents('ai', state, events, lastError);
    });
    online.subscribe(({ state, events, lastError }) => {
      appendEvents('online', state, events, lastError);
    });
  });

  const storedAnalysis = readStoredAnalysisEngine();
  const initialAiStrength = readStoredAiStrength();
  const initialAiBotId = readStoredAiBotId();
  session.setAiBot(initialAiBotId);
  session.setAiStrength(initialAiStrength);

  return {
    view: 'battle',
    setView: (view) => set({ view }),
    battleMode: initialRoom ? 'online' : 'ai',
    aiPlaying: false,
    pendingAnalysisId: null,
    consumePendingAnalysisId: () => {
      const id = get().pendingAnalysisId;
      if (id) set({ pendingAnalysisId: null });
      return id;
    },
    aiStrength: initialAiStrength,
    setAiStrength: (aiStrength) => {
      const next = clampAiStrength(aiStrength);
      writeStoredAiStrength(next);
      get().session.setAiStrength(next);
      set({ aiStrength: next });
    },
    aiBotId: initialAiBotId,
    setAiBotId: (aiBotId) => {
      const next = clampBotId(aiBotId);
      writeStoredAiBotId(next);
      get().session.setAiBot(next);
      set({ aiBotId: next });
    },
    analysisTimeMs: storedAnalysis.timeMs,
    setAnalysisTimeMs: (analysisTimeMs) => {
      const next = clampAnalysisTimeMs(analysisTimeMs);
      writeStoredAnalysisEngine({
        timeMs: next,
        depth: get().analysisDepth,
        threads: get().analysisThreads,
        botId: get().analysisBotId,
      });
      set({ analysisTimeMs: next });
    },
    analysisDepth: storedAnalysis.depth,
    setAnalysisDepth: (analysisDepth) => {
      const next = clampAnalysisDepth(analysisDepth);
      writeStoredAnalysisEngine({
        timeMs: get().analysisTimeMs,
        depth: next,
        threads: get().analysisThreads,
        botId: get().analysisBotId,
      });
      set({ analysisDepth: next });
    },
    analysisThreads: storedAnalysis.threads,
    setAnalysisThreads: (analysisThreads) => {
      const next = clampAnalysisThreads(analysisThreads);
      writeStoredAnalysisEngine({
        timeMs: get().analysisTimeMs,
        depth: get().analysisDepth,
        threads: next,
        botId: get().analysisBotId,
      });
      set({ analysisThreads: next });
    },
    analysisBotId: storedAnalysis.botId,
    setAnalysisBotId: (analysisBotId) => {
      const next = clampBotId(analysisBotId);
      writeStoredAnalysisEngine({
        timeMs: get().analysisTimeMs,
        depth: get().analysisDepth,
        threads: get().analysisThreads,
        botId: next,
      });
      set({ analysisBotId: next });
    },
    aiTimePreset: '10',
    setAiTimePreset: (aiTimePreset) => set({ aiTimePreset }),
    onlineTimePreset: '10',
    setOnlineTimePreset: (onlineTimePreset) => set({ onlineTimePreset }),
    onlineSide: 'white',
    setOnlineSide: (onlineSide) => set({ onlineSide }),
    setBattleMode: (battleMode) => {
      const { online: o } = get();
      if (battleMode === 'ai') {
        o.disconnect();
        set({
          battleMode,
          aiPlaying: false,
          selected: null,
          moveHistory: [],
          lastMove: null,
          captures: { white: [], black: [] },
          lastError: null,
          endBanner: null,
          analysis: idleAnalysis(),
          liveReviewCursor: 'live',
          liveReviewPositions: [],
          clocks: freshClocks(null),
          state: session.getState(),
        });
        return;
      }
      set({
        battleMode,
        aiPlaying: false,
        selected: null,
        moveHistory: [],
        lastMove: null,
        captures: { white: [], black: [] },
        lastError: null,
        endBanner: null,
        analysis: idleAnalysis(),
        liveReviewCursor: 'live',
        liveReviewPositions: [],
        clocks: freshClocks(null),
        state: o.getState(),
      });
    },
    session,
    online,
    state: session.getState(),
    events: [],
    moveHistory: [],
    lastMove: null,
    captures: { white: [], black: [] },
    clocks: freshClocks(null),
    endBanner: null,
    analysis: idleAnalysis(),
    lastError: null,
    selected: null,
    abilityArmed: null,
    setSelected: (selected) => set({ selected, abilityArmed: null }),
    setAbilityArmed: (abilityArmed) => set({ abilityArmed }),
    repo,
    activeDeckId: 'starter',
    setActiveDeckId: (activeDeckId) => set({ activeDeckId }),
    cards: repo.listCards(),
    decks: repo.listDecks(),
    refreshMeta: () =>
      set({
        cards: repo.listCards(),
        decks: repo.listDecks(),
      }),
    canControl: (owner) => {
      const { battleMode, online: o, endBanner, state, aiPlaying } = get();
      if (endBanner || state.phase === 'gameOver') return false;
      if (battleMode === 'ai') return aiPlaying && owner === 'white';
      return o.getMyColor() === owner;
    },
    resetClocks: (active, initialMs) => {
      const { battleMode, aiTimePreset, onlineTimePreset } = get();
      const ms =
        initialMs ??
        timePresetMs(battleMode === 'ai' ? aiTimePreset : onlineTimePreset);
      set({ clocks: freshClocks(active, ms), endBanner: null });
    },
    tickClock: () => {
      const { clocks, endBanner, state, battleMode, online: o, session: s, aiPlaying } =
        get();
      if (endBanner || state.phase === 'gameOver') return;
      const shouldRun =
        battleMode === 'ai'
          ? aiPlaying && state.phase === 'play'
          : o.getStatus() === 'playing' && state.phase === 'play';
      if (!shouldRun || !clocks.active) return;
      const { clocks: next, timeoutWinner } = advanceClocks(clocks);
      if (timeoutWinner) {
        set({
          clocks: next,
          endBanner: { kind: 'timeout', winner: timeoutWinner },
          selected: null,
        });
        if (battleMode === 'ai') s.endByTimeout(timeoutWinner);
        else o.endByTimeout(timeoutWinner);
        return;
      }
      set({ clocks: next });
    },
    dismissEndBanner: () => {
      const { battleMode, analysis } = get();
      if (battleMode === 'ai') {
        // Keep board if analysis is open / running.
        const keepBoard = analysis.status === 'running' || analysis.status === 'done';
        set({
          endBanner: null,
          aiPlaying: keepBoard,
          selected: null,
        });
        return;
      }
      set({ endBanner: null });
    },
    resign: () => {
      const { battleMode, session: s, online: o, endBanner, state, aiPlaying, liveReviewCursor } = get();
      if (liveReviewCursor !== 'live') return;
      if (endBanner || state.phase === 'gameOver') return;

      if (battleMode === 'ai') {
        if (!aiPlaying || state.phase !== 'play') return;
        set({
          endBanner: { kind: 'resign', winner: 'black', loser: 'white' },
          selected: null,
        });
        s.resign('white');
        return;
      }

      if (o.getStatus() !== 'playing' || state.phase !== 'play') return;
      const myColor = o.getMyColor();
      if (!myColor) return;
      set({
        endBanner: {
          kind: 'resign',
          winner: myColor === 'white' ? 'black' : 'white',
          loser: myColor,
        },
        selected: null,
      });
      o.resign();
    },
    saveAndOpenAnalysis: () => {
      const { session: s, online: o, battleMode, state, endBanner } = get();
      const source = battleMode === 'online' ? 'online' : 'ai';
      const active = battleMode === 'online' ? o : s;
      const replay = active.getReplay();
      if (!replay || replay.commands.length === 0) {
        return null;
      }
      const winner =
        state.winner ??
        endBanner?.winner ??
        (state.phase === 'gameOver' ? state.winner : null) ??
        null;
      const saved = saveGameReplay({
        source,
        opening: replay.opening,
        commands: replay.commands,
        winner,
        myColor: battleMode === 'online' ? o.getMyColor() : 'white',
      });
      set({
        endBanner: null,
        selected: null,
        abilityArmed: null,
        analysis: idleAnalysis(),
        pendingAnalysisId: saved.id,
        view: 'analysis',
        ...(battleMode === 'ai' ? { aiPlaying: true } : {}),
      });
      return saved;
    },
    setAnalysisCursor: (cursor) => {
      const { analysis } = get();
      if (analysis.status !== 'done' || analysis.positions.length === 0) return;
      const c = Math.max(0, Math.min(analysis.positions.length - 1, Math.floor(cursor)));
      set({ analysis: { ...analysis, cursor: c }, selected: null, abilityArmed: null });
    },
    clearAnalysis: () => set({ analysis: idleAnalysis() }),
    liveReviewCursor: 'live',
    liveReviewPositions: [],
    setLiveReviewCursor: (cursor) => {
      const { liveReviewPositions, analysis } = get();
      if (analysis.status === 'done' || analysis.status === 'running') return;
      if (liveReviewPositions.length === 0) {
        set({ liveReviewCursor: 'live', selected: null, abilityArmed: null });
        return;
      }
      if (cursor === 'live') {
        set({ liveReviewCursor: 'live', selected: null, abilityArmed: null });
        return;
      }
      const c = Math.max(0, Math.min(liveReviewPositions.length - 1, Math.floor(cursor)));
      if (c >= liveReviewPositions.length - 1) {
        set({ liveReviewCursor: 'live', selected: null, abilityArmed: null });
      } else {
        set({ liveReviewCursor: c, selected: null, abilityArmed: null });
      }
    },
    goToLivePosition: () => {
      get().setLiveReviewCursor('live');
    },
    submitMove: (to, abilityId) => {
      const {
        selected,
        abilityArmed,
        battleMode,
        session: s,
        online: o,
        canControl,
        state,
        endBanner,
        aiPlaying,
        liveReviewCursor,
      } = get();
      if (liveReviewCursor !== 'live') return;
      if (endBanner || state.phase === 'gameOver') return;
      if (battleMode === 'ai' && !aiPlaying) return;
      if (!selected) return;
      const piece = state.pieces.find(
        (p) => p.pos.x === selected.x && p.pos.y === selected.y,
      );
      if (!piece || !canControl(piece.owner)) return;

      const active = battleMode === 'online' ? o : s;
      const moves = active
        .getLegalMovesFrom(selected)
        .filter((m) => m.to.x === to.x && m.to.y === to.y);

      const wantAbility = abilityId ?? (abilityArmed && abilityArmed !== 'push' ? abilityArmed : undefined);
      const wantPush = abilityArmed === 'push';
      let legal;
      if (wantPush) {
        legal = moves.find((m) => Boolean(m.push));
      } else if (wantAbility) {
        legal = moves.find((m) => m.abilityId === wantAbility);
      } else {
        // Prefer a plain move/capture — never auto-pick push or optional ability.
        legal =
          moves.find((m) => !m.abilityId && !m.push) ??
          moves.find((m) => Boolean(m.castle)) ??
          moves[0];
        if (legal?.push) return;
        if (legal?.abilityId && isArmableAbility(legal.abilityId)) return;
      }
      if (!legal) return;
      if (abilityArmed === 'push' && !legal.push) return;
      if (
        abilityArmed &&
        abilityArmed !== 'push' &&
        legal.abilityId !== abilityArmed
      ) {
        return;
      }

      const ok = active.submitCommand({
        type: 'move',
        from: selected,
        to,
        ...(legal.abilityId !== undefined ? { abilityId: legal.abilityId } : {}),
        ...(legal.push ? { push: true } : {}),
      });
      if (!ok) return;
      set({ selected: null, abilityArmed: null });
    },
    finishExtraMove: () => {
      const { battleMode, session: s, online: o, canControl, state, endBanner, aiPlaying, liveReviewCursor } =
        get();
      if (liveReviewCursor !== 'live') return;
      if (endBanner || state.phase === 'gameOver' || state.phase !== 'play') return;
      if (battleMode === 'ai' && !aiPlaying) return;
      if (!state.extraMovePieceId) return;
      const piece = state.pieces.find((p) => p.id === state.extraMovePieceId);
      if (!piece || !canControl(piece.owner)) return;
      if (state.activePlayer !== piece.owner) return;

      const active = battleMode === 'online' ? o : s;
      const ok = active.submitCommand({ type: 'endTurn' });
      if (!ok) return;
      set({ selected: null, abilityArmed: null });
    },
    startAiMatch: () => {
      const { repo: r, activeDeckId, session: s, aiStrength, aiBotId, aiTimePreset } = get();
      const deck = r.getDeck(activeDeckId);
      if (!deck || deck.placements.length < 16) {
        set({ lastError: 'Выберите полную сохранённую колоду' });
        return;
      }
      s.setAiBot(aiBotId);
      s.setAiStrength(aiStrength);
      s.restart(deck);
      const startState = s.getState();
      const ms = timePresetMs(aiTimePreset);
      const openingHistory = openingSkipEntries(startState);
      const replay = s.getReplay();
      const liveReviewPositions = replay
        ? buildReplayPositions(replay.opening, replay.commands)
        : [];
      set({
        aiPlaying: true,
        selected: null,
        moveHistory: openingHistory,
        lastMove: null,
        captures: { white: [], black: [] },
        lastError: null,
        endBanner: null,
        analysis: idleAnalysis(),
        liveReviewCursor: 'live',
        liveReviewPositions,
        clocks: freshClocks(startState.activePlayer, ms),
        state: startState,
        view: 'battle',
        battleMode: 'ai',
      });
    },
    restart: () => {
      const { battleMode, online: o } = get();
      if (battleMode === 'online') {
        o.disconnect();
        set({
          selected: null,
          moveHistory: [],
          lastMove: null,
          captures: { white: [], black: [] },
          lastError: null,
          endBanner: null,
          analysis: idleAnalysis(),
          liveReviewCursor: 'live',
          liveReviewPositions: [],
          clocks: freshClocks(null),
          state: o.getState(),
        });
        return;
      }
      set({
        aiPlaying: false,
        selected: null,
        moveHistory: [],
        lastMove: null,
        captures: { white: [], black: [] },
        lastError: null,
        endBanner: null,
        analysis: idleAnalysis(),
        liveReviewCursor: 'live',
        liveReviewPositions: [],
        clocks: freshClocks(null),
        state: session.getState(),
      });
    },
    saveDeck: (deck, opts) => {
      repo.saveDeck(deck);
      const startBattle = opts?.startBattle ?? false;
      const makeActive = opts?.makeActive ?? true;
      const patch: Partial<AppStore> = {
        decks: repo.listDecks(),
        selected: null,
      };
      if (makeActive) patch.activeDeckId = deck.id;
      if (startBattle) {
        patch.view = 'battle';
        patch.battleMode = 'ai';
        patch.aiPlaying = false;
        patch.endBanner = null;
        patch.clocks = freshClocks(null);
      }
      set(patch);
    },
    deleteDeck: (id) => {
      if (id === 'starter') return;
      repo.deleteDeck(id);
      const decks = repo.listDecks();
      const { activeDeckId } = get();
      set({
        decks,
        activeDeckId: activeDeckId === id ? (decks[0]?.id ?? 'starter') : activeDeckId,
      });
    },
  };
});
