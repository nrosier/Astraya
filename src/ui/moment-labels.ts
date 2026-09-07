/**
 * The words we put on a resolved moment.
 *
 * Shared between the birth-data form and the standalone when-and-where panel because two
 * copies of the same user-facing wording drift, and the drift is invisible: nobody has both
 * screens open at once to notice that one of them describes an ambiguous hour differently.
 */
import type { ResolvedMoment, TimeWarningCode } from '../time/types.js';

/** Provenance in the user's words, not ours. */
export const PROVENANCE: Record<ResolvedMoment['provenance'], string> = {
  manual: 'the offset you entered',
  tzdb: 'the timezone database, for this date',
  lmt: 'Local Mean Time from the longitude',
};

/**
 * Which warnings deserve a stronger presentation than the rest.
 *
 * These two are questions only the user can answer — the record says which side of a
 * clock change the birth fell on, or nothing does. The others are context.
 */
export const NEEDS_A_DECISION: readonly TimeWarningCode[] = ['ambiguous-local-time', 'nonexistent-local-time'];
