import { describe, expect, it } from 'vitest';
import {
  angularityOf,
  DEFAULT_SALIENCE_LIMIT,
  derivePlacements,
  rankPlacements,
  selectSalientPlacements,
} from '../src/interpretation/rules.js';
import { bodyByKey } from '../src/astrology/bodies.js';
import type { Aspect } from '../src/astrology/aspects.js';
import type { EssentialDignities } from '../src/astrology/dignities.js';
import type { ChartData } from '../src/domain/chart-compute.js';
import type { BodyId, BodyPosition, Degrees, HousePositions } from '../src/ephemeris/types.js';

function bodyId(key: string): BodyId {
  const body = bodyByKey(key);
  if (body === undefined) throw new Error(`unknown body key "${key}" in test fixture`);
  return body.id;
}

function position(key: string, longitude: Degrees, overrides: Partial<BodyPosition> = {}): BodyPosition {
  return {
    body: bodyId(key),
    longitude,
    latitude: 0,
    distance: 1,
    longitudeSpeed: 1,
    latitudeSpeed: 0,
    distanceSpeed: 0,
    retrograde: false,
    ...overrides,
  };
}

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** Equal 12-house cusps starting from `ascendant`, matching an equal-house layout. */
function equalHouses(ascendant: Degrees): HousePositions {
  const cusps: Degrees[] = [0];
  for (let house = 1; house <= 12; house++) cusps.push(norm360(ascendant + (house - 1) * 30));
  const midheaven = cusps[10];
  if (midheaven === undefined) throw new Error('unreachable: house 10 cusp always exists');
  return {
    cusps,
    ascendant,
    midheaven,
    armc: midheaven,
    vertex: 0,
    equatorialAscendant: ascendant,
    coAscendantKoch: ascendant,
    coAscendantMunkasey: ascendant,
    polarAscendant: ascendant,
    system: 'P',
  };
}

const NO_DIGNITY: EssentialDignities = { ruler: false, exalted: false, detriment: false, fall: false };

interface ChartFixtureOptions {
  readonly ascendant?: Degrees;
  readonly positions?: readonly BodyPosition[];
  readonly dignities?: ReadonlyMap<BodyId, EssentialDignities>;
  readonly aspects?: readonly Aspect[];
  readonly sect?: ChartData['sect'];
}

function makeChart(options: ChartFixtureOptions = {}): ChartData {
  const positions = options.positions ?? [position('sun', 10), position('moon', 100)];
  return {
    positions,
    houses: equalHouses(options.ascendant ?? 0),
    aspects: options.aspects ?? [],
    dignities: options.dignities ?? new Map(positions.map((p) => [p.body, NO_DIGNITY])),
    sect: options.sect ?? 'day',
    partOfFortune: 0,
    partOfSpirit: 0,
  };
}

describe('angularityOf (#60)', () => {
  it('is zero exactly on the ascendant', () => {
    expect(angularityOf(15, equalHouses(15))).toBe(0);
  });

  it('is zero exactly on the descendant', () => {
    const houses = equalHouses(0);
    expect(angularityOf(180, houses)).toBe(0);
  });

  it('is zero exactly on the midheaven and IC', () => {
    const houses = equalHouses(0); // midheaven at 270
    expect(angularityOf(270, houses)).toBe(0);
    expect(angularityOf(90, houses)).toBe(0); // IC, opposite the midheaven
  });

  it('is the distance to the nearest angle, not an arbitrary one', () => {
    const houses = equalHouses(0); // angles at 0, 90, 180, 270
    expect(angularityOf(85, houses)).toBe(5);
    expect(angularityOf(178, houses)).toBe(2);
  });
});

describe('derivePlacements (#60)', () => {
  it('gives every position a planet-in-sign and a planet-in-house placement', () => {
    const chart = makeChart();
    const keys = derivePlacements(chart).map((placement) => placement.key);
    expect(keys).toContain('planet-in-sign:sun:0');
    expect(keys).toContain('planet-in-house:sun:1');
    expect(keys).toContain('planet-in-sign:moon:3');
  });

  it('derives a sign-on-cusp placement for every house of a 12-house system', () => {
    const chart = makeChart({ ascendant: 0 });
    const cuspKeys = derivePlacements(chart)
      .map((placement) => placement.key)
      .filter((key) => key.startsWith('sign-on-cusp:'));
    expect(cuspKeys).toHaveLength(12);
    expect(cuspKeys).toContain('sign-on-cusp:0:1'); // Aries rising on the 1st
  });

  it('weighs a body with a dignity higher than the same placement with none', () => {
    const dignified = makeChart({
      positions: [position('mars', 10)], // Aries: Mars rules
      dignities: new Map([[bodyId('mars'), { ruler: true, exalted: false, detriment: false, fall: false }]]),
    });
    const peregrine = makeChart({
      positions: [position('mars', 40)], // Taurus: no dignity
      dignities: new Map([[bodyId('mars'), NO_DIGNITY]]),
    });
    const dignifiedSalience = derivePlacements(dignified).find((p) => p.key === 'planet-in-sign:mars:0')?.salience;
    const peregrineSalience = derivePlacements(peregrine).find((p) => p.key === 'planet-in-sign:mars:1')?.salience;
    expect(dignifiedSalience).toBeGreaterThan(peregrineSalience ?? Infinity);
  });

  it('produces both a ruler and a matching dignity-state placement for a dignified body', () => {
    const chart = makeChart({
      positions: [position('mars', 10)],
      dignities: new Map([[bodyId('mars'), { ruler: true, exalted: false, detriment: false, fall: false }]]),
    });
    const keys = derivePlacements(chart).map((placement) => placement.key);
    expect(keys).toContain('dignity-state:mars:ruler');
  });

  it('omits a dignity-state placement for a peregrine body', () => {
    const chart = makeChart({
      positions: [position('mars', 40)],
      dignities: new Map([[bodyId('mars'), NO_DIGNITY]]),
    });
    const keys = derivePlacements(chart).map((placement) => placement.key);
    expect(keys.some((key) => key.startsWith('dignity-state:'))).toBe(false);
  });

  it('gives the sect light extra salience over the same body out of sect', () => {
    const dayChart = makeChart({ positions: [position('sun', 10)], sect: 'day' });
    const nightChart = makeChart({ positions: [position('sun', 10)], sect: 'night' });
    const daySalience = derivePlacements(dayChart).find((p) => p.key === 'planet-in-sign:sun:0')?.salience;
    const nightSalience = derivePlacements(nightChart).find((p) => p.key === 'planet-in-sign:sun:0')?.salience;
    expect(daySalience).toBeGreaterThan(nightSalience ?? Infinity);
  });

  it('adds retrograde salience for a classical planet but not for a lunar node', () => {
    const stillMercury = makeChart({ positions: [position('mercury', 10)] });
    const retroMercury = makeChart({ positions: [position('mercury', 10, { retrograde: true, longitudeSpeed: -1 })] });
    const stillSalience = derivePlacements(stillMercury).find((p) => p.key === 'planet-in-sign:mercury:0')?.salience;
    const retroSalience = derivePlacements(retroMercury).find((p) => p.key === 'planet-in-sign:mercury:0')?.salience;
    expect(retroSalience).toBeGreaterThan(stillSalience ?? Infinity);

    const stillNode = makeChart({ positions: [position('trueNode', 10)] });
    const retroNode = makeChart({ positions: [position('trueNode', 10, { retrograde: true, longitudeSpeed: -1 })] });
    const nodeStillSalience = derivePlacements(stillNode).find((p) => p.key === 'planet-in-sign:trueNode:0')?.salience;
    const nodeRetroSalience = derivePlacements(retroNode).find((p) => p.key === 'planet-in-sign:trueNode:0')?.salience;
    expect(nodeRetroSalience).toBe(nodeStillSalience);
  });

  it('gives a planet close to an angle higher salience than the same body far from every angle', () => {
    const angular = makeChart({ ascendant: 0, positions: [position('mars', 2)] }); // 2° past the ascendant
    const nonAngular = makeChart({ ascendant: 0, positions: [position('mars', 45)] }); // mid-house, far from any angle
    const angularSalience = derivePlacements(angular).find((p) => p.key === 'planet-in-house:mars:1')?.salience;
    const nonAngularSalience = derivePlacements(nonAngular).find((p) => p.key === 'planet-in-house:mars:2')?.salience;
    expect(angularSalience).toBeGreaterThan(nonAngularSalience ?? Infinity);
  });

  it('derives an aspect-pair placement for every chart aspect, keyed with alphabetically ordered bodies', () => {
    const aspect: Aspect = {
      bodyA: bodyId('venus'),
      bodyB: bodyId('mars'),
      aspect: { key: 'trine', name: 'Trine', angle: 120, family: 'major' },
      separation: 121,
      orb: 1,
      applying: false,
    };
    const chart = makeChart({ aspects: [aspect] });
    const keys = derivePlacements(chart).map((placement) => placement.key);
    expect(keys).toContain('aspect-pair:trine:mars:venus');
  });

  it('gives a tight aspect higher salience than a wide one of the same kind', () => {
    const tightAspect: Aspect = {
      bodyA: bodyId('venus'),
      bodyB: bodyId('mars'),
      aspect: { key: 'trine', name: 'Trine', angle: 120, family: 'major' },
      separation: 120.1,
      orb: 0.1,
      applying: false,
    };
    const wideAspect: Aspect = { ...tightAspect, separation: 126, orb: 6 };
    const tightSalience = derivePlacements(makeChart({ aspects: [tightAspect] })).find(
      (p) => p.key === 'aspect-pair:trine:mars:venus',
    )?.salience;
    const wideSalience = derivePlacements(makeChart({ aspects: [wideAspect] })).find(
      (p) => p.key === 'aspect-pair:trine:mars:venus',
    )?.salience;
    expect(tightSalience).toBeGreaterThan(wideSalience ?? Infinity);
  });

  it('omits the house-class factor for a non-12-house system rather than misapplying it', () => {
    const chart = makeChart();
    const gauquelin: ChartData = {
      ...chart,
      houses: { ...chart.houses, cusps: Array.from({ length: 37 }, (_, index) => (index * 10) % 360) },
    };
    const cuspPlacements = derivePlacements(gauquelin).filter((p) => p.key.startsWith('sign-on-cusp:'));
    expect(cuspPlacements).toHaveLength(36);
    for (const placement of cuspPlacements) {
      expect(placement.factors.some((factor) => factor.rule === 'house')).toBe(false);
    }
  });

  it('is deterministic: the same chart derives structurally identical placements every time', () => {
    const chart = makeChart({
      positions: [position('sun', 10), position('moon', 100, { retrograde: false })],
      aspects: [
        {
          bodyA: bodyId('sun'),
          bodyB: bodyId('moon'),
          aspect: { key: 'square', name: 'Square', angle: 90, family: 'major' },
          separation: 90,
          orb: 0,
          applying: false,
        },
      ],
    });
    expect(derivePlacements(chart)).toEqual(derivePlacements(chart));
  });
});

describe('rankPlacements (#60)', () => {
  it('orders placements from most to least salient', () => {
    const chart = makeChart({
      positions: [position('sun', 10), position('vesta', 200)],
    });
    const ranked = rankPlacements(derivePlacements(chart));
    const saliences = ranked.map((placement) => placement.salience);
    expect(saliences).toEqual([...saliences].sort((left, right) => right - left));
  });

  it('breaks a salience tie deterministically by placement key', () => {
    const chart = makeChart({
      positions: [position('ceres', 10), position('pallas', 40)], // same category, no other differentiating factor
    });
    const ranked = rankPlacements(derivePlacements(chart).filter((p) => p.key.startsWith('planet-in-sign:')));
    // Both are asteroids with no other differentiating factor, so their salience ties;
    // only the key tie-break decides the order, and it must do so the same way every time.
    expect(ranked.map((p) => p.key)).toEqual(['planet-in-sign:ceres:0', 'planet-in-sign:pallas:1']);
  });
});

describe('selectSalientPlacements (#60)', () => {
  it('returns at most the given limit, most salient first', () => {
    const chart = makeChart();
    const selected = selectSalientPlacements(chart, 3);
    expect(selected.length).toBeLessThanOrEqual(3);
    const ranked = rankPlacements(derivePlacements(chart));
    expect(selected).toEqual(ranked.slice(0, 3));
  });

  it('defaults to DEFAULT_SALIENCE_LIMIT when no limit is given', () => {
    const chart = makeChart();
    expect(selectSalientPlacements(chart).length).toBeLessThanOrEqual(DEFAULT_SALIENCE_LIMIT);
  });
});
