/**
 * Tests for how a person reads in the list.
 *
 * The rule under test is one thing: never make a record look more complete than it is. A row
 * that shows a name and a date for a person with no coordinates promises a chart that cannot
 * be cast, and the user finds out only when the chart screen refuses them.
 */
import { describe, expect, it } from 'vitest';
import { ordered, summary } from '../src/ui/people-list.js';
import type { Person } from '../src/domain/person.js';

/**
 * Ada, born in Vevay, Indiana — the case whose zone lookup this project measured wrong.
 *
 * `moment` is spelled out in the override type rather than left to `Partial<Person>`: under
 * `exactOptionalPropertyTypes` an absent moment and an explicit `undefined` are different
 * types, and a person with no birth record is exactly what half these tests are about.
 */
type Overrides = Partial<Omit<Person, 'moment'>> & { readonly moment?: Person['moment'] | undefined };

function person(overrides: Overrides = {}): Person {
  const { moment, ...rest } = {
    moment: {
      civil: { year: 1960, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
      coordinates: { latitude: 38.7478, longitude: -85.0672 },
    } satisfies Person['moment'],
    ...overrides,
  };
  return {
    id: 'p-aaaaaaaaaaaaaaaa',
    displayName: 'Ada',
    timeAccuracy: 'recorded',
    placeLabel: 'Vevay, Indiana',
    notes: '',
    missing: [],
    ...rest,
    // Rebuilt away rather than set to undefined: `Person.moment` is optional, not
    // optional-or-undefined, which is the point of `exactOptionalPropertyTypes`.
    ...(moment === undefined ? {} : { moment }),
  };
}

function mapOf(people: readonly Person[]): ReadonlyMap<string, Person> {
  return new Map(people.map((p) => [p.id, p]));
}

describe('ordering people', () => {
  it('sorts by name', () => {
    const people = mapOf([
      person({ id: 'p-c', displayName: 'Grace' }),
      person({ id: 'p-a', displayName: 'Ada' }),
      person({ id: 'p-b', displayName: 'Barbara' }),
    ]);
    expect(ordered(people).map((p) => p.displayName)).toEqual(['Ada', 'Barbara', 'Grace']);
  });

  it('puts the not-yet-named last', () => {
    // A person is created with an empty name and then edited, so an unnamed row is a normal
    // transient state. Sorting by code point would park it at the top of the list, above
    // everyone the user actually came to find.
    const people = mapOf([
      person({ id: 'p-1', displayName: '' }),
      person({ id: 'p-2', displayName: 'Ada' }),
      person({ id: 'p-3', displayName: '' }),
    ]);
    expect(ordered(people).map((p) => p.displayName)).toEqual(['Ada', '', '']);
  });

  it('sorts accented names where a reader expects them, not after Z', () => {
    const people = mapOf([
      person({ id: 'p-1', displayName: 'Zoë' }),
      person({ id: 'p-2', displayName: 'Émile' }),
      person({ id: 'p-3', displayName: 'Fatima' }),
    ]);
    expect(ordered(people).map((p) => p.displayName)).toEqual(['Émile', 'Fatima', 'Zoë']);
  });

  it('does not mutate the map it was given', () => {
    const people = mapOf([person({ id: 'p-1', displayName: 'Grace' }), person({ id: 'p-2', displayName: 'Ada' })]);
    ordered(people);
    expect([...people.values()].map((p) => p.displayName)).toEqual(['Grace', 'Ada']);
  });
});

describe('summarising a person', () => {
  it('shows the date, the local time, the resolved offset and the place', () => {
    const text = summary(person());
    expect(text).toContain('1960-06-15');
    expect(text).toContain('14:30');
    // -04:00 is what a coordinate lookup gives here: tz-lookup puts these coordinates in
    // America/New_York, while Switzerland County's own zone (America/Indiana/Vevay) was on
    // -05:00 that June. This is the documented limitation the time module exists to expose
    // rather than hide, so the assertion is on the lookup's answer *and* on the flag.
    expect(text).toContain('-04:00?');
    expect(text).toContain('Vevay, Indiana');
  });

  it('flags an offset the resolution had something to say about', () => {
    // The whole point of the time module is that a contested offset never reads as settled.
    // The list is where a user picks which record to open, so the doubt has to survive here
    // too — the reasons are on the form.
    expect(summary(person())).toContain('?');
    // A location well inside a zone, with an unambiguous time, gets no flag: the marker has
    // to mean something, and a flag on every row would mean nothing.
    const clean = person({
      placeLabel: 'Greenwich',
      moment: {
        civil: { year: 1990, month: 6, day: 15, hour: 12, minute: 0, second: 0 },
        coordinates: { latitude: 51.4779, longitude: 0 },
      },
    });
    expect(summary(clean)).not.toContain('?');
  });

  it('names what is missing rather than calling the record incomplete', () => {
    // The user is the only one who can supply these, and cannot without knowing which.
    const text = summary(person({ moment: undefined, missing: ['coordinates', 'birth time'] }));
    expect(text).toContain('coordinates');
    expect(text).toContain('birth time');
    expect(text).not.toContain('1960');
  });

  it('falls back to naming birth data when nothing is recorded at all', () => {
    expect(summary(person({ moment: undefined, missing: [] }))).toContain('birth data');
  });

  it('says the time is unknown instead of printing midnight', () => {
    // Midnight is a real birth time. Showing 00:00 for a record that has none is inventing
    // data, and it is the kind of invention a user would never think to question.
    const text = summary(person({ timeAccuracy: 'unknown' }));
    expect(text).toContain('time unknown');
    expect(text).not.toContain('00:00');
  });

  it('says the place is not recorded rather than leaving a gap', () => {
    expect(summary(person({ placeLabel: '' }))).toContain('place not recorded');
  });
});
