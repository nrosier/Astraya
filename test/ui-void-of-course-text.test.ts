import { describe, expect, it } from 'vitest';
import { bodyByKey } from '../src/astrology/bodies.js';
import { ASPECTS } from '../src/astrology/aspects.js';
import type { VoidOfCourseMoon } from '../src/astrology/void-of-course.js';
import { transitViewMessages } from '../src/ui/TransitView.messages.js';
import { formatUtc, voidOfCourseSentence } from '../src/ui/void-of-course-text.js';

// 2024-03-08 12:00 UTC.
const NOON = 2460378;
const aspect = (key: string) => {
  const found = ASPECTS.find((a) => a.key === key);
  if (!found) throw new Error(`fixture bug: no aspect ${key}`);
  return found;
};
const body = (key: string) => bodyByKey(key)?.id ?? -1;

const VOID: VoidOfCourseMoon = {
  jd: NOON + 0.25,
  signIndex: 10, // Aquarius
  signEntryJd: NOON - 1,
  signExitJd: NOON + 0.5,
  isVoid: true,
  lastAspect: { jd: NOON + 0.2, body: body('venus'), aspect: aspect('conjunction') },
  nextAspect: undefined,
  voidFromJd: NOON + 0.2,
};

const ACTIVE: VoidOfCourseMoon = {
  jd: NOON,
  signIndex: 11, // Pisces
  signEntryJd: NOON - 0.5,
  signExitJd: NOON + 2,
  isVoid: false,
  lastAspect: undefined,
  nextAspect: { jd: NOON + 0.75, body: body('saturn'), aspect: aspect('trine') },
  voidFromJd: undefined,
};

describe('formatUtc', () => {
  it('prints a Julian day as the UTC date and minute', () => {
    expect(formatUtc(NOON)).toBe('2024-03-08 12:00 UTC');
    expect(formatUtc(NOON + 0.25)).toBe('2024-03-08 18:00 UTC');
  });
});

describe('voidOfCourseSentence', () => {
  it('says yes, since the last aspect and until the next sign, when void', () => {
    const text = voidOfCourseSentence(VOID, transitViewMessages.en, 'en');
    expect(text).toContain('at 2024-03-08 18:00 UTC: yes');
    expect(text).toContain('since 2024-03-08 16:48 UTC');
    expect(text).toContain('last aspect: Conjunction Venus');
    expect(text).toContain('until it enters Pisces at 2024-03-09 00:00 UTC');
  });

  it('wraps from Pisces to Aries when the Moon is void in the last sign', () => {
    const text = voidOfCourseSentence({ ...VOID, signIndex: 11 }, transitViewMessages.en, 'en');
    expect(text).toContain('until it enters Aries');
  });

  it('says since the sign entry when the Moon made no aspect yet this sign', () => {
    const text = voidOfCourseSentence(
      { ...VOID, lastAspect: undefined, voidFromJd: undefined },
      transitViewMessages.en,
      'en',
    );
    expect(text).toContain('since 2024-03-07 12:00 UTC (when it entered its sign)');
  });

  it('says no, naming the next aspect and when the Moon leaves its sign, when not void', () => {
    const text = voidOfCourseSentence(ACTIVE, transitViewMessages.en, 'en');
    expect(text).toContain('at 2024-03-08 12:00 UTC: no');
    expect(text).toContain('next aspect is Trine Saturn at 2024-03-09 06:00 UTC');
    expect(text).toContain('before it leaves Pisces at 2024-03-10 12:00 UTC');
  });

  it('is written in Dutch, with Dutch sign, aspect and body names, for the Dutch locale', () => {
    const voidText = voidOfCourseSentence(VOID, transitViewMessages.nl, 'nl');
    expect(voidText).toContain('Maan zonder koers op');
    expect(voidText).toContain('ja');
    expect(voidText).toContain('Vissen');
    const activeText = voidOfCourseSentence(ACTIVE, transitViewMessages.nl, 'nl');
    expect(activeText).toContain('nee');
    expect(activeText).toContain('Saturnus');
  });
});
