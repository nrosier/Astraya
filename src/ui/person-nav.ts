/**
 * Pure logic for the persistent per-person tab bar (#234). Kept separate from `PersonNav.tsx`
 * so the active-tab/gating logic can be tested without a DOM, the same convention `route.ts`
 * follows for route parsing.
 */
import type { Route } from './route.js';

export type PersonTabKey =
  | 'birth-record'
  | 'chart'
  | 'report'
  | 'profections'
  | 'transit'
  | 'synastry'
  | 'composite'
  | 'harmonic'
  | 'periodic-transit'
  | 'astrocartography';

export interface PersonTab {
  readonly key: PersonTabKey;
  readonly buildHref: (personId: string) => string;
}

// Same order and hrefs as the middot chain this replaces (previously in PersonForm.tsx).
// Labels are translated, so they live in `PersonNav.messages.ts`, looked up by `key`,
// rather than here — this module has no access to the current locale.
export const PERSON_TABS: readonly PersonTab[] = [
  { key: 'birth-record', buildHref: (id) => `#/person/${id}` },
  { key: 'chart', buildHref: (id) => `#/chart/${id}` },
  { key: 'report', buildHref: (id) => `#/report/${id}` },
  { key: 'profections', buildHref: (id) => `#/profections/${id}` },
  { key: 'transit', buildHref: (id) => `#/transit/${id}` },
  { key: 'synastry', buildHref: (id) => `#/synastry/${id}` },
  { key: 'composite', buildHref: (id) => `#/composite/${id}` },
  { key: 'harmonic', buildHref: (id) => `#/harmonic/${id}` },
  { key: 'periodic-transit', buildHref: (id) => `#/periodic-transit/${id}` },
  { key: 'astrocartography', buildHref: (id) => `#/astrocartography/${id}` },
];

/** Which tab a parsed route corresponds to, or `null` for a route with no tab (e.g. `home`, `about`). */
export function activeTabKey(route: Route): PersonTabKey | null {
  switch (route.kind) {
    case 'person':
      return 'birth-record';
    case 'chart':
    case 'report':
    case 'profections':
    case 'transit':
    case 'synastry':
    case 'composite':
    case 'harmonic':
    case 'periodic-transit':
    case 'astrocartography':
      return route.kind;
    default:
      return null;
  }
}

/** Every tab but Birth record requires a completed, stored birth moment (same gate `PersonForm` used). */
export function isTabEnabled(key: PersonTabKey, hasBirthMoment: boolean): boolean {
  return key === 'birth-record' || hasBirthMoment;
}
