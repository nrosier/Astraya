/**
 * What the wheel's selection panel shows text for (#415), against a real chart: the 1 Jan 1970
 * reference chart from the #412 screenshots (Sun in Capricorn, Moon and Uranus in Libra).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { bodyById, bodyByKey } from '../src/astrology/bodies.js';
import { computeChartData, type ChartData } from '../src/domain/chart-compute.js';
import { derivePlacements } from '../src/interpretation/rules.js';
import { parseSelectionKey, selectionPlacements, type WheelSelection } from '../src/interpretation/selection.js';
import { getEngine } from './engine-harness.js';

let chart: ChartData;

beforeAll(async () => {
  chart = await computeChartData(
    {
      civil: { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
      coordinates: { latitude: 41.1833, longitude: -84.7333 },
      zoneOverride: 'America/New_York',
    },
    await getEngine(),
  );
}, 60_000);

describe('parseSelectionKey (#415)', () => {
  it('reads each kind of key the wheel produces', () => {
    expect(parseSelectionKey('body:sun')).toEqual({ kind: 'body', key: 'sun', ring: 0 });
    expect(parseSelectionKey('sign:capricorn')).toEqual({ kind: 'sign', signIndex: 9 });
    expect(parseSelectionKey('sign:aries')).toEqual({ kind: 'sign', signIndex: 0 });
    expect(parseSelectionKey('aspect:moon|sun')).toEqual({
      kind: 'aspect',
      bodyA: 'moon',
      ringA: 0,
      bodyB: 'sun',
      ringB: 0,
    });
  });

  it('reads the ring a body is on, where the wheel names one (#418)', () => {
    expect(parseSelectionKey('body:sun@1')).toEqual({ kind: 'body', key: 'sun', ring: 1 });
    expect(parseSelectionKey('body:sun@0')).toEqual({ kind: 'body', key: 'sun', ring: 0 });
    expect(parseSelectionKey('aspect:saturn@1|sun@0')).toEqual({
      kind: 'aspect',
      bodyA: 'saturn',
      ringA: 1,
      bodyB: 'sun',
      ringB: 0,
    });
  });

  it('treats a malformed ring as ring 0 rather than refusing the selection', () => {
    expect(parseSelectionKey('body:sun@x')).toEqual({ kind: 'body', key: 'sun', ring: 0 });
    expect(parseSelectionKey('body:sun@-1')).toEqual({ kind: 'body', key: 'sun', ring: 0 });
  });

  it('rejects a malformed key, an empty value, an unknown sign and an unknown kind', () => {
    for (const bad of [
      '',
      'sun',
      'body:',
      'sign:',
      'sign:ophiuchus',
      'aspect:moon',
      'aspect:|sun',
      'aspect:moon|',
      'planet:sun',
    ]) {
      expect(parseSelectionKey(bad), bad).toBeUndefined();
    }
  });

  it('knows all twelve signs by their lowercase names', () => {
    const names = [
      'aries',
      'taurus',
      'gemini',
      'cancer',
      'leo',
      'virgo',
      'libra',
      'scorpio',
      'sagittarius',
      'capricorn',
      'aquarius',
      'pisces',
    ];
    names.forEach((name, index) => {
      expect(parseSelectionKey(`sign:${name}`)).toEqual({ kind: 'sign', signIndex: index });
    });
  });
});

describe('selectionPlacements (#415)', () => {
  const select = (selection: WheelSelection) => selectionPlacements(chart, selection);
  const sun = bodyByKey('sun')?.id ?? -1;

  it('for a planet: its sign, its house and every aspect it is part of — and nothing about other planets', () => {
    const items = select({ kind: 'body', key: 'sun', ring: 0 });
    const categories = new Set(items.map((item) => item.placement.category));
    expect(categories.has('planet-in-sign')).toBe(true);
    expect(categories.has('planet-in-house')).toBe(true);
    expect(categories.has('aspect-pair')).toBe(true);
    for (const item of items) {
      const placement = item.placement;
      if (placement.category === 'planet-in-sign' || placement.category === 'planet-in-house') {
        expect(placement.body).toBe('sun');
      } else if (placement.category === 'aspect-pair') {
        expect([placement.bodyA, placement.bodyB]).toContain('sun');
      } else if (placement.category === 'dignity-state') {
        expect(placement.body).toBe('sun');
      } else {
        throw new Error(`unexpected category ${placement.category}`);
      }
    }
  });

  it('puts the Sun in Capricorn, as the chart has it', () => {
    const inSign = select({ kind: 'body', key: 'sun', ring: 0 }).find(
      (item) => item.placement.category === 'planet-in-sign',
    );
    expect(inSign?.placement).toMatchObject({ category: 'planet-in-sign', body: 'sun', sign: 9 });
  });

  it('lists every aspect the chart has for that planet — as many as the report would', () => {
    const fromChart = chart.aspects.filter((aspect) => aspect.bodyA === sun || aspect.bodyB === sun).length;
    const shown = select({ kind: 'body', key: 'sun', ring: 0 }).filter(
      (item) => item.placement.category === 'aspect-pair',
    ).length;
    expect(shown).toBe(fromChart);
    expect(shown).toBeGreaterThan(0);
  });

  it('puts what the planet is before how it relates: sign, then house, then aspects', () => {
    const categories = select({ kind: 'body', key: 'sun', ring: 0 }).map((item) => item.placement.category);
    expect(categories[0]).toBe('planet-in-sign');
    expect(categories[1]).toBe('planet-in-house');
    const firstAspect = categories.indexOf('aspect-pair');
    expect(firstAspect).toBeGreaterThan(1);
    // Once the aspects begin, nothing else follows them.
    expect(categories.slice(firstAspect).every((category) => category === 'aspect-pair')).toBe(true);
  });

  it('orders the aspects by salience, most salient first, as the report ranks them', () => {
    const aspects = select({ kind: 'body', key: 'sun', ring: 0 }).filter(
      (item) => item.placement.category === 'aspect-pair',
    );
    const saliences = aspects.map((item) => item.salience);
    expect(saliences).toEqual([...saliences].sort((a, b) => b - a));
  });

  it('puts the planets in a sign before that sign’s house cusps', () => {
    const categories = select({ kind: 'sign', signIndex: 6 }).map((item) => item.placement.category);
    const firstCusp = categories.indexOf('sign-on-cusp');
    expect(firstCusp).toBeGreaterThan(0);
    expect(categories.slice(0, firstCusp).every((category) => category === 'planet-in-sign')).toBe(true);
  });

  it('gives the same placements whichever ring was clicked: the written text is about the body, not the ring', () => {
    expect(select({ kind: 'body', key: 'sun', ring: 1 })).toEqual(select({ kind: 'body', key: 'sun', ring: 0 }));
  });

  it('for a sign: each planet in it, and only those', () => {
    const items = select({ kind: 'sign', signIndex: 6 }); // Libra
    const bodies = items.flatMap((item) => (item.placement.category === 'planet-in-sign' ? [item.placement.body] : []));
    expect(bodies).toContain('moon');
    expect(bodies).toContain('uranus');
    expect(bodies).not.toContain('sun');
    for (const item of items) {
      expect(['planet-in-sign', 'sign-on-cusp']).toContain(item.placement.category);
    }
  });

  it('for a sign: also the house cusps that fall in it (Libra holds the Ascendant)', () => {
    const cusps = select({ kind: 'sign', signIndex: 6 }).filter((item) => item.placement.category === 'sign-on-cusp');
    expect(cusps.length).toBeGreaterThanOrEqual(1);
    expect(cusps.some((item) => item.placement.category === 'sign-on-cusp' && item.placement.house === 1)).toBe(true);
  });

  it('for an empty sign: nothing, not an error', () => {
    // A sign with no planet and no cusp in it.
    const occupied = new Set(
      derivePlacements(chart).flatMap((item) =>
        item.placement.category === 'planet-in-sign' || item.placement.category === 'sign-on-cusp'
          ? [item.placement.sign]
          : [],
      ),
    );
    const empty = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].find((sign) => !occupied.has(sign));
    if (empty !== undefined) expect(select({ kind: 'sign', signIndex: empty })).toEqual([]);
  });

  it('for an aspect line: exactly that pair, whichever way round it is named', () => {
    const aspect = chart.aspects[0];
    expect(aspect).toBeDefined();
    if (!aspect) return;
    const a = bodyById(aspect.bodyA)?.key ?? '';
    const b = bodyById(aspect.bodyB)?.key ?? '';
    const forward = select({ kind: 'aspect', bodyA: a, ringA: 0, bodyB: b, ringB: 0 });
    const reverse = select({ kind: 'aspect', bodyA: b, ringA: 0, bodyB: a, ringB: 0 });
    expect(forward).toHaveLength(1);
    expect(reverse).toEqual(forward);
    expect(forward[0]?.placement.category).toBe('aspect-pair');
  });

  it('for a pair that does not aspect: nothing', () => {
    expect(select({ kind: 'aspect', bodyA: 'sun', ringA: 0, bodyB: 'nonexistent', ringB: 0 })).toEqual([]);
  });

  it('for a body with no placements (an unknown key): nothing', () => {
    expect(select({ kind: 'body', key: 'nonexistent', ring: 0 })).toEqual([]);
  });
});
