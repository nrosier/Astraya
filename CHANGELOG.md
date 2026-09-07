# Changelog

All notable changes to Astraya are recorded here. Versions follow
[semantic versioning](https://semver.org/), and every milestone ends in a release —
see [docs/RELEASING.md](docs/RELEASING.md).

## [0.2.0] — 2026-09-07

**Milestone M1 — delivery pipeline.**

Astraya is now something you can run, rather than something you have to build.
Still no charts: this release is about there being a trustworthy path from a commit
to a running application.

### Added

- **A Docker image**, `nrosier/astraya`, for both `linux/amd64` and `linux/arm64`.
  One image holds the application and the server that serves it — `docker run -p
8080:8080 nrosier/astraya:latest` is the whole deployment.
- **An in-app changelog.** The version in the footer is a link; clicking it shows
  what changed in the build you are actually running, with no network request.
- **Published tags you can pin against** — `1.2.3`, `1.2`, `1` and `latest` for
  releases, `edge` for the main branch. A prerelease never moves `latest`.

### Notes on correctness

- Every published image is started and asked for its health endpoint before the
  build is called a success, and the served page is checked for its
  Content-Security-Policy header. An image that builds but cannot serve looks like
  a success, which makes it worse than a failure.
- The Content-Security-Policy is now defined in one place and asserted by a test to
  match between the served header and the page itself. Two copies drifting apart
  would silently weaken it.
- The changelog is rendered by a small Markdown subset renderer that cannot emit
  raw HTML, so it cannot become an injection sink later. A test renders the real
  changelog and fails if any entry is dropped — quietly losing a changelog line is
  worse than showing its syntax.
- Continuous integration and the release build now run the same Node version that
  the image ships, so the runtime that gates a release is the runtime that serves it.

## [0.1.0] — 2026-09-07

**Milestone M0 — foundation, licence and architecture.**

Astraya does not calculate charts for you yet. What this release establishes is
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
  what Astraya stores and where.
- Continuous integration, a release process, and Renovate for dependency updates.

### Notes on correctness

Three ways to get silently wrong answers were found and closed:

- The Swiss Ephemeris type declarations state that the first house cusp is at array
  index 0. It is not. Following the documentation would have rotated **every
  chart** by one house — an error that looks entirely plausible on screen.
- Loading ephemeris data reports success even when individual data files fail,
  after which it quietly falls back to a lower-precision theory. Astraya now checks
  that every file actually loaded and refuses to compute otherwise.
- Around fourteen configuration flags are computed at runtime and untyped, so
  reading them from the declarations yields wrong values. They are now read from a
  live instance instead, and CI fails if they drift.

Dates outside 1800–2399 are refused with a clear message rather than answered with
degraded accuracy.

### Licence

Astraya is **AGPL-3.0-or-later**. This is required, not chosen: Swiss Ephemeris is
offered under either the AGPL or a commercial licence, and the AGPL cannot be
combined with MIT in this direction.

[0.2.0]: https://github.com/nrosier/Astraya/releases/tag/v0.2.0
[0.1.0]: https://github.com/nrosier/Astraya/releases/tag/v0.1.0
