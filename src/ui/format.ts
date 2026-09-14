/**
 * Locale-aware display formatting (#158) — the counterpart to `messages.ts` for values that
 * aren't fixed strings: dates, times, coordinates. Luxon (already a dependency for calculation,
 * always used in UTC/fixed offsets there) is what gives these a `.locale`, rather than hand-
 * rolling a second formatter per display site.
 *
 * Starts with just the one call-site-independent helper below; `ChartView.tsx`,
 * `multi-wheel.ts`, `chart-tables.ts` and friends migrate into this module in the
 * "Formatting + glossary" rollout PR, once their own catalogues exist.
 */

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
