/**
 * Jones chart shapes (#35).
 *
 * Marc Edmund Jones classified a chart's overall "shape" — how the bodies
 * are spread or clustered around the wheel — into seven patterns. Bundle,
 * Bowl and Locomotive are the three "single arc" shapes: they differ only in
 * how much of the circle that arc covers, i.e. how much is left completely
 * empty — a trine (120 degrees), a half (180) or two trines (240).
 *
 * Beyond that, no single empty arc reaches even a third of the chart, so the
 * shape instead depends on how many separate groups the bodies fall into.
 * Groups are cut at every gap of at least a sextile (`SEPARATING_GAP`): one
 * group is a Splash, two are a Seesaw — or a Bucket, if one of the two is a
 * single isolated body playing "handle" — and three or more are a Splay.
 *
 * Real charts are not always this tidy, and this is exactly where
 * implementations disagree: the line between a wide Bowl and a Locomotive,
 * or a sparse Splay and a Splash, is a matter of convention. The 120/180/240
 * breakpoints are Jones' own (thirds and half of the circle); the sextile
 * used to detect a genuine split beyond that is this module's own explicit,
 * documented choice, not a claim of universal agreement.
 */
import type { BodyId, Degrees } from '../ephemeris/types.js';

const TRINE: Degrees = 120;
const OPPOSITION: Degrees = 180;
const TWO_TRINES: Degrees = 240;

/** Minimum gap treated as a genuine split between groups, rather than ordinary spacing. */
const SEPARATING_GAP: Degrees = 60;

export type JonesShape = 'bundle' | 'bowl' | 'locomotive' | 'bucket' | 'seesaw' | 'splay' | 'splash';

export interface JonesShapeResult {
  readonly shape: JonesShape;
  /** The arc containing every body: 360 minus the single largest empty gap. */
  readonly span: Degrees;
  /**
   * Bodies split into groups by every gap at least `SEPARATING_GAP` wide, in
   * wheel order. A single group holding every body when the shape isn't
   * split at all (bundle, bowl, locomotive, splash).
   */
  readonly groups: readonly (readonly BodyId[])[];
  /** The isolated body opposite the main cluster. Present only for 'bucket'. */
  readonly handle?: BodyId;
}

/** Gaps between each body and the next, walking the circle; the last wraps back to the first. */
function circularGaps(sortedLongitudes: readonly Degrees[]): readonly Degrees[] {
  const n = sortedLongitudes.length;
  const gaps: Degrees[] = [];
  for (let i = 0; i < n; i++) {
    const current = sortedLongitudes[i];
    const next = sortedLongitudes[(i + 1) % n];
    if (current === undefined || next === undefined) continue;
    gaps.push(i + 1 < n ? next - current : next + 360 - current);
  }
  return gaps;
}

/** Split `bodies` (in wheel order) into contiguous groups at each given gap index. */
function clusterByBoundaries(
  bodies: readonly BodyId[],
  boundaryIndices: readonly number[],
): readonly (readonly BodyId[])[] {
  const n = bodies.length;
  const firstBoundary = boundaryIndices[0];
  if (firstBoundary === undefined) return [bodies];

  const groups: BodyId[][] = [];
  let current: BodyId[] = [];
  for (let offset = 0; offset < n; offset++) {
    const index = (firstBoundary + 1 + offset) % n;
    const body = bodies[index];
    if (body === undefined) continue;
    current.push(body);
    if (boundaryIndices.includes(index)) {
      groups.push(current);
      current = [];
    }
  }
  return groups;
}

/** Classify the overall distribution of bodies around the chart. */
export function jonesShapeOf(positions: ReadonlyMap<BodyId, Degrees>): JonesShapeResult {
  const sorted = Array.from(positions.entries()).sort((a, b) => a[1] - b[1]);
  if (sorted.length < 2) {
    throw new RangeError('Jones chart shapes require at least two bodies');
  }

  const bodies = sorted.map(([body]) => body);
  const longitudes = sorted.map(([, longitude]) => longitude);
  const gaps = circularGaps(longitudes);

  const maxGap = Math.max(...gaps);
  const span = 360 - maxGap;

  if (span <= TRINE) return { shape: 'bundle', span, groups: [bodies] };
  if (span <= OPPOSITION) return { shape: 'bowl', span, groups: [bodies] };
  if (span <= TWO_TRINES) return { shape: 'locomotive', span, groups: [bodies] };

  const boundaryIndices = gaps.reduce<number[]>((indices, gap, index) => {
    if (gap >= SEPARATING_GAP) indices.push(index);
    return indices;
  }, []);

  if (boundaryIndices.length < 2) return { shape: 'splash', span, groups: [bodies] };

  const groups = clusterByBoundaries(bodies, boundaryIndices);

  if (groups.length === 2) {
    const handleGroup = groups.find((group) => group.length === 1);
    if (handleGroup?.length === 1) {
      const [handle] = handleGroup;
      if (handle !== undefined) return { shape: 'bucket', span, groups, handle };
    }
    return { shape: 'seesaw', span, groups };
  }

  return { shape: 'splay', span, groups };
}
