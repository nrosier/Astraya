// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { bodyByKey } from '../src/astrology/bodies.js';
import type { ChartData } from '../src/domain/chart-compute.js';
import type { BodyId, BodyPosition, HousePositions } from '../src/ephemeris/types.js';
import { AstroChartWheel } from '../src/ui/AstroChartWheel.js';

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

const DATA: ChartData = {
  positions: [position(idOf('sun'), 10), position(idOf('moon'), 130)],
  houses: HOUSES,
  aspects: [],
  dignities: new Map(),
  sect: 'day',
  partOfFortune: 0,
  partOfSpirit: 0,
};

describe('AstroChartWheel', () => {
  it('renders an svg from the given chart data', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    act(() => {
      root.render(<AstroChartWheel data={DATA} size={200} />);
    });

    expect(container.querySelector('svg')).not.toBeNull();

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
