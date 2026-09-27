// @vitest-environment jsdom
/**
 * A jsdom smoke test for `CorpusOverridesPanel` (#292), in the style of
 * `ui-report-view.test.tsx`: mount with `createRoot`, interact with real DOM
 * nodes via a stubbed `global.fetch`, no React Testing Library. The fetch
 * stub is stateful (a small in-memory `overrides` array) so a save/reset
 * round-trip is visible the same way it would be against the real server.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorpusOverridesPanel } from '../src/ui/CorpusOverridesPanel.js';
import { corpusOverridesPanelMessages } from '../src/ui/CorpusOverridesPanel.messages.js';
import { setLocale } from '../src/ui/locale.js';

const NEUTRAL_ENTRY = {
  key: 'planet-in-sign:sun:0',
  locale: 'en',
  text: 'A neutral placement description.',
  tier: 'core',
  tags: ['sun'],
  provenance: { source: 'hand-written' },
};

const OTHER_ENTRY = {
  key: 'planet-in-sign:moon:1',
  locale: 'en',
  text: 'A different placement entirely.',
  tier: 'notable',
  tags: ['moon'],
  provenance: { source: 'hand-written' },
};

interface FakeOverride {
  readonly id: string;
  readonly key: string;
  readonly locale: string;
  readonly persona: string | undefined;
  readonly text: string;
  readonly tier: string;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly updatedByUserId: string;
  readonly updatedByUsername: string;
}

/**
 * React overrides the `value` property on a controlled input/textarea instance itself, so
 * setting `.value = ...` directly and dispatching `input` looks like "no change" to it. Going
 * through the prototype's original setter, the same trick React Testing Library's
 * `fireEvent`/`userEvent` use internally, makes the change visible to React's own tracking.
 */
function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function makeFetchMock(): { fetch: typeof fetch; overrides: FakeOverride[] } {
  const overrides: FakeOverride[] = [];
  let nextId = 1;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    await Promise.resolve();
    const url = urlOf(input);
    const method = init?.method ?? 'GET';

    if (url === '/corpus/en/neutral.json') return new Response(JSON.stringify([NEUTRAL_ENTRY, OTHER_ENTRY]));

    if (url.startsWith('/api/corpus-overrides/')) {
      return new Response(
        JSON.stringify({
          entries: overrides.map((o) => ({
            key: o.key,
            locale: o.locale,
            text: o.text,
            tier: o.tier,
            tags: o.tags,
            persona: o.persona,
            provenance: { source: 'hand-written' },
          })),
        }),
      );
    }

    if (url.startsWith('/api/admin/corpus-overrides') && method === 'GET') {
      return new Response(JSON.stringify({ overrides }));
    }

    if (url === '/api/admin/corpus-overrides' && method === 'PUT') {
      const body = JSON.parse(init?.body as string) as {
        key: string;
        locale: string;
        persona?: string;
        text: string;
        tier: string;
        tags: readonly string[];
      };
      const now = new Date().toISOString();
      const override: FakeOverride = {
        id: `ov-${String(nextId)}`,
        key: body.key,
        locale: body.locale,
        persona: body.persona,
        text: body.text,
        tier: body.tier,
        tags: body.tags,
        createdAt: now,
        updatedAt: now,
        updatedByUserId: 'u1',
        updatedByUsername: 'alice',
      };
      nextId += 1;
      const existing = overrides.findIndex((o) => o.key === body.key && o.persona === body.persona);
      if (existing === -1) overrides.push(override);
      else overrides[existing] = override;
      return new Response(JSON.stringify({ override }));
    }

    if (url.startsWith('/api/admin/corpus-overrides/') && method === 'DELETE') {
      const id = url.split('/').pop();
      const index = overrides.findIndex((o) => o.id === id);
      if (index !== -1) overrides.splice(index, 1);
      return new Response(JSON.stringify({ ok: true }));
    }

    return new Response('not found', { status: 404 });
  });

  return { fetch: fetchMock, overrides };
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent === text);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`test fixture bug: no button with text "${text}"`);
  return button;
}

function searchInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('.field-grid input[type="text"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('test fixture bug: no search input');
  return input;
}

function tableRows(container: HTMLElement): readonly HTMLTableRowElement[] {
  return Array.from(container.querySelectorAll('.data-table tbody tr'));
}

/**
 * `loadRuntimeCorpus` appends overridden entries at the end of the merged array rather than
 * keeping their original position, so a row's index shifts once it has an override — find it
 * by its key's own cell instead of assuming a position.
 */
function editButtonForKey(container: HTMLElement, key: string): HTMLButtonElement {
  const row = tableRows(container).find((candidate) => candidate.querySelector('td')?.textContent === key);
  const button = row?.querySelector('td.actions button');
  if (!(button instanceof HTMLButtonElement)) throw new Error(`test fixture bug: no edit button for row "${key}"`);
  return button;
}

/**
 * Flushes both microtasks and the next macrotask turn — needed after an action that chains
 * several fetches (e.g. reset: delete, then reload the corpus and the override list), where a
 * fixed number of bare `await Promise.resolve()` ticks isn't reliably enough.
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mount(): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<CorpusOverridesPanel />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

describe('CorpusOverridesPanel (#292)', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    setLocale('en');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup?.();
    cleanup = undefined;
  });

  it('lists corpus entries and narrows them with the search box', async () => {
    const { fetch: fetchMock } = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const { container, root } = await mount();
    cleanup = () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    };

    expect(tableRows(container)).toHaveLength(2);

    await act(async () => {
      setNativeValue(searchInput(container), 'moon');
      await Promise.resolve();
    });

    const rows = tableRows(container);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('planet-in-sign:moon:1');
  });

  it('editing and saving a correction marks the entry Overridden', async () => {
    const { fetch: fetchMock } = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const { container, root } = await mount();
    cleanup = () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    };

    const t = corpusOverridesPanelMessages.en;

    await act(async () => {
      editButtonForKey(container, NEUTRAL_ENTRY.key).click();
      await Promise.resolve();
    });

    const textarea = container.querySelector('textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('test fixture bug: no textarea in edit form');

    await act(async () => {
      setNativeValue(textarea, 'A corrected description.');
      await Promise.resolve();
    });

    await act(async () => {
      findButton(container, t.saveButton).click();
      await flush();
    });

    const rows = tableRows(container);
    expect(rows.some((row) => row.textContent.includes(t.overriddenStatus))).toBe(true);
    expect(rows.some((row) => row.textContent.includes('A corrected description.'))).toBe(true);
  });

  it('resetting a correction reverts it to the corpus default', async () => {
    const { fetch: fetchMock, overrides } = makeFetchMock();
    overrides.push({
      id: 'ov-existing',
      key: NEUTRAL_ENTRY.key,
      locale: 'en',
      persona: undefined,
      text: 'A corrected description.',
      tier: 'core',
      tags: ['sun'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedByUserId: 'u1',
      updatedByUsername: 'alice',
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container, root } = await mount();
    cleanup = () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    };

    const t = corpusOverridesPanelMessages.en;
    expect(tableRows(container).some((row) => row.textContent.includes(t.overriddenStatus))).toBe(true);

    await act(async () => {
      editButtonForKey(container, NEUTRAL_ENTRY.key).click();
      await Promise.resolve();
    });

    await act(async () => {
      findButton(container, t.resetButton).click();
      await Promise.resolve();
    });

    await act(async () => {
      findButton(container, t.resetPermanentlyButton).click();
      await flush();
    });

    expect(overrides).toHaveLength(0);
    expect(tableRows(container).every((row) => !row.textContent.includes(t.overriddenStatus))).toBe(true);
  });
});
