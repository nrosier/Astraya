/**
 * The facts a bi-wheel's selection panel states (#418): what was clicked, on which ring, and how it
 * relates across the rings. Pure — raw keys and numbers, no wording — so it can be tested without a
 * DOM and rendered in either language by the component.
 *
 * Which parts of the wheel to dim is not decided here: `wheel-interaction.ts` derives that from the
 * wheel's markup. This only answers "what is it?" for the panel beside the wheel.
 *
 * The two bi-wheel screens order their cross-ring aspects differently (a transit puts the transiting
 * body, on the outer ring, first; a synastry puts person A, on ring 0, first), so the caller says
 * which ring the first and second end of each aspect row is on.
 */
import { bodyById } from '../astrology/bodies.js';
import { houseOf } from '../astrology/emphasis.js';
import { SIGNS } from '../astrology/signs.js';
import { housesAreDefined, type ChartData } from '../domain/chart-compute.js';
import { filterAspectsForDisplay } from '../chart/aspect-web.js';
import { aspectRows, crossAspectRows, degreeParts, type AspectRow } from '../domain/chart-tables.js';
import { parseSelectionKey } from '../interpretation/selection.js';

export interface BiWheelRing {
  /** What the ring is called on screen: "Natal", "Transiting", a person's name. */
  readonly label: string;
  readonly data: ChartData;
}

export interface BiWheelInput {
  readonly rings: readonly BiWheelRing[];
  /** The aspects between the rings, as table rows. */
  readonly cross: readonly AspectRow[];
  /** Which ring the first and second end (`bodyAKey`, `bodyBKey`) of each cross row is on. */
  readonly crossRingOfA: number;
  readonly crossRingOfB: number;
}

export interface BodyOnRing {
  readonly bodyKey: string;
  readonly ring: number;
  readonly signName: string;
  readonly degree: number;
  readonly minute: number;
  readonly retrograde: boolean;
}

export interface BiWheelAspect {
  readonly row: AspectRow;
  /** The end that is not the selected body, with the ring it is on. */
  readonly other: { readonly bodyKey: string; readonly ring: number };
}

export type BiWheelFacts =
  | {
      readonly kind: 'body';
      readonly body: BodyOnRing;
      /** The house of ring 0 the body falls in — a transiting planet's natal house, a partner's planet in your house. Undefined without houses. */
      readonly houseInFirstRing: number | undefined;
      /** Aspects to the other ring. */
      readonly aspects: readonly BiWheelAspect[];
      /** Aspects to other bodies of the same ring — the wheel draws these lines too. */
      readonly ownAspects: readonly BiWheelAspect[];
    }
  | { readonly kind: 'sign'; readonly signName: string; readonly bodies: readonly BodyOnRing[] }
  | {
      readonly kind: 'aspect';
      readonly row: AspectRow;
      readonly a: { readonly bodyKey: string; readonly ring: number };
      readonly b: { readonly bodyKey: string; readonly ring: number };
    };

function bodyOnRing(data: ChartData, ring: number, bodyKey: string): BodyOnRing | undefined {
  const position = data.positions.find((candidate) => bodyById(candidate.body)?.key === bodyKey);
  if (position === undefined) return undefined;
  const { sign, degree, minute } = degreeParts(position.longitude);
  return { bodyKey, ring, signName: sign, degree, minute, retrograde: position.retrograde };
}

/** The facts for a selection key, or `undefined` when the key is not one the wheel makes or names nothing on these rings. */
export function resolveBiWheelSelection(selectionKey: string, input: BiWheelInput): BiWheelFacts | undefined {
  const selection = parseSelectionKey(selectionKey);
  if (selection === undefined) return undefined;

  if (selection.kind === 'body') {
    const ring = input.rings[selection.ring];
    if (ring === undefined) return undefined;
    const body = bodyOnRing(ring.data, selection.ring, selection.key);
    if (body === undefined) return undefined;
    const position = ring.data.positions.find((candidate) => bodyById(candidate.body)?.key === selection.key);
    const firstHouses = input.rings[0]?.data.houses;
    const houseInFirstRing =
      position !== undefined && firstHouses !== undefined && housesAreDefined(firstHouses)
        ? houseOf(position.longitude, firstHouses.cusps)
        : undefined;
    const aspects = input.cross.flatMap((row): BiWheelAspect[] => {
      if (row.bodyAKey === selection.key && input.crossRingOfA === selection.ring) {
        return [{ row, other: { bodyKey: row.bodyBKey, ring: input.crossRingOfB } }];
      }
      if (row.bodyBKey === selection.key && input.crossRingOfB === selection.ring) {
        return [{ row, other: { bodyKey: row.bodyAKey, ring: input.crossRingOfA } }];
      }
      return [];
    });
    // Only the lines the wheel draws inside a ring: the major aspects, but not conjunctions, whose
    // two bodies already sit side by side (cross-ring conjunctions are drawn, so they are in `aspects`).
    const drawnOwn = filterAspectsForDisplay(ring.data.aspects, { visibleFamilies: ['major'] }).filter(
      (aspect) => aspect.aspect.key !== 'conjunction',
    );
    const ownAspects = crossAspectRows(drawnOwn).flatMap((row): BiWheelAspect[] => {
      if (row.bodyAKey === selection.key) return [{ row, other: { bodyKey: row.bodyBKey, ring: selection.ring } }];
      if (row.bodyBKey === selection.key) return [{ row, other: { bodyKey: row.bodyAKey, ring: selection.ring } }];
      return [];
    });
    return { kind: 'body', body, houseInFirstRing, aspects, ownAspects };
  }

  if (selection.kind === 'sign') {
    const signName = SIGNS[selection.signIndex]?.name ?? '';
    const bodies = input.rings.flatMap((ring, index) =>
      ring.data.positions.flatMap((position): BodyOnRing[] => {
        const key = bodyById(position.body)?.key;
        if (key === undefined) return [];
        const placed = bodyOnRing(ring.data, index, key);
        return placed?.signName === signName ? [placed] : [];
      }),
    );
    return { kind: 'sign', signName, bodies };
  }

  const a = { bodyKey: selection.bodyA, ring: selection.ringA };
  const b = { bodyKey: selection.bodyB, ring: selection.ringB };
  // Between the rings, or one ring's own aspect — whichever the clicked line is.
  const ownRing = input.rings[selection.ringA];
  const candidates: readonly AspectRow[] =
    selection.ringA === selection.ringB ? (ownRing === undefined ? [] : aspectRows(ownRing.data)) : input.cross;
  const row = candidates.find((candidate) => {
    const forward =
      candidate.bodyAKey === a.bodyKey &&
      candidate.bodyBKey === b.bodyKey &&
      (selection.ringA === selection.ringB || (input.crossRingOfA === a.ring && input.crossRingOfB === b.ring));
    const backward =
      candidate.bodyAKey === b.bodyKey &&
      candidate.bodyBKey === a.bodyKey &&
      (selection.ringA === selection.ringB || (input.crossRingOfA === b.ring && input.crossRingOfB === a.ring));
    return forward || backward;
  });
  return row === undefined ? undefined : { kind: 'aspect', row, a, b };
}
