/**
 * Theme selection logic for the explicit light/dark override (#70). `'system'` means
 * "no override" — the page follows `prefers-color-scheme`, via the plain `:root` /
 * `@media (prefers-color-scheme: light)` rules already in `app.css`. `'light'`/`'dark'`
 * pin the palette regardless of the OS setting, via the `:root[data-theme]` rules those
 * same tokens are redefined in.
 *
 * Kept pure and DOM-free so it's Vitest-testable (the project's tests run under Node,
 * with no `document`/`localStorage`) — the actual reading/writing/applying lives in
 * `ThemeToggle.tsx`, the same "thin `.tsx`, tested `.ts`" split `SortableTable.tsx`/
 * `table-sort.ts` already use.
 */

export type Theme = 'system' | 'light' | 'dark';

export const THEME_CYCLE: readonly Theme[] = ['system', 'light', 'dark'];

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEME_CYCLE as readonly string[]).includes(value);
}

export function nextTheme(current: Theme): Theme {
  const index = THEME_CYCLE.indexOf(current);
  return THEME_CYCLE[(index + 1) % THEME_CYCLE.length] ?? 'system';
}

export const THEME_LABELS: Record<Theme, string> = {
  system: 'Theme: System',
  light: 'Theme: Light',
  dark: 'Theme: Dark',
};
