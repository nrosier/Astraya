/**
 * The report language, promoted out of `ReportView` to sit next to `ThemeToggle` — see
 * `locale.ts` for why it's a shared store rather than a `ReportView`-local `useState`.
 *
 * A single cycling button, same shape as `ThemeToggle`, rather than a `<select>`: two
 * locales today, and a button matches the toggle it sits beside instead of looking like
 * a form control dropped into the corner of the screen.
 */
import { CORPUS_LOCALES } from '../interpretation/schema.js';
import { LOCALE_LABELS, useLocale } from './locale.js';

export function LanguageToggle(): React.JSX.Element {
  const [locale, setLocale] = useLocale();

  return (
    <button
      type="button"
      className="theme-toggle language-toggle"
      onClick={() => {
        const index = CORPUS_LOCALES.indexOf(locale);
        setLocale(CORPUS_LOCALES[(index + 1) % CORPUS_LOCALES.length] ?? locale);
      }}
      aria-label={`Report language: ${LOCALE_LABELS[locale]} — activate to change`}
      title={LOCALE_LABELS[locale]}
    >
      {locale.toUpperCase()}
    </button>
  );
}
