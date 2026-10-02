/**
 * Persists "there is a batch job in flight" across separate process invocations, so
 * evaluate-corpus-batch.mjs / improve-corpus-batch.mjs never have to block a terminal session for
 * however long a provider's batch takes (OpenAI documents up to 24h, Gemini up to its own 48h
 * hard expiry) — submit and exit immediately; a later run of the same script checks the job's
 * real status once and, if it's done, retrieves and applies the results, instead of resubmitting
 * a duplicate job or sitting in a blocking poll loop.
 *
 * One state file per (script, locale) pair, under tools/corpus-gen/batch-state/ — a scratch
 * directory, same convention as eval-tracking/ and feedback/, not committed.
 */
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readBatchState(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function writeBatchState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function clearBatchState(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
