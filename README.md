# Astraya

<p align="center">
  <a href="https://github.com/nrosier/Astraya/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/nrosier/Astraya/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/nrosier/Astraya/releases"><img alt="Release" src="https://img.shields.io/badge/release-v0.8.5-blue"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue"></a>
</p>

A genuine astrological calculation and charting application. You enter a birth
date, time and place; Astraya computes the chart and draws it.

The emphasis is on being _correct_. Positions come from the Swiss Ephemeris, and
the test suite checks them against reference values fetched from NASA JPL
Horizons rather than values written from memory. Where a calculation is undefined
— Placidus houses inside the polar circles, Chiron outside its validity window, a
date outside the shipped ephemeris range — Astraya says so instead of returning a
plausible-looking number.

## Status

Early. Milestone M4 (calculation core) is in progress; see the
[issues and milestones](https://github.com/nrosier/Astraya/issues) for what is
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

Requires Node 24 or newer.

```sh
npm install
npm run ephe:sync    # copy + verify the Swiss Ephemeris data files
npm run corpus:split # split the interpretation corpus into runtime chunks
npm run dev
npm run check        # format, lint, typecheck, test
```

`npm run ephe:sync` copies four files (2.48 MB) out of the 110 MB `sweph-wasm`
package into `public/ephe/` and verifies each against a pinned SHA-256. It fails
loudly if upstream repacks them, because a silently different ephemeris file is a
silently different chart.

`npm run corpus:split` splits `src/interpretation/corpus/{en,nl}.json` into
small per-(locale, persona) files under `public/corpus/`, so the app fetches
only the interpretation text a reader can actually see instead of the entire
corpus. Re-run it whenever those source files change.

## Running it

A single image serves the built application; there is nothing else to deploy.

```sh
docker run -p 8080:8080 -v astraya-data:/app/data niqck/astraya:latest
```

Then open <http://localhost:8080>. It works offline once loaded, and needs no
configuration — calculation happens in your browser, and no account is required.
Images are published for `linux/amd64` and `linux/arm64`; see
[docs/RELEASING.md](docs/RELEASING.md) for the tagging scheme.

The `-v` mount is only needed if you sign in: it's where the container keeps
accounts and sessions. Without it, that data is lost the moment the container
is removed — everything else about the app, run with no volume at all, still
works exactly the same.

`PORT` (default `8080`), `HOST`, `LOG_LEVEL`, `ASTRAYA_DB_PATH` and
`ASTRAYA_ENCRYPTION_KEY` are the only required settings. Local sign-in is
optional; the container logs a one-time setup link on first boot if you want
an account.

### Optional: sign-in with Authentik

Astraya's own username/password accounts work with no further setup. To let
people sign in with an existing Authentik identity instead (or as well), set
`ASTRAYA_OIDC_ISSUER`, `ASTRAYA_OIDC_CLIENT_ID` and `ASTRAYA_PUBLIC_URL` (see
[`.env.example`](.env.example) for the exact meaning of each). In the
Authentik provider:

- Create a public OAuth2/OIDC provider — no client secret; Astraya uses the
  Authorization Code flow with PKCE and never holds a secret.
- Set its redirect URI to exactly `${ASTRAYA_PUBLIC_URL}/auth/oidc/callback`.
- Set its RP-initiated logout redirect (sign-out redirect) to exactly
  `${ASTRAYA_PUBLIC_URL}`, so signing out of Astraya also ends the Authentik
  session rather than leaving it active.

Signing in with Authentik provisions a new local Astraya account on first use
(never an admin — grant that separately) and, from then on, works exactly like
a local account: same session cookie, same sync relay, same sign-out flow.
Astraya has no way to notice an account disabled or a session revoked on the
Authentik side after the initial sign-in exchange, so Authentik-derived
sessions use a shorter TTL (24h, vs. 30 days for local accounts) to bound how
long that gap can last.

## Licence

**AGPL-3.0-or-later.** Astraya links the Swiss Ephemeris, which Astrodienst AG
licenses under either the AGPL or a commercial licence; the AGPL is the option
taken here, and it is why Astraya cannot be MIT. See [`LICENSE`](LICENSE) and
[`NOTICE`](NOTICE) for the full terms and the required attributions.

If you run a modified Astraya as a network service, the AGPL obliges you to offer
its users the corresponding source. The `/about` page carries that link.
