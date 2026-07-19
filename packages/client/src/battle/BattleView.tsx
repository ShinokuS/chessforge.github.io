import { useEffect, useRef, useState } from 'react';
import styles from './BattleView.module.css';
import { BoardView } from './BoardView';
import { formatClock } from './clock';
import {
  AI_STRENGTH,
  SIDE_OPTIONS,
  TIME_PRESETS,
  timePresetMs,
  type AiStrength,
  type SidePreference,
  type TimePresetId,
} from './settings';
import { useAppStore } from '../app/store';

export function BattleView() {
  const state = useAppStore((s) => s.state);
  const lastError = useAppStore((s) => s.lastError);
  const moveHistory = useAppStore((s) => s.moveHistory);
  const clocks = useAppStore((s) => s.clocks);
  const endBanner = useAppStore((s) => s.endBanner);
  const restart = useAppStore((s) => s.restart);
  const startAiMatch = useAppStore((s) => s.startAiMatch);
  const tickClock = useAppStore((s) => s.tickClock);
  const resetClocks = useAppStore((s) => s.resetClocks);
  const dismissEndBanner = useAppStore((s) => s.dismissEndBanner);
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

  const onlineClocksStarted = useRef(false);
  useEffect(() => {
    if (battleMode !== 'online') {
      onlineClocksStarted.current = false;
      return;
    }
    const status = online.getStatus();
    if (status === 'playing' && !onlineClocksStarted.current) {
      onlineClocksStarted.current = true;
      resetClocks('white', online.getMatchClockMs());
      return;
    }
    if (status !== 'playing') {
      onlineClocksStarted.current = false;
    }
  }, [battleMode, online, resetClocks, tick]);

  const [joinCode, setJoinCode] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('room') ?? '';
  });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const onlineStatus = online.getStatus();
  const roomId = online.getRoomId();
  const myColor = online.getMyColor();
  const activeDeck = decks.find((d) => d.id === activeDeckId) ?? decks[0];

  const winnerLabel = (w: 'white' | 'black') => (w === 'white' ? 'белые' : 'чёрные');

  const status = endBanner
    ? endBanner.kind === 'timeout'
      ? `Время вышло · победа: ${winnerLabel(endBanner.winner)}`
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

  const showAiLobby = battleMode === 'ai' && !aiPlaying && !endBanner;
  const showOnlineLobby =
    battleMode === 'online' &&
    (onlineStatus === 'idle' ||
      onlineStatus === 'error' ||
      onlineStatus === 'disconnected' ||
      onlineStatus === 'connecting');

  const boardVisible =
    (battleMode === 'ai' && (aiPlaying || Boolean(endBanner) || state.phase === 'gameOver')) ||
    onlineStatus === 'waiting' ||
    onlineStatus === 'playing' ||
    (battleMode === 'online' && state.phase === 'gameOver');

  const showClocks =
    (battleMode === 'ai' && aiPlaying) ||
    onlineStatus === 'playing' ||
    Boolean(endBanner) ||
    (battleMode === 'online' && state.phase === 'gameOver');

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
      ? 'ИИ'
      : onlineStatus === 'waiting'
        ? 'Соперник'
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
        {(aiPlaying ||
          onlineStatus === 'waiting' ||
          onlineStatus === 'playing' ||
          onlineStatus === 'connecting') && (
          <button type="button" className={styles.restart} onClick={restart}>
            {battleMode === 'online' ? 'Выйти / сброс' : 'В лобби'}
          </button>
        )}
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

          <fieldset className={styles.optionGroup}>
            <legend>Сила ИИ</legend>
            <div className={styles.optionRow}>
              {(Object.keys(AI_STRENGTH) as AiStrength[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  className={aiStrength === id ? styles.optionActive : undefined}
                  onClick={() => setAiStrength(id)}
                >
                  {AI_STRENGTH[id].label}
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
                  className={aiTimePreset === p.id ? styles.optionActive : undefined}
                  onClick={() => setAiTimePreset(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </fieldset>

          <p className={styles.lobbyHint}>
            Вы белые · колода «{activeDeck?.name ?? '—'}» · ИИ:{' '}
            {AI_STRENGTH[aiStrength].label.toLowerCase()} · {timePresetMs(aiTimePreset) / 60_000}{' '}
            мин
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
                <h3 className={styles.historyTitle}>История</h3>
                {moveHistory.length === 0 ? (
                  <p className={styles.historyEmpty}>Ходов пока нет</p>
                ) : (
                  <ol className={styles.historyList}>
                    {moveHistory.map((entry) => (
                      <li key={`${entry.ply}-${entry.text}`} className={styles.historyItem}>
                        <span className={styles.historyMeta}>
                          {entry.turn}
                          {entry.player === 'white' ? 'б' : 'ч'}
                        </span>
                        <span
                          className={
                            entry.player === 'white' ? styles.historyWhite : styles.historyBlack
                          }
                        >
                          {entry.text}
                        </span>
                      </li>
                    ))}
                  </ol>
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

      <p className={styles.hint}>
        {battleMode === 'online'
                      ? 'Создайте комнату (время и сторона — ваши) или войдите по коду со своей колодой.'
                      : aiPlaying
            ? 'Выберите фигуру, затем клетку. Рокировка — король на два поля к ладье.'
            : 'Выберите колоду, силу ИИ и контроль времени, затем начните партию.'}
      </p>

      {endBanner && (
        <div className={styles.endOverlay} role="dialog" aria-modal="true" aria-labelledby="end-title">
          <div className={styles.endModal}>
            <p className={styles.endEyebrow}>
              {endBanner.kind === 'timeout' ? 'Время вышло' : 'Партия окончена'}
            </p>
            <h3 id="end-title" className={styles.endTitle}>
              Победа {winnerLabel(endBanner.winner)}
            </h3>
            <p className={styles.endBody}>
              {endBanner.kind === 'timeout'
                ? `У ${winnerLabel(endBanner.winner === 'white' ? 'black' : 'white')} закончилось время.`
                : 'Король соперника повержен.'}
            </p>
            <div className={styles.endActions}>
              <button type="button" className={styles.primary} onClick={restart}>
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
