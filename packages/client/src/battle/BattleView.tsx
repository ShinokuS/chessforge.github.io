import { useEffect, useState } from 'react';
import styles from './BattleView.module.css';
import { BoardView } from './BoardView';
import { useAppStore } from '../app/store';

export function BattleView() {
  const state = useAppStore((s) => s.state);
  const lastError = useAppStore((s) => s.lastError);
  const moveHistory = useAppStore((s) => s.moveHistory);
  const restart = useAppStore((s) => s.restart);
  const battleMode = useAppStore((s) => s.battleMode);
  const setBattleMode = useAppStore((s) => s.setBattleMode);
  const online = useAppStore((s) => s.online);
  const repo = useAppStore((s) => s.repo);
  const activeDeckId = useAppStore((s) => s.activeDeckId);
  const decks = useAppStore((s) => s.decks);
  const setActiveDeckId = useAppStore((s) => s.setActiveDeckId);

  const [, tick] = useState(0);
  useEffect(() => online.subscribeStatus(() => tick((n) => n + 1)), [online]);

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

  const status =
    battleMode === 'online'
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
      : state.phase === 'gameOver'
        ? `Победа: ${state.winner === 'white' ? 'белые' : 'чёрные'}`
        : `Ход ${state.turn} · ${state.activePlayer === 'white' ? 'белые' : 'чёрные (ИИ)'}`;

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
      await online.createRoom(placements());
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

  const showLobby =
    battleMode === 'online' &&
    (onlineStatus === 'idle' ||
      onlineStatus === 'error' ||
      onlineStatus === 'disconnected' ||
      onlineStatus === 'connecting');

  const boardVisible =
    battleMode === 'ai' ||
    onlineStatus === 'waiting' ||
    onlineStatus === 'playing' ||
    (battleMode === 'online' && state.phase === 'gameOver');

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
        <button type="button" className={styles.restart} onClick={restart}>
          {battleMode === 'online' ? 'Выйти / сброс' : 'Новая партия'}
        </button>
      </div>

      {showLobby && (
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
          <p className={styles.lobbyHint}>
            У каждого игрока своя колода: вы берёте «{activeDeck?.name ?? '—'}», соперник — свою при
            входе.
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
          <div className={styles.boardCol}>
            {onlineStatus === 'waiting' && roomId && (
              <div className={styles.roomBanner}>
                <div>
                  <p className={styles.roomLabel}>Код комнаты — передайте сопернику</p>
                  <p className={styles.roomCode}>{roomId}</p>
                  <p className={styles.roomHint}>Вы белые. Ходы начнутся, когда соперник войдёт.</p>
                </div>
                <button type="button" className={styles.copyCode} onClick={copyCode}>
                  {copied ? 'Скопировано' : 'Копировать код'}
                </button>
              </div>
            )}
            <BoardView />
          </div>
          <aside className={styles.history} aria-label="История ходов">
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
          </aside>
        </div>
      )}

      <p className={styles.hint}>
        {battleMode === 'online'
          ? 'Создайте комнату (код на доске) или войдите по коду. У каждого — своя колода.'
          : 'Выберите фигуру, затем клетку. Рокировка — король на два поля к ладье.'}
      </p>
    </section>
  );
}
