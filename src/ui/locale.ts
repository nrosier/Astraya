/**
 * The app's UI locale (#158) — originally added as a `ReportView`-only picker, then promoted
 * to sit next to `ThemeToggle` as an app-wide setting. It now drives every UI message
 * catalogue (`useMessages`, in `messages.ts`) as well as the interpretation report's language.
 * The storage key still says `reportLocale`: renaming it would reset every existing user's
 * choice for no benefit, since the value it holds hasn't changed — only its scope has.
 *
 * A plain module-level store rather than React context: `LanguageToggle` (mounted once,
 * globally) and `ReportView` (mounted only while that tab is open) both need to read and
 * react to the same value with no provider wiring `App.tsx` would otherwise need. Same
 * `useSyncExternalStore` shape `SyncBadge.tsx` uses for sync status, including its
 * `OFF_STATUS`-style stable snapshot: returning a fresh value from `getSnapshot` would
 * make React re-render forever.
 */
import { useSyncExternalStore } from 'react';
import { CORPUS_LOCALES, type Locale } from '../interpretation/schema.js';

const LOCALE_KEY = 'astraya:reportLocale';

export const LOCALE_LABELS: Readonly<Record<Locale, string>> = { en: 'English', nl: 'Nederlands' };

export function isLocale(value: string): value is Locale {
  return (CORPUS_LOCALES as readonly string[]).includes(value);
}

function readStored(): Locale {
  const stored = localStorage.getItem(LOCALE_KEY);
  return stored !== null && isLocale(stored) ? stored : 'en';
}

let current: Locale = readStored();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  if (next === current) return;
  current = next;
  localStorage.setItem(LOCALE_KEY, next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

export function useLocale(): [Locale, (next: Locale) => void] {
  const locale = useSyncExternalStore(subscribe, getLocale);
  return [locale, setLocale];
}
