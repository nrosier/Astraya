/**
 * The explicit light/dark override (#70): a single button, always visible, that cycles
 * system -> light -> dark -> system and remembers the choice for next time.
 *
 * Thin wiring only: the DOM/storage calls live in `theme-dom.ts`, the cycle logic in
 * `theme.ts` — this component just holds the current value in state and applies it.
 * `main.tsx` applies the stored value once before the first paint, so this only ever
 * has to re-apply on a change the user just made.
 */
import { useState } from 'react';
import { applyTheme, readStoredTheme, writeStoredTheme } from './theme-dom.js';
import { nextTheme, THEME_LABELS, type Theme } from './theme.js';

export function ThemeToggle(): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => {
        setTheme((current) => {
          const next = nextTheme(current);
          writeStoredTheme(next);
          applyTheme(next);
          return next;
        });
      }}
      aria-label={`${THEME_LABELS[theme]} — activate to change`}
      title={THEME_LABELS[theme]}
    >
      {theme === 'system' ? '◐' : theme === 'light' ? '☀' : '☾'}
    </button>
  );
}
