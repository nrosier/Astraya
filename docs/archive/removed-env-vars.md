# Archive: removed environment variables

Append-only record of environment variables that were once documented in `.env.example` (or read
by the code) and have since been removed entirely — kept here, not just in `git log`, so that
testing, running, or reviewing an **older tagged version** doesn't leave you wondering what a var
you see in that old checkout's `.env.example` was for. See #397.

Each entry: the variable, what it did, why it was removed, and roughly when.

## `GEMINI_BATCH_SIZE`

- **Purpose**: documented as "fragments per request" for `tools/corpus-gen/`'s Gemini-backed
  corpus generation — how many entries to request in a single non-batch-API call.
- **Why removed**: dead. No code ever read this variable; `generate-batch.mjs` controls batching
  through its own `--concurrency`/`--delay-ms` CLI flags and the separate `--batch` mode (the
  real Gemini Batch API), not an env var. Likely left behind from an earlier version of the
  generator before those flags existed.
- **Removed**: 2026-10-02 (#397).

## `GEMINI_MAX_CONCURRENCY`

- **Purpose**: documented as a cap on concurrent in-flight requests to Gemini during corpus
  generation.
- **Why removed**: dead, same situation as `GEMINI_BATCH_SIZE` above — superseded by
  `generate-batch.mjs`'s own `--concurrency` CLI flag (default `3`), never read from the
  environment.
- **Removed**: 2026-10-02 (#397).
