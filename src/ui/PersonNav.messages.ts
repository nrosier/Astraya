/**
 * Message catalogue for `PersonNav.tsx` (#158), including the per-tab labels for
 * `person-nav.ts`'s `PERSON_TABS` (that module has no access to the current locale, so
 * `PersonNav.tsx` looks labels up here by `tab.key`).
 */
import type { PersonTabFamilyKey, PersonTabKey } from './person-nav.js';

const en = {
  chartTypesAriaLabel: 'Chart types',
  adminTabLabel: 'Admin',
  disabledTabSuffix: (label: string) => `${label} — complete the birth record first`,
  completeBirthRecordHint: 'Complete the birth record to unlock the other tabs.',
  subtabsAriaLabel: (familyLabel: string) => `${familyLabel} subtabs`,

  tabLabels: {
    'birth-record': 'Birth record',
    chart: 'Natal chart',
    report: 'Interpretation',
    profections: 'Profections',
    progressions: 'Progressions',
    'solar-arc': 'Solar Arc',
    transit: 'Transits',
    synastry: 'Synastry',
    composite: 'Composite',
    harmonic: 'Harmonic',
    draconic: 'Draconic',
    'periodic-transit': 'Forecast',
    astrocartography: 'Astrocartography',
  } satisfies Record<PersonTabKey, string>,

  familyLabels: {
    'transits-forecast': 'Transits & Forecast',
    'progressions-directions': 'Progressions & Directions',
    'relationship-charts': 'Relationship Charts',
    'chart-variants': 'Chart Variants',
  } satisfies Record<PersonTabFamilyKey, string>,
};

const nl: typeof en = {
  chartTypesAriaLabel: 'Horoscooptypes',
  adminTabLabel: 'Beheer',
  disabledTabSuffix: (label: string) => `${label} — voltooi eerst de geboortegegevens`,
  completeBirthRecordHint: 'Vul de geboortegegevens in om de overige tabs te ontgrendelen.',
  subtabsAriaLabel: (familyLabel: string) => `Subtabs van ${familyLabel}`,

  tabLabels: {
    'birth-record': 'Geboortegegevens',
    chart: 'Horoscoop',
    report: 'Interpretatie',
    profections: 'Profecties',
    progressions: 'Progressies',
    'solar-arc': 'Solar Arc',
    transit: 'Transits',
    synastry: 'Synastrie',
    composite: 'Composiet',
    harmonic: 'Harmonisch',
    draconic: 'Draconisch',
    'periodic-transit': 'Prognose',
    astrocartography: 'Astrocartografie',
  } satisfies Record<PersonTabKey, string>,

  familyLabels: {
    'transits-forecast': 'Transits & prognose',
    'progressions-directions': 'Progressies & directies',
    'relationship-charts': 'Relatiehoroscopen',
    'chart-variants': 'Horoscoopvarianten',
  } satisfies Record<PersonTabFamilyKey, string>,
};

export const personNavMessages = { en, nl };
