/**
 * Tests for the birth-data form's rules (#45).
 *
 * The rules here decide whether a chart is cast from what the user meant. Two classes of
 * failure they exist to prevent:
 *
 *  - Coercion. A latitude of 95 must produce a message, not a chart at 90°N; February 30th
 *    must be refused, not rolled into March.
 *  - Over-writing. A save must produce operations for the fields the user changed and
 *    nothing else, because a field written with a fresh timestamp beats whatever another
 *    device wrote to it while this form was open.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT, draftFrom, draftToMutations, validateDraft, type Draft } from '../src/domain/person-form.js';
import { buildPerson } from '../src/domain/person.js';

const VEVAY: Draft = {
  ...EMPTY_DRAFT,
  displayName: 'Ada',
  date: '1960-06-15',
  time: '14:30:00',
  latitude: '38.7478',
  longitude: '-85.0672',
  placeLabel: 'Vevay, Indiana',
};

describe('validating a draft', () => {
  it('accepts a complete record and returns the moment', () => {
    const { errors, moment } = validateDraft(VEVAY);
    expect(errors).toEqual({});
    expect(moment).toEqual({
      civil: { year: 1960, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
      coordinates: { latitude: 38.7478, longitude: -85.0672 },
    });
  });

  it('requires a name, because it is how the person is found again', () => {
    expect(validateDraft({ ...VEVAY, displayName: '   ' }).errors.displayName).toBeDefined();
  });

  it('rejects a day the month does not have', () => {
    // Coercion is the failure here: a form that rolled 30 February into 2 March would cast
    // a chart for a day the user never entered and never mention it.
    const errors = validateDraft({ ...VEVAY, date: '1961-02-30' }).errors;
    expect(errors.date).toContain('28 days');
    expect(validateDraft({ ...VEVAY, date: '1960-02-29' }).errors.date).toBeUndefined();
  });

  it('applies the Julian leap rule when the date is in the Julian calendar', () => {
    // 1900 was a leap year in the Julian calendar and not in the Gregorian one. The form
    // has to agree with the calendar the ephemeris will use, or it would reject a date the
    // calculation would happily accept.
    expect(validateDraft({ ...VEVAY, date: '1900-02-29', calendar: 'julian' }).errors.date).toBeUndefined();
    expect(validateDraft({ ...VEVAY, date: '1900-02-29', calendar: 'gregorian' }).errors.date).toBeDefined();
    // `auto` reads pre-1582 dates as Julian, the same reform date `resolveCalendar` uses.
    expect(validateDraft({ ...VEVAY, date: '1500-02-29' }).errors.date).toBeUndefined();
  });

  it('rejects year zero rather than guessing a convention', () => {
    expect(validateDraft({ ...VEVAY, date: '0000-06-15' }).errors.date).toContain('no year 0');
  });

  it('rejects a month outside 1 to 12 and a malformed date', () => {
    expect(validateDraft({ ...VEVAY, date: '1960-13-01' }).errors.date).toBeDefined();
    expect(validateDraft({ ...VEVAY, date: '15/06/1960' }).errors.date).toBeDefined();
    expect(validateDraft({ ...VEVAY, date: '' }).errors.date).toBeDefined();
  });

  it('accepts a leap second but not a 25th hour', () => {
    expect(validateDraft({ ...VEVAY, time: '23:59:60' }).errors.time).toBeUndefined();
    expect(validateDraft({ ...VEVAY, time: '24:00' }).errors.time).toBeDefined();
    expect(validateDraft({ ...VEVAY, time: '14:60' }).errors.time).toBeDefined();
  });

  it('accepts a missing time only when the time is marked unknown', () => {
    // An unknown birth time is a state, not an omission. Filling it in with noon would
    // produce houses and angles that look like findings and are not.
    expect(validateDraft({ ...VEVAY, time: '' }).errors.time).toBeDefined();
    const unknown = validateDraft({ ...VEVAY, time: '', timeAccuracy: 'unknown' });
    expect(unknown.errors).toEqual({});
    expect(unknown.moment?.civil.hour).toBe(0);
  });

  it('rejects coordinates outside the globe, at the boundary as well as far past it', () => {
    expect(validateDraft({ ...VEVAY, latitude: '95' }).errors.latitude).toBeDefined();
    expect(validateDraft({ ...VEVAY, longitude: '-181' }).errors.longitude).toBeDefined();
    // The pole and the date line are valid; anything past them is not. Tested just outside
    // rather than only far outside, because a bound that is off by a degree is exactly the
    // kind of error that passes a test using 95.
    expect(validateDraft({ ...VEVAY, latitude: '90', longitude: '180' }).errors).toEqual({});
    expect(validateDraft({ ...VEVAY, latitude: '-90', longitude: '-180' }).errors).toEqual({});
    expect(validateDraft({ ...VEVAY, latitude: '90.5' }).errors.latitude).toBeDefined();
    expect(validateDraft({ ...VEVAY, longitude: '180.5' }).errors.longitude).toBeDefined();
  });

  it('treats an empty coordinate as missing rather than as zero', () => {
    // 0, 0 is a real place in the Gulf of Guinea. Reading an empty field as that would give
    // a confidently wrong chart for a coordinate nobody entered.
    const { errors, moment } = validateDraft({ ...VEVAY, latitude: '', longitude: '' });
    expect(errors.latitude).toBeDefined();
    expect(errors.longitude).toBeDefined();
    expect(moment).toBeUndefined();
  });

  it('treats a half-typed minus sign as missing, not as an error to shout about', () => {
    expect(validateDraft({ ...VEVAY, longitude: '-' }).errors.longitude).toBeDefined();
    expect(validateDraft({ ...VEVAY, longitude: '-85.' }).errors.longitude).toBeUndefined();
  });

  it('keeps an offset override of zero, which means UTC', () => {
    // Zero is not "no override". Treating it as one would silently hand the chart back to
    // the timezone lookup the user was overruling.
    expect(validateDraft({ ...VEVAY, offsetOverride: '0' }).moment?.offsetOverrideMinutes).toBe(0);
    expect(validateDraft({ ...VEVAY, offsetOverride: '' }).moment?.offsetOverrideMinutes).toBeUndefined();
  });

  it('bounds the offset override outside every real zone but not at twelve hours', () => {
    expect(validateDraft({ ...VEVAY, offsetOverride: '840' }).errors.offsetOverride).toBeUndefined();
    expect(validateDraft({ ...VEVAY, offsetOverride: '1200' }).errors.offsetOverride).toBeDefined();
    expect(validateDraft({ ...VEVAY, offsetOverride: 'east' }).errors.offsetOverride).toBeDefined();
  });

  it('omits optional fields rather than setting them to a default', () => {
    const moment = validateDraft(VEVAY).moment;
    expect(moment).toBeDefined();
    expect('calendar' in (moment ?? {})).toBe(false);
    expect('zoneOverride' in (moment ?? {})).toBe(false);
  });

  it('carries a zone override through, trimmed', () => {
    expect(validateDraft({ ...VEVAY, zoneOverride: ' America/Indiana/Vevay ' }).moment?.zoneOverride).toBe(
      'America/Indiana/Vevay',
    );
  });

  it('returns no moment whenever anything is wrong', () => {
    // Never a partly filled moment: half a coordinate pair is a place nobody was born.
    expect(validateDraft({ ...VEVAY, latitude: '95' }).moment).toBeUndefined();
  });
});

describe('loading a draft from a stored person', () => {
  it('round trips a complete record', () => {
    const person = buildPerson(
      'p-aaaaaaaaaaaaaaaa',
      new Map<string, unknown>([
        ['displayName', 'Ada'],
        ['civil', { year: 1960, month: 6, day: 15, hour: 14, minute: 30, second: 0 }],
        ['coordinates', { latitude: 38.7478, longitude: -85.0672 }],
        ['placeLabel', 'Vevay, Indiana'],
        ['notes', 'from the certificate'],
        ['offsetOverrideMinutes', -300],
      ]),
    );
    const draft = draftFrom(person);
    expect(draft.date).toBe('1960-06-15');
    expect(draft.time).toBe('14:30:00');
    expect(draft.latitude).toBe('38.7478');
    expect(draft.offsetOverride).toBe('-300');
    expect(draft.notes).toBe('from the certificate');
    // And the draft validates, so opening a saved person for editing cannot produce a form
    // that refuses to save what it was given.
    expect(validateDraft(draft).errors).toEqual({});
  });

  it('leaves the fields blank for a person whose birth data is missing', () => {
    const person = buildPerson('p-aaaaaaaaaaaaaaaa', new Map<string, unknown>([['displayName', 'Unknown']]));
    const draft = draftFrom(person);
    expect(draft.date).toBe('');
    expect(draft.latitude).toBe('');
    // Blank, not zero: a person can exist before their birth data does.
    expect(validateDraft(draft).moment).toBeUndefined();
  });

  it('pads a year before 1000 to four digits', () => {
    const person = buildPerson(
      'p-aaaaaaaaaaaaaaaa',
      new Map<string, unknown>([
        ['displayName', 'Hypatia'],
        ['civil', { year: 350, month: 1, day: 2, hour: 3, minute: 4, second: 5 }],
        ['coordinates', { latitude: 31.2, longitude: 29.9 }],
      ]),
    );
    expect(draftFrom(person).date).toBe('0350-01-02');
    expect(draftFrom(person).time).toBe('03:04:05');
  });
});

describe('turning a save into operations', () => {
  const ID = 'p-aaaaaaaaaaaaaaaa';

  it('writes every field on a first save', () => {
    const fields = draftToMutations(ID, VEVAY).map((mutation) => mutation.field);
    expect(fields).toContain('displayName');
    expect(fields).toContain('civil');
    expect(fields).toContain('coordinates');
    expect(fields).toContain('placeLabel');
  });

  it('writes nothing when nothing changed', () => {
    // Re-saving an unchanged form must be a no-op. Otherwise every visit to the form would
    // stamp all eleven fields with a fresh timestamp and beat any concurrent edit.
    expect(draftToMutations(ID, VEVAY, VEVAY)).toEqual([]);
  });

  it('writes only the field that changed', () => {
    const mutations = draftToMutations(ID, { ...VEVAY, notes: 'from the certificate' }, VEVAY);
    expect(mutations).toEqual([{ entity: 'person', entityId: ID, field: 'notes', value: 'from the certificate' }]);
  });

  it('writes the birth moment whole, never field by field', () => {
    // The register is deliberately coarse: a date assembled half from one device's edit and
    // half from another's is a moment that never happened.
    const mutations = draftToMutations(ID, { ...VEVAY, time: '14:31:00' }, VEVAY);
    expect(mutations.length).toBe(1);
    expect(mutations[0]?.field).toBe('civil');
    expect(mutations[0]?.value).toEqual({ year: 1960, month: 6, day: 15, hour: 14, minute: 31, second: 0 });
  });

  it('writes coordinates as one register', () => {
    const mutations = draftToMutations(ID, { ...VEVAY, latitude: '38.75' }, VEVAY);
    expect(mutations.map((mutation) => mutation.field)).toEqual(['coordinates']);
    expect(mutations[0]?.value).toEqual({ latitude: 38.75, longitude: -85.0672 });
  });

  it('clears an offset override with null rather than zero', () => {
    // Writing 0 would mean UTC and could move the chart by up to a day; writing nothing
    // would leave the override the user just deleted still in force.
    const had: Draft = { ...VEVAY, offsetOverride: '-300' };
    const mutations = draftToMutations(ID, { ...VEVAY, offsetOverride: '' }, had);
    expect(mutations).toEqual([{ entity: 'person', entityId: ID, field: 'offsetOverrideMinutes', value: null }]);
  });

  it('trims what it writes, and ignores a change that is only whitespace', () => {
    expect(draftToMutations(ID, { ...VEVAY, displayName: '  Ada  ' }, VEVAY)).toEqual([]);
    expect(draftToMutations(ID, { ...VEVAY, displayName: ' Grace ' }, VEVAY)[0]?.value).toBe('Grace');
  });

  it('refuses to write a draft that does not validate', () => {
    // The form disables saving, but this is the layer that must not be talked into writing a
    // latitude of 95 by a caller that forgot to check.
    expect(() => draftToMutations(ID, { ...VEVAY, latitude: '95' }, VEVAY)).toThrow(/does not validate/);
  });
});
