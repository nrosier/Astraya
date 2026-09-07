# 1. Swiss Ephemeris as the calculation engine

- **Status:** accepted
- **Date:** 2026-09-07

## Context

Astraea's premise is that the numbers are right. That makes the ephemeris the
single most consequential dependency in the project, and it constrains the
licence of everything else.

Two candidates were evaluated by inspection rather than reputation:

|                                       | `astronomy-engine` | Swiss Ephemeris (`sweph-wasm`)              |
| ------------------------------------- | ------------------ | ------------------------------------------- |
| Licence                               | MIT                | AGPL-3.0 **or** commercial (Astrodienst AG) |
| Positional accuracy                   | arcminute-ish      | arcsecond, from JPL DE431                   |
| House systems                         | **none**           | ~23                                         |
| Ayanamsas                             | **none**           | 48                                          |
| Asteroids, fixed stars, nodes/apsides | no                 | yes                                         |

`astronomy-engine` has no house systems and no ayanamsas at all. Since houses are
not optional in astrology and the agreed scope is "every option possible", it
cannot implement the product regardless of how pleasant its licence is.

`sweph-wasm@2.6.9` was checked against a live instance rather than its README,
which documents only a fraction of what it exposes: 287 constants are reachable,
and the presence of `swe_houses_ex2`, `swe_mooncross` and `swe_helio_cross` shows
the underlying C core is really about 2.10. So the full API is available and we do
not need to compile Swiss Ephemeris ourselves.

## Decision

Swiss Ephemeris via `sweph-wasm`, confined to `src/ephemeris/` behind our own
`EphemerisProvider` interface, executing in a Web Worker.

## Consequences

- **Astraea must be AGPL-3.0-or-later.** This is not a preference. The AGPL is the
  option we take on Astrodienst's dual licence, and AGPL and MIT cannot be linked
  in the other direction. Running a modified Astraea as a network service obliges
  us to offer users the source, which the `/about` page does. Astrodienst also
  requires visible credit.
- **We ship 2.48 MB of the 110.6 MB package**: `swisseph.wasm` (584,227 B),
  `semo_18.se1` (1,304,771 B), `sepl_18.se1` (484,055 B), `seas_18.se1`
  (223,002 B). This fixes the supported date range at **1800–2399**; outside it
  the engine refuses rather than falling back to lower-precision theory. Each file
  is pinned by SHA-256 so an upstream repack fails loudly.
- **`sefstars.txt` is absent from the package.** Fixed stars will not work until it
  is sourced separately.
- **Two library behaviours are actively dangerous and are guarded:**
  - `swe_set_ephe_path` swallows per-file fetch errors and throws only if _every_
    file fails. A partial load therefore proceeds and silently degrades to Moshier
    theory. We assert every expected file exists in the WASM filesystem afterwards.
  - The bundled `.d.ts` states that `cusp[0]` is the first house. **It is wrong.**
    Verified empirically: the array has 13 entries, index 0 is unused, `cusps[1]`
    is the Ascendant and `cusps[10]` the MC. Believing the documentation would have
    rotated every chart by one house — a wrong answer that looks entirely
    plausible.
- **Constants are generated, never transcribed**, from a live instance. Roughly
  fourteen flags (`SEFLG_SIDEREAL`, `SEFLG_TOPOCTR`, `SEFLG_EQUATORIAL` among them)
  are computed at runtime and typed only as `number` in the declarations, so
  reading the types would have produced wrong values. CI fails on drift.
- **`swe_set_sid_mode` and `swe_set_topo` are global mutable state** on the
  instance, not per-call arguments. Confining WASM to one worker thread with a
  serialised request queue is what makes that safe to reason about.

## Verification

The engine runs fully offline in Node, at full precision including Chiron, by
widening `fetch` to resolve `file://` — so the golden-chart gate exercises the real
production load path in CI with no network.

Measured agreement with NASA JPL Horizons across 11 bodies and 3 epochs: median
about 0.05″. Two distinct residuals were identified rather than assumed:

1. A constant ~0.05″ offset at every epoch, independent of body speed — a
   frame-level model difference in nutation and aberration handling.
2. For future dates, an additional shared ~1.5 s time offset across the fast
   bodies — differing **predicted ΔT**. Visible only on the Moon, which at ~0.55″
   per second of time turns that into 0.83″.

Hence the gate uses two tolerances: **0.2″ for historical epochs** (where natal
charts actually live) and 1.5″ for future dates. A single 1″ bound would have hidden
a tenfold regression on exactly the cases that matter.
