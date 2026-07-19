export type SiteTheme = 'forest' | 'brown' | 'mono';

export const SITE_THEMES: { id: SiteTheme; label: string }[] = [
  { id: 'forest', label: 'Лес' },
  { id: 'brown', label: 'Коричневая' },
  { id: 'mono', label: 'Ч/Б' },
];

const STORAGE_KEY = 'chessforge.theme';

export function readStoredTheme(): SiteTheme {
  if (typeof window === 'undefined') return 'forest';
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === 'brown' || v === 'mono' || v === 'forest') return v;
  return 'forest';
}

export function applySiteTheme(theme: SiteTheme): void {
  document.documentElement.setAttribute('data-theme', theme);
  window.localStorage.setItem(STORAGE_KEY, theme);
}
