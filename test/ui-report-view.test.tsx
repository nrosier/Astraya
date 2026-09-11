// @vitest-environment jsdom
/**
 * A jsdom smoke test for `ReportView` (#62's language/advisor picker), in
 * the style of `ui-extended-settings-panel.test.tsx`: mount with
 * `createRoot`, interact with real DOM nodes, no React Testing Library.
 * `loadRuntimeCorpus`'s network call is stubbed via a fake `global.fetch`
 * rather than an injected `fetchImpl` — `ReportView` calls it with none,
 * same as production — so this also exercises the real corpus-client URL
 * shape (`/corpus/<locale>/<scope>.json`).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportView, PERSONA_LABELS } from '../src/ui/ReportView.js';
import { bodyByKey } from '../src/astrology/bodies.js';
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

function labeledSelect(container: HTMLElement, labelText: string): HTMLSelectElement {
  const label = Array.from(container.querySelectorAll('label')).find(
    (candidate) => candidate.querySelector('select') !== null && candidate.textContent.includes(labelText),
  );
  const select = label?.querySelector('select');
  if (!(select instanceof HTMLSelectElement)) throw new Error(`test fixture bug: no select labeled "${labelText}"`);
  return select;
}

async function mount(): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ReportView chart={makeChart()} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

describe('PERSONA_LABELS stays in sync with tools/corpus-gen/personas.json', () => {
  it('matches every persona title, in both locales', async () => {
    const personasPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'corpus-gen', 'personas.json');
    const raw = await readFile(personasPath, 'utf8');
    const personas = (JSON.parse(raw) as { personas: readonly { id: string; title: { en: string; nl: string } }[] })
      .personas;
    for (const persona of personas) {
      const labels = (PERSONA_LABELS as Record<string, Record<string, string>>)[persona.id];
      if (labels === undefined) throw new Error(`no PERSONA_LABELS entry for "${persona.id}"`);
      expect(labels.en).toBe(persona.title.en);
      expect(labels.nl).toBe(persona.title.nl);
    }
    expect(Object.keys(PERSONA_LABELS).sort()).toEqual(personas.map((p) => p.id).sort());
  });
});

describe('ReportView language/advisor picker', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn(
      () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }) as unknown as ReturnType<typeof fetch>,
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to English/Neutral and fetches only the neutral chunk', async () => {
    const { container, root } = await mount();

    const languageSelect = labeledSelect(container, 'Language');
    expect(languageSelect.value).toBe('en');
    const advisorSelect = labeledSelect(container, 'Advisor');
    expect(advisorSelect.value).toBe('');
    expect(Array.from(advisorSelect.options).map((o) => o.textContent)).toEqual([
      'Neutral',
      'The Strict Traditionalist',
      'The Cozy Cosmic Big Sister',
      'The Irreverent Cynic',
      'The Evolutionary Mystic',
      'The Pragmatic No-Nonsense Coach',
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/corpus/en/neutral.json');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('persists the chosen language to localStorage and re-fetches that locale', async () => {
    const { container, root } = await mount();
    const languageSelect = labeledSelect(container, 'Language');

    await act(async () => {
      languageSelect.value = 'nl';
      languageSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    expect(localStorage.getItem('astraya:reportLocale')).toBe('nl');
    expect(fetchMock).toHaveBeenCalledWith('/corpus/nl/neutral.json');
    // The advisor options relabel in the newly selected report language.
    const advisorSelect = labeledSelect(container, 'Advisor');
    expect(Array.from(advisorSelect.options).map((o) => o.textContent)).toContain('De Cynische Realist');

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('persists the chosen advisor to localStorage and fetches its persona chunk', async () => {
    const { container, root } = await mount();
    const advisorSelect = labeledSelect(container, 'Advisor');

    await act(async () => {
      advisorSelect.value = 'cynic';
      advisorSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    expect(localStorage.getItem('astraya:reportPersona')).toBe('cynic');
    expect(fetchMock).toHaveBeenCalledWith('/corpus/en/neutral.json');
    expect(fetchMock).toHaveBeenCalledWith('/corpus/en/cynic.json');

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('restores a previously chosen language and advisor from localStorage', async () => {
    localStorage.setItem('astraya:reportLocale', 'nl');
    localStorage.setItem('astraya:reportPersona', 'mystic');
    const { container, root } = await mount();

    expect(labeledSelect(container, 'Language').value).toBe('nl');
    expect(labeledSelect(container, 'Advisor').value).toBe('mystic');
    expect(fetchMock).toHaveBeenCalledWith('/corpus/nl/neutral.json');
    expect(fetchMock).toHaveBeenCalledWith('/corpus/nl/mystic.json');

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
