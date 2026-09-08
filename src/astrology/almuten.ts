/**
 * Peregrine detection and almuten scoring (#27).
 *
 * Classical essential-dignity scoring weights each of the five dignities a
 * planet can hold at a degree: 5 points for domicile rulership, 4 for
 * exaltation, 3 for its sect-appropriate triplicity rulership, 2 for its
 * bound (term), 1 for its face (decan) — the scheme used throughout, e.g.
 * DCCCXIII/astro's `almuten/figuris.go` implementing Ibn Ezra's Almuten
 * Figuris. A planet with none of the five at a given degree is "peregrine"
 * there (score 0) — traditionally read as lacking any foothold of dignity,
 * for better or worse depending on the planet's other conditions.
 *
 * Only triplicity's sect-appropriate ruler counts (the day ruler in a day
 * chart, the night ruler in a night chart) — never the participating ruler,
 * which is not part of this scoring scheme even though `triplicity.ts`
 * tracks it for other purposes. Sect itself is not computed here: callers
 * who already have one pass it in (see `sect.ts`, #28).
 *
 * "Almuten of a point" is which of the seven traditional planets holds the
 * most dignity at one specific degree (e.g. the Ascendant). "Almuten
 * Figuris" extends that across several degrees at once ("vital points" —
 * classically the Ascendant, Sun, Moon, Part of Fortune's ruler and
 * prenatal syzygy) by summing each planet's score at every point and taking
 * the overall highest. This module implements only that essential-dignity
 * sum: the fuller classical Figuris algorithm also adds planetary-hour and
 * synodic-cycle bonuses that depend on machinery (planetary hours, prenatal
 * syzygy) this codebase doesn't otherwise compute, so those are deliberately
 * left out rather than approximated. Callers wanting the complete algorithm
 * supply their own bonus terms on top of what's returned here.
 *
 * Rulership and bounds each come in more than one scheme (see `dignities.ts`
 * and `bounds.ts`); both are threaded through as explicit, defaulted options
 * rather than hidden behind one hardcoded choice.
 */
import { bodyByKey } from './bodies.js';
import type { BodyId, Degrees } from '../ephemeris/types.js';
import type { BoundsScheme } from './bounds.js';
import { boundRulerOf } from './bounds.js';
import { faceRulerOf } from './decans.js';
import { essentialDignities, type RulershipScheme } from './dignities.js';
import type { Sect } from './sect.js';
import { triplicityRoleOf } from './triplicity.js';

function id(key: string): BodyId {
  const body = bodyByKey(key);
  if (!body) throw new Error(`unreachable: body key "${key}" is not in the canonical body set`);
  return body.id;
}

/** The seven traditional planets eligible to hold essential dignity, Chaldean order. */
const TRADITIONAL_PLANETS: readonly BodyId[] = [
  id('saturn'),
  id('jupiter'),
  id('mars'),
  id('sun'),
  id('venus'),
  id('mercury'),
  id('moon'),
];

const RULER_POINTS = 5;
const EXALTATION_POINTS = 4;
const TRIPLICITY_POINTS = 3;
const BOUND_POINTS = 2;
const FACE_POINTS = 1;

export interface EssentialDignityScoreOptions {
  readonly rulershipScheme?: RulershipScheme;
  readonly boundsScheme?: BoundsScheme;
}

export interface EssentialDignityScore {
  readonly body: BodyId;
  readonly ruler: boolean;
  readonly exalted: boolean;
  readonly triplicity: boolean;
  readonly bound: boolean;
  readonly face: boolean;
  /** Sum of the five weights above for whichever dignities are held. */
  readonly points: number;
  /** True exactly when `points` is 0 — holds no essential dignity here. */
  readonly peregrine: boolean;
}

/** How much essential dignity `body` holds at `longitude`, under the given sect and schemes. */
export function essentialDignityScoreOf(
  body: BodyId,
  longitude: Degrees,
  sect: Sect,
  options: EssentialDignityScoreOptions = {},
): EssentialDignityScore {
  const rulershipScheme = options.rulershipScheme ?? 'traditional';
  const boundsScheme = options.boundsScheme ?? 'egyptian';

  const dignities = essentialDignities(body, longitude, rulershipScheme);
  const triplicity = triplicityRoleOf(body, longitude) === sect;
  const bound = boundRulerOf(longitude, boundsScheme) === body;
  const face = faceRulerOf(longitude) === body;

  const points =
    (dignities.ruler ? RULER_POINTS : 0) +
    (dignities.exalted ? EXALTATION_POINTS : 0) +
    (triplicity ? TRIPLICITY_POINTS : 0) +
    (bound ? BOUND_POINTS : 0) +
    (face ? FACE_POINTS : 0);

  return {
    body,
    ruler: dignities.ruler,
    exalted: dignities.exalted,
    triplicity,
    bound,
    face,
    points,
    peregrine: points === 0,
  };
}

export interface AlmutenResult {
  /** Every traditional planet's score, in `TRADITIONAL_PLANETS` (Chaldean) order. */
  readonly scores: readonly EssentialDignityScore[];
  /** The winning point total. */
  readonly points: number;
  /** Every planet that reached `points` — more than one entry on a tie. */
  readonly almutens: readonly BodyId[];
}

function pickAlmutens(scores: readonly EssentialDignityScore[]): AlmutenResult {
  const points = Math.max(...scores.map((s) => s.points));
  const almutens = scores.filter((s) => s.points === points).map((s) => s.body);
  return { scores, points, almutens };
}

/** Which of the seven traditional planets holds the most essential dignity at one degree. */
export function almutenOf(longitude: Degrees, sect: Sect, options: EssentialDignityScoreOptions = {}): AlmutenResult {
  return pickAlmutens(TRADITIONAL_PLANETS.map((body) => essentialDignityScoreOf(body, longitude, sect, options)));
}

/**
 * Almuten Figuris (essential-dignity component only — see module docs): sums
 * each traditional planet's score across every vital point supplied, and
 * returns whichever planet's total is highest.
 */
export function almutenFigurisOf(
  vitalPoints: readonly Degrees[],
  sect: Sect,
  options: EssentialDignityScoreOptions = {},
): AlmutenResult {
  if (vitalPoints.length === 0) throw new RangeError('almutenFigurisOf requires at least one vital point');
  const scores = TRADITIONAL_PLANETS.map((body) => {
    const perPoint = vitalPoints.map((longitude) => essentialDignityScoreOf(body, longitude, sect, options));
    const points = perPoint.reduce((sum, s) => sum + s.points, 0);
    return {
      body,
      ruler: perPoint.some((s) => s.ruler),
      exalted: perPoint.some((s) => s.exalted),
      triplicity: perPoint.some((s) => s.triplicity),
      bound: perPoint.some((s) => s.bound),
      face: perPoint.some((s) => s.face),
      points,
      peregrine: points === 0,
    };
  });
  return pickAlmutens(scores);
}
