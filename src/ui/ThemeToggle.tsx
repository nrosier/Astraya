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
import { useMessages } from './messages.js';
import { applyTheme, readStoredTheme, writeStoredTheme } from './theme-dom.js';
import { nextTheme, themeLabel, type Theme } from './theme.js';
import { themeToggleMessages } from './ThemeToggle.messages.js';

export function ThemeToggle(): React.JSX.Element {
  const t = useMessages(themeToggleMessages);
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const label = themeLabel(theme, t);

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
      aria-label={t.activateToChange(label)}
      title={label}
    >
      {theme === 'system' ? '◐' : theme === 'light' ? '☀' : '☾'}
    </button>
  );
}
