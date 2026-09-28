/**
 * Regression coverage for `tools/corpus-gen/lib/write-corpus.mjs`'s
 * minimal-diff writer. Bootstrapping from a fresh `[]` used to corrupt the
 * file — `writeCorpus` assumed at least one existing entry to anchor its
 * "insert new entries before the closing bracket" logic on, so a zero-entry
 * array fell through to writing the appended entries in front of the whole
 * original `[]` text instead of inside it.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
// @ts-expect-error -- plain .mjs, no type declarations; cast to a known shape below.
import { writeCorpus as writeCorpusUntyped } from '../tools/corpus-gen/lib/write-corpus.mjs';

interface CorpusEntry {
  readonly key: string;
  readonly locale: string;
  readonly text: string;
  readonly tier: string;
  readonly tags: readonly string[];
}

const writeCorpus = writeCorpusUntyped as (path: string, corpus: readonly CorpusEntry[]) => Promise<void>;

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'astraya-write-corpus-'));
  path = join(dir, 'corpus.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const entryA = { key: 'planet-in-sign:sun:aries', locale: 'en', text: 'a', tier: 'core', tags: [] };
const entryB = { key: 'planet-in-sign:moon:taurus', locale: 'en', text: 'b', tier: 'core', tags: [] };

describe('writeCorpus', () => {
  test('bootstraps when the file does not exist on disk at all', async () => {
    await writeCorpus(path, [entryA, entryB]);

    const written = JSON.parse(await readFile(path, 'utf8')) as CorpusEntry[];
    expect(written).toEqual([entryA, entryB]);
  });

  test('bootstraps a fresh `[]` file with brand-new entries', async () => {
    await writeFile(path, '[]\n', 'utf8');

    await writeCorpus(path, [entryA, entryB]);

    const written = JSON.parse(await readFile(path, 'utf8')) as CorpusEntry[];
    expect(written).toEqual([entryA, entryB]);
  });

  test('bootstraps `[]` with zero entries back to an empty array', async () => {
    await writeFile(path, '[]\n', 'utf8');

    await writeCorpus(path, []);

    const written = JSON.parse(await readFile(path, 'utf8')) as CorpusEntry[];
    expect(written).toEqual([]);
  });

  test('still appends after existing entries (non-empty case unaffected)', async () => {
    await writeFile(path, '[]\n', 'utf8');
    await writeCorpus(path, [entryA]);

    await writeCorpus(path, [entryA, entryB]);

    const written = JSON.parse(await readFile(path, 'utf8')) as CorpusEntry[];
    expect(written).toEqual([entryA, entryB]);
  });

  test('still edits an existing entry in place', async () => {
    await writeFile(path, '[]\n', 'utf8');
    await writeCorpus(path, [entryA]);

    const editedA = { ...entryA, text: 'edited' };
    await writeCorpus(path, [editedA]);

    const written = JSON.parse(await readFile(path, 'utf8')) as CorpusEntry[];
    expect(written).toEqual([editedA]);
  });

  test('writes via a temp file and rename, leaving no stray temp file behind', async () => {
    await writeCorpus(path, [entryA]);
    await writeCorpus(path, [entryA, entryB]);

    const filesInDir = readdirSync(dir);
    expect(filesInDir).toEqual(['corpus.json']);
  });
});
