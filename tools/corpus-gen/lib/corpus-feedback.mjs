/**
 * Per-locale feedback file read/write for #381's two-stage loop: evaluate-corpus-batch.mjs
 * writes to this file, improve-corpus-batch.mjs reads from it. A plain JSON array, not keyed by
 * an object map, so it stays simple to inspect by hand (`jq`, a text editor) between the two
 * stages — this is meant to be a legible artifact, not just internal plumbing.
 *
 * Identity is `(key, persona)`, matching the corpus's own dedupe identity (schema.ts/loader.ts):
 * a neutral and a persona-specific entry for the same placement are tracked separately.
 * `upsertFeedback` replaces an existing record for the same identity rather than duplicating it,
 * so re-running evaluate-corpus-batch.mjs after a prior pass updates stale feedback instead of
 * piling up repeats.
 */
import { readFile, writeFile } from 'node:fs/promises';

function sameIdentity(a, b) {
  return a.key === b.key && (a.persona ?? 'neutral') === (b.persona ?? 'neutral');
}

/** Reads a locale's feedback file, or an empty array if it doesn't exist yet. */
export async function readFeedback(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** Writes a locale's feedback array back to its file, pretty-printed so a human can read it directly. */
export async function writeFeedback(path, feedback) {
  await writeFile(path, `${JSON.stringify(feedback, null, 2)}\n`, 'utf8');
}

/** Mutates `feedback` in place: replaces the existing record for this (key, persona), or appends. */
export function upsertFeedback(feedback, record) {
  const index = feedback.findIndex((existing) => sameIdentity(existing, record));
  if (index === -1) feedback.push(record);
  else feedback[index] = record;
}

/** Removes the record for this (key, persona), if present. Used by improve-corpus-batch.mjs once a record has been acted on. */
export function removeFeedback(feedback, identity) {
  const index = feedback.findIndex((existing) => sameIdentity(existing, identity));
  if (index !== -1) feedback.splice(index, 1);
}
