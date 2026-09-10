/**
 * Runtime corpus loading for the browser, as a small counterpart to
 * `index.ts`'s synchronous `CORPUS` export.
 *
 * `index.ts` statically imports the full committed corpus (both locales,
 * every persona) so the interpretation test suite and `loadCorpus`'s en/nl
 * parity check can validate it — that must stay a synchronous, whole-corpus
 * value for those to work. But a browser client only ever needs one
 * locale's neutral text plus, at most, one persona's flavor of it, and
 * Vite inlines whatever `index.ts` imports into the JS bundle regardless —
 * so `ReportView.tsx` fetches a chunk through this module instead of
 * importing `CORPUS` at all.
 *
 * The chunks this fetches are written by scripts/split-corpus.mjs into
 * public/corpus/<locale>/<scope>.json — build output, gitignored, generated
 * before `dev`/`build` the same way public/ephe/ is (see that script's own
 * comment). `CORPUS_BASE_URL` mirrors `EPHE_BASE_URL`
 * (src/ephemeris/assets.ts) and `fetchImpl` is injectable for the same
 * reason `warmEphemerisCache` (src/pwa/warm.ts) takes one: testability
 * without a real network.
 */
import type { CorpusEntry, Locale, PersonaId } from './schema.js';

export const CORPUS_BASE_URL = '/corpus/';

async function fetchChunk(locale: Locale, scope: string, fetchImpl: typeof fetch): Promise<readonly CorpusEntry[]> {
  const url = `${CORPUS_BASE_URL}${locale}/${scope}.json`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(
      `Failed to load the interpretation corpus: ${locale}/${scope}.json (HTTP ${String(response.status)})`,
    );
  }
  return (await response.json()) as readonly CorpusEntry[];
}

/**
 * The corpus slice a report for `locale`/`persona` needs: the neutral chunk
 * every placement can fall back to, plus (when given) that persona's chunk
 * layered on top — matching `findCorpusEntry`'s own persona-then-neutral
 * preference, so the concatenation order here doesn't matter to it.
 */
export async function loadRuntimeCorpus(
  locale: Locale,
  persona?: PersonaId,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly CorpusEntry[]> {
  const chunks = await Promise.all([
    fetchChunk(locale, 'neutral', fetchImpl),
    ...(persona !== undefined ? [fetchChunk(locale, persona, fetchImpl)] : []),
  ]);
  return chunks.flat();
}
