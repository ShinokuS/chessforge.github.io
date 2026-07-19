import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './BattleView.module.css';
import { BoardView } from './BoardView';
import { formatClock } from './clock';
import { formatEvalCp, judgmentLabel, type AnalyzedPly, type MoveJudgment } from './analyzeGame';
import { groupHistoryForDisplay } from './moveHistory';
import {
  aiSearchProfile,
  SIDE_OPTIONS,
  TIME_PRESETS,
  timePresetMs,
  type SidePreference,
  type TimePresetId,
} from './settings';
import { useAppStore } from '../app/store';

const JUDGMENT_CLASS: Record<MoveJudgment, string> = {
  best: styles.jBest ?? '',
  excellent: styles.jExcellent ?? '',
  good: styles.jGood ?? '',
  inaccuracy: styles.jInaccuracy ?? '',
  mistake: styles.jMistake ?? '',
  blunder: styles.jBlunder ?? '',
};

export function BattleView() {
  const state = useAppStore((s) => s.state);
  const lastError = useAppStore((s) => s.lastError);
  const moveHistory = useAppStore((s) => s.moveHistory);
  const clocks = useAppStore((s) => s.clocks);
  const endBanner = useAppStore((s) => s.endBanner);
  const restart = useAppStore((s) => s.restart);
  const resign = useAppStore((s) => s.resign);
  const startAiMatch = useAppStore((s) => s.startAiMatch);
  const tickClock = useAppStore((s) => s.tickClock);
  const resetClocks = useAppStore((s) => s.resetClocks);
  const dismissEndBanner = useAppStore((s) => s.dismissEndBanner);
  const analysis = useAppStore((s) => s.analysis);
  const startGameAnalysis = useAppStore((s) => s.startGameAnalysis);
  const setAnalysisCursor = useAppStore((s) => s.setAnalysisCursor);
  const clearAnalysis = useAppStore((s) => s.clearAnalysis);
  const battleMode = useAppStore((s) => s.battleMode);
  const setBattleMode = useAppStore((s) => s.setBattleMode);
  const aiPlaying = useAppStore((s) => s.aiPlaying);
  const aiStrength = useAppStore((s) => s.aiStrength);
  const setAiStrength = useAppStore((s) => s.setAiStrength);
  const aiTimePreset = useAppStore((s) => s.aiTimePreset);
  const setAiTimePreset = useAppStore((s) => s.setAiTimePreset);
  const onlineTimePreset = useAppStore((s) => s.onlineTimePreset);
  const setOnlineTimePreset = useAppStore((s) => s.setOnlineTimePreset);
  const onlineSide = useAppStore((s) => s.onlineSide);
  const setOnlineSide = useAppStore((s) => s.setOnlineSide);
  const online = useAppStore((s) => s.online);
  const repo = useAppStore((s) => s.repo);
  const activeDeckId = useAppStore((s) => s.activeDeckId);
  const decks = useAppStore((s) => s.decks);
  const setActiveDeckId = useAppStore((s) => s.setActiveDeckId);

  const [, tick] = useState(0);
  useEffect(() => online.subscribeStatus(() => tick((n) => n + 1)), [online]);

  useEffect(() => {
    const id = window.setInterval(() => tickClock(), 200);
    return () => window.clearInterval(id);
  }, [tickClock]);

  useEffect(() => {
    if (analysis.status !== 'done') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const { analysis: a } = useAppStore.getState();
        setAnalysisCursor(a.cursor - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const { analysis: a } = useAppStore.getState();
        setAnalysisCursor(a.cursor + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [analysis.status, setAnalysisCursor]);

  const onlineClocksStarted = useRef(false);
  useEffect(() => {
    if (battleMode !== 'online') {
      onlineClocksStarted.current = false;
      return;
    }
    return online.subscribeStatus(() => {
      const status = online.getStatus();
      if (status === 'playing') {
        if (!onlineClocksStarted.current) {
          onlineClocksStarted.current = true;
          const ms = online.getMatchClockMs();
          resetClocks('white', ms > 0 ? ms : timePresetMs(onlineTimePreset));
        }
      } else {
        onlineClocksStarted.current = false;
      }
    });
  }, [battleMode, online, resetClocks, onlineTimePreset]);

  const [joinCode, setJoinCode] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('room') ?? '';
  });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const historyBlocks = useMemo(() => groupHistoryForDisplay(moveHistory), [moveHistory]);
  const lastPly = moveHistory.reduce((max, e) => (e.kind === 'ply' ? Math.max(max, e.ply) : max), 0);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = historyScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [moveHistory]);

  const onlineStatus = online.getStatus();
  const roomId = online.getRoomId();
  const myColor = online.getMyColor();
  const activeDeck = decks.find((d) => d.id === activeDeckId) ?? decks[0];

  const winnerLabel = (w: 'white' | 'black') => (w === 'white' ? 'белые' : 'чёрные');
  const reviewing = analysis.status === 'running' || analysis.status === 'done';

  const status = reviewing
    ? analysis.status === 'running'
      ? `Анализ партии… ${analysis.progress.done}/${analysis.progress.total}`
      : `Анализ · позиция ${analysis.cursor}/${Math.max(0, analysis.positions.length - 1)}`
    : endBanner
      ? endBanner.kind === 'timeout'
        ? `Время вышло · победа: ${winnerLabel(endBanner.winner)}`
        : endBanner.kind === 'resign'
          ? `Сдача · победа: ${winnerLabel(endBanner.winner)}`
          : `Победа: ${winnerLabel(endBanner.winner)}`
      : battleMode === 'online'
        ? onlineStatus === 'waiting'
          ? 'Ожидание соперника…'
          : onlineStatus === 'playing'
            ? `Онлайн · вы ${myColor === 'white' ? 'белые' : 'чёрные'} · ход ${state.turn} · ${
                state.activePlayer === myColor ? 'ваш ход' : 'ход соперника'
              }`
            : onlineStatus === 'connecting'
              ? 'Подключение…'
              : onlineStatus === 'disconnected'
                ? 'Соединение потеряно'
                : 'Онлайн-лобби'
        : aiPlaying
          ? state.phase === 'gameOver'
            ? `Победа: ${winnerLabel(state.winner ?? 'white')}`
            : `Ход ${state.turn} · ${state.activePlayer === 'white' ? 'белые' : 'чёрные (ИИ)'}`
          : 'Настройте партию и нажмите «Начать»';

  const showAiLobby =
    battleMode === 'ai' && !aiPlaying && !endBanner && analysis.status === 'idle';
  const showOnlineLobby =
    battleMode === 'online' &&
    (onlineStatus === 'idle' ||
      onlineStatus === 'error' ||
      onlineStatus === 'disconnected' ||
      onlineStatus === 'connecting');

  const boardVisible =
    (battleMode === 'ai' && (aiPlaying || Boolean(endBanner) || reviewing)) ||
    onlineStatus === 'waiting' ||
    onlineStatus === 'playing' ||
    (battleMode === 'online' && (Boolean(endBanner) || state.phase === 'gameOver'));

  const showClocks =
    (battleMode === 'ai' && (aiPlaying || Boolean(endBanner)) && !reviewing) ||
    onlineStatus === 'playing' ||
    (battleMode === 'online' && (Boolean(endBanner) || state.phase === 'gameOver'));

  const canResign =
    !endBanner &&
    !reviewing &&
    state.phase === 'play' &&
    ((battleMode === 'ai' && aiPlaying) ||
      (battleMode === 'online' && onlineStatus === 'playing'));

  const resignWasYou =
    endBanner?.kind === 'resign' &&
    (battleMode === 'ai'
      ? endBanner.loser === 'white'
      : Boolean(myColor) && endBanner.loser === myColor);

  const placements = () => {
    const deck = repo.getDeck(activeDeckId);
    if (!deck || deck.placements.length < 16) {
      throw new Error('Выберите полную сохранённую колоду');
    }
    return deck.placements;
  };

  const createRoom = async () => {
    setBusy(true);
    try {
      const { onlineSide: side, onlineTimePreset: time } = useAppStore.getState();
      await online.createRoom(placements(), {
        clockMs: timePresetMs(time),
        side,
      });
    } catch {
      /* error via session */
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async () => {
    const code = joinCode.trim().toLowerCase();
    if (!code) return;
    setBusy(true);
    try {
      await online.joinRoom(code, placements());
    } catch {
      /* error via session */
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!roomId) return;
    await navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const sideWaitingLabel =
    myColor === 'white'
      ? online.getHostSidePreference() === 'random'
        ? 'Вам выпали белые'
        : 'Вы белые'
      : myColor === 'black'
        ? online.getHostSidePreference() === 'random'
          ? 'Вам выпали чёрные'
          : 'Вы чёрные'
        : 'Сторона ещё не назначена';

  const youSide: 'white' | 'black' =
    battleMode === 'online' && myColor === 'black' ? 'black' : 'white';
  const topSide: 'white' | 'black' = youSide === 'white' ? 'black' : 'white';
  const bottomSide = youSide;
  const topMs = topSide === 'white' ? clocks.whiteMs : clocks.blackMs;
  const bottomMs = bottomSide === 'white' ? clocks.whiteMs : clocks.blackMs;
  const topLabel =
    battleMode === 'ai'
      ? `ИИ ${aiStrength}/10`
      : 'Соперник';
  const bottomLabel = battleMode === 'ai' ? 'Вы' : 'Вы';

  return (
    <section className={styles.wrap}>
      <div className={styles.hud}>
        <div>
          <h2 className={styles.title}>Поле боя</h2>
          <div className={styles.modeSwitch}>
            <button
              type="button"
              className={battleMode === 'ai' ? styles.modeActive : undefined}
              onClick={() => setBattleMode('ai')}
            >
              Против ИИ
            </button>
            <button
              type="button"
              className={battleMode === 'online' ? styles.modeActive : undefined}
              onClick={() => setBattleMode('online')}
            >
              Онлайн
            </button>
          </div>
          <p className={styles.status}>{status}</p>
          {lastError && <p className={styles.error}>{lastError}</p>}
        </div>
        <div className={styles.hudActions}>
          {canResign && (
            <button type="button" className={styles.resign} onClick={() => resign()}>
              Сдаться
            </button>
          )}
          {(aiPlaying ||
            reviewing ||
            onlineStatus === 'waiting' ||
            onlineStatus === 'playing' ||
            onlineStatus === 'connecting') && (
            <button
              type="button"
              className={styles.restart}
              onClick={() => {
                clearAnalysis();
                restart();
              }}
            >
              {battleMode === 'online' ? 'Выйти / сброс' : reviewing ? 'Закрыть анализ' : 'В лобби'}
            </button>
          )}
        </div>
      </div>

      {showAiLobby && (
        <div className={styles.lobby}>
          <label className={styles.lobbyField}>
            Ваша колода
            <select value={activeDeckId} onChange={(e) => setActiveDeckId(e.target.value)}>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.lobbyField}>
            Сила ИИ · {aiStrength}/10
            <input
              type="range"
              className={styles.strengthSlider}
              min={0}
              max={10}
              step={1}
              value={aiStrength}
              onChange={(e) => setAiStrength(Number(e.target.value))}
            />
            <span className={styles.sliderHint}>{aiSearchProfile(aiStrength).hint}</span>
          </label>

          <fieldset className={styles.optionGroup}>
            <legend>Время на сторону</legend>
            <div className={styles.optionRow}>
              {TIME_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={aiTimePreset === p.id ? styles.optionActive : undefined}
                  onClick={() => setAiTimePreset(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </fieldset>

          <p className={styles.lobbyHint}>
            Вы белые · колода «{activeDeck?.name ?? '—'}» · ИИ {aiStrength}/10 (
            {aiSearchProfile(aiStrength).hint}) · {timePresetMs(aiTimePreset) / 60_000} мин
          </p>

          <div className={styles.lobbyActions}>
            <button type="button" className={styles.primary} onClick={startAiMatch}>
              Начать партию
            </button>
          </div>
        </div>
      )}

      {showOnlineLobby && (
        <div className={styles.lobby}>
          <label className={styles.lobbyField}>
            Ваша колода
            <select
              value={activeDeckId}
              onChange={(e) => setActiveDeckId(e.target.value)}
              disabled={busy}
            >
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset className={styles.optionGroup}>
            <legend>Ваша сторона (при создании комнаты)</legend>
            <div className={styles.optionRow}>
              {SIDE_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={onlineSide === o.id ? styles.optionActive : undefined}
                  onClick={() => setOnlineSide(o.id as SidePreference)}
                  disabled={busy}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.optionGroup}>
            <legend>Время на сторону</legend>
            <div className={styles.optionRow}>
              {TIME_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={onlineTimePreset === p.id ? styles.optionActive : undefined}
                  onClick={() => setOnlineTimePreset(p.id as TimePresetId)}
                  disabled={busy}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </fieldset>

          <p className={styles.lobbyHint}>
            У каждого своя колода. Время и сторону задаёт создатель комнаты — они применятся при
            старте для обоих.
          </p>

          <div className={styles.lobbyActions}>
            <button type="button" className={styles.primary} onClick={createRoom} disabled={busy}>
              Создать комнату
            </button>
            <div className={styles.joinRow}>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="код комнаты"
                disabled={busy}
              />
              <button type="button" onClick={joinRoom} disabled={busy || !joinCode.trim()}>
                Войти
              </button>
            </div>
          </div>
        </div>
      )}

      {boardVisible && (
        <div className={styles.layout}>
          {onlineStatus === 'waiting' && roomId && (
            <div className={styles.roomBanner}>
              <div>
                <p className={styles.roomLabel}>Код комнаты — передайте сопернику</p>
                <p className={styles.roomCode}>{roomId}</p>
                <p className={styles.roomHint}>
                  {sideWaitingLabel}. Ходы начнутся, когда соперник войдёт ·{' '}
                  {online.getMatchClockMs() / 60_000} мин на сторону.
                </p>
              </div>
              <button type="button" className={styles.copyCode} onClick={copyCode}>
                {copied ? 'Скопировано' : 'Копировать код'}
              </button>
            </div>
          )}

          <div className={styles.playArea}>
            <BoardView />

            <aside className={styles.sidePanel} aria-label="Часы и история">
              {showClocks ? (
                <div
                  className={[
                    styles.clock,
                    clocks.active === topSide ? styles.clockActive : '',
                    topMs <= 30_000 ? styles.clockLow : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className={styles.clockTime}>{formatClock(topMs)}</span>
                </div>
              ) : (
                <div className={styles.clockSpacer} />
              )}

              <div className={styles.playerRow}>
                <span className={styles.playerName}>{topLabel}</span>
                <span className={styles.playerSide}>
                  {topSide === 'white' ? 'белые' : 'чёрные'}
                </span>
              </div>

              <div className={styles.history} aria-label="История ходов">
                <div className={styles.historyHead}>
                  <h3 className={styles.historyTitle}>
                    {reviewing ? 'Анализ' : 'Ходы'}
                  </h3>
                  {analysis.status === 'done' && (
                    <div className={styles.analysisNav}>
                      <button
                        type="button"
                        onClick={() => setAnalysisCursor(analysis.cursor - 1)}
                        disabled={analysis.cursor <= 0}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        onClick={() => setAnalysisCursor(analysis.cursor + 1)}
                        disabled={analysis.cursor >= analysis.positions.length - 1}
                      >
                        ›
                      </button>
                    </div>
                  )}
                </div>

                {analysis.status === 'running' && (
                  <div className={styles.analysisProgress}>
                    <div
                      className={styles.analysisProgressBar}
                      style={{
                        width: `${
                          analysis.progress.total
                            ? (100 * analysis.progress.done) / analysis.progress.total
                            : 0
                        }%`,
                      }}
                    />
                    <p>
                      Считаем ходы… {analysis.progress.done}/{analysis.progress.total}
                    </p>
                  </div>
                )}

                {analysis.status === 'error' && (
                  <p className={styles.historyEmpty}>{analysis.error ?? 'Ошибка анализа'}</p>
                )}

                {analysis.status === 'done' && analysis.plies.length > 0 && (
                  <>
                    <EvalSparkline
                      values={analysis.plies.map((p) => p.evalAfter)}
                      cursor={Math.max(0, analysis.cursor - 1)}
                      onSelect={(i) => setAnalysisCursor(i + 1)}
                    />
                    <div className={styles.historyScroll} ref={historyScrollRef}>
                      <ol className={styles.historyList}>
                        {groupHistoryForDisplay(
                          analysis.plies.map((p) => ({
                            ply: p.ply,
                            turn: Math.ceil(p.ply / 2),
                            player: p.player,
                            text: p.playedLabel,
                            kind: 'ply' as const,
                          })),
                        ).map((block) => {
                          if (block.type !== 'turn') return null;
                          const { row } = block;
                          const whitePly = row.white
                            ? analysis.plies.find((p) => p.ply === row.white!.ply)
                            : undefined;
                          const blackPly = row.black
                            ? analysis.plies.find((p) => p.ply === row.black!.ply)
                            : undefined;
                          return (
                            <li key={`a-${row.turn}`} className={styles.historyRow}>
                              <span className={styles.historyIndex}>{row.turn}.</span>
                              <AnalysisMoveCell
                                ply={whitePly}
                                active={analysis.cursor === whitePly?.ply}
                                onClick={() => whitePly && setAnalysisCursor(whitePly.ply)}
                              />
                              <AnalysisMoveCell
                                ply={blackPly}
                                active={analysis.cursor === blackPly?.ply}
                                onClick={() => blackPly && setAnalysisCursor(blackPly.ply)}
                              />
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                    {analysis.cursor > 0 && analysis.plies[analysis.cursor - 1] && (
                      <div className={styles.analysisDetail}>
                        {(() => {
                          const p = analysis.plies[analysis.cursor - 1]!;
                          return (
                            <>
                              <p>
                                <span className={JUDGMENT_CLASS[p.judgment]}>
                                  {judgmentLabel(p.judgment)}
                                </span>
                                {' · '}
                                {formatEvalCp(p.evalBefore)} → {formatEvalCp(p.evalAfter)}
                                {p.loss > 12 ? ` (−${(p.loss / 100).toFixed(1)})` : ''}
                              </p>
                              {!p.sameAsBest && (
                                <p className={styles.analysisBest}>
                                  Лучший: {p.bestLabel} ({formatEvalCp(p.evalBest)})
                                </p>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </>
                )}

                {!reviewing && historyBlocks.length === 0 && (
                  <p className={styles.historyEmpty}>Ходов пока нет</p>
                )}

                {!reviewing && historyBlocks.length > 0 && (
                  <div className={styles.historyScroll} ref={historyScrollRef}>
                    <ol className={styles.historyList}>
                      {historyBlocks.map((block) => {
                        if (block.type === 'system') {
                          return (
                            <li
                              key={`sys-${block.entry.ply}-${block.entry.text}`}
                              className={styles.historySystem}
                            >
                              {block.entry.text}
                            </li>
                          );
                        }
                        const { row } = block;
                        return (
                          <li key={`t-${row.turn}`} className={styles.historyRow}>
                            <span className={styles.historyIndex}>{row.turn}.</span>
                            <span
                              className={[
                                styles.historyMove,
                                row.white && row.white.ply === lastPly ? styles.historyActive : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              {row.white?.text ?? ''}
                            </span>
                            <span
                              className={[
                                styles.historyMove,
                                row.black && row.black.ply === lastPly ? styles.historyActive : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              {row.black?.text ?? ''}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
              </div>

              <div className={styles.playerRow}>
                <span className={styles.playerName}>{bottomLabel}</span>
                <span className={styles.playerSide}>
                  {bottomSide === 'white' ? 'белые' : 'чёрные'}
                </span>
              </div>

              {showClocks ? (
                <div
                  className={[
                    styles.clock,
                    clocks.active === bottomSide ? styles.clockActive : '',
                    bottomMs <= 30_000 ? styles.clockLow : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className={styles.clockTime}>{formatClock(bottomMs)}</span>
                </div>
              ) : (
                <div className={styles.clockSpacer} />
              )}
            </aside>
          </div>
        </div>
      )}

      {(battleMode === 'online' || !aiPlaying) && (
        <p className={styles.hint}>
          {battleMode === 'online'
            ? 'Создайте комнату (время и сторона — ваши) или войдите по коду со своей колодой.'
            : 'Выберите колоду, силу ИИ и контроль времени, затем начните партию.'}
        </p>
      )}

      {endBanner && (
        <div className={styles.endOverlay} role="dialog" aria-modal="true" aria-labelledby="end-title">
          <div className={styles.endModal}>
            <p className={styles.endEyebrow}>
              {endBanner.kind === 'timeout'
                ? 'Время вышло'
                : endBanner.kind === 'resign'
                  ? 'Сдача'
                  : 'Партия окончена'}
            </p>
            <h3 id="end-title" className={styles.endTitle}>
              Победа {winnerLabel(endBanner.winner)}
            </h3>
            <p className={styles.endBody}>
              {endBanner.kind === 'timeout'
                ? `У ${winnerLabel(endBanner.winner === 'white' ? 'black' : 'white')} закончилось время.`
                : endBanner.kind === 'resign'
                  ? resignWasYou
                    ? 'Вы сдались. Партия окончена.'
                    : 'Соперник сдался. Партия окончена.'
                  : 'Король соперника повержен.'}
            </p>
            <div className={styles.endActions}>
              {battleMode === 'ai' && (
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => {
                    void startGameAnalysis();
                  }}
                >
                  Анализ партии
                </button>
              )}
              <button
                type="button"
                className={battleMode === 'ai' ? styles.endDismiss : styles.primary}
                onClick={() => {
                  clearAnalysis();
                  restart();
                }}
              >
                {battleMode === 'ai' ? 'В лобби' : 'Выйти в лобби'}
              </button>
              <button type="button" className={styles.endDismiss} onClick={dismissEndBanner}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function AnalysisMoveCell({
  ply,
  active,
  onClick,
}: {
  ply: AnalyzedPly | undefined;
  active: boolean;
  onClick: () => void;
}) {
  if (!ply) return <span className={styles.historyMove} />;
  return (
    <button
      type="button"
      className={[
        styles.historyMove,
        styles.analysisMoveBtn,
        JUDGMENT_CLASS[ply.judgment],
        active ? styles.historyActive : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
      title={`${judgmentLabel(ply.judgment)} · ${formatEvalCp(ply.evalAfter)}`}
    >
      <span className={styles.judgmentDot} aria-hidden />
      {ply.playedLabel}
    </button>
  );
}

function EvalSparkline({
  values,
  cursor,
  onSelect,
}: {
  values: number[];
  cursor: number;
  onSelect: (i: number) => void;
}) {
  if (values.length === 0) return null;
  const w = 220;
  const h = 48;
  const mid = h / 2;
  const capped = values.map((v) => Math.max(-600, Math.min(600, v)));
  const pts = capped
    .map((v, i) => {
      const x = values.length === 1 ? w / 2 : (i / (values.length - 1)) * (w - 4) + 2;
      const y = mid - (v / 600) * (mid - 4);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className={styles.evalGraph}>
      <svg viewBox={`0 0 ${w} ${h}`} className={styles.evalSvg} aria-hidden>
        <line x1="0" y1={mid} x2={w} y2={mid} className={styles.evalZero} />
        <polyline points={pts} className={styles.evalLine} fill="none" />
        {capped.map((v, i) => {
          const x = values.length === 1 ? w / 2 : (i / (values.length - 1)) * (w - 4) + 2;
          const y = mid - (v / 600) * (mid - 4);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={i === cursor ? 3.5 : 2}
              className={i === cursor ? styles.evalPointActive : styles.evalPoint}
              onClick={() => onSelect(i)}
            />
          );
        })}
      </svg>
    </div>
  );
}
