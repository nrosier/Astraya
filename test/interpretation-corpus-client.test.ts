/**
 * Tests for runtime corpus loading (#212): the browser-side counterpart to
 * `index.ts`'s synchronous, whole-corpus `CORPUS` export.
 */
import { describe, expect, it, vi } from 'vitest';
import { CORPUS_BASE_URL, loadRuntimeCorpus } from '../src/interpretation/corpus-client.js';
import type { CorpusEntry } from '../src/interpretation/schema.js';

const NEUTRAL_ENTRY: CorpusEntry = {
  key: 'planet-in-sign:sun:0',
  locale: 'en',
  text: 'Neutral text.',
  tier: 'core',
  tags: [],
  provenance: { source: 'hand-written' },
};

const MYSTIC_ENTRY: CorpusEntry = {
  ...NEUTRAL_ENTRY,
  text: 'Mystic text.',
  persona: 'mystic',
};

function fakeFetch(byUrl: ReadonlyMap<string, readonly CorpusEntry[]>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = byUrl.get(url);
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body));
  });
}

describe('loadRuntimeCorpus (#212)', () => {
  it('fetches just the neutral chunk when no persona is given', async () => {
    const fetchImpl = fakeFetch(new Map([[`${CORPUS_BASE_URL}en/neutral.json`, [NEUTRAL_ENTRY]]]));

    const result = await loadRuntimeCorpus('en', undefined, fetchImpl);

    expect(result).toEqual([NEUTRAL_ENTRY]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fetches the neutral chunk and the persona chunk, concatenated', async () => {
    const fetchImpl = fakeFetch(
      new Map([
        [`${CORPUS_BASE_URL}en/neutral.json`, [NEUTRAL_ENTRY]],
        [`${CORPUS_BASE_URL}en/mystic.json`, [MYSTIC_ENTRY]],
      ]),
    );

    const result = await loadRuntimeCorpus('en', 'mystic', fetchImpl);

    expect(result).toEqual([NEUTRAL_ENTRY, MYSTIC_ENTRY]);
  });

  it('scopes chunk URLs to the requested locale', async () => {
    const fetchImpl = fakeFetch(new Map([[`${CORPUS_BASE_URL}nl/neutral.json`, [NEUTRAL_ENTRY]]]));

    await loadRuntimeCorpus('nl', undefined, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(`${CORPUS_BASE_URL}nl/neutral.json`);
  });

  it('throws, naming the failed chunk, rather than silently returning partial text', async () => {
    const fetchImpl = fakeFetch(new Map([[`${CORPUS_BASE_URL}en/neutral.json`, [NEUTRAL_ENTRY]]]));

    await expect(loadRuntimeCorpus('en', 'mystic', fetchImpl)).rejects.toThrow(/en\/mystic\.json/);
  });
});
