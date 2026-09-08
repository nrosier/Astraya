/**
 * Triplicity rulers: day, night and participating (#26).
 *
 * Each of the four elements has three rulers rather than one, following the
 * table set out by Dorotheus and reproduced by Lilly in Christian Astrology —
 * the version most traditional astrologers use today, as distinct from
 * Ptolemy's own (differently-assigned, participating-ruler-free) triplicity
 * table in the Tetrabiblos. This module implements only the Dorothean/Lilly
 * table; it does not attempt to also model Ptolemy's variant.
 *
 * Which ruler applies — day or night — depends on the sect of the chart
 * (whether the Sun is above or below the horizon), which this module does not
 * compute: that belongs with sect/combustion (#28). Callers who already know
 * the sect pass it in explicitly; this module only holds the static table.
 */
import { bodyByKey } from './bodies.js';
import type { BodyId, Degrees } from '../ephemeris/types.js';
import type { Element } from './signs.js';
import { signOf } from './signs.js';

function id(key: string): BodyId {
  const body = bodyByKey(key);
  if (!body) throw new Error(`unreachable: body key "${key}" is not in the canonical body set`);
  return body.id;
}

export interface TriplicityRulers {
  readonly day: BodyId;
  readonly night: BodyId;
  readonly participating: BodyId;
}

const TRIPLICITY_RULERS: Readonly<Record<Element, TriplicityRulers>> = {
  fire: { day: id('sun'), night: id('jupiter'), participating: id('saturn') },
  earth: { day: id('venus'), night: id('moon'), participating: id('mars') },
  air: { day: id('saturn'), night: id('mercury'), participating: id('jupiter') },
  water: { day: id('venus'), night: id('mars'), participating: id('moon') },
};

/** The day/night/participating rulers of an element's triplicity. */
export function triplicityRulersOf(element: Element): TriplicityRulers {
  return TRIPLICITY_RULERS[element];
}

/** The day/night/participating rulers of the triplicity a longitude falls in. */
export function triplicityRulersAt(longitude: Degrees): TriplicityRulers {
  return triplicityRulersOf(signOf(longitude).element);
}

export type TriplicityRole = keyof TriplicityRulers;

/** Whether `body` holds any triplicity role for the sign at `longitude`. */
export function triplicityRoleOf(body: BodyId, longitude: Degrees): TriplicityRole | undefined {
  const rulers = triplicityRulersAt(longitude);
  if (rulers.day === body) return 'day';
  if (rulers.night === body) return 'night';
  if (rulers.participating === body) return 'participating';
  return undefined;
}
