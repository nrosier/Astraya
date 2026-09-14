/**
 * Locale-aware display formatting (#158) — the counterpart to `messages.ts` for values that
 * aren't fixed strings: dates, times, coordinates. Luxon (already a dependency for calculation,
 * always used in UTC/fixed offsets there) is what gives these a `.locale`, rather than hand-
 * rolling a second formatter per display site.
 *
 * Framework-free like `src/domain`/`src/chart` — `Locale` is a plain string union, and every
 * function here takes it as an explicit argument rather than reading `locale.ts`'s store, so
 * `chart-tables.ts` and `multi-wheel.ts` can call in too without taking on a UI/React dependency
 * or a `localStorage` read of their own.
 */
import type { Locale } from '../interpretation/schema.js';

/**
 * Today's date as an `<input type="date">` value, in the visitor's local calendar. Locale-
 * invariant by the HTML spec (always `yyyy-mm-dd`, regardless of UI language), so this is a
 * pure dedup — it was triplicated across `TransitView.tsx`, `PeriodicTransitView.tsx` and
 * `ProfectionsView.tsx` — not a translation.
 */
export function todayInputValue(): string {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const enCardinals = { north: 'N', south: 'S', east: 'E', west: 'W' };
const nlCardinals: typeof enCardinals = { north: 'N', south: 'Z', east: 'O', west: 'W' };
const CARDINALS: Readonly<Record<Locale, typeof enCardinals>> = { en: enCardinals, nl: nlCardinals };

/**
 * A latitude or longitude as printed decimal degrees plus a hemisphere letter — e.g. `51.50°N`,
 * `51,50°N` in Dutch. The letter set differs per locale (Dutch "Zuid"/"Oost" give Z/O where
 * English gives S/E); the decimal separator follows `Intl.NumberFormat`, which already renders
 * `nl` with a comma.
 */
export function formatCoordinate(value: number, axis: 'lat' | 'lon', locale: Locale): string {
  const cardinals = CARDINALS[locale];
  const letter =
    axis === 'lat' ? (value < 0 ? cardinals.south : cardinals.north) : value < 0 ? cardinals.west : cardinals.east;
  const magnitude = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Math.abs(value),
  );
  return `${magnitude}°${letter}`;
}
