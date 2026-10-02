/**
 * `server/interpretation/results.ts` (#392): saved Tier 2 generations, encrypted at rest the
 * same way `ops.payload` is. Against an in-memory `openDatabase(':memory:')`, same pattern as
 * `test/server-interpretation-usage.test.ts` — no Fastify app needed since these are plain
 * functions over `Database`.
 */
import { describe, expect, it } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { openDatabase, type Database } from '../server/db.ts';
import {
  saveInterpretationResult,
  listInterpretationResults,
  getInterpretationResult,
} from '../server/interpretation/results.ts';
import type { Tier2Section } from '../server/interpretation/llm-client.ts';

function makeUser(db: Database, username: string): string {
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, 0, ?)').run(
    id,
    username,
    'irrelevant-hash',
    new Date().toISOString(),
  );
  return id;
}

const SECTIONS: readonly Tier2Section[] = [{ heading: 'Overview', body: 'A restyled interpretation.' }];

describe('saveInterpretationResult / getInterpretationResult (#392)', () => {
  it('round-trips the exact sections through encryption', () => {
    const db = openDatabase(':memory:');
    const key = randomBytes(32);
    const userId = makeUser(db, 'alice');

    const id = saveInterpretationResult(db, { userId, mode: 'grounded', locale: 'en', sections: SECTIONS }, key);
    const found = getInterpretationResult(db, userId, id, key);

    expect(found).toMatchObject({ id, mode: 'grounded', locale: 'en', sections: SECTIONS });
    expect(found?.createdAt).toBeTypeOf('string');
    db.close();
  });

  it('stores the ciphertext, not the plaintext, in the raw row', () => {
    const db = openDatabase(':memory:');
    const key = randomBytes(32);
    const userId = makeUser(db, 'alice');

    saveInterpretationResult(db, { userId, mode: 'grounded', locale: 'en', sections: SECTIONS }, key);

    const row = db.prepare('SELECT sections_json FROM interpretation_results').get() as { sections_json: Buffer };
    expect(row.sections_json.toString('utf8')).not.toContain('A restyled interpretation');
    db.close();
  });

  it('returns undefined for a result that belongs to a different user', () => {
    const db = openDatabase(':memory:');
    const key = randomBytes(32);
    const alice = makeUser(db, 'alice');
    const bob = makeUser(db, 'bob');

    const id = saveInterpretationResult(db, { userId: alice, mode: 'grounded', locale: 'en', sections: SECTIONS }, key);

    expect(getInterpretationResult(db, bob, id, key)).toBeUndefined();
    db.close();
  });

  it('returns undefined for an id that does not exist', () => {
    const db = openDatabase(':memory:');
    const key = randomBytes(32);
    const userId = makeUser(db, 'alice');

    expect(getInterpretationResult(db, userId, 'not-a-real-id', key)).toBeUndefined();
    db.close();
  });

  it('throws (fails closed) when decrypting with the wrong key, rather than returning garbage', () => {
    const db = openDatabase(':memory:');
    const userId = makeUser(db, 'alice');
    const id = saveInterpretationResult(
      db,
      { userId, mode: 'grounded', locale: 'en', sections: SECTIONS },
      randomBytes(32),
    );

    expect(() => getInterpretationResult(db, userId, id, randomBytes(32))).toThrow();
    db.close();
  });
});

describe('listInterpretationResults (#392)', () => {
  it('returns an empty array when the user has nothing saved', () => {
    const db = openDatabase(':memory:');
    const userId = makeUser(db, 'alice');
    expect(listInterpretationResults(db, userId)).toEqual([]);
    db.close();
  });

  it('lists only this user’s own results, metadata only (no sections)', () => {
    const db = openDatabase(':memory:');
    const key = randomBytes(32);
    const alice = makeUser(db, 'alice');
    const bob = makeUser(db, 'bob');

    const first = saveInterpretationResult(
      db,
      { userId: alice, mode: 'grounded', locale: 'en', sections: SECTIONS },
      key,
    );
    const second = saveInterpretationResult(
      db,
      { userId: alice, mode: 'synthesis', locale: 'nl', sections: SECTIONS },
      key,
    );
    saveInterpretationResult(db, { userId: bob, mode: 'grounded', locale: 'en', sections: SECTIONS }, key);

    const results = listInterpretationResults(db, alice);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toEqual(expect.arrayContaining([first, second]));
    expect(results.every((r) => !('sections' in r))).toBe(true);
  });
});
