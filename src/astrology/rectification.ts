/**
 * Birth-time rectification (#408): narrowing an uncertain birth time by testing candidate times
 * against the dates of known life events.
 *
 * The idea is the one every rectification starts from: the Ascendant and Midheaven move through
 * the whole zodiac in a day, so they are the points that change with the birth time — a planet's
 * position hardly does. If an event in someone's life lines up with a technique's contact to an
 * angle, the angle was probably about where that candidate time puts it. This module counts those
 * alignments for each candidate and ranks the candidates by the count.
 *
 * **It narrows; it does not prove.** A rectified time is a better-supported guess, never a
 * measurement: the score is a sum of coincidences, some of which are chance, so each result also
 * carries its `lift` over the average candidate — a time that scores only like the average has
 * explained nothing. The screen says so too.
 *
 * Sources disagree on which techniques count as evidence and how to weight them, so the convention
 * used is stated rather than hidden:
 *
 * - **Solar-arc directions** (weight 2, the technique most rectifiers trust for timing): the
 *   secondary-progressed Sun's arc since birth, applied to a point, carries it forward about a
 *   degree a year. A contact counts when a directed angle (Ascendant or Midheaven) falls on a
 *   natal planet, or a directed planet on a natal angle, by conjunction, square or opposition
 *   (`SOLAR_ARC_ORB_DEG`, a degree: roughly a year either side of exact).
 * - **Transits to the angles** (weight 1): Jupiter, Saturn, Uranus, Neptune or Pluto — the slow
 *   planets, whose contact lasts long enough to line up with a dated event — conjunct, square or
 *   opposite the natal Ascendant or Midheaven within `TRANSIT_ORB_DEG`.
 * - A contact scores its technique's weight scaled by how close it is: full at exact, nothing at the
 *   orb. Every event counts equally; the user chooses which events to supply.
 *
 * Planets are taken at the candidate's own birth moment, so the Moon — which moves a degree every
 * two hours — also helps tell candidates apart, in the directed and natal roles alike.
 */
import { bodyByKey } from './bodies.js';
import { ageInYears } from './progressions.js';
import type { BodyId, Degrees, EphemerisProvider, GeoPosition, HouseSystem, JulianDayUT } from '../ephemeris/types.js';

export const SOLAR_ARC_ORB_DEG = 1;
export const TRANSIT_ORB_DEG = 1;
export const SOLAR_ARC_WEIGHT = 2;
export const TRANSIT_WEIGHT = 1;

const DEFAULT_HOUSE_SYSTEM: HouseSystem = 'P';

/** The aspects that count: conjunction, square and opposition — the hard, event-marking ones. */
const CONTACT_ANGLES: readonly { readonly key: 'conjunction' | 'square' | 'opposition'; readonly angle: Degrees }[] = [
  { key: 'conjunction', angle: 0 },
  { key: 'square', angle: 90 },
  { key: 'opposition', angle: 180 },
];

/** Bodies that are directed and received: the luminaries and the planets. */
const CHART_BODY_KEYS = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
/** The slow planets whose transits to the angles count. */
const SLOW_TRANSIT_KEYS = ['jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];

export type RectificationTechnique = 'solar-arc' | 'transit';

/** A dated life event the candidate times are tested against. */
export interface RectificationEvent {
  readonly label: string;
  readonly jd: JulianDayUT;
}

export interface RectificationContact {
  readonly eventIndex: number;
  readonly technique: RectificationTechnique;
  /** The moving point: `'asc'`/`'mc'` directed, a directed body key, or a transiting body key. */
  readonly moving: string;
  /** The natal point it touches: a body key, `'asc'` or `'mc'`. */
  readonly natal: string;
  readonly aspect: 'conjunction' | 'square' | 'opposition';
  /** Distance from exact, in degrees. */
  readonly orb: Degrees;
  readonly points: number;
}

export interface CandidateScore {
  /** The candidate birth moment. */
  readonly jd: JulianDayUT;
  readonly ascendant: Degrees;
  readonly midheaven: Degrees;
  readonly score: number;
  readonly contacts: readonly RectificationContact[];
}

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** The smaller of the two arcs between two longitudes, in [0, 180]. */
function separation(a: Degrees, b: Degrees): Degrees {
  const diff = norm360(a - b);
  return diff > 180 ? 360 - diff : diff;
}

/**
 * How close `moving` is to making `aspectAngle` to `natal`, in degrees, or `undefined` outside `maxOrb`.
 */
export function contactOrb(
  moving: Degrees,
  natal: Degrees,
  aspectAngle: Degrees,
  maxOrb: Degrees,
): Degrees | undefined {
  const orb = Math.abs(separation(moving, natal) - aspectAngle);
  return orb <= maxOrb ? orb : undefined;
}

/** A contact's points: its technique's weight at exact, falling in a straight line to nothing at the orb. */
export function contactPoints(orb: Degrees, maxOrb: Degrees, weight: number): number {
  return weight * (1 - orb / maxOrb);
}

interface Point {
  readonly key: string;
  readonly longitude: Degrees;
}

/** Every contact between `moving` points and `natal` points that falls within `maxOrb`. */
function contactsBetween(
  eventIndex: number,
  technique: RectificationTechnique,
  moving: readonly Point[],
  natal: readonly Point[],
  maxOrb: Degrees,
  weight: number,
): readonly RectificationContact[] {
  const contacts: RectificationContact[] = [];
  for (const mover of moving) {
    for (const target of natal) {
      if (mover.key === target.key) continue;
      for (const { key, angle } of CONTACT_ANGLES) {
        const orb = contactOrb(mover.longitude, target.longitude, angle, maxOrb);
        if (orb === undefined) continue;
        contacts.push({
          eventIndex,
          technique,
          moving: mover.key,
          natal: target.key,
          aspect: key,
          orb,
          points: contactPoints(orb, maxOrb, weight),
        });
      }
    }
  }
  return contacts;
}

export interface RectificationOptions {
  readonly houseSystem?: HouseSystem;
}

function bodyIds(keys: readonly string[]): readonly { key: string; id: BodyId }[] {
  return keys.flatMap((key) => {
    const body = bodyByKey(key);
    return body === undefined ? [] : [{ key, id: body.id }];
  });
}

/** How well one candidate birth moment fits the events. */
export async function scoreCandidate(
  provider: EphemerisProvider,
  place: GeoPosition,
  candidateJd: JulianDayUT,
  events: readonly RectificationEvent[],
  options: RectificationOptions = {},
): Promise<CandidateScore> {
  const sun = bodyByKey('sun');
  if (sun === undefined) throw new Error('unreachable: the Sun is always in BODIES');
  const houses = await provider.houses(candidateJd, place, options.houseSystem ?? DEFAULT_HOUSE_SYSTEM);
  if (!Number.isFinite(houses.ascendant) || !Number.isFinite(houses.midheaven)) {
    throw new RangeError('No Ascendant or Midheaven can be cast for this place and time.');
  }

  const chartBodies = bodyIds(CHART_BODY_KEYS);
  const natalPositions = await provider.positions(
    candidateJd,
    chartBodies.map((body) => body.id),
  );
  const natalBodies: Point[] = chartBodies.map((body, index) => ({
    key: body.key,
    longitude: natalPositions[index]?.longitude ?? Number.NaN,
  }));
  const natalAngles: Point[] = [
    { key: 'asc', longitude: houses.ascendant },
    { key: 'mc', longitude: houses.midheaven },
  ];
  const natalSun = natalBodies.find((body) => body.key === 'sun')?.longitude ?? Number.NaN;

  const slow = bodyIds(SLOW_TRANSIT_KEYS);
  const contacts: RectificationContact[] = [];
  for (const [eventIndex, event] of events.entries()) {
    // The solar arc: how far the progressed Sun (a day of motion per year of age) has moved.
    const age = ageInYears(candidateJd, event.jd);
    const progressedSun = await provider.position(candidateJd + age, sun.id);
    const arc = progressedSun.longitude - natalSun;
    const directedAngles = natalAngles.map((angle) => ({ key: angle.key, longitude: norm360(angle.longitude + arc) }));
    const directedBodies = natalBodies.map((body) => ({ key: body.key, longitude: norm360(body.longitude + arc) }));
    contacts.push(
      ...contactsBetween(eventIndex, 'solar-arc', directedAngles, natalBodies, SOLAR_ARC_ORB_DEG, SOLAR_ARC_WEIGHT),
      ...contactsBetween(eventIndex, 'solar-arc', directedBodies, natalAngles, SOLAR_ARC_ORB_DEG, SOLAR_ARC_WEIGHT),
    );

    const transits = await provider.positions(
      event.jd,
      slow.map((body) => body.id),
    );
    const transiting: Point[] = slow.map((body, index) => ({
      key: body.key,
      longitude: transits[index]?.longitude ?? Number.NaN,
    }));
    contacts.push(...contactsBetween(eventIndex, 'transit', transiting, natalAngles, TRANSIT_ORB_DEG, TRANSIT_WEIGHT));
  }

  return {
    jd: candidateJd,
    ascendant: houses.ascendant,
    midheaven: houses.midheaven,
    contacts,
    score: contacts.reduce((total, contact) => total + contact.points, 0),
  };
}

export interface RankedCandidate extends CandidateScore {
  /** This candidate's score divided by the average over all candidates: 1 is no better than chance. */
  readonly lift: number;
}

/** Refuse a search over more candidates than this: it is for reading, and for a tab to finish. */
export const MAX_RECTIFICATION_CANDIDATES = 1500;

/**
 * Scores every candidate and ranks them, best first. `lift` is each score over the mean score of
 * all candidates, so a flat field (every time explains the events about equally) is visible as
 * lifts near 1 rather than hidden behind a "best" time.
 */
export async function rectify(
  provider: EphemerisProvider,
  place: GeoPosition,
  candidateJds: readonly JulianDayUT[],
  events: readonly RectificationEvent[],
  options: RectificationOptions = {},
): Promise<readonly RankedCandidate[]> {
  if (events.length === 0) throw new RangeError('add at least one dated event');
  if (candidateJds.length === 0) throw new RangeError('no candidate times to test');
  if (candidateJds.length > MAX_RECTIFICATION_CANDIDATES) {
    throw new RangeError(
      `${String(candidateJds.length)} candidate times is more than the ${String(MAX_RECTIFICATION_CANDIDATES)} allowed — shorten the range or use a longer step.`,
    );
  }
  const scored: CandidateScore[] = [];
  for (const jd of candidateJds) scored.push(await scoreCandidate(provider, place, jd, events, options));
  const mean = scored.reduce((total, candidate) => total + candidate.score, 0) / scored.length;
  return scored
    .map((candidate) => ({ ...candidate, lift: mean > 0 ? candidate.score / mean : 0 }))
    .sort((a, b) => b.score - a.score || a.jd - b.jd);
}
