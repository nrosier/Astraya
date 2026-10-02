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
  | 'progressions'
  | 'solar-arc'
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
  { key: 'progressions', buildHref: (id) => `#/progressions/${id}` },
  { key: 'solar-arc', buildHref: (id) => `#/solar-arc/${id}` },
  { key: 'transit', buildHref: (id) => `#/transit/${id}` },
  { key: 'synastry', buildHref: (id) => `#/synastry/${id}` },
  { key: 'composite', buildHref: (id) => `#/composite/${id}` },
  { key: 'harmonic', buildHref: (id) => `#/harmonic/${id}` },
  { key: 'periodic-transit', buildHref: (id) => `#/periodic-transit/${id}` },
  { key: 'astrocartography', buildHref: (id) => `#/astrocartography/${id}` },
];

/**
 * Groups the tabs beyond the three fixed ones (`birth-record`/`chart`/`report`) and the
 * standalone `astrocartography` into astrologically-sensible families with subtabs (#398), so the
 * top-level bar doesn't keep growing linearly as more techniques get wired in. Grouping and
 * reasoning: a real astrologer's own navigation habits, not engineering convenience —
 * "Transits & Forecast" is "what is the real sky doing against this chart"; "Progressions &
 * Directions" is "advance the chart by its own symbolic rule"; "Relationship Charts" is "how do
 * two people's charts interact"; "Chart Variants" is "a different lens on this one birth moment".
 * `astrocartography` is deliberately NOT in any family — it's spatial, not a different lens on
 * the same chart data, with its own distinct vocabulary and practitioner audience.
 */
export type PersonTabFamilyKey =
  'transits-forecast' | 'progressions-directions' | 'relationship-charts' | 'chart-variants';

export interface PersonTabFamily {
  readonly key: PersonTabFamilyKey;
  readonly members: readonly PersonTabKey[];
}

// Order within a family is the order subtabs render in. Future techniques (planetary return,
// secondary/minor progression, solar arc directions, draconic) slot in as additional members
// here once built, rather than becoming new top-level items.
export const PERSON_TAB_FAMILIES: readonly PersonTabFamily[] = [
  { key: 'transits-forecast', members: ['transit', 'periodic-transit'] },
  { key: 'progressions-directions', members: ['profections', 'progressions', 'solar-arc'] },
  { key: 'relationship-charts', members: ['synastry', 'composite'] },
  { key: 'chart-variants', members: ['harmonic'] },
];

/** Which family (if any) a tab belongs to — `undefined` for the three fixed tabs and `astrocartography`. */
export function familyForTab(key: PersonTabKey): PersonTabFamilyKey | undefined {
  return PERSON_TAB_FAMILIES.find((family) => family.members.includes(key))?.key;
}

/** Which tab a parsed route corresponds to, or `null` for a route with no tab (e.g. `home`, `about`). */
export function activeTabKey(route: Route): PersonTabKey | null {
  switch (route.kind) {
    case 'person':
      return 'birth-record';
    case 'chart':
    case 'report':
    case 'profections':
    case 'progressions':
    case 'solar-arc':
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
