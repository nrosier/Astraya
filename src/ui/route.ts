/**
 * Hash routes.
 *
 * Pure and separate from the components on purpose. A route that fails to match renders a
 * blank screen or, worse, silently falls through to the home page — a failure a user reports
 * as "the link you sent me doesn't work" and which no type checker catches. Parsing it here
 * means it can be tested without a DOM.
 *
 * Hash routing rather than history routing because the built app is static files: every URL
 * has to resolve without a server rewrite rule, including when the app is opened from disk.
 */
import { isPersonId } from '../domain/id.js';

export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'about' }
  | { readonly kind: 'changelog' }
  | { readonly kind: 'time' }
  | { readonly kind: 'people' }
  | { readonly kind: 'person'; readonly personId: string }
  | { readonly kind: 'chart'; readonly personId: string }
  | { readonly kind: 'profections'; readonly personId: string }
  | { readonly kind: 'transit'; readonly personId: string }
  // The second person is picked from within the screen, not the URL (#172) — every other
  // multi-word route here names exactly one person, and a synastry pairing changes far more
  // often within one visit (trying several comparisons) than it's worth sharing as a link.
  | { readonly kind: 'synastry'; readonly personId: string }
  // Same reasoning as synastry (#169): the second person is picked in-screen, not the URL.
  | { readonly kind: 'composite'; readonly personId: string }
  // The harmonic number / Varga preset is picked in-screen, not the URL (#170) — same
  // reasoning as composite: it changes far more often within one visit than it's worth
  // sharing as a link, and the screen's default (natal, n=1) is always a valid landing.
  | { readonly kind: 'harmonic'; readonly personId: string }
  | { readonly kind: 'shared' }
  | { readonly kind: 'admin' }
  | { readonly kind: 'set-password' }
  | { readonly kind: 'setup' };

const PERSON_PATH = /^#\/person\/(.+)$/;
const CHART_PATH = /^#\/chart\/(.+)$/;
const PROFECTIONS_PATH = /^#\/profections\/(.+)$/;
const TRANSIT_PATH = /^#\/transit\/(.+)$/;
const SYNASTRY_PATH = /^#\/synastry\/(.+)$/;
const COMPOSITE_PATH = /^#\/composite\/(.+)$/;
const HARMONIC_PATH = /^#\/harmonic\/(.+)$/;

export function parseRoute(hash: string): Route {
  // The query carries a birth record on #/time, so every match is on the path part alone.
  // Trailing slashes are tolerated because people hand-edit these URLs and a bare '#' is
  // what a browser leaves behind after an anchor click.
  const path = (hash.split('?')[0] ?? '').replace(/\/+$/, '');

  switch (path) {
    case '#/about':
      return { kind: 'about' };
    case '#/changelog':
      return { kind: 'changelog' };
    case '#/time':
      return { kind: 'time' };
    case '#/people':
      return { kind: 'people' };
    // #65: a chart shared by link — everything it needs is in the query, not the store.
    case '#/shared':
      return { kind: 'shared' };
    case '#/admin':
      return { kind: 'admin' };
    // The one-time token lives in the query (#135) — read directly off `location.hash`
    // by the screen itself, the same way #/time reads its own query, rather than here.
    case '#/set-password':
      return { kind: 'set-password' };
    // The one-time admin-bootstrap token (`server/auth/bootstrap.ts`) lives in the query,
    // same convention as #/set-password — read directly off `location.hash` by the screen
    // itself, not here.
    case '#/setup':
      return { kind: 'setup' };
    default:
      break;
  }

  // Validated as one of our ids, not merely as "some characters after the slash". An
  // unparseable id would open the form on a person the store has no records for, which
  // renders as "deleted, restorable from the list" — a lie about a URL that was simply
  // mistyped. Home is the honest answer.
  const person = PERSON_PATH.exec(path);
  if (person !== null && isPersonId(person[1])) return { kind: 'person', personId: person[1] };

  const chart = CHART_PATH.exec(path);
  if (chart !== null && isPersonId(chart[1])) return { kind: 'chart', personId: chart[1] };

  const profections = PROFECTIONS_PATH.exec(path);
  if (profections !== null && isPersonId(profections[1])) return { kind: 'profections', personId: profections[1] };

  const transit = TRANSIT_PATH.exec(path);
  if (transit !== null && isPersonId(transit[1])) return { kind: 'transit', personId: transit[1] };

  const synastry = SYNASTRY_PATH.exec(path);
  if (synastry !== null && isPersonId(synastry[1])) return { kind: 'synastry', personId: synastry[1] };

  const composite = COMPOSITE_PATH.exec(path);
  if (composite !== null && isPersonId(composite[1])) return { kind: 'composite', personId: composite[1] };

  const harmonic = HARMONIC_PATH.exec(path);
  if (harmonic !== null && isPersonId(harmonic[1])) return { kind: 'harmonic', personId: harmonic[1] };

  return { kind: 'home' };
}

/** The one-time token embedded in a `#/set-password?token=...` link (#135). `null` if missing. */
export function setPasswordToken(hash: string): string | null {
  const queryIndex = hash.indexOf('?');
  if (queryIndex === -1) return null;
  return new URLSearchParams(hash.slice(queryIndex + 1)).get('token');
}

/** The one-time token embedded in a `#/setup?token=...` link (`server/auth/bootstrap.ts`). `null` if missing. */
export function setupToken(hash: string): string | null {
  const queryIndex = hash.indexOf('?');
  if (queryIndex === -1) return null;
  return new URLSearchParams(hash.slice(queryIndex + 1)).get('token');
}
