/**
 * Which interpretation entries belong to a selection on the chart wheel (#415).
 *
 * Clicking a planet, a sign or an aspect line on the wheel (#400, #412) isolates it; this says which
 * of the chart's placements to show the written text for. It selects from `derivePlacements` — the
 * exact set the Interpretation tab's report is built from — and orders it by the same salience, so
 * the wheel can never say something the report doesn't, or say it in a different order.
 *
 * - **A planet:** its sign, its house, its dignity if it has one, and every aspect it is part of.
 * - **A sign:** each planet in that sign, and the house cusp(s) that fall in it. (A sign has no entry
 *   of its own: what is written is about placements *in* it.)
 * - **An aspect line:** that one pair.
 */
import { SIGNS } from '../astrology/signs.js';
import { parseBodyId } from '../chart/body-id.js';
import type { ChartData } from '../domain/chart-compute.js';
import { derivePlacements, rankPlacements, type SalientPlacement } from './rules.js';

export type WheelSelection =
  | { readonly kind: 'body'; readonly key: string; readonly ring: number }
  | { readonly kind: 'sign'; readonly signIndex: number }
  | {
      readonly kind: 'aspect';
      readonly bodyA: string;
      readonly ringA: number;
      readonly bodyB: string;
      readonly ringB: number;
    };

/**
 * Reads the wheel's selection key: `body:<id>`, `sign:<lowercase sign name>` or `aspect:<idA>|<idB>`,
 * where an id is a body key with an optional ring (`sun`, or `sun@1` — see `chart/body-id.ts`; a
 * bare key is ring 0). `undefined` for anything else, including a sign that does not exist.
 */
export function parseSelectionKey(key: string): WheelSelection | undefined {
  const colon = key.indexOf(':');
  if (colon === -1) return undefined;
  const kind = key.slice(0, colon);
  const value = key.slice(colon + 1);
  if (kind === 'body') {
    const { key: bodyKey, ring } = parseBodyId(value);
    return bodyKey === '' ? undefined : { kind: 'body', key: bodyKey, ring };
  }
  if (kind === 'sign') {
    const signIndex = SIGNS.findIndex((sign) => sign.name.toLowerCase() === value);
    return signIndex === -1 ? undefined : { kind: 'sign', signIndex };
  }
  if (kind === 'aspect') {
    const [idA, idB] = value.split('|');
    if (idA === undefined || idB === undefined) return undefined;
    const a = parseBodyId(idA);
    const b = parseBodyId(idB);
    return a.key === '' || b.key === ''
      ? undefined
      : { kind: 'aspect', bodyA: a.key, ringA: a.ring, bodyB: b.key, ringB: b.ring };
  }
  return undefined;
}

function matches(item: SalientPlacement, selection: WheelSelection): boolean {
  const placement = item.placement;
  switch (selection.kind) {
    case 'body':
      switch (placement.category) {
        case 'planet-in-sign':
        case 'planet-in-house':
        case 'dignity-state':
          return placement.body === selection.key;
        case 'aspect-pair':
          return placement.bodyA === selection.key || placement.bodyB === selection.key;
        default:
          return false;
      }
    case 'sign':
      return (
        (placement.category === 'planet-in-sign' || placement.category === 'sign-on-cusp') &&
        placement.sign === selection.signIndex
      );
    case 'aspect':
      return (
        placement.category === 'aspect-pair' &&
        ((placement.bodyA === selection.bodyA && placement.bodyB === selection.bodyB) ||
          (placement.bodyA === selection.bodyB && placement.bodyB === selection.bodyA))
      );
  }
}

/** The order kinds of placement are shown in: what a planet *is* before how it relates. */
const CATEGORY_ORDER: readonly string[] = [
  'planet-in-sign',
  'planet-in-house',
  'dignity-state',
  'sign-on-cusp',
  'aspect-pair',
];

function categoryRank(item: SalientPlacement): number {
  const index = CATEGORY_ORDER.indexOf(item.placement.category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

/** The chart's placements that belong to `selection`: basics first, then aspects; most salient first within each. */
export function selectionPlacements(chart: ChartData, selection: WheelSelection): readonly SalientPlacement[] {
  // `rankPlacements` already orders by salience, and `sort` is stable, so within a kind that order holds.
  return rankPlacements(derivePlacements(chart))
    .filter((item) => matches(item, selection))
    .sort((a, b) => categoryRank(a) - categoryRank(b));
}
