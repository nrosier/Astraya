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
  | { readonly kind: 'chart'; readonly personId: string };

const PERSON_PATH = /^#\/person\/(.+)$/;
const CHART_PATH = /^#\/chart\/(.+)$/;

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

  return { kind: 'home' };
}
