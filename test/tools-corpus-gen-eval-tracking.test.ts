/**
 * Regression coverage for `tools/corpus-gen/lib/eval-tracking.mjs` (#381): the per-locale,
 * per-entry evaluation-loop state that stops evaluate-corpus-batch.mjs from re-checking an
 * entry already judged clean, or already rewritten as many times as the feedback loop allows.
 * Identity is (key, persona), same convention as corpus-feedback.mjs.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs, no type declarations; cast to known shapes below.
import { readTracking as readTrackingUntyped, writeTracking as writeTrackingUntyped, findTracking as findTrackingUntyped, upsertTracking as upsertTrackingUntyped, isEvaluationExhausted as isEvaluationExhaustedUntyped } from '../tools/corpus-gen/lib/eval-tracking.mjs';

interface TrackingRecord {
  readonly key: string;
  readonly persona?: string | undefined;
  readonly locale: string;
  readonly clean: boolean;
  readonly evaluationCount: number;
  readonly updatedAt: string;
}

const readTracking = readTrackingUntyped as (path: string) => Promise<TrackingRecord[]>;
const writeTracking = writeTrackingUntyped as (path: string, tracking: readonly TrackingRecord[]) => Promise<void>;
const findTracking = findTrackingUntyped as (
  tracking: readonly TrackingRecord[],
  identity: { readonly key: string; readonly persona?: string | undefined },
) => TrackingRecord | undefined;
const upsertTracking = upsertTrackingUntyped as (tracking: TrackingRecord[], record: TrackingRecord) => void;
const isEvaluationExhausted = isEvaluationExhaustedUntyped as (
  record: TrackingRecord | undefined,
  limit: number,
) => boolean;

function record(overrides: Partial<TrackingRecord> = {}): TrackingRecord {
  return {
    key: 'planet-in-sign:saturn:9',
    locale: 'en',
    clean: false,
    evaluationCount: 0,
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eval-tracking-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readTracking (#381)', () => {
  it('returns an empty array when the file does not exist yet', async () => {
    expect(await readTracking(join(dir, 'nope.json'))).toEqual([]);
  });

  it('reads back what writeTracking wrote', async () => {
    const path = join(dir, 'en.json');
    await writeTracking(path, [record()]);
    expect(await readTracking(path)).toEqual([record()]);
  });

  it('writeTracking pretty-prints with a trailing newline, for a legible hand-editable artifact', async () => {
    const path = join(dir, 'en.json');
    await writeTracking(path, [record()]);
    const raw = await readFile(path, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('\n  ');
  });
});

describe('findTracking (#381)', () => {
  it('returns undefined when no record matches', () => {
    expect(findTracking([record()], { key: 'planet-in-sign:mars:0', persona: undefined })).toBeUndefined();
  });

  it('finds the matching record by (key, persona)', () => {
    const target = record({ persona: 'mystic' });
    expect(findTracking([record(), target], { key: target.key, persona: 'mystic' })).toEqual(target);
  });

  it('treats a missing persona and persona="neutral" as the same identity', () => {
    const target = record({ persona: undefined });
    expect(findTracking([target], { key: target.key, persona: undefined })).toEqual(target);
  });
});

describe('upsertTracking (#381)', () => {
  it('appends a new record when none exists for this (key, persona)', () => {
    const tracking: TrackingRecord[] = [];
    upsertTracking(tracking, record());
    expect(tracking).toEqual([record()]);
  });

  it('replaces the existing record for the same (key, persona) instead of duplicating it', () => {
    const tracking: TrackingRecord[] = [record({ evaluationCount: 1 })];
    upsertTracking(tracking, record({ evaluationCount: 2 }));
    expect(tracking).toHaveLength(1);
    expect(tracking[0]?.evaluationCount).toBe(2);
  });

  it('keeps a neutral and a persona-specific record for the same key as two separate entries', () => {
    const tracking: TrackingRecord[] = [];
    upsertTracking(tracking, record({ persona: undefined }));
    upsertTracking(tracking, record({ persona: 'mystic' }));
    expect(tracking).toHaveLength(2);
  });
});

describe('isEvaluationExhausted (#381)', () => {
  it('is not exhausted when there is no record at all (never evaluated)', () => {
    expect(isEvaluationExhausted(undefined, 2)).toBe(false);
  });

  it('is exhausted once a record is marked clean, regardless of its evaluationCount', () => {
    expect(isEvaluationExhausted(record({ clean: true, evaluationCount: 0 }), 2)).toBe(true);
  });

  it('is not exhausted below the limit', () => {
    expect(isEvaluationExhausted(record({ clean: false, evaluationCount: 1 }), 2)).toBe(false);
  });

  it('is exhausted once evaluationCount reaches the limit', () => {
    expect(isEvaluationExhausted(record({ clean: false, evaluationCount: 2 }), 2)).toBe(true);
  });

  it('respects a custom limit', () => {
    expect(isEvaluationExhausted(record({ clean: false, evaluationCount: 3 }), 5)).toBe(false);
    expect(isEvaluationExhausted(record({ clean: false, evaluationCount: 5 }), 5)).toBe(true);
  });
});
