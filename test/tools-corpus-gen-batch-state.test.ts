/**
 * Regression coverage for `tools/corpus-gen/lib/batch-state.mjs`: the per-(script, locale)
 * record of batch jobs already in flight that lets evaluate-corpus-batch.mjs/
 * improve-corpus-batch.mjs submit-and-exit instead of blocking a terminal session for however
 * long OpenAI/Gemini's batch APIs take (up to 24h/48h respectively).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// prettier-ignore
// @ts-expect-error -- plain .mjs, no type declarations; cast to known shapes below.
import { readBatchState as readBatchStateUntyped, writeBatchState as writeBatchStateUntyped, clearBatchState as clearBatchStateUntyped } from '../tools/corpus-gen/lib/batch-state.mjs';

interface BatchStateFile {
  readonly jobs: readonly { readonly batchId: string; readonly submittedAt: string }[];
}

const readBatchState = readBatchStateUntyped as (path: string) => Promise<BatchStateFile | undefined>;
const writeBatchState = writeBatchStateUntyped as (path: string, state: BatchStateFile) => Promise<void>;
const clearBatchState = clearBatchStateUntyped as (path: string) => Promise<void>;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'batch-state-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readBatchState', () => {
  it('returns undefined when no state file exists yet', async () => {
    expect(await readBatchState(join(dir, 'nope.json'))).toBeUndefined();
  });

  it('reads back what writeBatchState wrote', async () => {
    const path = join(dir, 'evaluate-nl.json');
    const state = { jobs: [{ batchId: 'batch_123', submittedAt: '2026-10-01T00:00:00.000Z' }] };
    await writeBatchState(path, state);
    expect(await readBatchState(path)).toEqual(state);
  });

  it('creates the parent directory if it does not exist yet', async () => {
    const path = join(dir, 'nested', 'evaluate-nl.json');
    await writeBatchState(path, { jobs: [] });
    expect(await readBatchState(path)).toEqual({ jobs: [] });
  });
});

describe('clearBatchState', () => {
  it('removes an existing state file', async () => {
    const path = join(dir, 'evaluate-nl.json');
    await writeBatchState(path, { jobs: [] });
    await clearBatchState(path);
    expect(await readBatchState(path)).toBeUndefined();
  });

  it('is a no-op when the file does not exist', async () => {
    await expect(clearBatchState(join(dir, 'nope.json'))).resolves.toBeUndefined();
  });
});
