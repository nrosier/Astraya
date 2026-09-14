/**
 * Pure logic for the persistent per-person tab bar (#234). Kept separate from `PersonNav.tsx`
 * so the active-tab/gating logic can be tested without a DOM, the same convention `route.ts`
 * follows for route parsing.
 */
import { chartTab } from './route.js';
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
  readonly label: string;
  readonly buildHref: (personId: string) => string;
}

// Same labels, order and hrefs as the middot chain this replaces (previously in
// PersonForm.tsx). Report shares the chart route with a `?tab=report` query rather than
// having its own route — see ChartView's own tab handling.
export const PERSON_TABS: readonly PersonTab[] = [
  { key: 'birth-record', label: 'Birth record', buildHref: (id) => `#/person/${id}` },
  { key: 'chart', label: 'Natal chart', buildHref: (id) => `#/chart/${id}` },
  { key: 'report', label: 'Report', buildHref: (id) => `#/chart/${id}?tab=report` },
  { key: 'profections', label: 'Profections', buildHref: (id) => `#/profections/${id}` },
  { key: 'transit', label: 'Transits', buildHref: (id) => `#/transit/${id}` },
  { key: 'synastry', label: 'Synastry', buildHref: (id) => `#/synastry/${id}` },
  { key: 'composite', label: 'Composite', buildHref: (id) => `#/composite/${id}` },
  { key: 'harmonic', label: 'Harmonic', buildHref: (id) => `#/harmonic/${id}` },
  { key: 'periodic-transit', label: 'Forecast', buildHref: (id) => `#/periodic-transit/${id}` },
  { key: 'astrocartography', label: 'Astrocartography', buildHref: (id) => `#/astrocartography/${id}` },
];

/**
 * Which tab a parsed route corresponds to, or `null` for a route with no tab (e.g. `home`,
 * `about`). `hash` is needed separately from `route` only for the chart/report split, since
 * `?tab=report` lives in the query rather than in `Route` itself.
 */
export function activeTabKey(route: Route, hash: string): PersonTabKey | null {
  switch (route.kind) {
    case 'person':
      return 'birth-record';
    case 'chart':
      return chartTab(hash) === 'report' ? 'report' : 'chart';
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
