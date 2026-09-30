/**
 * Persistence for benchmark-batch.mjs (#368 Part 3): what's already been
 * checked, and its score, so a re-run doesn't re-spend a Laya call (or an
 * astrologyapi.com call) on a placement that's already been verified unless
 * `--force` is passed.
 *
 * `node:sqlite`'s `DatabaseSync` — the same library `server/db.ts` already
 * uses (ships with Node, no new dependency) — but deliberately without that
 * file's migration-array/`PRAGMA user_version` machinery: this is a single
 * throwaway dev cache with a couple of tables, not a production database
 * with a history of shipped schemas to carry forward. If a table's shape
 * needs to change, deleting the file and letting it get recreated is the
 * expected fix, not a migration.
 *
 * Two tables, two different rules about third-party prose:
 *
 * - `benchmark_results` — no column holds astrologyapi.com's own prose,
 *   full stop. This is the durable, dashboard-facing history; #368's own
 *   no-redistribution constraint applies to it exactly as it applies to
 *   benchmark-batch.mjs's text report.
 * - `thirdparty_cache` — a deliberate, scoped exception, added on the
 *   user's own explicit request: while actively iterating on the judge
 *   itself (adding `all-minilm`, tuning thresholds, etc.), re-fetching the
 *   same placement's astrologyapi.com report on every run wastes real money
 *   and rate-limit budget for no reason. This table caches the raw response
 *   + extracted text per placement so a re-run can reuse it. Still
 *   local-only and gitignored (same `.data/` directory as everything else
 *   here), and the user's own instruction was explicit that this is
 *   temporary: `purgeThirdPartyCache()` (wired to `benchmark-batch.mjs
 *   --purge-thirdparty-cache`) is meant to be run once the judge itself is
 *   "solved and grounded" — not left running forever.
 *
 *   Second, later, equally explicit exception: `benchmark-dashboard.mjs`
 *   now reads this cache too, to show the third-party text next to
 *   Astraya's own in a per-row detail view — the user's own request, so
 *   they can actually read and compare the two, not just trust a score. The
 *   "never shown" half of #368's no-redistribution constraint bends here on
 *   purpose: the dashboard is a local, gitignored file, never committed and
 *   never reachable by an actual Astraya end user, which is the harm that
 *   constraint was written to prevent. The "never committed" and "never in
 *   the corpus" halves are untouched — `benchmark_results` itself still has
 *   no column for this text, and neither table is ever written to src/ or
 *   git.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` in sqlite, so a column added after this
 * table already exists on someone's machine (as `similarity_score` was, after `preference`) needs
 * this guard rather than erroring on every second run. Still no migrations array — this stays a
 * single throwaway dev cache, just one that doesn't force a wipe over a column addition. */
function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function openBenchmarkDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS benchmark_results (
      placement_key TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      facts TEXT NOT NULL,
      astraya_text TEXT NOT NULL,
      astraya_source TEXT NOT NULL,
      astraya_model TEXT,
      grounded_astraya REAL,
      grounded_thirdparty REAL,
      grounded_astraya_embedding REAL,
      grounded_thirdparty_embedding REAL,
      preference TEXT,
      preference_astraya_prob REAL,
      preference_thirdparty_prob REAL,
      similarity_score REAL,
      similarity_label TEXT,
      embedding_similarity REAL,
      embedding_model TEXT,
      grounded_astraya_llm REAL,
      grounded_thirdparty_llm REAL,
      similarity_score_llm REAL,
      similarity_label_llm TEXT,
      llm_model TEXT,
      skipped INTEGER NOT NULL DEFAULT 0,
      skip_reason TEXT,
      checked_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS thirdparty_cache (
      placement_key TEXT PRIMARY KEY,
      raw_json TEXT,
      extracted_text TEXT,
      fetched_at TEXT NOT NULL
    );
  `);
  ensureColumn(db, 'benchmark_results', 'similarity_score', 'REAL');
  ensureColumn(db, 'benchmark_results', 'similarity_label', 'TEXT');
  ensureColumn(db, 'benchmark_results', 'embedding_similarity', 'REAL');
  ensureColumn(db, 'benchmark_results', 'embedding_model', 'TEXT');
  ensureColumn(db, 'benchmark_results', 'astraya_model', 'TEXT');
  ensureColumn(db, 'benchmark_results', 'grounded_astraya_embedding', 'REAL');
  ensureColumn(db, 'benchmark_results', 'grounded_thirdparty_embedding', 'REAL');
  ensureColumn(db, 'benchmark_results', 'grounded_astraya_llm', 'REAL');
  ensureColumn(db, 'benchmark_results', 'grounded_thirdparty_llm', 'REAL');
  ensureColumn(db, 'benchmark_results', 'similarity_score_llm', 'REAL');
  ensureColumn(db, 'benchmark_results', 'similarity_label_llm', 'TEXT');
  ensureColumn(db, 'benchmark_results', 'llm_model', 'TEXT');
  return db;
}

export function getResult(db, placementKey) {
  const row = db.prepare('SELECT * FROM benchmark_results WHERE placement_key = ?').get(placementKey);
  return row ?? undefined;
}

export function upsertResult(db, row) {
  db.prepare(
    `INSERT INTO benchmark_results (
       placement_key, category, facts, astraya_text, astraya_source, astraya_model,
       grounded_astraya, grounded_thirdparty,
       grounded_astraya_embedding, grounded_thirdparty_embedding,
       preference, preference_astraya_prob, preference_thirdparty_prob,
       similarity_score, similarity_label,
       embedding_similarity, embedding_model,
       grounded_astraya_llm, grounded_thirdparty_llm, similarity_score_llm, similarity_label_llm, llm_model,
       skipped, skip_reason, checked_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (placement_key) DO UPDATE SET
       category = excluded.category,
       facts = excluded.facts,
       astraya_text = excluded.astraya_text,
       astraya_source = excluded.astraya_source,
       astraya_model = excluded.astraya_model,
       grounded_astraya = excluded.grounded_astraya,
       grounded_thirdparty = excluded.grounded_thirdparty,
       grounded_astraya_embedding = excluded.grounded_astraya_embedding,
       grounded_thirdparty_embedding = excluded.grounded_thirdparty_embedding,
       preference = excluded.preference,
       preference_astraya_prob = excluded.preference_astraya_prob,
       preference_thirdparty_prob = excluded.preference_thirdparty_prob,
       similarity_score = excluded.similarity_score,
       similarity_label = excluded.similarity_label,
       embedding_similarity = excluded.embedding_similarity,
       embedding_model = excluded.embedding_model,
       grounded_astraya_llm = excluded.grounded_astraya_llm,
       grounded_thirdparty_llm = excluded.grounded_thirdparty_llm,
       similarity_score_llm = excluded.similarity_score_llm,
       similarity_label_llm = excluded.similarity_label_llm,
       llm_model = excluded.llm_model,
       skipped = excluded.skipped,
       skip_reason = excluded.skip_reason,
       checked_at = excluded.checked_at`,
  ).run(
    row.placementKey,
    row.category,
    row.facts,
    row.astrayaText,
    row.astrayaSource,
    row.astrayaModel ?? null,
    row.groundedAstraya ?? null,
    row.groundedThirdparty ?? null,
    row.groundedAstrayaEmbedding ?? null,
    row.groundedThirdpartyEmbedding ?? null,
    row.preference ?? null,
    row.preferenceAstrayaProb ?? null,
    row.preferenceThirdpartyProb ?? null,
    row.similarityScore ?? null,
    row.similarityLabel ?? null,
    row.embeddingSimilarity ?? null,
    row.embeddingModel ?? null,
    row.groundedAstrayaLlm ?? null,
    row.groundedThirdpartyLlm ?? null,
    row.similarityScoreLlm ?? null,
    row.similarityLabelLlm ?? null,
    row.llmModel ?? null,
    row.skipped ? 1 : 0,
    row.skipReason ?? null,
    row.checkedAt,
  );
}

export function allResults(db) {
  return db.prepare('SELECT * FROM benchmark_results ORDER BY checked_at DESC').all();
}

/** For `benchmark-dashboard.mjs`'s per-row detail view only (see this file's own doc comment for
 * the scoped exception that makes that read acceptable) — every cached extracted third-party text,
 * keyed by placement, so the dashboard can look one up without a query per row. */
export function allCachedThirdPartyText(db) {
  const rows = db.prepare('SELECT placement_key, extracted_text FROM thirdparty_cache').all();
  return new Map(rows.map((r) => [r.placement_key, r.extracted_text]));
}

/** Temporary cache of astrologyapi.com's own fetched report for a placement — see this file's own
 * doc comment for why this table exists and why it must stay separate from `benchmark_results`. */
export function getCachedThirdParty(db, placementKey) {
  const row = db.prepare('SELECT * FROM thirdparty_cache WHERE placement_key = ?').get(placementKey);
  return row ?? undefined;
}

export function cacheThirdParty(db, placementKey, { rawJson, extractedText }) {
  db.prepare(
    `INSERT INTO thirdparty_cache (placement_key, raw_json, extracted_text, fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (placement_key) DO UPDATE SET raw_json = excluded.raw_json, extracted_text = excluded.extracted_text, fetched_at = excluded.fetched_at`,
  ).run(placementKey, rawJson ?? null, extractedText ?? null, new Date().toISOString());
}

/** Deletes every cached astrologyapi.com response — meant to be run once the judge itself (Laya
 * thresholds, the `all-minilm` cross-check, the extraction heuristics) is "solved and grounded",
 * per the user's own instruction that this cache is temporary, not a permanent store. */
export function purgeThirdPartyCache(db) {
  const countBefore = db.prepare('SELECT COUNT(*) AS n FROM thirdparty_cache').get().n;
  db.exec('DELETE FROM thirdparty_cache');
  return countBefore;
}
