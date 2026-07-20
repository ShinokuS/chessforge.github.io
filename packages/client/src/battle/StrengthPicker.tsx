import { AI_STRENGTH_LEVELS, aiSearchProfile, type AiStrengthLevel } from './settings';
import styles from './StrengthPicker.module.css';

type Props = {
  value: AiStrengthLevel;
  onChange: (level: AiStrengthLevel) => void;
  label: string;
  /** Extra line under the hint (e.g. in-game note). */
  note?: string;
  compact?: boolean;
};

export function StrengthPicker({ value, onChange, label, note, compact }: Props) {
  const profile = aiSearchProfile(value);

  return (
    <fieldset className={compact ? `${styles.wrap} ${styles.compact}` : styles.wrap}>
      <legend className={styles.legend}>{label}</legend>
      <div className={styles.levels} role="radiogroup" aria-label={label}>
        {AI_STRENGTH_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={value === level}
            className={value === level ? styles.levelActive : styles.level}
            onClick={() => onChange(level)}
          >
            {level}
          </button>
        ))}
      </div>
      <p className={styles.hint}>{profile.hint}</p>
      {note ? <p className={styles.note}>{note}</p> : null}
    </fieldset>
  );
}
