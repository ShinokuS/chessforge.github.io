import type { ReactElement, ReactNode } from 'react';
import type { PlayerId } from '@chessforge/engine';

type PieceIconProps = {
  defId: string;
  owner: PlayerId;
  className?: string | undefined;
};

type Colors = { fill: string; stroke: string; accent: string };

function colors(owner: PlayerId): Colors {
  if (owner === 'white') {
    return { fill: '#f3efe4', stroke: '#2b2a26', accent: '#c4a35a' };
  }
  return { fill: '#1e1c1a', stroke: '#0c0b0a', accent: '#c4a35a' };
}

function Base({
  owner,
  children,
}: {
  owner: PlayerId;
  children: ReactNode;
}) {
  const c = colors(owner);
  return (
    <g fill={c.fill} stroke={c.stroke} strokeWidth={1.5} strokeLinejoin="round">
      {children}
    </g>
  );
}

function Pawn({ owner }: { owner: PlayerId }) {
  return (
    <Base owner={owner}>
      <path d="M22.5 9c-2.2 0-4 1.8-4 4 0 1.3.6 2.4 1.6 3.1C17.4 17.4 15 20.2 15 24v1.5h15V24c0-3.8-2.4-6.6-5.1-7.9 1-.7 1.6-1.8 1.6-3.1 0-2.2-1.8-4-4-4z" />
      <path d="M12 36.5h21l-1.8-8.5H13.8z" />
      <path d="M11 39.5h23v3.5H11z" />
    </Base>
  );
}

/** Diagonal-capable pawn — pointed head + side notches. */
function Skirmisher({ owner }: { owner: PlayerId }) {
  const c = colors(owner);
  return (
    <Base owner={owner}>
      <path d="M22.5 7l3.2 6.5H19.3z" />
      <path d="M16 16.5h13l-2 6.5H18z" />
      <path d="M14 26h17l-2.2 8H16.2z" />
      <path d="M12 36.5h21v3H12z" />
      <path d="M10 20l5 3M35 20l-5 3" stroke={c.accent} fill="none" strokeWidth={2} strokeLinecap="round" />
    </Base>
  );
}

/** Armored pawn — wide plate + rivets. */
function Ironclad({ owner }: { owner: PlayerId }) {
  const c = colors(owner);
  return (
    <Base owner={owner}>
      <rect x="16" y="10" width="13" height="10" rx="1.5" />
      <path d="M13 22h19l-1.5 12H14.5z" />
      <path d="M11 36h23v4H11z" />
      <circle cx="19" cy="15" r="1.1" fill={c.stroke} stroke="none" />
      <circle cx="26" cy="15" r="1.1" fill={c.stroke} stroke="none" />
      <path d="M18 28h9" stroke={c.accent} fill="none" strokeWidth={2} />
    </Base>
  );
}

/** Forward spear strike — long point. */
function Spearman({ owner }: { owner: PlayerId }) {
  const c = colors(owner);
  return (
    <Base owner={owner}>
      <path d="M22.5 5l1.8 14h-3.6z" fill={c.accent} stroke={c.stroke} />
      <path d="M20 20h5v8l2 6H18l2-6z" />
      <path d="M13 36h19v4H13z" />
      <path d="M22.5 19v14" stroke={c.stroke} fill="none" strokeWidth={1.5} />
    </Base>
  );
}

function Rook({ owner }: { owner: PlayerId }) {
  return (
    <Base owner={owner}>
      <path d="M11 14.5h5.5V10H20v4.5h5V10h3.5v4.5H34V18l-2.2 3.5v9.5H13.2v-9.5L11 18z" />
      <path d="M12.5 33.5h20l-1.5 3H14z" />
      <path d="M11 38h23v4H11z" />
    </Base>
  );
}

/** Short rook with forward wedges. */
function Sprinter({ owner }: { owner: PlayerId }) {
  const c = colors(owner);
  return (
    <Base owner={owner}>
      <path d="M14 16h4V12h4v4h5V12h4v4h4v4l-2 2v8H16v-8l-2-2z" />
      <path d="M13 32h19l-1.5 4H14.5z" />
      <path d="M12 38h21v3H12z" />
      <path d="M8 22h5M8 26h5M32 22h5M32 26h5" stroke={c.accent} fill="none" strokeWidth={1.8} strokeLinecap="round" />
    </Base>
  );
}

/** Compact king-step rook — low battlement. */
function Sentry({ owner }: { owner: PlayerId }) {
  const c = colors(owner);
  return (
    <Base owner={owner}>
      <path d="M15 18h4v-3h3v3h4v-3h3v3h4v5l-2 2v6H17v-6l-2-2z" />
      <path d="M14 34h17l-1 3H15z" />
      <path d="M13 39h19v3H13z" />
      <circle cx="22.5" cy="26" r="2" fill={c.accent} stroke={c.stroke} />
    </Base>
  );
}

function Knight({ owner }: { owner: PlayerId }) {
  const c = colors(owner);
  return (
    <Base owner={owner}>
      <path d="M14 38.5h21v3.5H12.5z" />
      <path d="M13 34.5h19.5l-1.2-4.2c1.8-1.4 3.2-3.4 3.8-5.8.8-3.2-.2-6.4-2.8-8.7C29.5 13.2 26 11 22.2 11c-1.4 0-2.7.2-3.9.7L14 9.5v6.2l2.2 1.1c-.8 1.2-1.3 2.6-1.3 4.1 0 1.6.5 3 1.3 4.2L12.5 28c-.6 1.1-.8 2.3-.7 3.5z" />
      <circle cx="20.5" cy="18.5" r="1.2" fill={c.stroke} stroke="none" />
    </Base>
  );
}

/** Orthogonal jumper — spear crest. */
function Lancer({ owner }: { owner: PlayerId }) {
  const c = colors(owner);
  return (
    <Base owner={owner}>
      <path d="M22.5 6l2 10h-4z" fill={c.accent} stroke={c.stroke} />
      <path d="M18 16h9v6l3 4v8H15v-8l3-4z" />
      <path d="M13 36h19v4H13z" />
      <path d="M22.5 22v10" stroke={c.stroke} fill="none" />
    </Base>
  );
}

/** Retreat knight — rear plume. */
function Outrider({ owner }: { owner: PlayerId }) {
  const c = colors(owner);
  return (
    <Base owner={owner}>
      <path d="M30 12c4 1 7 5 8 9-3-1-6-2-9-5z" fill={c.accent} stroke={c.stroke} />
      <path d="M14 38.5h20v3.5H13z" />
      <path d="M14 33h18l-1-4c2-2 3.5-4.5 3.5-7.5 0-4.5-3.5-8-8-8-2 0-3.5.5-5 1.2L15 12v5l2 1c-1 1.2-1.5 2.6-1.5 4.2 0 1.4.4 2.7 1.1 3.8L13.5 30c-.5 1-.7 2-.6 3z" />
      <circle cx="21" cy="19" r="1.1" fill={c.stroke} stroke="none" />
    </Base>
  );
}

function Bishop({ owner }: { owner: PlayerId }) {
  const c = colors(owner);
  return (
    <Base owner={owner}>
      <circle cx="22.5" cy="10" r="2.4" />
      <path d="M22.5 13.5c-4.8 3.2-8 8.2-8 13.2 0 2.2.6 4.1 1.6 5.8h12.8c1-1.7 1.6-3.6 1.6-5.8 0-5-3.2-10-8-13.2z" />
      <path d="M18 28.5h9" stroke={c.stroke} fill="none" />
      <path d="M22.5 17.5v8" stroke={c.stroke} fill="none" />
      <path d="M13 36.5h19l-1.6-4H14.6z" />
      <path d="M11.5 39h22v3.5h-22z" />
    </Base>
  );
}

/** Support bishop — cross top, open cleft. */
function Chaplain({ owner }: { owner: PlayerId }) {
  const c = colors(owner);
  return (
    <Base owner={owner}>
      <path d="M20.5 7h4v3h3v3.5h-3V17h-4v-3.5h-3V10h3z" fill={c.accent} stroke={c.stroke} />
      <path d="M15 19c0 0 3-3 7.5-3s7.5 3 7.5 3c1.5 4 2 8 0 12H15c-2-4-1.5-8 0-12z" />
      <path d="M18 28h9" stroke={c.stroke} fill="none" />
      <path d="M13 35h19l-1.5 3H14.5z" />
      <path d="M12 40h21v2.5H12z" />
    </Base>
  );
}

/** Swap bishop — double mitre tips. */
function Exchanger({ owner }: { owner: PlayerId }) {
  const c = colors(owner);
  return (
    <Base owner={owner}>
      <circle cx="18" cy="10" r="2" />
      <circle cx="27" cy="10" r="2" />
      <path d="M22.5 13.5c-4.8 3.2-8 8.2-8 13.2 0 2.2.6 4.1 1.6 5.8h12.8c1-1.7 1.6-3.6 1.6-5.8 0-5-3.2-10-8-13.2z" />
      <path d="M16 24h13M19 21l-3 3 3 3M26 21l3 3-3 3" stroke={c.accent} fill="none" strokeWidth={1.6} strokeLinecap="round" />
      <path d="M13 36.5h19l-1.6-4H14.6z" />
      <path d="M11.5 39h22v3.5h-22z" />
    </Base>
  );
}

function Queen({ owner }: { owner: PlayerId }) {
  return (
    <Base owner={owner}>
      <circle cx="12" cy="13" r="2.1" />
      <circle cx="22.5" cy="10" r="2.1" />
      <circle cx="33" cy="13" r="2.1" />
      <path d="M12 15.2 14.8 29h15.4L33 15.2 27 22.5 22.5 14 18 22.5z" />
      <path d="M14.5 31.5h16l-1.4 3.5h-13.2z" />
      <path d="M12 38.5h21v3.5H12z" />
    </Base>
  );
}

/** Warp queen — crescent diadem. */
function Regent({ owner }: { owner: PlayerId }) {
  const c = colors(owner);
  return (
    <Base owner={owner}>
      <path d="M11 14c3-6 20-6 23 0-4-3-19-3-23 0z" fill={c.accent} stroke={c.stroke} />
      <circle cx="22.5" cy="9" r="2" />
      <path d="M13 16 16 29h13l3-13-6 6-3.5-8L19 22z" />
      <path d="M14.5 31.5h16l-1.4 3.5h-13.2z" />
      <path d="M12 38.5h21v3.5H12z" />
    </Base>
  );
}

/** Freeze queen — icy crown points. */
function Cryomancer({ owner }: { owner: PlayerId }) {
  const c = colors(owner);
  return (
    <Base owner={owner}>
      <path d="M12 16l2.5-7 2.5 5 3-8 3 8 2.5-5 2.5 7" fill={c.accent} stroke={c.stroke} />
      <path d="M13 17 16 29h13l3-12-5 5-3.5-7L20 22z" />
      <path d="M14.5 31.5h16l-1.4 3.5h-13.2z" />
      <path d="M12 38.5h21v3.5H12z" />
      <path d="M18 24h9" stroke="#8fd4f0" fill="none" strokeWidth={1.5} />
    </Base>
  );
}

function King({ owner }: { owner: PlayerId }) {
  return (
    <Base owner={owner}>
      <path d="M20.5 8.5h4v3h3v4h-3v3h-4v-3h-3v-4h3z" />
      <path d="M13.5 20.5c0-3.2 4-5.5 9-5.5s9 2.3 9 5.5c0 4.5-3.2 7.2-5.2 10.5H18.7c-2-3.3-5.2-6-5.2-10.5z" />
      <path d="M14.5 33.5h16l-1.5 3H16z" />
      <path d="M12 38.5h21v3.5H12z" />
    </Base>
  );
}

/** King + shield boss. */
function Warden({ owner }: { owner: PlayerId }) {
  const c = colors(owner);
  return (
    <Base owner={owner}>
      <path d="M20.5 7h4v2.5h2.5v3H24.5V16h-4v-3.5H18V9.5h2.5z" />
      <path d="M14 18.5c0-2.5 3.5-4.5 8.5-4.5s8.5 2 8.5 4.5c0 3.5-2.5 6-4.5 9H18.5c-2-3-4.5-5.5-4.5-9z" />
      <path d="M16 30.5h13v3.5c0 3-3 5.5-6.5 5.5S16 37 16 34z" fill={c.accent} stroke={c.stroke} />
      <path d="M12 38.5h21v3.5H12z" />
    </Base>
  );
}

/** Immobile king — heavy base, no cross. */
function Anchor({ owner }: { owner: PlayerId }) {
  const c = colors(owner);
  return (
    <Base owner={owner}>
      <path d="M18 12h9v4l3 3v4H15v-4l3-3z" />
      <path d="M14 24h17v6c0 4-3.5 7-8.5 7S14 34 14 30z" fill={c.accent} stroke={c.stroke} />
      <path d="M11 38.5h23v3.5H11z" />
      <path d="M22.5 27v8" stroke={c.stroke} fill="none" />
    </Base>
  );
}

const ICONS: Record<string, (props: { owner: PlayerId }) => ReactElement> = {
  pawn: Pawn,
  skirmisher: Skirmisher,
  ironclad: Ironclad,
  spearman: Spearman,
  rook: Rook,
  sprinter: Sprinter,
  sentry: Sentry,
  knight: Knight,
  lancer: Lancer,
  outrider: Outrider,
  bishop: Bishop,
  chaplain: Chaplain,
  exchanger: Exchanger,
  queen: Queen,
  regent: Regent,
  cryomancer: Cryomancer,
  king: King,
  warden: Warden,
  anchor: Anchor,
};

export function PieceIcon({ defId, owner, className }: PieceIconProps) {
  const Icon = ICONS[defId] ?? Pawn;

  return (
    <svg
      className={className}
      viewBox="0 0 45 45"
      width="100%"
      height="100%"
      aria-hidden
      focusable="false"
    >
      <Icon owner={owner} />
    </svg>
  );
}
