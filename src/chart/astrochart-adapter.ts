/**
 * Adapts a computed chart to the input shape `@astrodraw/astrochart`'s `radix()`
 * call expects (MIT — https://github.com/AstroDraw/AstroChart). This is the only
 * file that knows about that library's data format; nothing else in `src/chart/*`
 * or the export pipeline depends on it.
 *
 * AstroChart recognizes a fixed, small set of point names — anything else falls
 * through to its default glyph, an unlabelled circle, which is worse than leaving
 * the point out. `BODY_KEY_TO_ASTROCHART_NAME` is therefore a deliberate subset:
 * the ten classical bodies and Chiron map straight across (Astraya's own
 * `BodyDefinition.name` already matches AstroChart's naming), and of Astraya's two
 * lunar nodes and three Liliths — models AstroChart has only one glyph slot each
 * for — the more commonly displayed variant of each (the true node, the mean
 * "Black Moon" Lilith) is chosen. The four asteroids have no slot at all and are
 * omitted.
 */
import { bodyById } from '../astrology/bodies.js';
import type { ChartData } from '../domain/chart-compute.js';

const BODY_KEY_TO_ASTROCHART_NAME: Readonly<Record<string, string>> = {
  sun: 'Sun',
  moon: 'Moon',
  mercury: 'Mercury',
  venus: 'Venus',
  mars: 'Mars',
  jupiter: 'Jupiter',
  saturn: 'Saturn',
  uranus: 'Uranus',
  neptune: 'Neptune',
  pluto: 'Pluto',
  chiron: 'Chiron',
  trueNode: 'NNode',
  meanLilith: 'Lilith',
};

/** The shape `Chart.radix()` expects — see the library's own `AstroData` type. */
export interface AstroChartRadixData {
  readonly planets: Readonly<Record<string, [number]>>;
  // Not `readonly number[]`: this is handed straight to `Chart.radix()`, whose own
  // `AstroData` type declares `cusps` as a mutable array.
  readonly cusps: number[];
}

/**
 * `data.houses.cusps` is 1-indexed with index 0 unused (see `HousePositions`'s own
 * doc comment); AstroChart wants a plain 0-indexed 12-element array.
 */
export function toAstroChartRadixData(data: ChartData): AstroChartRadixData {
  const planets: Record<string, [number]> = {};
  for (const position of data.positions) {
    const name = BODY_KEY_TO_ASTROCHART_NAME[bodyById(position.body)?.key ?? ''];
    if (name === undefined) continue;
    planets[name] = [position.longitude];
  }
  return { planets, cusps: data.houses.cusps.slice(1, 13) };
}
