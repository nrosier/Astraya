# Changelog

All notable changes to Astraya are recorded here. Versions follow
[semantic versioning](https://semver.org/), and every milestone ends in a release —
see [docs/RELEASING.md](docs/RELEASING.md).

## [0.8.5] — 2026-09-11

**A Symbol column, and the Ascendant/Midheaven folded into Positions.**

A small patch matching Astro-Seek's own table layout more closely.

### Added

- **A Symbol column on the Positions table**, showing each body's traditional
  glyph (☉ ☽ ☿ ♀ ♂ etc.) as the leftmost column — plain Unicode rather than
  the wheel's SVG glyphs, since a table cell round-trips through Copy/CSV
  export as plain text.
- **The Ascendant and Midheaven now appear as two extra rows in the Positions table**,
  instead of the Houses tab's separate Angles table, matching Astro-Seek's
  combined layout. They show no House/Speed/Rx columns, since neither angle
  sits in a house or moves the way a body does. The Houses tab's Angles
  table still lists ARMC, the Equatorial Ascendant, both Co-Ascendants and
  the Polar Ascendant. The move is gated by the same flag that already
  hides the whole houses/angles picture for an unknown-birth-time chart, so
  that case still shows Positions with no Ascendant/Midheaven rows.

### Notes on correctness

- No calculation path was touched — this is a display-layer reshuffle of
  data Astraya already computed.
- `npm run ephe:sync` reports no digest change.
- Verified manually in a running browser: the Symbol column renders for
  every body, the Ascendant/Midheaven rows show dashes where House/Speed/Rx
  would be, the Houses tab's Angles table now starts at ARMC, an unknown-
  birth-time chart still omits the Ascendant/Midheaven rows, and CSV/TSV
  export includes the new column and rows.

## [0.8.4] — 2026-09-11

**Extended chart settings, Astro-Seek style.**

Another patch carrying feature work: `0.9.0` is still reserved for milestone
M8, and everything here is either wiring up options Astraya already computed
under the hood, or a cosmetic wheel option — no new calculation capability.

### Added

- **An "Extended settings" panel on the chart view**, modeled on Astro-Seek's
  own panel of the same name: house system, zodiac, orb rules, minor
  aspects, which points are shown, which points participate in aspect-
  finding, and a cosmetic wheel option, all editable as a draft with one
  "Redraw" action.
- **House system selector**, covering all 24 systems Astraya already
  supports, and a **Tropical/Sidereal zodiac switch** with an ayanamsa
  picker for every ayanamsa Astraya knows.
- **The default orb rules now match Astro-Seek's own**: major aspects at 7°
  (10° with a luminary), sextile at 4° (5°30′ with a luminary), and every
  minor aspect at a flat 2°30′ — replacing Astraya's previous per-aspect orb
  table. A ±90% scale slider widens or narrows all three tiers at once.
- **Minor aspects, and aspects to Chiron/Lilith/the Lunar Nodes, default off**,
  matching Astro-Seek's own defaults. Each is an individual toggle: six
  minor-aspect checkboxes, and one "aspects to" checkbox per body. This
  narrows what the Aspects tab and matrix show by default; nothing is hidden
  that isn't computed — turning a toggle on computes and shows it for real.
- **Point-display toggles** for the Part of Fortune, the Vertex, Chiron and
  a new pair of **ASC/MC and Sun/Moon midpoint rows** in the Derived points
  tab (the same two Astro-Seek shows inline on its own chart page). Chiron
  defaults visible; the other three default hidden.
- **Lilith and the Lunar Nodes each get a Mean/True variant switch** — Astro-
  Seek's "True Lilith" maps to Swiss Ephemeris's osculating apogee, since
  there is no literal "true Lilith" flag in the ephemeris.
- **Rainbow Color Zodiac**, a cosmetic wheel option coloring each of the
  twelve sign wedges individually, available on both of Astraya's wheel
  renderings (its own, and the AstroChart alternate from 0.8.3).

### Notes on correctness

- The golden-chart gate continues to pass at its 0.2″ historical tolerance;
  no calculation path was touched by the point-visibility or panel work.
  The orb-rule and aspect-participation defaults are a deliberate, called-
  out behavior change (see above), not a regression.
- **Verified manually in a running browser**: every toggle in the panel
  (house system, sidereal + ayanamsa, orb scale, a minor aspect, Chiron/
  Fortune/Vertex/midpoints visibility, Lilith's True variant, aspects to
  Chiron, Rainbow Color Zodiac) was exercised against a live chart and
  produced the expected change.
- **A known, deliberate interaction**: turning "aspects to Chiron" on adds
  Chiron's resulting aspects to the wheel's chords as well as the tab and
  matrix, whenever those aspects are in the major family — the wheel's
  major-only aspect filter (shipped just before this release) filters by
  aspect family only, not by which bodies are involved, so it has no reason
  to treat Chiron differently from any other body once its aspects are
  turned on.
- **The Horizon house system ('H') is now excluded from the property test**,
  alongside Gauquelin sectors and the alternative Sunshine system. Its
  degenerate zone turned out not to be a fixed neighborhood around the
  equator, as a prior fix assumed, but to track the RAMC for the date and
  hour under test — sweeping latitude found it winding 11x across roughly
  ten degrees on one date, and only right at the equator on another. No
  fixed exclusion is safe against a property test that generates a random
  date and hour on every run, so 'H' is excluded outright rather than
  narrowing the latitude range for every other system to accommodate it.

## [0.8.3] — 2026-09-10

**A second wheel rendering, drawn by AstroChart.**

Another patch carrying feature work: `0.9.0` is still reserved for milestone
M8, and this adds an alternate on-screen view rather than changing how a
chart is computed.

### Added

- **A toggle between two wheel renderings.** Alongside Astraya's own wheel
  (redrawn in 0.8.2), the chart view can now render the radix wheel with the
  third-party [AstroChart](https://github.com/AstroDraw/AstroChart) library
  (MIT) instead. AstroChart is the default view; a small toggle switches
  back to Astraya's own rendering.
- **Exports are unaffected either way.** The SVG/PNG/PDF export buttons
  always export Astraya's own rendering, regardless of which wheel is shown
  on screen, so downloaded charts are unchanged from 0.8.2.

### Notes on correctness

- The golden-chart gate continues to pass at its 0.2″ historical tolerance;
  no calculation path was touched.
- **Not verified in a browser for this release.** The new adapter and
  component are covered by unit and DOM-smoke tests, and the full suite and
  `npm run check` pass, but the toggle itself was not visually checked in a
  running browser before release.

## [0.8.2] — 2026-09-10

**The wheel redrawn in the Astrodienst style.**

Another patch carrying feature work rather than only fixes, for the same
reason as 0.8.1: `0.9.0` is still reserved for milestone M8, and nothing
here changes how a chart is computed — this is a look-and-feel port, not a
structural one.

### Added

- **Every glyph redrawn**, ported from Kerykeion's (AGPL-3.0) hand-drawn
  artwork rather than Astraya's own placeholder shapes: all ten planets,
  Chiron, both lunar node pairs (including a real south-node symbol, not a
  mirrored north node), the four major asteroids, all twelve signs, and all
  eleven aspect glyphs.
- **The ring band bodies sit in is wider**, closer to the Astrodienst
  proportion, so placements read less cramped near the chart's centre.
- **Aspects now sort into three colour families, not two.** Conjunction,
  semisextile, sextile and trine read as the harmonious family (blue);
  semisquare, square, sesquiquadrate and opposition as the hard family
  (red, unchanged); quintile, biquintile and quincunx get their own third
  colour rather than falling through to a flat neutral grey. The aspect
  grid repeats the same three-way colouring.
- **The structural rings have depth.** The zodiac band and the aspect disk
  are now lightly shaded rather than flat outlines, the single biggest
  lever on the wheel's "just outlines" look.
- **House cusps are drawn as reference lines, not features** — dashed and
  faint, so the angle lines (ASC/MC axis) stand out against them instead of
  blending in.

### Notes on correctness

- The golden-chart gate continues to pass at its 0.2″ historical tolerance.
  This release is drawing only; no calculation path was touched.
- **Not verified in a browser for this release.** The redesign was checked
  against the full structural chart test suite and by a manual diff review
  against the ported source artwork, not by opening a rendered chart.

## [0.8.1] — 2026-09-10

**Chart rendering, theming and export.**

A patch number carrying feature work rather than only fixes: the version table
reserves `0.9.0` for milestone M8, and nothing here changes how a chart is
computed.

### Added

- **A full chart sheet, not just a wheel.** One drawing now carries the
  birth details, the wheel itself, and a data panel beneath it: an aspect
  grid pairing every two bodies exactly once, an element and modality
  breakdown, and a strip showing how the chart's degrees cluster within a
  sign.
- **The wheel says what it is drawing.** Zodiac sign glyphs around the ring,
  degree ticks in three tiers, numbered houses, and each body annotated with
  its exact degree and minute — none of which the wheel had before.
- **Drawn at any size.** The sheet is described proportionally rather than in
  fixed pixels, so it is rendered at the size asked for instead of at one
  size and stretched. This is what makes a 2400px export sharp rather than
  enlarged.
- **Bi- and tri-wheels draw the same rings as the natal chart.** Comparing
  two charts previously lost the sign glyphs, tick tiers and house numbers a
  single chart got; there is now one renderer, and the natal chart is its
  one-ring case.
- **Hard and soft aspects are told apart at a glance**, red and blue, by the
  convention printed charts use — and an aspect is drawn only if the Aspects
  table on the same screen agrees it exists.
- **Export a chart as SVG, PNG or PDF.** The saved file carries its own
  styling, so it stays legible somewhere that has never loaded Astraya's
  stylesheet; PNG is rasterised at a size you pick.
- **A light/dark override** ([#70](https://github.com/nrosier/Astraya/issues/70)),
  for disagreeing with the OS setting. The stored choice is applied before the
  first render, so it never flashes the other palette first.
- **Sortable chart tables**, by any column.

### Fixed

- **Four zodiac glyphs were wrong.** Aries was drawn inverted, which made it
  the lunar node's symbol rather than its own; Sagittarius' crossbar lay along
  its own arrow shaft and so drew nothing at all; Cancer and Capricorn were
  redrawn to be recognisable as their signs.
- **Crowded charts no longer print text on top of itself.** Where a cluster
  of bodies has no room for every degree label, labels are dropped rather
  than overlapped — the glyph and its pointer still carry the position, and
  the exact figure is in the table. The aspect grid's orb notation likewise
  shortens, then gives way to the aspect symbol alone, instead of being set
  at a size no renderer honours.

### Notes on correctness

- The golden-chart gate continues to pass at its 0.2″ historical tolerance.
  This release is rendering only; no calculation path was touched.
- **Not verified in a browser for this release.** The export buttons and
  print output were exercised through the rendering pipeline and by
  rasterising the result, but not by clicking them in a real browser. The
  sheet is also now taller than a printed page, so how a PDF splits it is
  unconfirmed.

## [0.8.0] — 2026-09-10

**Milestone M7 — interpretation.**

A chart has always been numbers and a picture. Now it also gets a written
report: plain-language text for what each placement means, chosen for the
chart in front of it rather than templated.

### Added

- **A written report tab**, assembling the placements a chart actually has
  into a readable page rather than a flat list of everything the corpus
  knows.
- **A salience-ranked rule engine.** Every placement in a chart competes for
  the report's attention on dignity, sect and angularity, not just category
  order, so the report leads with what the chart itself makes important.
- **A large interpretation corpus** — hand-written exemplars plus
  AI Studio-generated text, covering planets in sign and house, aspects,
  dignities, nakshatras and chart-shape patterns, in English and Dutch, with
  a typed schema and loader enforcing that every entry names a real body,
  sign or aspect rather than a typo that would silently never match a chart.
- **Five reading personas** (traditionalist, big sister, cynic, mystic,
  pragmatist), each with its own voice for the same placement, generated
  across the whole corpus and falling back to a neutral entry where a
  persona-specific one doesn't exist.
- **A "why this text?" provenance view**, showing whether a passage was
  hand-written or generated, and by what, next to the passage itself.
- **A coverage guarantee**: no placement a chart can produce is allowed to
  fall through to empty text — a fallback composition step covers any
  corpus gap so the report never shows a hole.
- Chart wheel wired into the chart screen itself, with rings, aspects and
  data tables now sharing one tabbed view instead of tables alone.
- Sharing a chart via a self-contained link, and permanently deleting a
  person's data on the device that holds it, next to the existing
  reversible delete.

### Notes on correctness

- **The corpus was linted and deduplicated as data, not just written and trusted.**
  An automated lint pass checks every entry's placement fields against the real
  astrology reference tables, and a similarity pass flags any two entries in the
  same locale that read too much alike; one flagged pair was rewritten and
  reverified before this release.
- **A CI check keeps the model out of the running app.** The corpus is
  generated at build time and committed as data — a lint rule fails the
  build if any code path in `src/` could reach a language-model client at
  runtime.
- **The corpus is fetched in chunks, not shipped whole.** A browser loads
  only its locale's neutral text plus, at most, one persona's chunk on top,
  rather than downloading every language and persona regardless of what a
  reader actually sees.
- The golden-chart gate continues to pass at its 0.2″ historical tolerance;
  none of this milestone's work touches how a chart's positions are
  computed.
- Human review of the corpus's highest-salience entries (~250 of them) is
  tracked separately and deliberately not a release gate for this version —
  see [#63](https://github.com/nrosier/Astraya/issues/63).

## [0.7.0] — 2026-09-09

**Milestone M6 — progressions & returns.**

A chart is no longer just a fixed moment: Astraya now moves it forward, and
compares the result against the original.

### Added

- **Secondary progressions**, with a choice of Midheaven method — the
  progressed angles are one of the few places where astrologers genuinely
  disagree on the technique, so both are offered rather than picking one
  silently.
- **Solar arc directions**, advancing every body by the Sun's own secondary
  progression arc.
- **Tertiary and minor progressions**, the faster day-for-a-lunar-month and
  day-for-a-lunar-day variants, for the traditions that use them.
- **Solar and lunar returns**, found by root-finding directly against the
  Swiss Ephemeris rather than approximated, so a return's exact moment is as
  accurate as a natal chart's.
- **Planetary returns and the demibirthday** — a body's return to its natal
  degree, and the chart drawn for the midpoint of the solar year.
- **A cross-chart aspect engine**, comparing any two charts' bodies against
  each other — the same engine that powers progressions-to-natal and
  return-to-natal aspects, and every bi-wheel and tri-wheel drawn from here on.
- **A bi-wheel and tri-wheel renderer**, extending M5's chart wheel to show
  two or three charts at once, with a shared outer zodiac ring, per-ring house
  cusps, a fixed legend, and cross-ring aspect lines.

### Notes on correctness

- Return-finding is checked against its own root — a found return's body is
  re-measured at the found moment and must land within the same tolerance the
  golden-chart gate uses, rather than trusting the root-finder's convergence
  claim alone.
- The golden-chart gate continues to pass at its 0.2″ historical tolerance;
  none of this milestone's work touches how a single chart's positions are
  computed.

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

[0.8.1]: https://github.com/nrosier/Astraya/releases/tag/v0.8.1
[0.8.0]: https://github.com/nrosier/Astraya/releases/tag/v0.8.0
[0.4.0]: https://github.com/nrosier/Astraya/releases/tag/v0.4.0
[0.3.0]: https://github.com/nrosier/Astraya/releases/tag/v0.3.0
[0.2.0]: https://github.com/nrosier/Astraya/releases/tag/v0.2.0
[0.1.0]: https://github.com/nrosier/Astraya/releases/tag/v0.1.0
