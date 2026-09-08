/**
 * Dispositor chains, final dispositor and mutual reception (#34).
 *
 * A body's dispositor is the ruler of the sign it occupies. Walking that
 * relationship — "whoever rules the sign I'm in, then whoever rules the sign
 * *they're* in" — either terminates at a body that rules the sign it itself
 * occupies (its final dispositor) or loops back on a body already visited
 * (a cycle, the simplest case of which is two bodies in each other's sign:
 * mutual reception).
 *
 * The chain can only be walked as far as the chart actually has placements
 * for: `positions` must include a longitude for every body the walk reaches,
 * which in practice means at least the seven traditional rulers (plus the
 * three modern outer-planet rulers, if using the modern scheme).
 */
import type { BodyId, Degrees } from '../ephemeris/types.js';
import { type RulershipScheme, rulerOf } from './dignities.js';
import { signIndex } from './signs.js';

export interface DispositorChain {
  /** Starts with the queried body; ends at its final dispositor, or the body that closed a cycle. */
  readonly chain: readonly BodyId[];
  /** The body whose sign it itself rules, terminating the chain. `undefined` when a cycle was found first. */
  readonly finalDispositor: BodyId | undefined;
  /** True when the chain looped back onto an earlier body instead of reaching a final dispositor. */
  readonly cycle: boolean;
}

/**
 * Walks `body`'s dispositor chain: the sequence of rulers of the sign each
 * successive body occupies, until one rules its own sign (the final
 * dispositor) or a body repeats (a cycle — mutual reception is the
 * simplest case, a 2-body cycle).
 */
export function dispositorChain(
  body: BodyId,
  positions: ReadonlyMap<BodyId, Degrees>,
  scheme: RulershipScheme = 'traditional',
): DispositorChain {
  const chain: BodyId[] = [body];
  const seen = new Set<BodyId>([body]);
  let current = body;

  for (;;) {
    const longitude = positions.get(current);
    if (longitude === undefined) {
      throw new RangeError(`no position given for body ${current}; every body in the chain needs a placement`);
    }
    const ruler = rulerOf(signIndex(longitude), scheme);
    if (ruler === current) return { chain, finalDispositor: current, cycle: false };
    if (seen.has(ruler)) return { chain, finalDispositor: undefined, cycle: true };
    chain.push(ruler);
    seen.add(ruler);
    current = ruler;
  }
}

/**
 * Whether two bodies are in mutual reception: each sits in the sign the
 * other rules. A direct 2-body check, independent of walking a full chain —
 * useful for scanning a whole chart for reception pairs without following
 * every dispositor chain to completion.
 */
export function isMutualReception(
  bodyA: BodyId,
  longitudeA: Degrees,
  bodyB: BodyId,
  longitudeB: Degrees,
  scheme: RulershipScheme = 'traditional',
): boolean {
  return rulerOf(signIndex(longitudeA), scheme) === bodyB && rulerOf(signIndex(longitudeB), scheme) === bodyA;
}
