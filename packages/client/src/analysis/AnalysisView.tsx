import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { formatBotLabel, getBot } from '@chessforge/ai';
import {
  listTileDefinitions,
  type Coord,
  type GameCommand,
  type MatchState,
  type PlayerId,
} from '@chessforge/engine';
import { useAppStore } from '../app/store';
import {
  formatEvalCp,
} from '../battle/analyzeGame';
import { AnalysisEngineSettingsButton } from './AnalysisEngineSettings';
import { SavedGamesMenu } from './SavedGamesMenu';
import { PieceIcon } from '../battle/PieceIcon';
import {
  getSavedGame,
  type SavedGame,
} from '../repositories/savedGames';
import { AnalysisBoard } from './AnalysisBoard';
import styles from './AnalysisView.module.css';
import {
  applyEditorBrush,
  battlefieldAnalysisBoard,
  classicAnalysisBoard,
  emptyAnalysisBoard,
  evalBarPercent,
  formatAnalysisMove,
  palettePieces,
  setActivePlayer,
  tryPlayCommand,
  type AnalysisMode,
  type EditorBrush,
} from './analysisHelpers';
import {
  buildTreeHistory,
  createRootNode,
  deletePath,
  getNodeAt,
  keepMainlineOnly,
  mainlineGraphPaths,
  pathEquals,
  pathMatchesMove,
  playAtPath,
  playPvAtPath,
  promotePath,
  replayToTree,
  stepPath,
  type AnalysisNode,
  type AnalysisPath,
  type TreeHistoryBlock,
  type TreeHistoryMove,
} from './analysisTree';
import { useAnalysisEngine, getCachedEval, subscribeEvalCache, beginExclusiveAnalysis, endExclusiveAnalysis } from './useAnalysisEngine';
import { AnalysisEvalGraph } from './AnalysisEvalGraph';
import {
  analyzeFullGame,
  formatAnalysisElapsed,
  formatAnalysisEta,
  fullGameProgressPercent,
  FULL_GAME_DEPTH,
  type FullGameProgress,
} from './analyzeFullGame';
import {
  buildMainlineJudgments,
  hydrateJudgments,
  judgmentForMove,
  judgmentGlyph,
  judgmentLabel,
  restoreMainlineJudgments,
  serializeJudgments,
  type MoveJudgment,
  type MoveJudgmentInfo,
} from './moveJudgment';
import { clearCachedJudgmentsForStates } from './judgmentCacheStorage';
import { getAiPool } from '../ai/AiWorkerPool';
import {
  deleteAnalysisSession,
  hydrateAnalysisSession,
  loadAnalysisSession,
  scheduleSaveAnalysisSession,
  serializeAnalysisSession,
} from './analysisSessionStorage';

const JUDGMENT_CLASS: Record<MoveJudgment, string> = {
  best: styles.jBest ?? '',
  excellent: styles.jExcellent ?? '',
  good: styles.jGood ?? '',
  inaccuracy: styles.jInaccuracy ?? '',
  mistake: styles.jMistake ?? '',
  blunder: styles.jBlunder ?? '',
};

type ContextMenuState = {
  x: number;
  y: number;
  path: AnalysisPath;
};

function endOfLine(root: AnalysisNode, path: AnalysisPath): AnalysisPath {
  let cur = path;
  for (;;) {
    const node = getNodeAt(root, cur);
    if (!node || node.children.length === 0) return cur;
    cur = [...cur, 0];
  }
}

export function AnalysisView() {
  const consumePendingAnalysisId = useAppStore((s) => s.consumePendingAnalysisId);
  const analysisDepth = useAppStore((s) => s.analysisDepth);
  const setAnalysisDepth = useAppStore((s) => s.setAnalysisDepth);
  const analysisThreads = useAppStore((s) => s.analysisThreads);
  const setAnalysisThreads = useAppStore((s) => s.setAnalysisThreads);
  const analysisBotId = useAppStore((s) => s.analysisBotId);
  const setAnalysisBotId = useAppStore((s) => s.setAnalysisBotId);
  const analysisBotLabel = formatBotLabel(getBot(analysisBotId).meta);
  const [mode, setMode] = useState<AnalysisMode>('play');
  const [root, setRoot] = useState<AnalysisNode>(() => createRootNode(classicAnalysisBoard()));
  const [path, setPath] = useState<AnalysisPath>([]);
  const [flipped, setFlipped] = useState(false);
  const [engineOn, setEngineOn] = useState(true);
  const [brushOwner, setBrushOwner] = useState<PlayerId>('white');
  const [brush, setBrush] = useState<EditorBrush | null>({
    kind: 'piece',
    defId: 'king',
    owner: 'white',
  });
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [boardHeight, setBoardHeight] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [cacheTick, setCacheTick] = useState(0);
  const [fullGameProgress, setFullGameProgress] = useState<FullGameProgress | null>(null);
  const [fullGameError, setFullGameError] = useState<string | null>(null);
  /** Set after «Анализ партии» finishes — Lichess-style move marks. */
  const [moveJudgments, setMoveJudgments] = useState<Map<string, MoveJudgmentInfo> | null>(
    null,
  );
  const fullGameAbortRef = useRef<AbortController | null>(null);
  const evalBarRef = useRef<HTMLDivElement>(null);
  const movesScrollRef = useRef<HTMLDivElement>(null);
  const activeMoveRef = useRef<HTMLElement | null>(null);

  const cursorNode = getNodeAt(root, path) ?? root;
  const state = cursorNode.state;
  const fullGameRunning = fullGameProgress !== null;
  const engine = useAnalysisEngine(
    state,
    engineOn && mode === 'play' && !fullGameRunning,
    {
      depth: analysisDepth,
      threads: analysisThreads,
      botId: analysisBotId,
    },
  );
  const evalTick = engine.lines[0]?.depth ?? 0;
  const evalScore = engine.lines[0]?.scoreWhite ?? 0;

  const lastMove = useMemo(() => {
    const cmd = cursorNode.command;
    if (!cmd || cmd.type !== 'move') return null;
    return { from: cmd.from, to: cmd.to };
  }, [cursorNode]);

  const bestMove = engine.lines[0]?.best ?? getCachedEval(state)?.best ?? null;
  const scoreWhite =
    engine.lines[0]?.scoreWhite ?? getCachedEval(state)?.scoreWhite ?? 0;
  const barPct = evalBarPercent(scoreWhite);

  const pieces = useMemo(() => {
    const all = palettePieces();
    if (roleFilter === 'all') return all;
    if (roleFilter === 'base') return all.filter((d) => d.isBase);
    return all.filter((d) => d.baseRole === roleFilter);
  }, [roleFilter]);

  const tiles = useMemo(() => listTileDefinitions(), []);

  const historyBlocks = useMemo(() => buildTreeHistory(root), [root]);
  const canGoBack = path.length > 0;
  const canGoForward = (getNodeAt(root, path)?.children.length ?? 0) > 0;

  const graphPoints = useMemo(() => {
    void cacheTick;
    void evalTick;
    return mainlineGraphPaths(root).map((p) => {
      const node = getNodeAt(root, p);
      return {
        path: p,
        scoreWhite: getCachedEval(node?.state ?? root.state)?.scoreWhite ?? null,
      };
    });
  }, [root, cacheTick, evalTick]);

  const loadSavedGame = useCallback((game: SavedGame) => {
    const session = loadAnalysisSession(game.id);
    const built = session
      ? hydrateAnalysisSession(game.opening, session)
      : replayToTree(game.opening, game.commands);
    setMode('play');
    setRoot(built.root);
    setPath(built.path);
    setActiveGameId(game.id);
    setFlipped(game.myColor === 'black');
    setCtxMenu(null);
    const fromSession = hydrateJudgments(session?.judgments);
    setMoveJudgments(fromSession ?? restoreMainlineJudgments(built.root));
  }, []);

  useEffect(() => {
    const pending = consumePendingAnalysisId();
    if (!pending) return;
    const game = getSavedGame(pending);
    if (game) loadSavedGame(game);
  }, [consumePendingAnalysisId, loadSavedGame]);

  useEffect(() => subscribeEvalCache(() => setCacheTick((n) => n + 1)), []);

  useEffect(() => {
    if (!fullGameRunning) return;
    const id = window.setInterval(() => {
      setFullGameProgress((prev) =>
        prev ? { ...prev, elapsedMs: Date.now() - prev.startedAt } : prev,
      );
    }, 400);
    return () => window.clearInterval(id);
  }, [fullGameRunning]);

  const cancelFullGameAnalysis = useCallback(() => {
    fullGameAbortRef.current?.abort();
    getAiPool().cancelAnalysis();
  }, []);

  const startFullGameAnalysis = useCallback(async () => {
    // Restart: stop any in-flight full-game pass; cache is wiped inside analyzeFullGame.
    if (fullGameAbortRef.current) {
      fullGameAbortRef.current.abort();
      getAiPool().cancelAnalysis();
      fullGameAbortRef.current = null;
    }
    setFullGameError(null);
    setMoveJudgments(null);
    // Drop stale marks for this mainline so a re-run doesn't mix old labels.
    clearCachedJudgmentsForStates(
      mainlineGraphPaths(root)
        .map((p) => getNodeAt(root, p)?.state)
        .filter((s): s is MatchState => Boolean(s)),
    );
    const ac = new AbortController();
    fullGameAbortRef.current = ac;

    // Claim the worker pool before React disables the live engine — otherwise
    // the live-engine effect cleanup aborts this run immediately.
    const exclusiveToken = beginExclusiveAnalysis();

    const startedAt = Date.now();
    setFullGameProgress({
      done: 0,
      total: Math.max(1, mainlineGraphPaths(root).length),
      currentDepth: 0,
      targetDepth: FULL_GAME_DEPTH,
      startedAt,
      elapsedMs: 0,
      budgetMs: 0,
      etaMs: null,
      skipped: 0,
      sliceMs: analysisThreads,
    });

    // Let React apply fullGameRunning (pause live engine) before we search.
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });

    try {
      if (ac.signal.aborted) {
        throw new DOMException('Analysis cancelled', 'AbortError');
      }
      const result = await analyzeFullGame(root, {
        depth: FULL_GAME_DEPTH,
        threads: analysisThreads,
        engine: analysisBotId,
        signal: ac.signal,
        onProgress: (p) => {
          if (ac.signal.aborted) return;
          setFullGameProgress({ ...p });
        },
      });
      if (ac.signal.aborted) return;
      if (result.analyzed === 0 && result.skipped === 0) {
        setFullGameError('Нет позиций для анализа на главной линии.');
        setMoveJudgments(null);
      } else {
        setMoveJudgments(buildMainlineJudgments(root));
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.error('Full-game analysis failed', err);
        setFullGameError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      endExclusiveAnalysis(exclusiveToken);
      if (fullGameAbortRef.current === ac) {
        fullGameAbortRef.current = null;
        setFullGameProgress(null);
      }
    }
  }, [root, analysisThreads, analysisBotId]);

  useEffect(() => {
    if (!activeGameId) return;
    const existing = loadAnalysisSession(activeGameId);
    const judgments =
      serializeJudgments(moveJudgments) ?? existing?.judgments ?? null;
    scheduleSaveAnalysisSession(
      serializeAnalysisSession(activeGameId, root, path, judgments),
    );
  }, [activeGameId, root, path, moveJudgments]);

  // Restore marks from judgment/eval cache when opening a board that isn't a saved game.
  useEffect(() => {
    if (moveJudgments) return;
    if (fullGameRunning) return;
    const restored = restoreMainlineJudgments(root);
    if (restored) setMoveJudgments(restored);
    // Only on root identity / first paint with cache — not every cacheTick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  const resetTo = useCallback((next: MatchState) => {
    setRoot(createRootNode(next));
    setPath([]);
    setActiveGameId(null);
    setCtxMenu(null);
    setMoveJudgments(null);
  }, []);

  const playCommand = useCallback(
    (command: GameCommand) => {
      const next = playAtPath(root, path, command);
      if (!next) return;
      setRoot(next.root);
      setPath(next.path);
      setActiveGameId(null);
    },
    [root, path],
  );

  const playPvPrefix = useCallback(
    (pv: GameCommand[], upto: number) => {
      const next = playPvAtPath(root, path, pv, upto);
      if (!next) return;
      setRoot(next.root);
      setPath(next.path);
      setActiveGameId(null);
    },
    [root, path],
  );

  const onEdit = useCallback(
    (pos: Coord) => {
      if (!brush) return;
      const next = applyEditorBrush(state, pos, brush);
      resetTo(next);
    },
    [brush, state, resetTo],
  );

  const goPath = useCallback((next: AnalysisPath) => {
    setPath(next);
    setCtxMenu(null);
  }, []);

  const step = useCallback(
    (dir: -1 | 1) => {
      setPath(stepPath(root, path, dir));
    },
    [root, path],
  );

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        step(-1);
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        step(1);
      } else if (ev.key === 'f') {
        setFlipped((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  const selectPieceBrush = (defId: string) => {
    setBrush({ kind: 'piece', defId, owner: brushOwner });
    setMode('edit');
  };

  const setOwner = (owner: PlayerId) => {
    setBrushOwner(owner);
    setBrush((b) =>
      b?.kind === 'piece' ? { kind: 'piece', defId: b.defId, owner } : b,
    );
  };

  const enterPlay = () => {
    setMode('play');
    resetTo(state);
  };

  const evalForMovePath = (movePath: AnalysisPath): number | null => {
    if (movePath.length === 0) return null;
    const node = getNodeAt(root, movePath);
    if (!node) return null;
    void evalTick;
    void evalScore;
    return getCachedEval(node.state)?.scoreWhite ?? null;
  };

  const onMoveContextMenu = useCallback(
    (ev: ReactMouseEvent, movePath: AnalysisPath) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (movePath.length === 0) return;
      setPath(movePath);
      setCtxMenu({ x: ev.clientX, y: ev.clientY, path: movePath });
    },
    [],
  );

  const ctxPromote = () => {
    if (!ctxMenu) return;
    setRoot(promotePath(root, ctxMenu.path));
    setPath(ctxMenu.path.map((v, i) => (i === ctxMenu.path.length - 1 ? 0 : v)));
    setCtxMenu(null);
  };

  const ctxDelete = () => {
    if (!ctxMenu) return;
    const result = deletePath(root, ctxMenu.path);
    setRoot(result.root);
    setPath(result.path);
    setCtxMenu(null);
  };

  const ctxDeleteOthers = () => {
    if (!ctxMenu || ctxMenu.path.length === 0) return;
    const parentPath = ctxMenu.path.slice(0, -1);
    const promoted = promotePath(root, ctxMenu.path);
    setRoot(keepMainlineOnly(promoted, parentPath));
    setPath([...parentPath, 0]);
    setCtxMenu(null);
  };

  useEffect(() => {
    const el = evalBarRef.current;
    if (!el) return;
    const sync = () => setBoardHeight(Math.round(el.getBoundingClientRect().height));
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const container = movesScrollRef.current;
    const row = activeMoveRef.current;
    if (!container || !row) return;
    const cRect = container.getBoundingClientRect();
    const rRect = row.getBoundingClientRect();
    if (rRect.top < cRect.top) {
      container.scrollBy({ top: rRect.top - cRect.top, behavior: 'smooth' });
    } else if (rRect.bottom > cRect.bottom) {
      container.scrollBy({ top: rRect.bottom - cRect.bottom, behavior: 'smooth' });
    }
  }, [path, historyBlocks]);

  const renderMoveButton = (move: TreeHistoryMove, activeRef?: boolean) => {
    const active = pathMatchesMove(path, move);
    const evalPath = active ? path : (move.pathEnd ?? move.path);
    const score = evalForMovePath(evalPath);
    const judged = judgmentForMove(moveJudgments, move);
    const title = judged
      ? `${judgmentLabel(judged.judgment)} · ${formatEvalCp(judged.evalBefore)} → ${formatEvalCp(judged.evalAfter)}`
      : undefined;
    return (
      <button
        type="button"
        ref={
          active && activeRef
            ? (el) => {
                activeMoveRef.current = el;
              }
            : undefined
        }
        className={active ? styles.moveActive : styles.moveBtn}
        title={title}
        onClick={() => goPath(active ? path : (move.pathEnd ?? move.path))}
        onContextMenu={(ev) =>
          onMoveContextMenu(ev, active ? path : (move.pathEnd ?? move.path))
        }
      >
        <span
          className={[
            styles.judgmentGlyph,
            judged ? JUDGMENT_CLASS[judged.judgment] : styles.judgmentGlyphEmpty,
          ]
            .filter(Boolean)
            .join(' ')}
          aria-hidden
        >
          {judged ? judgmentGlyph(judged.judgment) : ''}
        </span>
        <span className={styles.moveSan}>{move.label}</span>
        {score !== null ? (
          <span className={styles.moveEval}>{formatEvalCp(score)}</span>
        ) : (
          <span className={styles.moveEval} />
        )}
      </button>
    );
  };

  const renderBlocks = (blocks: TreeHistoryBlock[], keyPrefix: string): ReactNode =>
    blocks.map((block, i) => {
      const key = `${keyPrefix}-${i}`;
      if (block.kind === 'system') {
        return (
          <div key={key} className={styles.historySystem}>
            {block.text}
          </div>
        );
      }
      if (block.kind === 'variation') {
        return (
          <div
            key={key}
            className={styles.variation}
            style={{ marginLeft: `${Math.min(block.depth, 4) * 0.35}rem` }}
          >
            <span className={styles.variationMark}>(</span>
            <span className={styles.variationMoves}>
              {block.moves.map((m, mi) => (
                <span key={m.nodeId} className={styles.variationMoveWrap}>
                  {mi > 0 ? ' ' : ''}
                  {renderMoveButton(m)}
                </span>
              ))}
            </span>
            {block.nested.length > 0 && renderBlocks(block.nested, `${key}-n`)}
            <span className={styles.variationMark}>)</span>
          </div>
        );
      }

      const whiteActive = block.white ? pathMatchesMove(path, block.white) : false;
      const blackActive = block.black ? pathMatchesMove(path, block.black) : false;
      return (
        <div key={key} className={styles.historyChunk}>
          <div
            className={styles.moveRow}
            ref={
              whiteActive || blackActive
                ? (el) => {
                    activeMoveRef.current = el;
                  }
                : undefined
            }
          >
            <span className={styles.moveNum}>{block.turn}.</span>
            {block.white ? (
              renderMoveButton(block.white)
            ) : (
              <span className={styles.movePlaceholder} />
            )}
            {block.black ? (
              renderMoveButton(block.black)
            ) : (
              <span className={styles.movePlaceholder} />
            )}
          </div>
          {block.afterWhite && block.afterWhite.length > 0 && (
            <div className={styles.variationGroup}>
              {renderBlocks(block.afterWhite, `${key}-aw`)}
            </div>
          )}
          {block.afterBlack && block.afterBlack.length > 0 && (
            <div className={styles.variationGroup}>
              {renderBlocks(block.afterBlack, `${key}-ab`)}
            </div>
          )}
        </div>
      );
    });

  const hasMoves = historyBlocks.some(
    (b) =>
      b.kind === 'row' ||
      b.kind === 'system' ||
      (b.kind === 'variation' && b.moves.length > 0),
  );

  const activeJudgment = useMemo(() => {
    if (!moveJudgments || path.length === 0) return null;
    for (const block of historyBlocks) {
      if (block.kind !== 'row') continue;
      for (const move of [block.white, block.black]) {
        if (!move || !pathMatchesMove(path, move)) continue;
        const info = judgmentForMove(moveJudgments, move);
        if (info) return { move, info };
      }
    }
    return null;
  }, [moveJudgments, path, historyBlocks]);

  const activeJudgmentBest = useMemo(() => {
    if (!activeJudgment || activeJudgment.info.sameAsBest) return null;
    const beforePath =
      activeJudgment.move.path.length > 0
        ? activeJudgment.move.path.slice(0, -1)
        : [];
    // For wayfarer pathEnd, parent of first half is better as "before".
    const parent = getNodeAt(root, beforePath);
    const line = parent ? getCachedEval(parent.state) : null;
    if (!line?.best) return null;
    return formatAnalysisMove(parent!.state, line.best);
  }, [activeJudgment, root, cacheTick]);

  return (
    <div className={styles.wrap}>
      <header className={styles.hud}>
        <div className={styles.hudTop}>
          <div>
            <h2 className={styles.title}>Анализ</h2>
            <p className={styles.sub}>
              Сохраняйте партии с ИИ или онлайн и разбирайте их здесь, либо расставьте позицию в
              редакторе.
            </p>
          </div>
          <div className={styles.hudActions}>
            <div className={styles.modeSwitch} role="group" aria-label="Режим">
              <button
                type="button"
                className={mode === 'play' ? styles.modeActive : undefined}
                onClick={enterPlay}
              >
                Игра / разбор
              </button>
              <button
                type="button"
                className={mode === 'edit' ? styles.modeActive : undefined}
                onClick={() => setMode('edit')}
              >
                Редактор
              </button>
            </div>
            <button type="button" className={styles.btn} onClick={() => setFlipped((v) => !v)}>
              Перевернуть
            </button>
            <SavedGamesMenu
              activeGameId={activeGameId}
              onLoad={loadSavedGame}
              onActiveCleared={() => setActiveGameId(null)}
            />
            <button
              type="button"
              className={engineOn ? styles.btnOn : styles.btn}
              onClick={() => setEngineOn((v) => !v)}
              disabled={mode === 'edit' || fullGameRunning}
            >
              {engineOn ? 'Движок · вкл' : 'Движок · выкл'}
            </button>
            <button
              type="button"
              className={fullGameRunning ? styles.btnOn : styles.btn}
              onClick={() => {
                void startFullGameAnalysis();
              }}
              disabled={mode === 'edit'}
              title={`Разбор партии: каждая позиция быстро до глубины ${FULL_GAME_DEPTH} (~200ms/шаг), ${analysisThreads} потоков`}
            >
              {fullGameRunning ? 'Перезапустить анализ…' : 'Анализ партии'}
            </button>
            <AnalysisEngineSettingsButton
              botId={analysisBotId}
              depth={analysisDepth}
              threads={analysisThreads}
              onBotChange={setAnalysisBotId}
              onDepthChange={setAnalysisDepth}
              onThreadsChange={setAnalysisThreads}
              disabled={mode === 'edit' || fullGameRunning}
            />
          </div>
        </div>
        {(fullGameProgress || fullGameError) && (
          <div className={styles.fullGameBar} role="status" aria-live="polite">
            {fullGameProgress && (
              <>
                <div className={styles.fullGameTrack}>
                  <div
                    className={styles.fullGameFill}
                    style={{ width: `${fullGameProgressPercent(fullGameProgress)}%` }}
                  />
                </div>
                <div className={styles.fullGameMeta}>
                  <span>
                    Позиция {Math.min(fullGameProgress.done + 1, fullGameProgress.total)}/
                    {fullGameProgress.total}
                    {' · '}
                    глубина {fullGameProgress.currentDepth}/{fullGameProgress.targetDepth}
                    {fullGameProgress.sliceMs > 0 && (
                      <> · потоков {fullGameProgress.sliceMs}</>
                    )}
                  </span>
                  <span>
                    прошло {formatAnalysisElapsed(fullGameProgress.elapsedMs)}
                    {fullGameProgress.etaMs !== null && (
                      <> · осталось ~{formatAnalysisEta(fullGameProgress.etaMs)}</>
                    )}
                  </span>
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={cancelFullGameAnalysis}
                  >
                    Стоп
                  </button>
                  {fullGameProgress.skipped > 0 && (
                    <span className={styles.mutedInline}>
                      из кэша: {fullGameProgress.skipped}
                    </span>
                  )}
                </div>
              </>
            )}
            {fullGameError && <p className={styles.error}>{fullGameError}</p>}
          </div>
        )}
      </header>

      <div className={styles.layout}>
        <div className={styles.boardColumn}>
          <div className={styles.boardWithBar}>
            <div className={styles.boardFrame}>
              <div
                ref={evalBarRef}
                className={styles.evalBar}
                title={formatEvalCp(scoreWhite)}
                aria-label={`Оценка ${formatEvalCp(scoreWhite)}`}
              >
                <div
                  className={styles.evalWhite}
                  style={{ height: `${flipped ? 100 - barPct : barPct}%` }}
                />
                <span className={styles.evalLabel}>{formatEvalCp(scoreWhite)}</span>
              </div>
              <AnalysisBoard
                state={state}
                mode={mode}
                brush={brush}
                flipped={flipped}
                lastMove={lastMove}
                bestMove={mode === 'play' && engineOn ? bestMove : null}
                onPlay={playCommand}
                onEdit={onEdit}
              />
              {mode === 'play' && graphPoints.length > 1 && (
                <div className={styles.evalGraphSlot}>
                  <AnalysisEvalGraph
                    points={graphPoints}
                    cursorPath={path}
                    onSelect={goPath}
                    flipped={flipped}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className={styles.side}>
          <div className={styles.analysisSplit}>
            <div
              className={styles.movesColumn}
              style={boardHeight ? { height: boardHeight } : undefined}
            >
              <section className={`${styles.panel} ${styles.movesPanel}`}>
                <h3 className={styles.panelTitle}>Ходы</h3>
                <div className={styles.moves} ref={movesScrollRef}>
                  {!hasMoves ? (
                    <p className={styles.muted}>
                      Пока нет ходов — откройте партию или сходите на доске.
                    </p>
                  ) : (
                    renderBlocks(historyBlocks, 'h')
                  )}
                </div>
                {moveJudgments && moveJudgments.size > 0 && (
                  <div className={styles.judgmentDetail}>
                    {activeJudgment ? (
                      <>
                        <p>
                          <span className={JUDGMENT_CLASS[activeJudgment.info.judgment]}>
                            {judgmentGlyph(activeJudgment.info.judgment)}{' '}
                            {judgmentLabel(activeJudgment.info.judgment)}
                          </span>
                          {' · '}
                          {formatEvalCp(activeJudgment.info.evalBefore)} →{' '}
                          {formatEvalCp(activeJudgment.info.evalAfter)}
                          {activeJudgment.info.winDrop >= 0.05 && (
                            <>
                              {' '}
                              (−{(activeJudgment.info.winDrop * 100).toFixed(0)}%
                              шансов)
                            </>
                          )}
                        </p>
                        {activeJudgmentBest && (
                          <p className={styles.judgmentBest}>
                            Лучший: {activeJudgmentBest}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className={styles.muted}>
                        Метки после анализа партии · выберите ход
                      </p>
                    )}
                  </div>
                )}
              </section>

              <div className={styles.navBar}>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => goPath([])}
                  disabled={!canGoBack}
                >
                  ⏮
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => step(-1)}
                  disabled={!canGoBack}
                >
                  ◀
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => step(1)}
                  disabled={!canGoForward}
                >
                  ▶
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => goPath(endOfLine(root, path))}
                  disabled={!canGoForward}
                >
                  ⏭
                </button>
                {state.extraMovePieceId && mode === 'play' && (
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={() => playCommand({ type: 'endTurn' })}
                  >
                    Закончить ход
                  </button>
                )}
                <span className={styles.turnHint}>
                  {state.phase === 'gameOver'
                    ? state.winner
                      ? `Победа: ${state.winner === 'white' ? 'белые' : 'чёрные'}`
                      : 'Конец'
                    : `Ход ${state.activePlayer === 'white' ? 'белых' : 'чёрных'}`}
                </span>
              </div>
            </div>

            <section className={`${styles.panel} ${styles.enginePanel}`}>
              <h3 className={styles.panelTitle}>{analysisBotLabel}</h3>
              {!engineOn || mode === 'edit' ? (
                <p className={styles.muted}>
                  {mode === 'edit'
                    ? 'В редакторе движок отключён. Нажмите «Игра / разбор».'
                    : 'Включите движок, чтобы видеть оценку и лучший вариант.'}
                </p>
              ) : (
                <>
                  <div className={styles.engineMeta}>
                    {engine.lines[0] ? (
                      <>
                        <span>{formatEvalCp(engine.lines[0].scoreWhite)}</span>
                        <span>
                          глубина {engine.lines[0].depth}
                          {engine.running ? '…' : ''}
                        </span>
                        {engine.lines[0].nodes > 0 && (
                          <span>
                            {engine.lines[0].nodes.toLocaleString('ru-RU')} узлов
                          </span>
                        )}
                        {engine.lines[0].nps > 0 && (
                          <span>{engine.lines[0].nps.toLocaleString('ru-RU')} у/с</span>
                        )}
                      </>
                    ) : (
                      <span>{engine.running ? 'запуск…' : 'нет оценки'}</span>
                    )}
                  </div>
                  {engine.error && <p className={styles.error}>{engine.error}</p>}
                  <ul className={styles.lines}>
                    {engine.lines.map((line, idx) => (
                      <li key={idx} className={styles.line}>
                        <button
                          type="button"
                          className={styles.lineScore}
                          onClick={() => playPvPrefix([line.best], 0)}
                          title="Сыграть лучший ход"
                        >
                          {formatEvalCp(line.scoreWhite)}
                        </button>
                        <div className={styles.pv}>
                          {line.pv.length === 0 ? (
                            <span className={styles.muted}>нет PV</span>
                          ) : (
                            line.pv.slice(0, 8).map((cmd, pvIdx) => {
                              let probe = state;
                              for (let k = 0; k < pvIdx; k += 1) {
                                const stepResult = tryPlayCommand(probe, line.pv[k]!);
                                if (!stepResult.ok) break;
                                probe = stepResult.state;
                              }
                              const label = formatAnalysisMove(probe, cmd);
                              return (
                                <button
                                  key={`${pvIdx}-${label}`}
                                  type="button"
                                  className={styles.pvMove}
                                  onClick={() => playPvPrefix(line.pv, pvIdx)}
                                  title="Добавить вариант в историю"
                                >
                                  {label}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>

          {mode === 'edit' && (
            <section className={styles.panel}>
              <h3 className={styles.panelTitle}>Редактор</h3>
              <div className={styles.editTools}>
                <div className={styles.modeSwitch}>
                  <button
                    type="button"
                    className={brushOwner === 'white' ? styles.modeActive : undefined}
                    onClick={() => setOwner('white')}
                  >
                    Белые
                  </button>
                  <button
                    type="button"
                    className={brushOwner === 'black' ? styles.modeActive : undefined}
                    onClick={() => setOwner('black')}
                  >
                    Чёрные
                  </button>
                </div>
                <button
                  type="button"
                  className={brush?.kind === 'trash' ? styles.btnOn : styles.btn}
                  onClick={() => setBrush({ kind: 'trash' })}
                >
                  Ластик
                </button>
                <div className={styles.modeSwitch}>
                  <button
                    type="button"
                    className={state.activePlayer === 'white' ? styles.modeActive : undefined}
                    onClick={() => resetTo(setActivePlayer(state, 'white'))}
                  >
                    Ход белых
                  </button>
                  <button
                    type="button"
                    className={state.activePlayer === 'black' ? styles.modeActive : undefined}
                    onClick={() => resetTo(setActivePlayer(state, 'black'))}
                  >
                    Ход чёрных
                  </button>
                </div>
              </div>

              <div className={styles.presets}>
                <button type="button" className={styles.btn} onClick={() => resetTo(classicAnalysisBoard())}>
                  Классика
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => resetTo(battlefieldAnalysisBoard())}
                >
                  Поле боя
                </button>
                <button type="button" className={styles.btn} onClick={() => resetTo(emptyAnalysisBoard())}>
                  Пусто
                </button>
              </div>

              <div className={styles.filters}>
                {(
                  [
                    ['all', 'Все'],
                    ['base', 'База'],
                    ['king', 'K'],
                    ['queen', 'Q'],
                    ['rook', 'R'],
                    ['bishop', 'B'],
                    ['knight', 'N'],
                    ['pawn', 'P'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={roleFilter === id ? styles.chipOn : styles.chip}
                    onClick={() => setRoleFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className={styles.palette}>
                {pieces.map((def) => {
                  const active =
                    brush?.kind === 'piece' &&
                    brush.defId === def.id &&
                    brush.owner === brushOwner;
                  return (
                    <button
                      key={def.id}
                      type="button"
                      className={active ? styles.paletteOn : styles.paletteBtn}
                      title={def.name}
                      onClick={() => selectPieceBrush(def.id)}
                    >
                      <PieceIcon defId={def.id} owner={brushOwner} className={styles.paletteIcon} />
                      <span>{def.name}</span>
                    </button>
                  );
                })}
              </div>

              <h4 className={styles.subTitle}>Тайлы</h4>
              <div className={styles.tilePalette}>
                {tiles.map((tile) => {
                  const active = brush?.kind === 'tile' && brush.tileId === tile.id;
                  return (
                    <button
                      key={tile.id}
                      type="button"
                      className={active ? styles.chipOn : styles.chip}
                      title={tile.description}
                      onClick={() => {
                        setBrush({ kind: 'tile', tileId: tile.id });
                        setMode('edit');
                      }}
                    >
                      {tile.name}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </aside>
      </div>

      {ctxMenu && (
        <div
          className={styles.contextMenu}
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          role="menu"
          onClick={(ev) => ev.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={ctxPromote}>
            Сделать главной линией
          </button>
          <button type="button" role="menuitem" onClick={ctxDeleteOthers}>
            Удалить другие варианты
          </button>
          <button type="button" role="menuitem" onClick={ctxDelete}>
            Удалить отсюда
          </button>
        </div>
      )}
    </div>
  );
}
