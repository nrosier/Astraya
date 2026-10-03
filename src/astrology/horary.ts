/**
 * The "considerations before judgment" of horary astrology (#406): the standard checks that a
 * chart cast for the moment a question was asked is fit to be judged at all.
 *
 * Horary reads a chart cast for the moment of a *question*, not a birth, and the tradition opens
 * with a short list of conditions under which the chart is said not to be "radical" — not safe to
 * answer from (William Lilly, *Christian Astrology*, 1647, ch. XXXVI; the same list is repeated
 * in most later horary texts). They are warnings to the astrologer, not hard prohibitions: a chart
 * that trips one is still a chart, and some practitioners would judge it anyway with care.
 *
 * Stated here, since schools differ on the finer points:
 *
 * - **Ascendant too early / too late** — the Ascendant is in the first 3° or the last 3° of its
 *   sign: too early, the matter is not yet ripe to judge; too late, it is already decided.
 * - **Moon void of course** — the Moon will make no further exact aspect before leaving its sign
 *   (see `void-of-course.ts` for the convention used: major aspects to the Sun and Mercury–Pluto).
 *   "Nothing will come of the matter."
 * - **Moon in the Via Combusta** — the Moon between 15° Libra and 15° Scorpio, the "burnt way".
 * - **Saturn in the seventh house** — Saturn, as the traditional malefic, in the house of the
 *   astrologer, impairs the astrologer's own judgment.
 *
 * Only these four are checked. Lilly lists further considerations (the lord of the Ascendant
 * combust, the querent's and quesited's significators afflicted, and so on) that depend on *what
 * was asked*, which no chart can tell — those belong to the judgment itself, which this module does
 * not attempt.
 */
import type { Degrees } from '../ephemeris/types.js';
import { degreesInSign } from './signs.js';

export type HoraryConsiderationKey =
  'ascendant-too-early' | 'ascendant-too-late' | 'moon-void-of-course' | 'moon-via-combusta' | 'saturn-in-seventh';

/** The Ascendant is "too early" below 3° into its sign and "too late" above 27°. */
export const ASCENDANT_EARLY_LIMIT_DEG = 3;
export const ASCENDANT_LATE_LIMIT_DEG = 27;

/** The Via Combusta runs from 15° Libra (195°) up to, but not including, 15° Scorpio (225°). */
export const VIA_COMBUSTA_START_DEG = 195;
export const VIA_COMBUSTA_END_DEG = 225;

export interface HoraryConsideration {
  readonly key: HoraryConsiderationKey;
  /** True when the condition holds, i.e. the chart carries this caution. */
  readonly applies: boolean;
}

export interface HoraryInput {
  readonly ascendant: Degrees;
  readonly moonLongitude: Degrees;
  /** Which house Saturn is in (1-12), or `undefined` when the houses cannot be cast. */
  readonly saturnHouse: number | undefined;
  readonly moonIsVoid: boolean;
}

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

export function horaryConsiderations(input: HoraryInput): readonly HoraryConsideration[] {
  const ascendantDegree = degreesInSign(input.ascendant);
  const moon = norm360(input.moonLongitude);
  return [
    { key: 'ascendant-too-early', applies: ascendantDegree < ASCENDANT_EARLY_LIMIT_DEG },
    { key: 'ascendant-too-late', applies: ascendantDegree > ASCENDANT_LATE_LIMIT_DEG },
    { key: 'moon-void-of-course', applies: input.moonIsVoid },
    { key: 'moon-via-combusta', applies: moon >= VIA_COMBUSTA_START_DEG && moon < VIA_COMBUSTA_END_DEG },
    { key: 'saturn-in-seventh', applies: input.saturnHouse === 7 },
  ];
}

/** A chart is "radical" — fit to be judged — when it carries none of the cautions. */
export function isRadical(considerations: readonly HoraryConsideration[]): boolean {
  return considerations.every((consideration) => !consideration.applies);
}
