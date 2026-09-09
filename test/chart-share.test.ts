import { describe, expect, it } from 'vitest';
import { ChartShareLinkError, decodeChartShareLink, encodeChartShareLink } from '../src/domain/chart-share.js';
import type { ChartShareData } from '../src/domain/chart-share.js';
import type { BirthMomentInput } from '../src/time/types.js';

const MOMENT: BirthMomentInput = {
  civil: { year: 1960, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
  coordinates: { latitude: 38.7478, longitude: -85.0672 },
};

function roundTrip(data: ChartShareData): ChartShareData {
  return decodeChartShareLink(new URLSearchParams(encodeChartShareLink(data).toString()));
}

describe('encodeChartShareLink / decodeChartShareLink (#65)', () => {
  it('round-trips birth data with no settings', () => {
    const decoded = roundTrip({ moment: MOMENT, settings: {}, housesKnown: true });
    expect(decoded.moment).toEqual(MOMENT);
    expect(decoded.settings).toEqual({});
  });

  it('round-trips the manual offset override', () => {
    const withOverride: BirthMomentInput = { ...MOMENT, offsetOverrideMinutes: -300, zoneOverride: 'America/New_York' };
    const decoded = roundTrip({ moment: withOverride, settings: {}, housesKnown: true });
    expect(decoded.moment.offsetOverrideMinutes).toBe(-300);
    expect(decoded.moment.zoneOverride).toBe('America/New_York');
  });

  it('round-trips chart settings, including nested and unknown keys', () => {
    const settings = {
      houseSystem: 'placidus',
      zodiac: { kind: 'sidereal', ayanamsa: 1 },
      wheelOrientation: 'aries-up',
      aFutureSettingThisBuildHasNeverHeardOf: 42,
    };
    const decoded = roundTrip({ moment: MOMENT, settings, housesKnown: true });
    expect(decoded.settings).toEqual(settings);
  });

  it('defaults to houses known when the link omits `hk`', () => {
    expect(roundTrip({ moment: MOMENT, settings: {}, housesKnown: true }).housesKnown).toBe(true);
  });

  it('round-trips an unknown birth time, so a recipient does not see a false Ascendant', () => {
    const params = encodeChartShareLink({ moment: MOMENT, settings: {}, housesKnown: false });
    expect(params.get('hk')).toBe('0');
    expect(decodeChartShareLink(params).housesKnown).toBe(false);
  });

  it('omits `cs` entirely when settings are empty, keeping links short', () => {
    const params = encodeChartShareLink({ moment: MOMENT, settings: {}, housesKnown: true });
    expect(params.has('cs')).toBe(false);
  });

  it('tags the current format version', () => {
    const params = encodeChartShareLink({ moment: MOMENT, settings: {}, housesKnown: true });
    expect(params.get('v')).toBe('1');
  });

  it('accepts a link with no `v` at all as version 1 (pre-existing moment-only links)', () => {
    const bare = encodeChartShareLink({ moment: MOMENT, settings: {}, housesKnown: true });
    bare.delete('v');
    expect(decodeChartShareLink(bare).moment).toEqual(MOMENT);
  });

  it('rejects a link from a newer format version', () => {
    const params = encodeChartShareLink({ moment: MOMENT, settings: {}, housesKnown: true });
    params.set('v', '2');
    expect(() => decodeChartShareLink(params)).toThrow(ChartShareLinkError);
    expect(() => decodeChartShareLink(params)).toThrow(/newer version/);
  });

  it('rejects a non-numeric or non-positive `v`', () => {
    const params = encodeChartShareLink({ moment: MOMENT, settings: {}, housesKnown: true });
    params.set('v', 'nope');
    expect(() => decodeChartShareLink(params)).toThrow(ChartShareLinkError);
    params.set('v', '0');
    expect(() => decodeChartShareLink(params)).toThrow(ChartShareLinkError);
  });

  it('rejects unreadable `cs`', () => {
    const params = encodeChartShareLink({ moment: MOMENT, settings: {}, housesKnown: true });
    params.set('cs', 'not-valid-base64url-json!!!');
    expect(() => decodeChartShareLink(params)).toThrow(ChartShareLinkError);
  });

  it('rejects `cs` that decodes to something other than an object', () => {
    const params = encodeChartShareLink({ moment: MOMENT, settings: {}, housesKnown: true });
    params.set('cs', btoa(JSON.stringify([1, 2, 3])).replace(/=+$/, ''));
    expect(() => decodeChartShareLink(params)).toThrow(/settings object/);
  });

  it('still surfaces a bad birth-data field via the underlying moment decoder', () => {
    const params = encodeChartShareLink({ moment: MOMENT, settings: {}, housesKnown: true });
    params.set('la', '999');
    expect(() => decodeChartShareLink(params)).toThrow(/Latitude/);
  });

  it('produces a link that is legible, not a single packed blob', () => {
    const params = encodeChartShareLink({ moment: MOMENT, settings: {}, housesKnown: true });
    const query = params.toString();
    expect(query).toContain('d=1960-06-15');
    expect(query).toContain('t=14%3A30');
  });
});
