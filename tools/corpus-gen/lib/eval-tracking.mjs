/**
 * Per-locale, per-entry evaluation-loop state for #381: without this, every run of
 * evaluate-corpus-batch.mjs re-checks the entire corpus from scratch, re-paying for (and
 * re-flagging) entries already judged clean in a prior pass. A plain JSON array, mirroring
 * corpus-feedback.mjs's own shape/identity convention, so it stays legible to inspect by hand
 * between runs.
 *
 * Two independent reasons an entry stops being re-evaluated:
 * - `clean: true` — either evaluate-corpus-batch.mjs's own judge said this entry is correct, or
 *   improve-corpus-batch.mjs's judge reviewed a flagged entry and decided no rewrite was
 *   warranted (`UNCHANGED`) — the latter is treated as equally resolved, not as "still flagged."
 * - `evaluationCount >= limit` — the entry has been rewritten (`IMPROVED`) as many times as the
 *   feedback loop is allowed to run (default 2, see evaluate-corpus-batch.mjs's
 *   `--evaluation-limit`), so it stops being re-queued even though it was never judged clean.
 *
 * `evaluationCount` only increments on an actual rewrite (`IMPROVED`), not on every evaluation —
 * a flagged-then-left-unchanged entry becomes `clean` instead, which already stops
 * re-evaluation on its own; counting that path too would double up two independent stop
 * conditions for no benefit.
 */
import { readFile, writeFile } from 'node:fs/promises';

function sameIdentity(a, b) {
  return a.key === b.key && (a.persona ?? 'neutral') === (b.persona ?? 'neutral');
}

/** Reads a locale's tracking file, or an empty array if it doesn't exist yet. */
export async function readTracking(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** Writes a locale's tracking array back to its file, pretty-printed so a human can read it directly. */
export async function writeTracking(path, tracking) {
  await writeFile(path, `${JSON.stringify(tracking, null, 2)}\n`, 'utf8');
}

/** Finds the existing record for this (key, persona), or `undefined` if this entry has never been tracked. */
export function findTracking(tracking, identity) {
  return tracking.find((existing) => sameIdentity(existing, identity));
}

/** Mutates `tracking` in place: replaces the existing record for this (key, persona), or appends. */
export function upsertTracking(tracking, record) {
  const index = tracking.findIndex((existing) => sameIdentity(existing, record));
  if (index === -1) tracking.push(record);
  else tracking[index] = record;
}

/** True once an entry no longer needs re-evaluation — already judged clean, or out of feedback-loop iterations. */
export function isEvaluationExhausted(record, limit) {
  if (record === undefined) return false;
  return record.clean || record.evaluationCount >= limit;
}
