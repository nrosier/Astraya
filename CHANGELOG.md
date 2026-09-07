# Changelog

All notable changes to Astraea are recorded here. Versions follow
[semantic versioning](https://semver.org/), and every milestone ends in a release —
see [docs/RELEASING.md](docs/RELEASING.md).

## [0.1.0] — 2026-09-07

**Milestone M0 — foundation, licence and architecture.**

Astraea does not calculate charts for you yet. What this release establishes is
that the numbers it will produce are trustworthy, and that the ways they could go
quietly wrong are closed off.

### Added

- **Swiss Ephemeris integration**, arcsecond-accurate and running entirely in your
  browser. It executes in a Web Worker, so the interface never freezes while a
  chart is computed.
- **A correctness gate.** Positions are checked against reference values fetched
  from NASA JPL Horizons — 11 bodies across three epochs, agreeing to within 0.2
  arcseconds for historical dates. The suite runs offline, so it cannot be
  accidentally skipped.
- **An About page** carrying the licence, the source link for the exact build you
  are running, the Swiss Ephemeris attribution, and a plain-language statement of
  what Astraea stores and where.
- Continuous integration, a release process, and Renovate for dependency updates.

### Notes on correctness

Three ways to get silently wrong answers were found and closed:

- The Swiss Ephemeris type declarations state that the first house cusp is at array
  index 0. It is not. Following the documentation would have rotated **every
  chart** by one house — an error that looks entirely plausible on screen.
- Loading ephemeris data reports success even when individual data files fail,
  after which it quietly falls back to a lower-precision theory. Astraea now checks
  that every file actually loaded and refuses to compute otherwise.
- Around fourteen configuration flags are computed at runtime and untyped, so
  reading them from the declarations yields wrong values. They are now read from a
  live instance instead, and CI fails if they drift.

Dates outside 1800–2399 are refused with a clear message rather than answered with
degraded accuracy.

### Licence

Astraea is **AGPL-3.0-or-later**. This is required, not chosen: Swiss Ephemeris is
offered under either the AGPL or a commercial licence, and the AGPL cannot be
combined with MIT in this direction.

[0.1.0]: https://github.com/nrosier/Astraea/releases/tag/v0.1.0
