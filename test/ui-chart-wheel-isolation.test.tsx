// @vitest-environment jsdom
/**
 * Click-to-isolate on the natal wheel (#400, #412), against a real computed chart: clicking a
 * body, a sign or an aspect line keeps only it and its connections at full strength and dims
 * every other symbol on the wheel — glyphs, their degree/sign/minute stacks, ticks, signs and
 * aspect lines alike.
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
  const engine = await getEngine();
  // The same chart as the #412 reference screenshot: 1 Jan 1970, 00:00, Antwerp (Ohio).
  data = await computeChartData(
    {
      civil: { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
      coordinates: { latitude: 41.1833, longitude: -84.7333 },
      zoneOverride: 'America/New_York',
    },
    engine,
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
});

async function mount(): Promise<HTMLElement> {
  setLocale('en');
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

function wheelOf(container: HTMLElement): HTMLElement {
  const wheel = container.querySelector<HTMLElement>('.chart-wheel-interactive');
  if (wheel === null) throw new Error('test fixture bug: no interactive wheel rendered');
  return wheel;
}

/** Clicks the invisible hit area — the whole point of #412 is that it, not a glyph stroke, takes the click. */
async function clickHitArea(wheel: HTMLElement, selector: string): Promise<void> {
  const hit = wheel.querySelector(`${selector} .chart-hit-area`);
  if (hit === null) throw new Error(`test fixture bug: no hit area under ${selector}`);
  await act(async () => {
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
}

function dimmedKeys(wheel: HTMLElement, attribute: string, dimmed: boolean): Set<string> {
  return new Set(
    [...wheel.querySelectorAll(`[${attribute}]`)]
      .filter((element) => element.classList.contains('chart-dimmed') === dimmed)
      .map((element) => element.getAttribute(attribute) ?? ''),
  );
}

describe('wheel click-to-isolate (#412)', () => {
  it('tells the user the wheel is clickable', async () => {
    const container = await mount();
    expect(container.querySelector('.chart-wheel-hint')?.textContent).toBe(chartViewMessages.en.wheelClickHint);
  });

  it('isolates a clicked body: it and its aspect partners stay, every other symbol and line dims', async () => {
    const wheel = wheelOf(await mount());
    await clickHitArea(wheel, '.chart-point[data-body="sun"]');

    const kept = dimmedKeys(wheel, 'data-body', false);
    expect(kept.has('sun')).toBe(true);
    expect(dimmedKeys(wheel, 'data-body', true).has('sun')).toBe(false);
    // Every part of a dimmed body — glyph group, radial stack, tick — dims together.
    for (const key of dimmedKeys(wheel, 'data-body', true)) {
      for (const element of wheel.querySelectorAll(`[data-body="${key}"]`)) {
        expect(element.classList.contains('chart-dimmed')).toBe(true);
      }
    }
    expect(dimmedKeys(wheel, 'data-body', true).size).toBeGreaterThan(0);

    // Only aspect lines touching the Sun stay.
    for (const link of wheel.querySelectorAll('[data-aspect-body-a]')) {
      const involvesSun =
        link.getAttribute('data-aspect-body-a') === 'sun' || link.getAttribute('data-aspect-body-b') === 'sun';
      expect(link.classList.contains('chart-dimmed')).toBe(!involvesSun);
    }

    // The Sun's own sign (Capricorn) stays; every other sign dims.
    expect([...dimmedKeys(wheel, 'data-sign', false)]).toEqual(['capricorn']);
  });

  it('isolates a clicked sign: the sign, the bodies in it and their aspect lines', async () => {
    const container = await mount();
    const wheel = wheelOf(container);
    await clickHitArea(wheel, '.chart-sign[data-sign="libra"]');

    expect([...dimmedKeys(wheel, 'data-sign', false)]).toEqual(['libra']);
    // Moon and Uranus are both in Libra in this chart.
    const kept = dimmedKeys(wheel, 'data-body', false);
    expect(kept.has('moon')).toBe(true);
    expect(kept.has('uranus')).toBe(true);
    for (const link of wheel.querySelectorAll('[data-aspect-body-a]:not(.chart-dimmed)')) {
      const ends = [link.getAttribute('data-aspect-body-a'), link.getAttribute('data-aspect-body-b')];
      expect(ends.includes('moon') || ends.includes('uranus')).toBe(true);
    }

    const panel = container.querySelector('.chart-isolation-panel');
    expect(panel?.querySelector('strong')?.textContent).toBe('Libra');
    expect(panel?.textContent).toContain('Moon');
    expect(panel?.textContent).toContain('Uranus');
  });

  it('isolates a clicked aspect line to just that pair', async () => {
    const wheel = wheelOf(await mount());
    const link = wheel.querySelector('.chart-aspect-link');
    const a = link?.getAttribute('data-aspect-body-a') ?? '';
    const b = link?.getAttribute('data-aspect-body-b') ?? '';
    await clickHitArea(wheel, `.chart-aspect-link[data-aspect-body-a="${a}"][data-aspect-body-b="${b}"]`);

    expect(dimmedKeys(wheel, 'data-body', false)).toEqual(new Set([a, b]));
    expect(wheel.querySelectorAll('.chart-aspect-link:not(.chart-dimmed)')).toHaveLength(1);
  });

  it('clears the isolation on a second click of the same symbol, and on a click on empty space', async () => {
    const wheel = wheelOf(await mount());
    await clickHitArea(wheel, '.chart-point[data-body="moon"]');
    expect(wheel.querySelectorAll('.chart-dimmed').length).toBeGreaterThan(0);
    await clickHitArea(wheel, '.chart-point[data-body="moon"]');
    expect(wheel.querySelectorAll('.chart-dimmed')).toHaveLength(0);

    await clickHitArea(wheel, '.chart-point[data-body="moon"]');
    await act(async () => {
      wheel.querySelector('.wheel-ring-aspect')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(wheel.querySelectorAll('.chart-dimmed')).toHaveLength(0);
  });
});
