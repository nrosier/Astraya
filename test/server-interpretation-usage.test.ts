/**
 * `server/interpretation/usage.ts` (#360/#382): the Tier 2 cost ledger, both the two daily-cap
 * checks already in production use and the admin-only aggregations added for #382's cost
 * visibility. Against an in-memory `openDatabase(':memory:')`, same pattern as
 * `test/server-db.test.ts` — no Fastify app needed since these are plain functions over `Database`.
 */
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openDatabase, type Database } from '../server/db.ts';
import {
  recordUsage,
  userCostCentsSince,
  totalCostCentsSince,
  usageByUser,
  costCentsSinceByUser,
} from '../server/interpretation/usage.ts';

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

function record(
  db: Database,
  userId: string,
  params: { promptTokens: number; outputTokens: number; costCents: number },
): void {
  recordUsage(db, { userId, ...params });
}

describe('usageByUser (#382)', () => {
  it('returns an empty array when no usage has ever been recorded', () => {
    const db = openDatabase(':memory:');
    expect(usageByUser(db)).toEqual([]);
    db.close();
  });

  it('aggregates request count, tokens, and cost per user — not per row', () => {
    const db = openDatabase(':memory:');
    const alice = makeUser(db, 'alice');
    record(db, alice, { promptTokens: 100, outputTokens: 50, costCents: 1 });
    record(db, alice, { promptTokens: 200, outputTokens: 80, costCents: 2 });

    const [row] = usageByUser(db);
    expect(row).toMatchObject({
      userId: alice,
      username: 'alice',
      requestCount: 2,
      promptTokens: 300,
      outputTokens: 130,
      costCents: 3,
    });
    db.close();
  });

  it('excludes a user with zero usage rather than returning an all-zero row', () => {
    const db = openDatabase(':memory:');
    makeUser(db, 'never-used-tier-2');
    expect(usageByUser(db)).toEqual([]);
    db.close();
  });

  it('orders by total cost descending', () => {
    const db = openDatabase(':memory:');
    const bigSpender = makeUser(db, 'big-spender');
    const smallSpender = makeUser(db, 'small-spender');
    record(db, smallSpender, { promptTokens: 10, outputTokens: 10, costCents: 1 });
    record(db, bigSpender, { promptTokens: 10, outputTokens: 10, costCents: 50 });

    const rows = usageByUser(db);
    expect(rows.map((r) => r.username)).toEqual(['big-spender', 'small-spender']);
    db.close();
  });
});

describe('costCentsSinceByUser (#382)', () => {
  it('returns a map of only the users with usage inside the window', () => {
    const db = openDatabase(':memory:');
    const alice = makeUser(db, 'alice');
    const bob = makeUser(db, 'bob');
    record(db, alice, { promptTokens: 1, outputTokens: 1, costCents: 5 });
    record(db, bob, { promptTokens: 1, outputTokens: 1, costCents: 7 });

    const since = costCentsSinceByUser(db);
    expect(since.get(alice)).toBe(5);
    expect(since.get(bob)).toBe(7);
    expect(since.size).toBe(2);
    db.close();
  });

  it('does not include a user outside the requested window', () => {
    const db = openDatabase(':memory:');
    const alice = makeUser(db, 'alice');
    record(db, alice, { promptTokens: 1, outputTokens: 1, costCents: 5 });
    // created_at defaults to "now" inside recordUsage, so a window of 0 hours (since = now) should
    // exclude it — this exercises the same `created_at >= ?` boundary userCostCentsSince/
    // totalCostCentsSince already rely on, just from the per-user aggregation's own query.
    const since = costCentsSinceByUser(db, -1);
    expect(since.get(alice)).toBeUndefined();
    db.close();
  });
});

describe('userCostCentsSince / totalCostCentsSince (#360, pre-existing)', () => {
  it('sums only the given user’s cost, not every user’s', () => {
    const db = openDatabase(':memory:');
    const alice = makeUser(db, 'alice');
    const bob = makeUser(db, 'bob');
    record(db, alice, { promptTokens: 1, outputTokens: 1, costCents: 10 });
    record(db, bob, { promptTokens: 1, outputTokens: 1, costCents: 20 });

    expect(userCostCentsSince(db, alice)).toBe(10);
    expect(totalCostCentsSince(db)).toBe(30);
    db.close();
  });
});
