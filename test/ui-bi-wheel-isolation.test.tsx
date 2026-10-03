// @vitest-environment jsdom
/**
 * Click-to-isolate on a bi-wheel (#418), against a real transit: the two rings draw the same
 * bodies, so a click must pick out the body *on its ring*, dim the other ring's copy unless it is
 * a partner of the click, and show a panel that names the ring.
 */
import { act, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bodyById } from '../src/astrology/bodies.js';
import { renderMultiWheelSvg } from '../src/chart/multi-wheel.js';
import { chartWheelRing, crossAspectRows } from '../src/domain/chart-tables.js';
import { computeTransit, type TransitData } from '../src/domain/transit.js';
import { BiWheelSelectionPanel } from '../src/ui/BiWheelSelectionPanel.js';
import { resolveBiWheelSelection } from '../src/ui/bi-wheel-selection.js';
import { setLocale } from '../src/ui/locale.js';
import { useWheelIsolation } from '../src/ui/wheel-interaction.js';
import { getEngine } from './engine-harness.js';

let transit: TransitData;
let mounted: { container: HTMLElement; root: Root } | undefined;

beforeAll(async () => {
  const engine = await getEngine();
  const target = await engine.julianDayFromUtc(2024, 4, 8, 12, 0, 0);
  transit = await computeTransit(
    {
      civil: { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
      coordinates: { latitude: 41.1833, longitude: -84.7333 },
      zoneOverride: 'America/New_York',
    },
    target,
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

/** The same wiring TransitView does: the shared hook on the wheel, the resolver and panel beside it. */
function Harness({ locale }: { locale: 'en' | 'nl' }) {
  const markup = useMemo(
    () =>
      renderMultiWheelSvg(
        [chartWheelRing(transit.natal, 'Natal'), chartWheelRing(transit.transit, 'Transit')],
        [{ innerRingIndex: 0, outerRingIndex: 1, aspects: transit.contacts }],
      ),
    [],
  );
  const { wheelRef, selectionKey, clear, onClick } = useWheelIsolation(markup);
  const facts =
    selectionKey === undefined
      ? undefined
      : resolveBiWheelSelection(selectionKey, {
          rings: [
            { label: 'Natal', data: transit.natal },
            { label: 'Transit', data: transit.transit },
          ],
          cross: crossAspectRows(transit.contacts),
          crossRingOfA: 1,
          crossRingOfB: 0,
        });
  return (
    <>
      <div
        ref={wheelRef}
        className="chart-wheel chart-wheel-interactive"
        dangerouslySetInnerHTML={{ __html: markup }}
        onClick={onClick}
      />
      {facts !== undefined && (
        <BiWheelSelectionPanel facts={facts} ringLabels={['Natal', 'Transit']} locale={locale} onClear={clear} />
      )}
    </>
  );
}

async function mount(locale: 'en' | 'nl' = 'en'): Promise<HTMLElement> {
  setLocale(locale);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Harness locale={locale} />);
    await Promise.resolve();
  });
  mounted = { container, root };
  return container;
}

async function click(container: HTMLElement, selector: string): Promise<void> {
  const hit = container.querySelector(`${selector} .chart-hit-area`);
  if (hit === null) throw new Error(`test fixture bug: no hit area under ${selector}`);
  await act(async () => {
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
}

const point = (key: string, ring: number): string => `.chart-point[data-body="${key}"][data-ring="${String(ring)}"]`;
const dimmed = (container: HTMLElement, selector: string): boolean =>
  container.querySelector(selector)?.classList.contains('chart-dimmed') ?? false;
const keyOf = (id: number): string => bodyById(id)?.key ?? '';

describe('bi-wheel click-to-isolate (#418)', () => {
  it('draws every body once per ring, each tagged with its ring', async () => {
    const container = await mount();
    for (const ring of [0, 1]) {
      expect(container.querySelectorAll(`.chart-point[data-body="sun"][data-ring="${String(ring)}"]`)).toHaveLength(1);
    }
  });

  it('keeps a transiting planet and exactly the natal bodies it contacts; dims every other body on both rings', async () => {
    const container = await mount();
    await click(container, point('saturn', 1));

    // Lit: Saturn itself, the natal bodies it contacts, and the transiting bodies it aspects
    // within its own ring (the wheel draws that ring's own aspect lines too).
    const natalPartners = new Set(
      transit.contacts.filter((c) => keyOf(c.bodyA) === 'saturn').map((c) => keyOf(c.bodyB)),
    );
    // Straight from the raw aspects: major ones only, and no same-ring conjunctions (not drawn as lines).
    const ownPartners = new Set(
      transit.transit.aspects
        .filter((a) => a.aspect.family === 'major' && a.aspect.key !== 'conjunction')
        .flatMap((a) =>
          keyOf(a.bodyA) === 'saturn' ? [keyOf(a.bodyB)] : keyOf(a.bodyB) === 'saturn' ? [keyOf(a.bodyA)] : [],
        ),
    );
    expect(natalPartners.size).toBeGreaterThan(0);
    expect(ownPartners.size).toBeGreaterThan(0);

    expect(dimmed(container, point('saturn', 1))).toBe(false);
    for (const position of transit.natal.positions) {
      const key = keyOf(position.body);
      expect(dimmed(container, point(key, 0))).toBe(!natalPartners.has(key));
    }
    for (const position of transit.transit.positions) {
      const key = keyOf(position.body);
      if (key !== 'saturn') expect(dimmed(container, point(key, 1))).toBe(!ownPartners.has(key));
    }
  });

  it('does not mistake the natal Sun for the transiting Sun: each click lights its own ring and the panel names it', async () => {
    const container = await mount();
    await click(container, point('sun', 0));
    expect(container.querySelector('.chart-isolation-head strong')?.textContent).toBe('Sun (Natal)');
    expect(dimmed(container, point('sun', 0))).toBe(false);

    await click(container, point('sun', 1));
    expect(container.querySelector('.chart-isolation-head strong')?.textContent).toBe('Sun (Transit)');
    expect(dimmed(container, point('sun', 1))).toBe(false);
  });

  it('says where the transiting planet is and which natal house it is in', async () => {
    const container = await mount();
    await click(container, point('saturn', 1));
    const text = container.querySelector('.chart-isolation-panel')?.textContent ?? '';
    expect(text).toMatch(/In Natal house \d+/);
    expect(text).toContain('Pisces');
  });

  it('clears on a second click on the same symbol and removes the panel', async () => {
    const container = await mount();
    await click(container, point('saturn', 1));
    expect(container.querySelector('.chart-isolation-panel')).not.toBeNull();
    await click(container, point('saturn', 1));
    expect(container.querySelector('.chart-isolation-panel')).toBeNull();
    expect(container.querySelectorAll('.chart-dimmed')).toHaveLength(0);
  });

  it('isolates a cross-ring aspect line to the two bodies it joins, on their own rings', async () => {
    const container = await mount();
    const contact = transit.contacts[0];
    if (contact === undefined) throw new Error('fixture bug: no contacts');
    const a = keyOf(contact.bodyA);
    const b = keyOf(contact.bodyB);
    await click(
      container,
      `.chart-aspect-link[data-aspect-body-a="${a}"][data-ring-a="1"][data-aspect-body-b="${b}"][data-ring-b="0"]`,
    );
    expect(dimmed(container, point(a, 1))).toBe(false);
    expect(dimmed(container, point(b, 0))).toBe(false);
    expect(container.querySelector('.chart-isolation-panel')).not.toBeNull();
    // A body on neither end stays dimmed, including the same-named body on the other ring.
    const otherRingCopy = a === b ? undefined : point(a, 0);
    if (otherRingCopy !== undefined) expect(dimmed(container, otherRingCopy)).toBe(true);
  });

  it('words the panel in Dutch when the language is Dutch', async () => {
    const container = await mount('nl');
    await click(container, point('saturn', 1));
    const text = container.querySelector('.chart-isolation-panel')?.textContent ?? '';
    expect(text).toContain('Saturnus');
    expect(text).toMatch(/In Natal huis \d+/);
    expect(container.querySelector('.chart-isolation-head button')?.textContent).toBe('Wissen');
  });
});
