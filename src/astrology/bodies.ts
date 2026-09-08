/**
 * The canonical set of bodies Astraya computes positions for (#17).
 *
 * This is the single place that decides "what is a body" for the rest of the
 * app — chart rendering, aspects, dignities and progressions all iterate this
 * list rather than each keeping their own. Three of the entries are not
 * physical bodies at all: the lunar nodes and the three "Lilith" points are
 * orbital elements of the Moon's path, not things with their own gravity, and
 * Swiss Ephemeris computes them from three different models (an osculating
 * ellipse, its instantaneous tangent, and an interpolation between the two) —
 * hence three SE ids rather than one, and why none of them can be checked
 * against JPL Horizons the way a real body can: there is nothing independent
 * to check against, since the model *is* the definition.
 */
import { SE } from '../ephemeris/generated-constants.js';
import type { BodyId } from '../ephemeris/types.js';

export type BodyCategory = 'luminary' | 'planet' | 'node' | 'lilith' | 'centaur' | 'asteroid';

export interface BodyDefinition {
  readonly id: BodyId;
  readonly key: string;
  readonly name: string;
  readonly category: BodyCategory;
}

/**
 * Sun through Pluto, both lunar nodes, all three Lilith variants, Chiron, and
 * the four main-belt asteroids visible to the naked eye at opposition.
 *
 * Order matches the traditional chart-listing order (luminaries, personal and
 * outer planets, then points), not the SE numeric ids.
 */
export const BODIES: readonly BodyDefinition[] = [
  { id: SE.SE_SUN, key: 'sun', name: 'Sun', category: 'luminary' },
  { id: SE.SE_MOON, key: 'moon', name: 'Moon', category: 'luminary' },
  { id: SE.SE_MERCURY, key: 'mercury', name: 'Mercury', category: 'planet' },
  { id: SE.SE_VENUS, key: 'venus', name: 'Venus', category: 'planet' },
  { id: SE.SE_MARS, key: 'mars', name: 'Mars', category: 'planet' },
  { id: SE.SE_JUPITER, key: 'jupiter', name: 'Jupiter', category: 'planet' },
  { id: SE.SE_SATURN, key: 'saturn', name: 'Saturn', category: 'planet' },
  { id: SE.SE_URANUS, key: 'uranus', name: 'Uranus', category: 'planet' },
  { id: SE.SE_NEPTUNE, key: 'neptune', name: 'Neptune', category: 'planet' },
  { id: SE.SE_PLUTO, key: 'pluto', name: 'Pluto', category: 'planet' },
  { id: SE.SE_MEAN_NODE, key: 'meanNode', name: 'Mean Node', category: 'node' },
  { id: SE.SE_TRUE_NODE, key: 'trueNode', name: 'True Node', category: 'node' },
  { id: SE.SE_MEAN_APOG, key: 'meanLilith', name: 'Mean Lilith', category: 'lilith' },
  { id: SE.SE_OSCU_APOG, key: 'osculatingLilith', name: 'Osculating Lilith', category: 'lilith' },
  { id: SE.SE_INTP_APOG, key: 'interpolatedLilith', name: 'Interpolated Lilith', category: 'lilith' },
  { id: SE.SE_CHIRON, key: 'chiron', name: 'Chiron', category: 'centaur' },
  { id: SE.SE_CERES, key: 'ceres', name: 'Ceres', category: 'asteroid' },
  { id: SE.SE_PALLAS, key: 'pallas', name: 'Pallas', category: 'asteroid' },
  { id: SE.SE_JUNO, key: 'juno', name: 'Juno', category: 'asteroid' },
  { id: SE.SE_VESTA, key: 'vesta', name: 'Vesta', category: 'asteroid' },
];

const BY_ID = new Map<BodyId, BodyDefinition>(BODIES.map((body) => [body.id, body]));
const BY_KEY = new Map<string, BodyDefinition>(BODIES.map((body) => [body.key, body]));

export function bodyById(id: BodyId): BodyDefinition | undefined {
  return BY_ID.get(id);
}

export function bodyByKey(key: string): BodyDefinition | undefined {
  return BY_KEY.get(key);
}

/** The south node is always 180° from whichever north node was requested. */
export function southNode(northNodeLongitude: number): number {
  const value = (northNodeLongitude + 180) % 360;
  return value < 0 ? value + 360 : value;
}
