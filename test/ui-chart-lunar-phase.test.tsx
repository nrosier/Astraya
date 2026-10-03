// @vitest-environment jsdom
/**
 * The lunar phase line above the Positions table (#403), against a real computed chart: the
 * #412 reference chart, 1 Jan 1970 00:00 in Antwerp (Ohio), whose Moon is 272°57' ahead of the
 * Sun — a Last Quarter Moon, about 47% lit, which Astro-Seek names the same way.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChartData } from '../src/domain/chart-compute.js';
import { computeChartData } from '../src/domain/chart-compute.js';
import { setLocale } from '../src/ui/locale.js';
import { ChartDataView } from '../src/ui/ChartView.js';
import { chartViewMessages } from '../src/ui/ChartView.messages.js';
import { getEngine } from './engine-harness.js';

let data: ChartData;
let mounted: { container: HTMLElement; root: Root } | undefined;

beforeAll(async () => {
  data = await computeChartData(
    {
      civil: { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
      coordinates: { latitude: 41.1833, longitude: -84.7333 },
      zoneOverride: 'America/New_York',
    },
    await getEngine(),
  );
}, 60_000);

afterEach(() => {
  if (mounted !== undefined) {
    act(() => {
      mounted?.root.unmount();
    });
    mounted.container.remove();
    mounted = undefined;
  }
  setLocale('en');
});

async function mount(locale: 'en' | 'nl'): Promise<HTMLElement> {
  setLocale(locale);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ChartDataView load={{ kind: 'ready', data }} displayName="Test" showHouses />);
    await Promise.resolve();
  });
  mounted = { container, root };
  return container;
}

describe('lunar phase line (#403)', () => {
  it('names the phase, the elongation to the minute, waxing/waning and the lit percentage', async () => {
    const container = await mount('en');
    const t = chartViewMessages.en;
    expect(container.querySelector('.lunar-phase-summary')?.textContent).toBe(
      t.lunarPhaseSentence(t.lunarPhaseLabels['last-quarter'], "272°57'", false, 47),
    );
    expect(container.querySelector('.lunar-phase-summary')?.textContent).toContain('Last Quarter Moon');
  });

  it('is shown in Dutch when the locale is Dutch', async () => {
    const container = await mount('nl');
    expect(container.querySelector('.lunar-phase-summary')?.textContent).toBe(
      "Maanfase: Laatste kwartier — 272°57' voor op de Zon, afnemend, 47% verlicht.",
    );
  });
});
