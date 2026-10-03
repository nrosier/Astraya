/**
 * Electional astrology (#409): choosing *when* to begin something by searching a span of time for
 * the moments whose sky best fits a chosen set of rules.
 *
 * Electional practice has a large and partly contradictory body of rules, and which to apply depends
 * on the purpose (a wedding wants different things from a launch). So the rule set here is small,
 * each rule is individually selectable, and each is stated with where it comes from. It is a
 * starting set, not a claim to completeness — the traditional sources are Bonatti, Lilly
 * (*Christian Astrology*, 1647) and their successors.
 *
 * Every rule is phrased so that **satisfied is good**, which keeps the scoring to a plain count:
 *
 * - `moon-not-void` — the Moon is not void of course (`void-of-course.ts` fixes the convention):
 *   a void Moon is the oldest standing warning that "nothing will come of" what is begun.
 * - `moon-not-via-combusta` — the Moon is outside 15° Libra – 15° Scorpio, the "burnt way".
 * - `mercury-direct` — Mercury is not retrograde, the usual modern caution for contracts, travel and
 *   communication. (Lilly warns against it for these; not every tradition applies it elsewhere.)
 * - `moon-not-weak` — the Moon is not in her detriment (Capricorn) or fall (Scorpio), where her
 *   essential dignity is lowest.
 * - `moon-waxing` — the Moon is increasing in light, between New and Full: favouring beginnings.
 * - `benefic-angular` — Venus or Jupiter, the benefics, is in an angular house (1st, 4th, 7th or
 *   10th) at the place, where a planet acts most strongly.
 * - `moon-aids-benefic` — the Moon is applying to a conjunction, sextile or trine of Venus or
 *   Jupiter, within 3°: the Moon "carries the light" of a benefic into the matter.
 *
 * No real moment satisfies every rule at once, so the result is a ranking by how many hold, not a
 * single "best time". The search walks the span at a fixed step and merges consecutive moments with
 * the same outcome into windows, so the answer reads as "from here to there" rather than a list of
 * near-identical minutes.
 */
import { DEFAULT_ORB_CONFIG, matchAspect, type OrbConfig } from './aspects.js';
import { bodyByKey } from './bodies.js';
import { houseOf } from './emphasis.js';
import { lunarPhaseOf } from './lunar-phase.js';
import { findMoonSignWindow, voidOfCourseAt, type MoonSignWindow } from './void-of-course.js';
import type {
  BodyPosition,
  Degrees,
  EphemerisProvider,
  GeoPosition,
  HouseSystem,
  JulianDayUT,
} from '../ephemeris/types.js';

export const ELECTION_RULE_KEYS = [
  'moon-not-void',
  'moon-not-via-combusta',
  'mercury-direct',
  'moon-not-weak',
  'moon-waxing',
  'benefic-angular',
  'moon-aids-benefic',
] as const;

export type ElectionRuleKey = (typeof ELECTION_RULE_KEYS)[number];

/** The Via Combusta runs from 15° Libra (195°) up to, but not including, 15° Scorpio (225°). */
const VIA_COMBUSTA_START_DEG = 195;
const VIA_COMBUSTA_END_DEG = 225;
/** Sign indices of the Moon's detriment (Capricorn) and fall (Scorpio). */
const MOON_WEAK_SIGNS: readonly number[] = [9, 7];
const ANGULAR_HOUSES: readonly number[] = [1, 4, 7, 10];
/** How close the Moon must be to an exact aspect of a benefic to count as aiding it. */
const MOON_BENEFIC_ORB_DEG = 3;
const MOON_BENEFIC_ASPECTS: readonly string[] = ['conjunction', 'sextile', 'trine'];

const BENEFIC_ORB_CONFIG: OrbConfig = {
  ...DEFAULT_ORB_CONFIG,
  majorOrb: { base: MOON_BENEFIC_ORB_DEG, luminaryBonus: 0 },
  sextileOrb: { base: MOON_BENEFIC_ORB_DEG, luminaryBonus: 0 },
};

/** Everything the rules need to know about the sky at one moment. */
export interface ElectionSnapshot {
  readonly jd: JulianDayUT;
  readonly moonLongitude: Degrees;
  readonly sunLongitude: Degrees;
  readonly moonVoid: boolean;
  readonly mercuryRetrograde: boolean;
  /** The houses Venus and Jupiter are in at the place, or empty when no houses could be cast. */
  readonly beneficHouses: readonly number[];
  /** True when the Moon is applying to a conjunction, sextile or trine of Venus or Jupiter within the orb. */
  readonly moonAidsBenefic: boolean;
}

export type ElectionOutcome = Readonly<Partial<Record<ElectionRuleKey, boolean>>>;

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** Whether each *enabled* rule is satisfied at this moment. Pure. */
export function evaluateRules(snapshot: ElectionSnapshot, enabled: ReadonlySet<ElectionRuleKey>): ElectionOutcome {
  const moon = norm360(snapshot.moonLongitude);
  const all: Record<ElectionRuleKey, boolean> = {
    'moon-not-void': !snapshot.moonVoid,
    'moon-not-via-combusta': !(moon >= VIA_COMBUSTA_START_DEG && moon < VIA_COMBUSTA_END_DEG),
    'mercury-direct': !snapshot.mercuryRetrograde,
    'moon-not-weak': !MOON_WEAK_SIGNS.includes(Math.floor(moon / 30)),
    'moon-waxing': lunarPhaseOf(snapshot.moonLongitude, snapshot.sunLongitude).waxing,
    'benefic-angular': snapshot.beneficHouses.some((house) => ANGULAR_HOUSES.includes(house)),
    'moon-aids-benefic': snapshot.moonAidsBenefic,
  };
  return Object.fromEntries(ELECTION_RULE_KEYS.filter((key) => enabled.has(key)).map((key) => [key, all[key]]));
}

export interface ElectionWindow {
  /** First sampled moment of the window. */
  readonly startJd: JulianDayUT;
  /** One step past the last sampled moment: where the next, different outcome begins. */
  readonly endJd: JulianDayUT;
  readonly satisfied: readonly ElectionRuleKey[];
  readonly violated: readonly ElectionRuleKey[];
}

function outcomeKey(outcome: ElectionOutcome): string {
  return ELECTION_RULE_KEYS.map((key) => (outcome[key] === undefined ? '-' : outcome[key] ? '1' : '0')).join('');
}

/**
 * Merges consecutive samples with identical outcomes into windows. `samples` must be in time order,
 * `stepDays` apart.
 */
export function electionWindows(
  samples: readonly { readonly jd: JulianDayUT; readonly outcome: ElectionOutcome }[],
  stepDays: number,
): readonly ElectionWindow[] {
  const windows: ElectionWindow[] = [];
  let current: { startJd: JulianDayUT; endJd: JulianDayUT; outcome: ElectionOutcome; key: string } | undefined;
  const flush = (): void => {
    if (current === undefined) return;
    const rules = ELECTION_RULE_KEYS.filter((key) => current?.outcome[key] !== undefined);
    windows.push({
      startJd: current.startJd,
      endJd: current.endJd,
      satisfied: rules.filter((key) => current?.outcome[key] === true),
      violated: rules.filter((key) => current?.outcome[key] === false),
    });
  };
  for (const sample of samples) {
    const key = outcomeKey(sample.outcome);
    if (current?.key === key) {
      current.endJd = sample.jd + stepDays;
    } else {
      flush();
      current = { startJd: sample.jd, endJd: sample.jd + stepDays, outcome: sample.outcome, key };
    }
  }
  flush();
  return windows;
}

/** Best first: most rules satisfied, then the longest window, then the earliest. */
export function rankWindows(windows: readonly ElectionWindow[], limit: number): readonly ElectionWindow[] {
  return [...windows]
    .sort(
      (a, b) =>
        b.satisfied.length - a.satisfied.length || b.endJd - b.startJd - (a.endJd - a.startJd) || a.startJd - b.startJd,
    )
    .slice(0, limit);
}

export interface ElectionSearchOptions {
  /** Minutes between sampled moments. Defaults to 60. */
  readonly stepMinutes?: number;
  readonly houseSystem?: HouseSystem;
}

const DEFAULT_STEP_MINUTES = 60;
const DEFAULT_HOUSE_SYSTEM: HouseSystem = 'P';

/** Refuse a search that would sample more moments than this: it is for reading, and for a tab to finish. */
export const MAX_ELECTION_SAMPLES = 3000;

/** The Moon applying to a benefic by conjunction, sextile or trine within `MOON_BENEFIC_ORB_DEG`. */
function aidsBenefic(moon: BodyPosition, benefics: readonly BodyPosition[]): boolean {
  return benefics.some((benefic) => {
    const match = matchAspect(moon, 'luminary', benefic, 'planet', BENEFIC_ORB_CONFIG);
    return match !== undefined && match.applying && MOON_BENEFIC_ASPECTS.includes(match.aspect.key);
  });
}

/** The sky at each step from `fromJd` to `toJd`, with void-of-course worked out once per Moon sign rather than per sample. */
export async function electionSnapshots(
  provider: EphemerisProvider,
  place: GeoPosition,
  fromJd: JulianDayUT,
  toJd: JulianDayUT,
  options: ElectionSearchOptions = {},
): Promise<readonly ElectionSnapshot[]> {
  if (toJd < fromJd) throw new RangeError('toJd must not be before fromJd');
  const stepDays = (options.stepMinutes ?? DEFAULT_STEP_MINUTES) / 1440;
  const sun = bodyByKey('sun');
  const moon = bodyByKey('moon');
  const mercury = bodyByKey('mercury');
  const venus = bodyByKey('venus');
  const jupiter = bodyByKey('jupiter');
  if (!sun || !moon || !mercury || !venus || !jupiter)
    throw new Error('unreachable: the classical bodies are in BODIES');

  const jds: JulianDayUT[] = [];
  for (let t = fromJd; t <= toJd; t += stepDays) jds.push(t);
  if (jds.length > MAX_ELECTION_SAMPLES) {
    throw new RangeError(
      `This search needs ${String(jds.length)} samples, more than the ${String(MAX_ELECTION_SAMPLES)} allowed — shorten the range or use a longer step.`,
    );
  }

  const snapshots: ElectionSnapshot[] = [];
  let window: MoonSignWindow | undefined;
  for (const jd of jds) {
    if (window === undefined || jd >= window.signExitJd) window = await findMoonSignWindow(provider, jd);
    const [sunPosition, moonPosition, mercuryPosition, venusPosition, jupiterPosition] = await provider.positions(jd, [
      sun.id,
      moon.id,
      mercury.id,
      venus.id,
      jupiter.id,
    ]);
    if (!sunPosition || !moonPosition || !mercuryPosition || !venusPosition || !jupiterPosition) {
      throw new Error('unreachable: positions returns one per body');
    }
    const houses = await provider.houses(jd, place, options.houseSystem ?? DEFAULT_HOUSE_SYSTEM);
    const housesDefined = houses.cusps.slice(1).every((cusp) => Number.isFinite(cusp));
    snapshots.push({
      jd,
      moonLongitude: moonPosition.longitude,
      sunLongitude: sunPosition.longitude,
      moonVoid: voidOfCourseAt(window, jd).isVoid,
      mercuryRetrograde: mercuryPosition.retrograde,
      beneficHouses: housesDefined
        ? [houseOf(venusPosition.longitude, houses.cusps), houseOf(jupiterPosition.longitude, houses.cusps)]
        : [],
      moonAidsBenefic: aidsBenefic(moonPosition, [venusPosition, jupiterPosition]),
    });
  }
  return snapshots;
}

/**
 * The windows of a span, each with the rules it satisfies, best first. `enabled` selects the rules;
 * with none enabled every moment trivially ties, so at least one is required.
 */
export async function findElectionWindows(
  provider: EphemerisProvider,
  place: GeoPosition,
  fromJd: JulianDayUT,
  toJd: JulianDayUT,
  enabled: ReadonlySet<ElectionRuleKey>,
  options: ElectionSearchOptions & { readonly limit?: number } = {},
): Promise<readonly ElectionWindow[]> {
  if (enabled.size === 0) throw new RangeError('choose at least one rule');
  const stepDays = (options.stepMinutes ?? DEFAULT_STEP_MINUTES) / 1440;
  const snapshots = await electionSnapshots(provider, place, fromJd, toJd, options);
  const windows = electionWindows(
    snapshots.map((snapshot) => ({ jd: snapshot.jd, outcome: evaluateRules(snapshot, enabled) })),
    stepDays,
  );
  return rankWindows(windows, options.limit ?? 25);
}
