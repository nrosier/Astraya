/**
 * Shared placement-space builder, extracted from generate-batch.mjs (#368) so
 * sample-validate-batch.mjs can sample the same restricted scope without
 * hand-rebuilding it — the exact duplication risk that made earlier /tmp
 * validation prototypes drift from what the real batch runner covers.
 */
import { buildSymbolismContext, planetSymbolism, signSymbolism } from '../../../src/interpretation/symbolism.ts';
import { BODIES } from '../../../src/astrology/bodies.ts';
import { SIGNS } from '../../../src/astrology/signs.ts';
import { ASPECTS } from '../../../src/astrology/aspects.ts';

export { buildSymbolismContext, BODIES, SIGNS, ASPECTS };

export const HOUSES = Array.from({ length: 12 }, (_, i) => i + 1);
export const SIGN_INDICES = SIGNS.map((s) => s.index);
export const DIGNITY_STATES = ['ruler', 'exalted', 'detriment', 'fall'];

/** Every computed body — planet-in-sign/-house and aspect-pair cover all of them. */
export const CORE_BODY_KEYS = BODIES.map((b) => b.key);
/** The 7 bodies with a defined traditional rulership — the only ones dignity-state means anything for. */
export const TRADITIONAL_RULER_KEYS = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'];

export function corePairs() {
  const keys = [...CORE_BODY_KEYS].sort();
  const pairs = [];
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) pairs.push([keys[i], keys[j]]);
  }
  return pairs;
}

/** The full restricted placement scope, in a fixed, deterministic order — mirrors generate-batch.mjs. */
export function buildPlacements() {
  const placements = [];
  for (const body of CORE_BODY_KEYS) {
    for (const sign of SIGN_INDICES) placements.push({ category: 'planet-in-sign', body, sign });
  }
  for (const body of CORE_BODY_KEYS) {
    for (const house of HOUSES) placements.push({ category: 'planet-in-house', body, house });
  }
  for (const sign of SIGN_INDICES) {
    for (const house of HOUSES) placements.push({ category: 'sign-on-cusp', sign, house });
  }
  for (const aspect of ASPECTS) {
    for (const [bodyA, bodyB] of corePairs())
      placements.push({ category: 'aspect-pair', aspect: aspect.key, bodyA, bodyB });
  }
  for (const aspect of ASPECTS) {
    for (const [bodyA, bodyB] of corePairs())
      placements.push({ category: 'synastry-aspect', aspect: aspect.key, bodyA, bodyB });
  }
  for (const body of TRADITIONAL_RULER_KEYS) {
    for (const state of DIGNITY_STATES) placements.push({ category: 'dignity-state', body, state });
  }
  return placements;
}

export function placementDescription(placement) {
  const bodyName = (key) => BODIES.find((b) => b.key === key)?.name ?? key;
  switch (placement.category) {
    case 'planet-in-sign':
      return `${bodyName(placement.body)} in ${SIGNS[placement.sign]?.name ?? String(placement.sign)} (${planetSymbolism(placement.body)?.core ?? ''} / ${signSymbolism(placement.sign)?.core ?? ''})`;
    case 'planet-in-house':
      return `${bodyName(placement.body)} in house ${String(placement.house)} (${planetSymbolism(placement.body)?.core ?? ''})`;
    case 'sign-on-cusp':
      return `${SIGNS[placement.sign]?.name ?? String(placement.sign)} on the cusp of house ${String(placement.house)} (${signSymbolism(placement.sign)?.core ?? ''})`;
    case 'aspect-pair':
      return `${bodyName(placement.bodyA)} ${placement.aspect} ${bodyName(placement.bodyB)}`;
    case 'synastry-aspect':
      return `synastry: ${bodyName(placement.bodyA)} ${placement.aspect} ${bodyName(placement.bodyB)} (cross-chart)`;
    case 'dignity-state':
      return `${bodyName(placement.body)} in ${placement.state}`;
    default:
      throw new Error(`unreachable: unhandled category "${placement.category}"`);
  }
}

/** Renders a placement's own computed facts as plain English — the same ground truth verify-batch.mjs's judge gets. */
export function factsDescription(placement) {
  const bodyName = (key) => BODIES.find((b) => b.key === key)?.name ?? key;
  const aspectName = (key) => ASPECTS.find((a) => a.key === key)?.name ?? key;
  switch (placement.category) {
    case 'planet-in-sign':
      return `${bodyName(placement.body)} in ${SIGNS[placement.sign]?.name ?? String(placement.sign)}`;
    case 'planet-in-house':
      return `${bodyName(placement.body)} in house ${String(placement.house)}`;
    case 'sign-on-cusp':
      return `${SIGNS[placement.sign]?.name ?? String(placement.sign)} on the cusp of house ${String(placement.house)}`;
    case 'aspect-pair':
      return `${bodyName(placement.bodyA)} ${aspectName(placement.aspect)} ${bodyName(placement.bodyB)}`;
    case 'synastry-aspect':
      return `this chart's ${bodyName(placement.bodyA)} ${aspectName(placement.aspect)} the other chart's ${bodyName(placement.bodyB)}`;
    case 'dignity-state':
      return `${bodyName(placement.body)} in ${placement.state}`;
    default:
      throw new Error(`this tool does not (yet) support category "${placement.category}"`);
  }
}
