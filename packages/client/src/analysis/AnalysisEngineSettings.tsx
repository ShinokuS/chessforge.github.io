import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { listBots, formatBotLabel, type BotId } from '@chessforge/ai';
import {
  ANALYSIS_DEPTH_OPTIONS,
  type AnalysisDepth,
  type AnalysisThreads,
} from './analysisSettings';
import styles from './AnalysisEngineSettings.module.css';

type Props = {
  botId: BotId;
  depth: AnalysisDepth;
  threads: AnalysisThreads;
  onBotChange: (botId: BotId) => void;
  onDepthChange: (depth: AnalysisDepth) => void;
  onThreadsChange: (threads: AnalysisThreads) => void;
  disabled?: boolean;
};

export function AnalysisEngineSettingsButton({
  botId,
  depth,
  threads,
  onBotChange,
  onDepthChange,
  onThreadsChange,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bots = useMemo(() => listBots(), []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={open ? styles.gearOn : styles.gear}
        aria-label="Настройки движка"
        aria-expanded={open}
        aria-controls={open ? titleId : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <GearIcon />
      </button>

      {open && (
        <div className={styles.panel} id={titleId} role="dialog" aria-label="Анализ">
          <h3 className={styles.panelTitle}>Анализ</h3>

          <label className={styles.row}>
            <span>Движок</span>
            <select
              className={styles.control}
              value={botId}
              onChange={(e) => onBotChange(e.target.value)}
            >
              {bots.map((bot) => (
                <option key={bot.id} value={bot.id} title={bot.description}>
                  {formatBotLabel(bot)}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.row}>
            <span>Макс. глубина</span>
            <select
              className={styles.control}
              value={depth}
              onChange={(e) => onDepthChange(Number(e.target.value))}
            >
              {ANALYSIS_DEPTH_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.row}>
            <span>Потоки</span>
            <input
              className={styles.control}
              type="number"
              min={1}
              step={1}
              value={threads}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') return;
                onThreadsChange(Number(raw));
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.1 7.1 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.57.23-1.11.54-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.77 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.89 14.52a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.3.59.22l2.39-.96c.5.4 1.05.72 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.57-.22 1.12-.54 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z"
      />
    </svg>
  );
}
