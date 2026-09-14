/**
 * Message catalogue for `PersonNav.tsx` (#158), including the per-tab labels for
 * `person-nav.ts`'s `PERSON_TABS` (that module has no access to the current locale, so
 * `PersonNav.tsx` looks labels up here by `tab.key`).
 */
import type { PersonTabKey } from './person-nav.js';

const en = {
  chartTypesAriaLabel: 'Chart types',
  disabledTabSuffix: (label: string) => `${label} — complete the birth record first`,
  completeBirthRecordHint: 'Complete the birth record to unlock the other tabs.',

  tabLabels: {
    'birth-record': 'Birth record',
    chart: 'Natal chart',
    report: 'Report',
    profections: 'Profections',
    transit: 'Transits',
    synastry: 'Synastry',
    composite: 'Composite',
    harmonic: 'Harmonic',
    'periodic-transit': 'Forecast',
    astrocartography: 'Astrocartography',
  } satisfies Record<PersonTabKey, string>,
};

const nl: typeof en = {
  chartTypesAriaLabel: 'Horoscooptypes',
  disabledTabSuffix: (label: string) => `${label} — voltooi eerst de geboortegegevens`,
  completeBirthRecordHint: 'Vul de geboortegegevens in om de overige tabs te ontgrendelen.',

  tabLabels: {
    'birth-record': 'Geboortegegevens',
    chart: 'Horoscoop',
    report: 'Rapport',
    profections: 'Profecties',
    transit: 'Transits',
    synastry: 'Synastrie',
    composite: 'Composiet',
    harmonic: 'Harmonisch',
    'periodic-transit': 'Prognose',
    astrocartography: 'Astrocartografie',
  } satisfies Record<PersonTabKey, string>,
};

export const personNavMessages = { en, nl };
