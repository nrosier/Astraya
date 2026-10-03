/**
 * Pure logic for the planetary-cycles screen (#410): the presets it offers, the clamps on its
 * inputs, and the shape of a result row. Kept apart from `CyclesView.tsx` so it can be tested
 * without a DOM or an ephemeris.
 */
import { bodyByKey } from '../astrology/bodies.js';
import type { MutualAspectEvent } from '../astrology/mutual-aspects.js';
import { SIGNS } from '../astrology/signs.js';
import { civilFromJulianDay } from '../time/julian.js';

/** The bodies the screen offers: the Sun, the planets and Chiron. The Moon is left out — it laps everything monthly, so a multi-year search over it is neither useful nor affordable. */
export const CYCLE_BODY_KEYS: readonly string[] = [
  'sun',
  'mercury',
  'venus',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
  'chiron',
];

/** The aspects the screen offers: the five Ptolemaic ones. */
export const CYCLE_ASPECT_KEYS: readonly string[] = ['conjunction', 'sextile', 'square', 'trine', 'opposition'];

export type MotionFilter = 'all' | 'retrograde' | 'direct';

export interface CyclePreset {
  readonly key: string;
  readonly bodyA: string;
  readonly bodyB: string;
  readonly aspect: string;
  readonly motion: MotionFilter;
  /** Years either side of `anchorYear`'s window; a fixed span for the long outer-planet cycles. */
  readonly span: { readonly from: number; readonly to: number } | { readonly yearsFromNow: number };
}

export const CYCLE_PRESETS: readonly CyclePreset[] = [
  {
    key: 'jupiter-saturn',
    bodyA: 'jupiter',
    bodyB: 'saturn',
    aspect: 'conjunction',
    motion: 'all',
    span: { from: 1800, to: 2200 },
  },
  {
    key: 'saturn-uranus',
    bodyA: 'saturn',
    bodyB: 'uranus',
    aspect: 'conjunction',
    motion: 'all',
    span: { from: 1800, to: 2200 },
  },
  {
    key: 'saturn-neptune',
    bodyA: 'saturn',
    bodyB: 'neptune',
    aspect: 'conjunction',
    motion: 'all',
    span: { from: 1800, to: 2200 },
  },
  {
    key: 'saturn-pluto',
    bodyA: 'saturn',
    bodyB: 'pluto',
    aspect: 'conjunction',
    motion: 'all',
    span: { from: 1800, to: 2200 },
  },
  {
    key: 'venus-pentagram',
    bodyA: 'venus',
    bodyB: 'sun',
    aspect: 'conjunction',
    motion: 'retrograde',
    span: { yearsFromNow: 8.5 },
  },
];

export interface CycleRow {
  readonly jd: number;
  /** `YYYY-MM-DD HH:MM` UTC. */
  readonly date: string;
  readonly aspectKey: string;
  /** Body A's longitude at the aspect. */
  readonly longitude: number;
  /** Sign name and the position within it, e.g. `Aquarius 0°29'`. */
  readonly signName: string;
  readonly position: string;
  readonly retrogradeA: boolean;
  readonly retrogradeB: boolean;
  /** Years since the previous row, or `undefined` for the first. */
  readonly yearsSincePrevious: number | undefined;
}

const DAYS_PER_YEAR = 365.2425;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Applies the motion filter to body A at the moment of the aspect. */
export function filterByMotion(
  events: readonly MutualAspectEvent[],
  motion: MotionFilter,
): readonly MutualAspectEvent[] {
  if (motion === 'all') return events;
  return events.filter((event) => event.retrogradeA === (motion === 'retrograde'));
}

export function cycleRows(events: readonly MutualAspectEvent[]): readonly CycleRow[] {
  return events.map((event, index) => {
    const c = civilFromJulianDay(event.jd);
    const totalMinutes = Math.round((((event.longitudeA % 360) + 360) % 360) * 60) % (360 * 60);
    const signIndex = Math.floor(totalMinutes / (30 * 60));
    const within = totalMinutes - signIndex * 30 * 60;
    const previous = events[index - 1];
    return {
      jd: event.jd,
      date: `${String(c.year)}-${pad2(c.month)}-${pad2(c.day)} ${pad2(c.hour)}:${pad2(c.minute)}`,
      aspectKey: event.aspect.key,
      longitude: event.longitudeA,
      signName: SIGNS[signIndex]?.name ?? '',
      position: `${String(Math.floor(within / 60))}°${pad2(within % 60)}'`,
      retrogradeA: event.retrogradeA,
      retrogradeB: event.retrogradeB,
      yearsSincePrevious: previous === undefined ? undefined : (event.jd - previous.jd) / DAYS_PER_YEAR,
    };
  });
}

export function bodyIdOf(key: string): number | undefined {
  return bodyByKey(key)?.id;
}
