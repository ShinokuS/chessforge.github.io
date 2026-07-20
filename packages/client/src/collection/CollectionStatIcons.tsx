/** Иконка бюджета колоды — шестиугольная жетон-монета. */
export function CostIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      width="16"
      height="16"
      aria-hidden
      focusable="false"
    >
      <path
        d="M10 1.5 17.2 5.75v8.5L10 18.5 2.8 14.25v-8.5z"
        fill="currentColor"
        opacity="0.18"
      />
      <path
        d="M10 2.8 16 6.4v7.2L10 17.2 4 13.6V6.4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M10 6.2 12.4 10 10 13.8 7.6 10z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M10 5v10M7 7.5h6M7 12.5h6"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinecap="round"
        fill="none"
        opacity="0.55"
      />
    </svg>
  );
}

/** Иконка количества — стопка карт. */
export function CountIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      width="16"
      height="16"
      aria-hidden
      focusable="false"
    >
      <rect
        x="3.5"
        y="5.5"
        width="11"
        height="13"
        rx="1.2"
        fill="currentColor"
        opacity="0.12"
        transform="rotate(-6 9 12)"
      />
      <rect
        x="5"
        y="4"
        width="11"
        height="13"
        rx="1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        transform="rotate(3 10.5 10.5)"
      />
      <rect
        x="6.5"
        y="2.5"
        width="11"
        height="13"
        rx="1.2"
        fill="currentColor"
        opacity="0.22"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path
        d="M9.5 7.5h5M9.5 10h5M9.5 12.5h3.5"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinecap="round"
        opacity="0.65"
      />
    </svg>
  );
}
