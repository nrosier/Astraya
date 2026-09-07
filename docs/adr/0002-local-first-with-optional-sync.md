# 2. Local-first storage with optional sync

- **Status:** accepted
- **Date:** 2026-09-07
- **Supersedes:** the earlier server-authoritative design, in which the backend
  owned people and charts in a relational schema and sign-in was required.

## Context

The application needs to hold birth data for many people and make it available
across a user's devices. Calculation is already entirely client-side, so the
question is only where the _data_ lives.

The original plan put a Fastify + SQLite backend in charge, with an account
required before any chart could be saved. That coupled authentication to the
domain model, the storage layer and the chart UI, and it made the app useless
without a network.

The requested alternative was the Actual Budget model: local data, syncing to a
backend. This turns out to fit unusually well, for reasons specific to this
domain:

- Calculation is already local, so offline mode loses nothing.
- The data is tiny. A person is a name, a date, a time, coordinates, a timezone
  and notes. **Charts are derived, never stored** — recomputed in milliseconds. Sync
  payloads are kilobytes.
- Writes are near-conflict-free. One user, records created once and rarely edited.

## Decision

The browser holds the authoritative copy, in IndexedDB, as an append-only
operation log. Sign-in and sync are **additive**: the local store is byte-identical
whether or not the user has an account.

- **IndexedDB, not SQLite-WASM.** We already ship 2.48 MB of WebAssembly for the
  ephemeris, and a few dozen records do not need SQL.
- **Field-level last-write-wins, ordered by hybrid logical clock — not CRDTs.**
  Actual needs CRDT machinery because budgets take concurrent numeric edits to
  shared cells. Astraea does not. Per-field LWW registers keyed by HLC converge
  deterministically in a fraction of the code. This is a considered simplification
  and is recorded in the module so nobody "upgrades" it without a reason.
- **The server is an opaque relay.** One table:
  `ops(user_id, seq, hlc, device_id, op_version, payload, received_at)`. It never
  interprets the domain model.

## Consequences

Good:

- Full functionality offline, as the normal mode rather than a degraded one.
- **A new domain field ships as a client release — no server migration, no server
  deploy.** This removes an entire class of coupling from every later milestone.
- Because payloads are opaque, end-to-end encryption can be added later with no
  protocol change.
- Anonymous use is genuinely private: nothing leaves the device, and that is the
  whole story rather than a promise about server conduct.

Costs, stated plainly:

- **IndexedDB eviction is a real data-loss vector.** For a user who never signs in,
  the browser holds the only copy, and browsers evict under storage pressure —
  Safari clears after a period of non-use. We call
  `navigator.storage.persist()` and must warn visibly when it is refused.
- **HLCs fix ordering, not a wrong clock.** A device whose clock is a year fast
  wins last-write-wins forever. The server stamps receive time and rejects
  implausible skew.
- **Operations must stay replayable forever.** Anything written today must remain
  interpretable by every future version, and operations carrying an unknown future
  version must be preserved rather than dropped.
- **Cross-account data bleed is the worst failure mode here** — signing in as a
  different account on a device that already holds another account's data. It gets
  its own issue and its own test.
- Encryption at rest with an env-supplied key defends a leaked database dump or
  backup. It does **not** defend host compromise, since key and data share a trust
  boundary. The key must be backed up separately from the database; a backup
  containing both is a backup with no encryption.

## Effect on sequencing

This reverses one earlier decision deliberately. Accounts had been moved early
specifically so the person model would not need retrofitting. Local-first removes
the coupling that made that necessary: authentication now gates neither the domain
model, nor storage, nor the UI. So the **person model stays early** (M3, without any
account) and **sign-in and sync become additive** (M8).

Two earlier plans are superseded outright: `localStorage` as the primary store, and
a relational server schema whose every domain change needed a migration.
