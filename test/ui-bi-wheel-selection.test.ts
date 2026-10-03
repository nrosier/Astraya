/**
 * The facts behind a bi-wheel selection (#418), against real transit data. Expectations are
 * recomputed from the charts' own positions rather than read back from the resolver.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { bodyById } from '../src/astrology/bodies.js';
import { houseOf } from '../src/astrology/emphasis.js';
import { computeTransit, type TransitData } from '../src/domain/transit.js';
import { aspectRows, crossAspectRows, degreeParts } from '../src/domain/chart-tables.js';
import { resolveBiWheelSelection, type BiWheelInput } from '../src/ui/bi-wheel-selection.js';
import { getEngine } from './engine-harness.js';

let transit: TransitData;
let input: BiWheelInput;

beforeAll(async () => {
  const engine = await getEngine();
  const target = await engine.julianDayFromUtc(2024, 4, 8, 12, 0, 0);
  transit = await computeTransit(
    {
      civil: { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
      coordinates: { latitude: 41.1833, longitude: -84.7333 },
      zoneOverride: 'America/New_York',
    },
    target,
    engine,
  );
  // As TransitView builds it: natal is ring 0, transit ring 1, and each contact's first end (the
  // transiting body) is on ring 1, its second (the natal point) on ring 0.
  input = {
    rings: [
      { label: 'Natal', data: transit.natal },
      { label: 'Transiting', data: transit.transit },
    ],
    cross: crossAspectRows(transit.contacts),
    crossRingOfA: 1,
    crossRingOfB: 0,
  };
}, 60_000);

const keyOf = (body: number): string => bodyById(body)?.key ?? '';

describe('resolveBiWheelSelection (#418)', () => {
  it('for a transiting planet: where it is, on the transiting ring', () => {
    const facts = resolveBiWheelSelection('body:saturn@1', input);
    expect(facts?.kind).toBe('body');
    if (facts?.kind !== 'body') return;
    const position = transit.transit.positions.find((p) => keyOf(p.body) === 'saturn');
    const expected = degreeParts(position?.longitude ?? 0);
    expect(facts.body).toMatchObject({
      bodyKey: 'saturn',
      ring: 1,
      signName: expected.sign,
      degree: expected.degree,
      minute: expected.minute,
      retrograde: position?.retrograde,
    });
  });

  it('tells the natal Sun from the transiting Sun: same key, different ring, different place', () => {
    const natal = resolveBiWheelSelection('body:sun@0', input);
    const transiting = resolveBiWheelSelection('body:sun@1', input);
    if (natal?.kind !== 'body' || transiting?.kind !== 'body') throw new Error('expected body facts');
    expect(natal.body.ring).toBe(0);
    expect(transiting.body.ring).toBe(1);
    // 1 January and 8 April put the Sun in different signs.
    expect(natal.body.signName).not.toBe(transiting.body.signName);
  });

  it('puts a transiting planet in the natal house it passes through, from the natal cusps', () => {
    const facts = resolveBiWheelSelection('body:saturn@1', input);
    if (facts?.kind !== 'body') throw new Error('expected body facts');
    const position = transit.transit.positions.find((p) => keyOf(p.body) === 'saturn');
    expect(facts.houseInFirstRing).toBe(houseOf(position?.longitude ?? 0, transit.natal.houses.cusps));
  });

  it('lists only the aspects the selected ring’s body makes to the other ring, naming the other end', () => {
    const facts = resolveBiWheelSelection('body:saturn@1', input);
    if (facts?.kind !== 'body') throw new Error('expected body facts');
    const expected = transit.contacts.filter((c) => keyOf(c.bodyA) === 'saturn');
    expect(facts.aspects).toHaveLength(expected.length);
    for (const aspect of facts.aspects) {
      expect(aspect.other.ring).toBe(0);
      expect(aspect.row.bodyAKey).toBe('saturn');
    }
  });

  it('for a natal planet, the same contacts seen from the other end: the transiting bodies that touch it', () => {
    const target = transit.contacts[0];
    if (target === undefined) throw new Error('fixture bug: no contacts');
    const natalKey = keyOf(target.bodyB);
    const facts = resolveBiWheelSelection(`body:${natalKey}@0`, input);
    if (facts?.kind !== 'body') throw new Error('expected body facts');
    const expected = transit.contacts.filter((c) => keyOf(c.bodyB) === natalKey);
    expect(facts.aspects).toHaveLength(expected.length);
    expect(facts.aspects.every((aspect) => aspect.other.ring === 1)).toBe(true);
    // The natal body's own ring never lists its own-chart aspects as cross-ring ones.
    expect(facts.aspects.every((aspect) => aspect.row.bodyBKey === natalKey)).toBe(true);
  });

  it('lists a ring’s own aspects as the wheel draws them: major, and no same-ring conjunctions', () => {
    const facts = resolveBiWheelSelection('body:saturn@1', input);
    if (facts?.kind !== 'body') throw new Error('expected body facts');
    // The transiting Mars conjoins the transiting Saturn on this date, but the wheel draws no line for it.
    expect(
      transit.transit.aspects.some(
        (a) => a.aspect.key === 'conjunction' && keyOf(a.bodyA) === 'mars' && keyOf(a.bodyB) === 'saturn',
      ),
    ).toBe(true);
    const others = facts.ownAspects.map((aspect) => aspect.other.bodyKey).sort();
    expect(others).toEqual(['ceres', 'pallas']);
    expect(facts.ownAspects.every((aspect) => aspect.other.ring === 1 && aspect.row.aspectKey !== 'conjunction')).toBe(
      true,
    );
  });

  it('for a cross-ring aspect line: that one contact, with the ring of each end', () => {
    const contact = transit.contacts[0];
    if (contact === undefined) throw new Error('fixture bug: no contacts');
    const a = `${keyOf(contact.bodyA)}@1`;
    const b = `${keyOf(contact.bodyB)}@0`;
    const facts = resolveBiWheelSelection(`aspect:${[a, b].sort().join('|')}`, input);
    expect(facts?.kind).toBe('aspect');
    if (facts?.kind !== 'aspect') return;
    expect(facts.row.aspectKey).toBe(contact.aspect.key);
    expect(facts.row.orb).toBeCloseTo(contact.orb, 9);
    expect([facts.a.ring, facts.b.ring].sort()).toEqual([0, 1]);
  });

  it('tells the same body on both rings apart: the transiting Sun squares the natal Sun, 8.77° off', () => {
    const facts = resolveBiWheelSelection('aspect:sun@0|sun@1', input);
    if (facts?.kind !== 'aspect') throw new Error('expected aspect facts');
    expect(facts.row.aspectKey).toBe('square');
    expect(facts.row.orb).toBeCloseTo(8.7718, 3);
  });

  it('for one ring’s own aspect line: that chart’s aspect, not a cross-ring contact', () => {
    const own = aspectRows(transit.natal)[0];
    if (own === undefined) throw new Error('fixture bug: no natal aspects');
    const facts = resolveBiWheelSelection(
      `aspect:${[`${own.bodyAKey}@0`, `${own.bodyBKey}@0`].sort().join('|')}`,
      input,
    );
    expect(facts?.kind).toBe('aspect');
    if (facts?.kind !== 'aspect') return;
    expect(facts.row.aspectKey).toBe(own.aspectKey);
    expect(facts.a.ring).toBe(0);
    expect(facts.b.ring).toBe(0);
  });

  it('for a sign: the bodies of both rings that stand in it, each marked with its ring', () => {
    const facts = resolveBiWheelSelection('sign:aries', input);
    if (facts?.kind !== 'sign') throw new Error('expected sign facts');
    expect(facts.signName).toBe('Aries');
    const expected =
      transit.natal.positions.filter((p) => degreeParts(p.longitude).sign === 'Aries').length +
      transit.transit.positions.filter((p) => degreeParts(p.longitude).sign === 'Aries').length;
    expect(facts.bodies).toHaveLength(expected);
    expect(facts.bodies.every((body) => body.signName === 'Aries')).toBe(true);
    // The Sun, Moon... of 8 April 2024 are in Aries on the transiting ring.
    expect(facts.bodies.some((body) => body.ring === 1 && body.bodyKey === 'sun')).toBe(true);
  });

  it('is undefined for a ring that does not exist, an unknown body, a pair that does not aspect and a bad key', () => {
    expect(resolveBiWheelSelection('body:sun@5', input)).toBeUndefined();
    expect(resolveBiWheelSelection('body:nonexistent@0', input)).toBeUndefined();
    // The transiting Sun does not aspect natal Venus on this date (verified against the contacts).
    expect(resolveBiWheelSelection('aspect:sun@1|venus@0', input)).toBeUndefined();
    expect(resolveBiWheelSelection('nonsense', input)).toBeUndefined();
  });
});
