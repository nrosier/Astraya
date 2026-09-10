import { describe, expect, it } from 'vitest';
import { bodyByKey } from '../src/astrology/bodies.js';
import { toAstroChartRadixData } from '../src/chart/astrochart-adapter.js';
import type { ChartData } from '../src/domain/chart-compute.js';
import type { BodyId, BodyPosition, HousePositions } from '../src/ephemeris/types.js';

function idOf(key: string): BodyId {
  const body = bodyByKey(key);
  if (body === undefined) throw new Error(`test fixture bug: no body keyed "${key}"`);
  return body.id;
}

function position(body: BodyId, longitude: number): BodyPosition {
  return {
    body,
    longitude,
    latitude: 0,
    distance: 1,
    longitudeSpeed: 1,
    latitudeSpeed: 0,
    distanceSpeed: 0,
    retrograde: false,
  };
}

const HOUSES: HousePositions = {
  cusps: [0, 10, 40, 70, 100, 130, 160, 190, 220, 250, 280, 310, 340],
  ascendant: 10,
  midheaven: 280,
  armc: 278,
  vertex: 200,
  equatorialAscendant: 12,
  coAscendantKoch: 14,
  coAscendantMunkasey: 16,
  polarAscendant: 18,
  system: 'P',
};

function chartData(positions: readonly BodyPosition[]): ChartData {
  return {
    positions,
    houses: HOUSES,
    aspects: [],
    dignities: new Map(),
    sect: 'day',
    partOfFortune: 0,
    partOfSpirit: 0,
  };
}

describe('toAstroChartRadixData', () => {
  it('maps a classical body straight across by name', () => {
    const data = chartData([position(idOf('sun'), 123.5)]);
    expect(toAstroChartRadixData(data).planets).toEqual({ Sun: [123.5] });
  });

  it('maps the true node to NNode and mean Lilith to Lilith', () => {
    const data = chartData([position(idOf('trueNode'), 10), position(idOf('meanLilith'), 20)]);
    expect(toAstroChartRadixData(data).planets).toEqual({ NNode: [10], Lilith: [20] });
  });

  it('omits bodies AstroChart has no glyph for: the mean node, the other two Liliths, and the asteroids', () => {
    const data = chartData([
      position(idOf('meanNode'), 1),
      position(idOf('osculatingLilith'), 2),
      position(idOf('interpolatedLilith'), 3),
      position(idOf('ceres'), 4),
      position(idOf('pallas'), 5),
      position(idOf('juno'), 6),
      position(idOf('vesta'), 7),
    ]);
    expect(toAstroChartRadixData(data).planets).toEqual({});
  });

  it('drops the unused index-0 cusp and returns a plain 0-indexed 12-element array', () => {
    const { cusps } = toAstroChartRadixData(chartData([]));
    expect(cusps).toEqual([10, 40, 70, 100, 130, 160, 190, 220, 250, 280, 310, 340]);
    expect(cusps).toHaveLength(12);
  });
});
