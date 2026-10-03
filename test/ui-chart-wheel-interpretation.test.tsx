// @vitest-environment jsdom
/**
 * The written interpretation under a wheel selection (#415), through the real chart screen: click
 * a planet, a sign or an aspect line and the panel shows the same corpus text the Interpretation tab
 * would. The expected text is read straight from the committed corpus files, independently of the
 * component, so a wrong lookup cannot agree with itself.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyById } from '../src/astrology/bodies.js';
import { computeChartData, type ChartData } from '../src/domain/chart-compute.js';
import { composeFallbackText } from '../src/interpretation/compose.js';
import type { CorpusEntry } from '../src/interpretation/schema.js';
import { placementKey } from '../src/interpretation/schema.js';
import { parseSelectionKey, selectionPlacements } from '../src/interpretation/selection.js';
import { setLocale } from '../src/ui/locale.js';
import { ChartDataView } from '../src/ui/ChartView.js';
import { chartViewMessages } from '../src/ui/ChartView.messages.js';
import { resetWheelCorpusCache } from '../src/ui/wheel-corpus.js';
import { SELECTION_TEXT_LIMIT } from '../src/ui/wheel-selection.js';
import { getEngine } from './engine-harness.js';

const corpusFile = (locale: 'en' | 'nl'): readonly CorpusEntry[] =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../src/interpretation/corpus/${locale}.json`), 'utf8'),
  ) as CorpusEntry[];
const NEUTRAL = {
  en: corpusFile('en').filter((e) => e.persona === undefined),
  nl: corpusFile('nl').filter((e) => e.persona === undefined),
};

let data: ChartData;
let mounted: { container: HTMLElement; root: Root } | undefined;
let corpusResponse: (locale: 'en' | 'nl') => Response;

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

beforeEach(() => {
  resetWheelCorpusCache();
  corpusResponse = (locale) => new Response(JSON.stringify(NEUTRAL[locale]), { status: 200 });
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const chunk = /\/corpus\/(en|nl)\/neutral\.json$/.exec(url);
      if (chunk?.[1] === 'en' || chunk?.[1] === 'nl') return Promise.resolve(corpusResponse(chunk[1]));
      return Promise.resolve(new Response(JSON.stringify({ entries: [] }), { status: 200 }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (mounted !== undefined) {
    act(() => {
      mounted?.root.unmount();
    });
    mounted.container.remove();
    mounted = undefined;
  }
  setLocale('en');
});

async function mount(locale: 'en' | 'nl' = 'en'): Promise<HTMLElement> {
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

async function click(container: HTMLElement, selector: string): Promise<void> {
  const hit = container.querySelector(`.chart-wheel-interactive ${selector} .chart-hit-area`);
  if (hit === null) throw new Error(`test fixture bug: no hit area under ${selector}`);
  act(() => {
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  // The corpus arrives asynchronously.
  await act(async () => {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  });
}

const section = (container: HTMLElement): HTMLElement | null =>
  container.querySelector('.chart-isolation-interpretation');
const texts = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('.chart-isolation-texts li p')].map((p) => p.textContent);
const headings = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('.chart-isolation-texts li strong')].map((p) => p.textContent);
const entryText = (locale: 'en' | 'nl', key: string): string | undefined =>
  NEUTRAL[locale].find((e) => e.key === key)?.text;

describe('wheel selection interpretation (#415)', () => {
  it('shows nothing until something is selected', async () => {
    const container = await mount();
    expect(section(container)).toBeNull();
  });

  it('for a planet: the corpus text for its sign, its house and its aspects, under a labelled heading', async () => {
    const container = await mount();
    await click(container, '.chart-point[data-body="sun"]');

    expect(section(container)?.querySelector('h4')?.textContent).toBe(
      chartViewMessages.en.selectionInterpretationHeading,
    );
    const capricorn = entryText('en', 'planet-in-sign:sun:9');
    expect(capricorn).toBeDefined();
    expect(texts(container)).toContain(capricorn);
    expect(headings(container)).toContain('Sun — Capricorn');
  });

  it('shows the same text for each entry as the corpus holds, and none that belongs to another planet', async () => {
    const container = await mount();
    await click(container, '.chart-point[data-body="sun"]');
    const selection = parseSelectionKey('body:sun');
    if (selection === undefined) throw new Error('fixture bug');
    const expected = selectionPlacements(data, selection)
      .slice(0, SELECTION_TEXT_LIMIT)
      .map((item) => entryText('en', item.key) ?? composeFallbackText(item.placement, 'en'));
    expect(texts(container)).toEqual(expected);
  });

  it('collapses a long list to a few entries, with a control that shows all of them and back', async () => {
    const container = await mount();
    await click(container, '.chart-point[data-body="sun"]');
    const selection = parseSelectionKey('body:sun');
    if (selection === undefined) throw new Error('fixture bug');
    const total = selectionPlacements(data, selection).length;
    expect(total).toBeGreaterThan(SELECTION_TEXT_LIMIT);
    expect(texts(container)).toHaveLength(SELECTION_TEXT_LIMIT);

    const toggle = (): HTMLButtonElement => {
      const button = [...(section(container)?.querySelectorAll('button') ?? [])][0];
      if (button === undefined) throw new Error('no show-all control');
      return button;
    };
    expect(toggle().textContent).toBe(chartViewMessages.en.selectionShowAll(total));
    act(() => {
      toggle().click();
    });
    expect(texts(container)).toHaveLength(total);
    expect(toggle().textContent).toBe(chartViewMessages.en.selectionShowFewer);
    act(() => {
      toggle().click();
    });
    expect(texts(container)).toHaveLength(SELECTION_TEXT_LIMIT);
  });

  it('for a sign: the text of each planet in it', async () => {
    const container = await mount();
    await click(container, '.chart-sign[data-sign="libra"]');
    expect(texts(container)).toContain(entryText('en', 'planet-in-sign:moon:6'));
    expect(texts(container)).toContain(entryText('en', 'planet-in-sign:uranus:6'));
    expect(headings(container)).toContain('Moon — Libra');
  });

  it('for an aspect line: exactly that aspect’s entry', async () => {
    const container = await mount();
    const aspect = data.aspects[0];
    if (aspect === undefined) throw new Error('fixture bug: no aspects');
    const a = bodyById(aspect.bodyA)?.key ?? '';
    const b = bodyById(aspect.bodyB)?.key ?? '';
    await click(container, `.chart-aspect-link[data-aspect-body-a="${a}"][data-aspect-body-b="${b}"]`);
    const key = placementKey({ category: 'aspect-pair', aspect: aspect.aspect.key, bodyA: a, bodyB: b });
    const reverse = placementKey({ category: 'aspect-pair', aspect: aspect.aspect.key, bodyA: b, bodyB: a });
    const expected = entryText('en', key) ?? entryText('en', reverse);
    expect(texts(container)).toHaveLength(1);
    expect(texts(container)[0]).toBe(
      expected ?? composeFallbackText({ category: 'aspect-pair', aspect: aspect.aspect.key, bodyA: a, bodyB: b }, 'en'),
    );
  });

  it('reads in Dutch, from the Dutch corpus, when the locale is Dutch', async () => {
    const container = await mount('nl');
    await click(container, '.chart-point[data-body="sun"]');
    expect(section(container)?.querySelector('h4')?.textContent).toBe(
      chartViewMessages.nl.selectionInterpretationHeading,
    );
    expect(texts(container)).toContain(entryText('nl', 'planet-in-sign:sun:9'));
    expect(headings(container)).toContain('Zon — Steenbok');
  });

  it('falls back to the mechanical sentence for a placement the corpus has no entry for, never to nothing', async () => {
    corpusResponse = () => new Response(JSON.stringify([]), { status: 200 });
    const container = await mount();
    await click(container, '.chart-point[data-body="sun"]');
    const first = texts(container)[0];
    expect(first).toBeTruthy();
    expect(texts(container).every((text) => text.length > 0)).toBe(true);
    expect(texts(container)).toContain(composeFallbackText({ category: 'planet-in-sign', body: 'sun', sign: 9 }, 'en'));
  });

  it('says the text could not be loaded when the corpus cannot be fetched, and keeps the facts', async () => {
    corpusResponse = () => new Response('nope', { status: 500 });
    const container = await mount();
    await click(container, '.chart-point[data-body="sun"]');
    expect(section(container)?.textContent).toContain(chartViewMessages.en.selectionUnavailable);
    expect(container.querySelector('.chart-isolation-panel strong')?.textContent).toBe('Sun');
    expect(texts(container)).toEqual([]);
  });

  it('loads the corpus once, however many selections follow', async () => {
    const container = await mount();
    await click(container, '.chart-point[data-body="sun"]');
    await click(container, '.chart-point[data-body="moon"]');
    await click(container, '.chart-sign[data-sign="libra"]');
    const requestedUrls = vi.mocked(fetch).mock.calls.map(([input]) => {
      if (typeof input === 'string') return input;
      return input instanceof URL ? input.href : input.url;
    });
    const chunkFetches = requestedUrls.filter((url) => url.includes('/corpus/en/neutral.json')).length;
    expect(chunkFetches).toBe(1);
  });

  it('removes the interpretation when the selection is cleared', async () => {
    const container = await mount();
    await click(container, '.chart-point[data-body="sun"]');
    expect(section(container)).not.toBeNull();
    await click(container, '.chart-point[data-body="sun"]');
    expect(section(container)).toBeNull();
  });
});
