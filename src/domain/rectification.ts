/**
 * Running a rectification search for a birth date and place with an uncertain time (#408): the
 * candidate local times in a range become candidate moments (each resolved through the same
 * time-zone logic a birth moment goes through, so a daylight-saving change inside the range is
 * respected), and `astrology/rectification.ts` scores them against the events.
 */
import { rectify, type RankedCandidate, type RectificationEvent } from '../astrology/rectification.js';
import type { EphemerisProvider, GeoPosition } from '../ephemeris/types.js';
import { julianDayFor } from '../time/julian.js';
import { resolveMoment } from '../time/resolve.js';
import type { BirthMomentInput } from '../time/types.js';

export interface RectificationRequest {
  /** The birth date and place; its time of day is ignored — the candidates supply it. */
  readonly base: BirthMomentInput;
  /** First and last candidate time, in minutes after local midnight (0-1439). */
  readonly fromMinute: number;
  readonly toMinute: number;
  readonly stepMinutes: number;
  readonly events: readonly RectificationEvent[];
}

export interface TimedCandidate extends RankedCandidate {
  /** The candidate's local clock time as `HH:MM`. */
  readonly localTime: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** The candidate minutes of the day from `fromMinute` to `toMinute` inclusive, `stepMinutes` apart. */
export function candidateMinutes(fromMinute: number, toMinute: number, stepMinutes: number): readonly number[] {
  if (stepMinutes < 1) throw new RangeError('the step must be at least one minute');
  const minutes: number[] = [];
  for (let minute = fromMinute; minute <= toMinute; minute += stepMinutes) minutes.push(minute);
  return minutes;
}

export async function runRectification(
  provider: EphemerisProvider,
  request: RectificationRequest,
): Promise<readonly TimedCandidate[]> {
  const minutes = candidateMinutes(request.fromMinute, request.toMinute, request.stepMinutes);
  const place: GeoPosition = { ...request.base.coordinates, altitude: 0 };

  const jds = [];
  const byJd = new Map<number, number>();
  for (const minute of minutes) {
    const moment: BirthMomentInput = {
      ...request.base,
      civil: { ...request.base.civil, hour: Math.floor(minute / 60), minute: minute % 60, second: 0 },
    };
    const jd = await julianDayFor(provider, resolveMoment(moment));
    // Two candidate clock times can map to one instant when a clock change repeats an hour; keep the first.
    if (byJd.has(jd)) continue;
    byJd.set(jd, minute);
    jds.push(jd);
  }

  const ranked = await rectify(provider, place, jds, request.events);
  return ranked.map((candidate) => {
    const minute = byJd.get(candidate.jd) ?? 0;
    return { ...candidate, localTime: `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}` };
  });
}
