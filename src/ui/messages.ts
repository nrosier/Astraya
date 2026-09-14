/**
 * Reads the current UI locale's half of a `{ en, nl }` message catalogue (#158).
 *
 * Catalogues are plain objects, not string keys into a runtime table: `chartViewMessages.nl`
 * is typed as `typeof chartViewMessages.en`, so a key missing from one locale is a compile
 * error, not a silent English fallback discovered at runtime.
 */
import { useLocale } from './locale.js';
import type { Locale } from '../interpretation/schema.js';

export function useMessages<T>(catalog: Readonly<Record<Locale, T>>): T {
  const [locale] = useLocale();
  return catalog[locale];
}
