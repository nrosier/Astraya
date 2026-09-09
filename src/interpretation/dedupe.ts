/**
 * Corpus dedupe pass (#58): at the corpus's eventual full size — around 1200
 * entries once #56 has generated the long tail on top of #55's exemplars — the
 * failure mode a reader actually hits is not a wrong fact but prose that all
 * sounds the same. Two placements can be substantively different and still
 * read as copy-pasted if a generator (or a tired human) reused the same
 * sentence shape.
 *
 * Similarity is character-trigram Jaccard, not an embedding: it needs no
 * network call and no model, which keeps this pass usable from `src/` — see
 * `test/no-runtime-llm-access.test.ts` (#64) — and deterministic enough to
 * gate CI on. It is also a different signal from #57's `repetitive-openings`
 * rule: that catches entries that only *start* alike; this catches entries
 * that are substantially the same text throughout, wherever in the corpus
 * they fall.
 *
 * Comparison is scoped to entries in the same locale — an `en` entry and its
 * `nl` translation are supposed to say the same thing, so cross-locale
 * similarity would just flag every correctly-translated pair.
 */
import type { CorpusEntry, Locale } from './schema.js';

export interface DuplicatePair {
  readonly keyA: string;
  readonly keyB: string;
  readonly locale: Locale;
  /** Trigram Jaccard similarity, 0 (nothing shared) to 1 (identical trigram sets). */
  readonly similarity: number;
}

export interface SimilarityReport {
  readonly threshold: number;
  readonly pairs: readonly DuplicatePair[];
}

/**
 * Where "reads as copy-pasted" starts, picked as a starting point for #63's
 * review to tighten once there is a real corpus to tune it against — not a
 * fact derived from anything.
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.7;

function trigramsOf(text: string): Set<string> {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');
  const grams = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i += 1) {
    grams.add(normalized.slice(i, i + 3));
  }
  return grams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) {
    if (b.has(gram)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return intersection / union;
}

/**
 * Flags every pair of entries, within a locale, whose text is at or above
 * `threshold` similar. Quadratic in the size of each locale's entry list —
 * fine at corpus scale (low thousands), not something to run per keystroke.
 */
export function findNearDuplicates(
  entries: readonly CorpusEntry[],
  threshold = DEFAULT_SIMILARITY_THRESHOLD,
): SimilarityReport {
  const byLocale = new Map<Locale, CorpusEntry[]>();
  for (const entry of entries) {
    const group = byLocale.get(entry.locale) ?? [];
    group.push(entry);
    byLocale.set(entry.locale, group);
  }

  const pairs: DuplicatePair[] = [];
  for (const [locale, group] of byLocale) {
    const grams = group.map((entry) => trigramsOf(entry.text));
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = grams[i];
        const b = grams[j];
        const entryA = group[i];
        const entryB = group[j];
        if (a === undefined || b === undefined || entryA === undefined || entryB === undefined) continue;
        const similarity = jaccard(a, b);
        if (similarity >= threshold) {
          pairs.push({ keyA: entryA.key, keyB: entryB.key, locale, similarity });
        }
      }
    }
  }

  pairs.sort((left, right) => right.similarity - left.similarity);
  return { threshold, pairs };
}

/** Renders a report as plain text — the artefact #58 asks for, independent of how it's produced or stored. */
export function formatSimilarityReport(report: SimilarityReport): string {
  if (report.pairs.length === 0) {
    return `No near-duplicates found at similarity >= ${String(report.threshold)}.`;
  }
  const lines = report.pairs.map(
    (pair) => `${(pair.similarity * 100).toFixed(1)}%  [${pair.locale}]  ${pair.keyA}  <->  ${pair.keyB}`,
  );
  return [
    `${String(report.pairs.length)} near-duplicate pair(s) at similarity >= ${String(report.threshold)}:`,
    ...lines,
  ].join('\n');
}
