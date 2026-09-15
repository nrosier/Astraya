// @vitest-environment jsdom
/**
 * `ChartDataView`'s `reportAvailable` flag (#269): `CompositeView` passes `false` since its
 * `ChartData` is a synthetic two-person midpoint, not an individual's natal chart, so the
 * natal-style `ReportView` text doesn't apply to it. Same mount/fixture style as
 * `ui-report-view.test.tsx` — a minimal hand-built `ChartData`, `createRoot`/`act`, no React
 * Testing Library.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyByKey } from '../src/astrology/bodies.js';
import { ChartDataView } from '../src/ui/ChartView.js';
import { chartViewMessages } from '../src/ui/ChartView.messages.js';
import { setLocale } from '../src/ui/locale.js';
import type { EssentialDignities } from '../src/astrology/dignities.js';
import type { ChartData } from '../src/domain/chart-compute.js';
import type { BodyId, BodyPosition, Degrees, HousePositions } from '../src/ephemeris/types.js';

function bodyId(key: string): BodyId {
  const body = bodyByKey(key);
  if (body === undefined) throw new Error(`unknown body key "${key}" in test fixture`);
  return body.id;
}

function position(key: string, longitude: Degrees): BodyPosition {
  return {
    body: bodyId(key),
    longitude,
    latitude: 0,
    distance: 1,
    longitudeSpeed: 1,
    latitudeSpeed: 0,
    distanceSpeed: 0,
    retrograde: false,
  };
}

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

function equalHouses(ascendant: Degrees): HousePositions {
  const cusps: Degrees[] = [0];
  for (let house = 1; house <= 12; house++) cusps.push(norm360(ascendant + (house - 1) * 30));
  const midheaven = cusps[10];
  if (midheaven === undefined) throw new Error('unreachable: house 10 cusp always exists');
  return {
    cusps,
    ascendant,
    midheaven,
    armc: midheaven,
    vertex: 0,
    equatorialAscendant: ascendant,
    coAscendantKoch: ascendant,
    coAscendantMunkasey: ascendant,
    polarAscendant: ascendant,
    system: 'P',
  };
}

const NO_DIGNITY: EssentialDignities = { ruler: false, exalted: false, detriment: false, fall: false };
const RULER: EssentialDignities = { ruler: true, exalted: false, detriment: false, fall: false };

function makeChart(): ChartData {
  const positions: BodyPosition[] = [
    position('sun', 10),
    position('moon', 100),
    position('mercury', 40),
    position('venus', 70),
    position('mars', 5),
    position('jupiter', 250),
    position('saturn', 280),
    position('trueNode', 130),
    position('chiron', 160),
  ];
  const dignities = new Map<BodyId, EssentialDignities>(positions.map((p) => [p.body, NO_DIGNITY]));
  dignities.set(bodyId('mars'), RULER);
  dignities.set(bodyId('jupiter'), RULER);
  dignities.set(bodyId('saturn'), RULER);
  return {
    positions,
    houses: equalHouses(0),
    aspects: [],
    dignities,
    sect: 'day',
    partOfFortune: 0,
    partOfSpirit: 0,
  };
}

async function mount(reportAvailable?: boolean): Promise<{ container: HTMLElement; root: Root }> {
  window.location.hash = '#/chart/test-person?tab=report';
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ChartDataView
        load={{ kind: 'ready', data: makeChart() }}
        displayName="Test Person"
        showHouses
        {...(reportAvailable === undefined ? {} : { reportAvailable })}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

describe('ChartDataView report tab availability (#269)', () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale('en');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }) as unknown as ReturnType<typeof fetch>,
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a plain hint instead of the report when reportAvailable is false', async () => {
    const { container, root } = await mount(false);
    try {
      expect(container.textContent).toContain(chartViewMessages.en.reportUnavailableHint);
      expect(container.textContent).not.toContain('Advisor');
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('renders the real report when reportAvailable is true (the default, e.g. ChartView/SharedChartView)', async () => {
    const { container, root } = await mount();
    try {
      expect(container.textContent).not.toContain(chartViewMessages.en.reportUnavailableHint);
      expect(container.textContent).toContain('Advisor');
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });
});
