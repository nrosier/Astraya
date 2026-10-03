/**
 * The sentence the Transits screen states the void-of-course Moon in (#402). Kept out of the
 * component so the wording, the UTC formatting and the two cases (void / not void) are testable
 * without mounting a person and an ephemeris.
 */
import { bodyById } from '../astrology/bodies.js';
import { SIGNS } from '../astrology/signs.js';
import type { MoonAspectEvent, VoidOfCourseMoon } from '../astrology/void-of-course.js';
import type { Locale } from '../interpretation/schema.js';
import { civilFromJulianDay } from '../time/julian.js';
import { aspectDisplayName, bodyDisplayName, signDisplayName } from './astro-names.messages.js';
import type { transitViewMessages } from './TransitView.messages.js';

/** `2024-03-08 18:55 UTC`: a Julian day as the UTC moment the whole screen's date is read in. */
export function formatUtc(jd: number): string {
  const c = civilFromJulianDay(jd);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(c.year)}-${pad(c.month)}-${pad(c.day)} ${pad(c.hour)}:${pad(c.minute)} UTC`;
}

function describeMoonAspect(event: MoonAspectEvent, locale: Locale): string {
  return `${aspectDisplayName(event.aspect.key, locale)} ${bodyDisplayName(bodyById(event.body)?.key ?? '', locale)}`;
}

export function voidOfCourseSentence(voc: VoidOfCourseMoon, t: typeof transitViewMessages.en, locale: Locale): string {
  const signName = (index: number): string => signDisplayName(SIGNS[((index % 12) + 12) % 12]?.name ?? '', locale);
  const when = formatUtc(voc.jd);
  const until = formatUtc(voc.signExitJd);
  if (voc.isVoid) {
    return t.vocVoid(
      when,
      formatUtc(voc.voidFromJd ?? voc.signEntryJd),
      voc.lastAspect === undefined ? undefined : describeMoonAspect(voc.lastAspect, locale),
      signName(voc.signIndex + 1),
      until,
    );
  }
  const next = voc.nextAspect;
  return t.vocActive(
    when,
    next === undefined ? '' : describeMoonAspect(next, locale),
    next === undefined ? '' : formatUtc(next.jd),
    signName(voc.signIndex),
    until,
  );
}
