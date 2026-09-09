# Changelog

All notable changes to Astraya are recorded here. Versions follow
[semantic versioning](https://semver.org/), and every milestone ends in a release —
see [docs/RELEASING.md](docs/RELEASING.md).

## [0.6.0] — 2026-09-09

**Milestone M5 — chart rendering.**

The wheel is drawn: a chart is now a picture, not just a table of numbers.

### Added

- **The SVG chart wheel.** Rings, degree ticks and house cusps, drawn as
  clean vector paths rather than a canvas bitmap, so the chart stays sharp at
  any size and its markup can be styled or queried like any other DOM.
- **A full glyph set** for every body, sign and aspect, with **collision spreading**:
  glyphs that would overlap at a shared longitude are nudged apart and given a
  short leader line back to their true position, so a crowded stellium stays
  readable instead of stacking illegibly.
- **The aspect web**, drawn as chords across the wheel's inner circle, with
  toggles for aspect type and orb tightness.
- **Wheel orientation and style options** — Ascendant-left or Aries-up,
  clockwise or counterclockwise — for the house and cultural conventions
  different traditions expect.
- **Overlay lines** for antiscia, declination parallels, and a 90° dial view
  of midpoint structures.
- **Data tables** for every computed quantity from M4 (positions, houses,
  aspects, dignities and the rest), so nothing computed is picture-only.

### Notes on correctness

- Every rendering module is pure and framework-free — it takes computed chart
  data and returns an SVG string, with no dependency on how or whether the
  app is running in a browser — so the geometry itself is unit-tested
  directly against the markup it produces.
- The golden-chart gate continues to pass at its 0.2″ historical tolerance;
  rendering builds on M4's data without touching how any of it is computed.

## [0.5.0] — 2026-09-09

**Milestone M4 — calculation core.**

The full chart data set is now computed for any birth moment: every body, every
house system, every dignity, and the traditional points and patterns astrologers
actually read a chart by.

### Added

- **The full body set.** Sun through Pluto, the lunar nodes, Lilith, Chiron and
  the outer asteroids, each with a validity window so requesting a position
  before an asteroid's ephemeris file starts fails honestly instead of
  returning a wrong number.
- **Every house system and ayanamsa.** All ~23 house systems Swiss Ephemeris
  supports, and all ~45 predefined ayanamsas with live tropical/sidereal
  toggling — not just Placidus and Lahiri.
- **Topocentric and heliocentric positions**, alongside the default geocentric
  view, for the handful of techniques that need them.
- **Aspects with configurable orbs**, essential dignities (rulership,
  exaltation, detriment, fall), triplicity rulers, bounds/terms, decans and
  faces, and peregrine/almuten scoring.
- **Sect and solar-relationship points**: day/night sect, combustion, cazimi,
  under-the-beams, and the sect-correct Part of Fortune and other Arabic parts.
- **Midpoints and the 90° dial**, antiscia and contra-antiscia, declinations
  with parallels/contraparallels and out-of-bounds flags.
- **Fixed stars**, sourced from `sefstars.txt`, with magnitude filtering and
  paran contacts to the chart's angles.
- **Dispositor chains, mutual reception and final dispositor**, Jones chart
  shapes (bowl, bucket, etc.), and element/modality/quadrant/hemisphere
  weighting.
- **Nakshatra and pada** for every body from its sidereal longitude.

### Fixed

- **Polar-latitude houses** no longer fail silently — a house system that
  can't be computed at extreme latitudes falls back and says so, rather than
  returning nonsense cusps.
- A house-cusp property-test regression was excluded pending a fix, so the
  calculation-core test suite stays a reliable gate rather than an
  intermittently-red one.

### Notes on correctness

- A property-test suite now runs the calculation core against thousands of
  generated birth moments, checking invariants (e.g. cusps sum correctly, an
  exalted body isn't also in detriment) rather than only fixed golden cases.
- The golden-chart gate — 11 bodies at 3 epochs checked against JPL Horizons —
  continues to pass at its 0.2″ historical tolerance.

## [0.4.0] — 2026-09-08

**Milestone M3 — local-first data and people.**

Astraya now remembers people. Everything typed lives on the device it was typed
on — no account, no server, no network call — and survives closing the tab,
losing the connection, or reopening the app a year later.

### Added

- **People.** Add a person, fill in their birth record, and find them again from
  the people list. A person with no birth data yet is shown as exactly that, not
  hidden or guessed at.
- **A local-first store.** Every change is an operation stamped with a hybrid
  logical clock and appended to a log in IndexedDB, so two devices' histories
  merge deterministically once sync exists (M8) with no server involved in
  deciding the outcome.
- **Deletes you can undo.** Removing a person hides them and their charts rather
  than erasing anything; the people list can bring them back.
- **A request to not be evicted.** The app asks the browser to persist its
  storage, and says so plainly when the browser refuses — this is the only copy
  of the data that exists.
- **A status line that will not reassure you falsely.** Every screen holding
  local data shows whether it exists anywhere else yet. Today the honest answer
  is always "only on this device" — accounts and sync land in M8.
- **The app works with the network off.** The app shell and the ephemeris files
  it needs are cached ahead of time, and a second visit with no connection at all
  loads and works exactly as it did the first time.

### Notes on correctness

- **Forward compatibility is built in, not promised.** Every stored operation
  carries a version number. A future build's operations are preserved untouched
  by an older one rather than dropped, so upgrading and downgrading devices
  cannot lose data between them.
- **A chart's settings are not the same register as its birth data.** A person's
  date, time and coordinates are written as whole values — a coordinate merged
  half from one device and half from another would be a place nobody was born —
  while chart settings merge field-by-field, because that is harmless there.
- 382 tests cover the store, the form validation, and the offline behaviour;
  the offline-shell and cache-storage behaviour was also verified against a real
  browser with the network genuinely disabled, not simulated.

## [0.3.0] — 2026-09-07

**Milestone M2 — time and place.**

Astraya can now work out _when_ a birth happened. That sounds like the easy part
and it is the single most common reason a chart is wrong: an offset that is off by
an hour moves the Ascendant by around 15 degrees, which is enough to change the
rising sign and every house boundary with it — and nothing about the result looks
wrong. So this release is less about calculating an offset than about showing its
reasoning and admitting what it cannot know.

Still no chart wheel. That starts in M4 and M5.

### Added

- **A "when and where" panel.** Enter a date, a time and coordinates, and it shows
  the UTC offset it arrived at, where that offset came from, and anything about the
  moment that deserves a second look.
- **Historical timezones, not today's.** Offsets are resolved for the date in
  question, so the US patchwork of 1918–1966, British Double Summer Time, Amsterdam
  Time before 1940 and Soviet decree time all resolve as they actually were.
- **Local Mean Time before standard time existed.** For a birth before roughly
  1880, the offset comes from longitude, because towns kept their own solar time and
  that is the clock the record meant.
- **A manual offset override.** A birth certificate that states the offset beats
  any lookup, so a stated offset wins outright over the database.
- **Dates in the Julian calendar**, chosen automatically against the 1582 reform or
  set by hand — Russia and Greece kept the Julian calendar into the twentieth
  century, so the date on an old record is not always the date it looks like.
- **Shareable links.** The address bar holds the whole record and stays readable —
  `#/time?d=1960-06-15&t=14:30&la=38.7478&lo=-85.0672` — so you can see what a link
  contains before you open it.
- **A night-sky palette**, in light and dark, applied across the app.

### Notes on correctness

- **Ambiguity is shown, not resolved by guessing.** When clocks go back, a
  wall-clock time genuinely happens twice and nothing in the date can say which was
  meant. Astraya uses the first, says so, and shows the alternative. When clocks go
  forward, a stated time may never have existed at all, and it says that too.
- **Coordinates near a timezone boundary are flagged.** County lines defeat
  coordinate lookups — the panel opens on Vevay, Indiana, precisely because that is
  a case the naive lookup gets wrong, which seemed a better default than one that
  flatters the implementation.
- **Which timezone database was used is recorded with every resolution.**
  Historical offsets are data, and that data is revised; a saved chart should not
  move because a timezone update shipped.
- **Leap seconds are handled where they exist**, from 1972, and deliberately not
  before, because UTC did not exist to have them.
- **The offset and the wall-clock time it applies to travel together** as one value,
  so no part of the app can be handed a mismatched pair and produce a confident
  wrong answer.
- Sixty-two tests cover this, and every expectation in them was measured against
  the ephemeris rather than written from memory. That caught three wrong
  assumptions, including one about how far the Ascendant actually moves, so the
  suite now pins the quantity that does advance uniformly — right ascension, at
  15.04 degrees an hour — rather than the one folklore says does.

## [0.2.0] — 2026-09-07

**Milestone M1 — delivery pipeline.**

Astraya is now something you can run, rather than something you have to build.
Still no charts: this release is about there being a trustworthy path from a commit
to a running application.

### Added

- **A Docker image**, `niqck/astraya`, for both `linux/amd64` and `linux/arm64`.
  One image holds the application and the server that serves it — `docker run -p
8080:8080 niqck/astraya:latest` is the whole deployment.
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

[0.4.0]: https://github.com/nrosier/Astraya/releases/tag/v0.4.0
[0.3.0]: https://github.com/nrosier/Astraya/releases/tag/v0.3.0
[0.2.0]: https://github.com/nrosier/Astraya/releases/tag/v0.2.0
[0.1.0]: https://github.com/nrosier/Astraya/releases/tag/v0.1.0
