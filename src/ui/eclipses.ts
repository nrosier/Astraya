/**
 * Pure logic for the eclipses screen (#404): the row shape and the limit on how much it will
 * search at once. Kept apart from `EclipsesView.tsx` so it can be tested without a DOM or an
 * ephemeris.
 */
import type { Eclipse, EclipseContact } from '../astrology/eclipses.js';
import { SIGNS } from '../astrology/signs.js';
import { civilFromJulianDay } from '../time/julian.js';

/** A longer span is refused: the list is for reading, and ~4.5 eclipses a year makes 60 years a few hundred rows. */
export const MAX_ECLIPSE_SPAN_YEARS = 60;

export interface EclipseRow {
  readonly id: string;
  readonly jd: number;
  /** `YYYY-MM-DD HH:MM` UTC. */
  readonly date: string;
  readonly family: Eclipse['family'];
  readonly kind: Eclipse['kind'];
  readonly longitude: number;
  readonly signName: string;
  /** Degree and minute within the sign, e.g. `19°24'`. */
  readonly position: string;
  readonly contacts: readonly EclipseContact[];
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** One row per eclipse. `contactsFor` supplies the natal contacts for each, or none when no person is chosen. */
export function eclipseRows(
  eclipses: readonly Eclipse[],
  contactsFor: (eclipse: Eclipse) => readonly EclipseContact[] = () => [],
): readonly EclipseRow[] {
  return eclipses.map((eclipse) => {
    const c = civilFromJulianDay(eclipse.maxJd);
    const totalMinutes = Math.round((((eclipse.longitude % 360) + 360) % 360) * 60) % (360 * 60);
    const signIndex = Math.floor(totalMinutes / (30 * 60));
    const within = totalMinutes - signIndex * 30 * 60;
    return {
      id: `${eclipse.family}-${String(eclipse.maxJd)}`,
      jd: eclipse.maxJd,
      date: `${String(c.year)}-${pad2(c.month)}-${pad2(c.day)} ${pad2(c.hour)}:${pad2(c.minute)}`,
      family: eclipse.family,
      kind: eclipse.kind,
      longitude: eclipse.longitude,
      signName: SIGNS[signIndex]?.name ?? '',
      position: `${String(Math.floor(within / 60))}°${pad2(within % 60)}'`,
      contacts: contactsFor(eclipse),
    };
  });
}
