// @vitest-environment jsdom
/**
 * A jsdom smoke test for `ExtendedSettingsPanel` (#52), in the style of the
 * existing `chart-astrochart-wheel.test.tsx`: mount with `createRoot`,
 * interact with real DOM nodes, no React Testing Library. The provider here
 * is a hand-built fake rather than the real engine (unlike the
 * `chart-compute.ts` integration tests) — this test only exercises the
 * panel's own rendering and state, never an actual ephemeris value, so a
 * fake keeping just the two methods the panel calls is the right scope.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXTENDED_SETTINGS } from '../src/chart/extended-settings.js';
import type { EphemerisProvider } from '../src/ephemeris/types.js';
import { ExtendedSettingsPanel } from '../src/ui/ExtendedSettingsPanel.js';

function notImplemented(): never {
  throw new Error('not used by this test');
}

function fakeProvider(): EphemerisProvider {
  return {
    initialize: notImplemented,
    julianDay: notImplemented,
    julianDayFromUtc: notImplemented,
    position: notImplemented,
    positions: notImplemented,
    houses: notImplemented,
    houseSystemName: (system) => Promise.resolve(`House system ${system}`),
    ayanamsa: notImplemented,
    obliquity: notImplemented,
    ayanamsaName: (mode) => Promise.resolve(`Ayanamsa ${String(mode)}`),
    fixedStar: notImplemented,
    fixedStarMagnitude: notImplemented,
    nextSunCrossing: notImplemented,
    nextMoonCrossing: notImplemented,
    version: notImplemented,
    dispose: notImplemented,
  };
}

/** The one checkbox whose own `<label>` text includes `text`, assumed unique among checkboxes. */
function checkboxLabeled(container: HTMLElement, text: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll('label')).find(
    (candidate) => candidate.querySelector('input[type="checkbox"]') !== null && candidate.textContent.includes(text),
  );
  const input = label?.querySelector('input[type="checkbox"]');
  if (!(input instanceof HTMLInputElement)) throw new Error(`test fixture bug: no checkbox labeled "${text}"`);
  return input;
}

async function mount(
  provider: EphemerisProvider,
  onRedraw: (next: unknown) => void,
): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ExtendedSettingsPanel value={DEFAULT_EXTENDED_SETTINGS} onRedraw={onRedraw} provider={provider} />);
    // Lets the fake provider's already-resolved name-lookup promises settle and the
    // resulting re-render commit before assertions run.
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

describe('ExtendedSettingsPanel', () => {
  it('renders collapsed behind a disclosure and resolves house-system names asynchronously', async () => {
    const { container, root } = await mount(fakeProvider(), vi.fn());

    expect(container.querySelector('details.extended-settings')).not.toBeNull();
    expect(container.querySelector('summary')?.textContent).toBe('Extended settings');

    const houseSelect = container.querySelector('select');
    expect(houseSelect).not.toBeNull();
    // Placidus ('P') is the default; its option's label should have resolved from the
    // fake's houseSystemName rather than staying on the raw machine key ("placidus").
    const placidusOption = Array.from(houseSelect?.querySelectorAll('option') ?? []).find(
      (option) => option.value === 'P',
    );
    expect(placidusOption?.textContent).toBe('House system P');

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('redraws with the edited draft, not the original value, once Redraw is clicked', async () => {
    const onRedraw = vi.fn();
    const { container, root } = await mount(fakeProvider(), onRedraw);

    const rainbowCheckbox = checkboxLabeled(container, 'Rainbow Color Zodiac');
    expect(rainbowCheckbox.checked).toBe(false);
    act(() => {
      rainbowCheckbox.click();
    });
    expect(onRedraw).not.toHaveBeenCalled();

    const redrawButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Redraw',
    );
    expect(redrawButton).not.toBeUndefined();
    act(() => {
      redrawButton?.click();
    });

    expect(onRedraw).toHaveBeenCalledTimes(1);
    expect(onRedraw).toHaveBeenCalledWith({ ...DEFAULT_EXTENDED_SETTINGS, rainbowZodiac: true });

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('toggles the Midpoints checkbox and redraws with it set', async () => {
    const onRedraw = vi.fn();
    const { container, root } = await mount(fakeProvider(), onRedraw);

    const midpointsCheckbox = checkboxLabeled(container, 'Midpoints (ASC/MC, Sun/Moon)');
    expect(midpointsCheckbox.checked).toBe(false);
    act(() => {
      midpointsCheckbox.click();
    });

    const redrawButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Redraw',
    );
    act(() => {
      redrawButton?.click();
    });

    expect(onRedraw).toHaveBeenCalledWith({ ...DEFAULT_EXTENDED_SETTINGS, midpointsVisible: true });

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('reveals the ayanamsa picker only once Sidereal is chosen', async () => {
    const { container, root } = await mount(fakeProvider(), vi.fn());

    expect(container.querySelectorAll('select')).toHaveLength(1);
    const siderealRadio = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]')).find(
      (radio) => radio.name === 'extended-settings-zodiac' && !radio.checked,
    );
    expect(siderealRadio).not.toBeUndefined();
    act(() => {
      siderealRadio?.click();
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelectorAll('select')).toHaveLength(2);

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
