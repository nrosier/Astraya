# Astraea

A genuine astrological calculation and charting application. You enter a birth
date, time and place; Astraea computes the chart and draws it.

The emphasis is on being _correct_. Positions come from the Swiss Ephemeris, and
the test suite checks them against reference values fetched from NASA JPL
Horizons rather than values written from memory. Where a calculation is undefined
— Placidus houses inside the polar circles, Chiron outside its validity window, a
date outside the shipped ephemeris range — Astraea says so instead of returning a
plausible-looking number.

## Status

Early. Milestone M0 (foundation) is in progress; see the
[issues and milestones](https://github.com/nrosier/Astraea/issues) for what is
planned and what is done.

## What it does

- **Natal charts** — all bodies, roughly 23 house systems, 48 ayanamsas, tropical
  and sidereal, aspects, dignities, derived points, nakshatras.
- **Progressions and returns** — secondary, solar-arc and tertiary progressions;
  solar, lunar and planetary returns; bi-wheels.
- **Interpretation** — a full written report. The prose corpus is drafted by an
  LLM **at build time** and committed as source data; the shipped application
  makes no model API calls, ever.

## Design

- **Local-first.** The authoritative copy of your data lives in your browser, in
  IndexedDB. Calculation and charting are entirely client-side, so the app works
  offline as its normal mode rather than as a degraded one.
- **Optional sync.** Signing in (Authentik OIDC) syncs an append-only operation
  log to your own self-hosted server so your data reaches your other devices. The
  server stores opaque operations and never interprets them. Without signing in,
  nothing leaves your device.

## Development

Requires Node 22 or newer.

```sh
npm install
npm run ephe:sync   # copy + verify the Swiss Ephemeris data files
npm run dev
npm run check       # format, lint, typecheck, test
```

`npm run ephe:sync` copies four files (2.48 MB) out of the 110 MB `sweph-wasm`
package into `public/ephe/` and verifies each against a pinned SHA-256. It fails
loudly if upstream repacks them, because a silently different ephemeris file is a
silently different chart.

## Licence

**AGPL-3.0-or-later.** Astraea links the Swiss Ephemeris, which Astrodienst AG
licenses under either the AGPL or a commercial licence; the AGPL is the option
taken here, and it is why Astraea cannot be MIT. See [`LICENSE`](LICENSE) and
[`NOTICE`](NOTICE) for the full terms and the required attributions.

If you run a modified Astraea as a network service, the AGPL obliges you to offer
its users the corresponding source. The `/about` page carries that link.
