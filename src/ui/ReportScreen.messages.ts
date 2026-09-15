/**
 * Message catalogue for `ReportScreen.tsx` (#271).
 */
const en = {
  personFallback: 'Person',
  reportFallback: 'Report',
  thisPerson: 'This person',
  notCompleteReport: (name: string) =>
    `${name}’s birth record is not complete enough to calculate a report yet. Fill in the missing fields on the`,
  personPageLink: 'person page',
  needsKnownTime: (name: string) =>
    `The report leans on houses and angles, so it needs a known birth time. ${name}’s birth time is unknown — the same reason their chart has no houses.`,

  heading: (name: string) => `${name}’s report`,
  calculating: 'Calculating…',
  error: (message: string) => `The report could not be calculated. ${message}`,
};

const nl: typeof en = {
  personFallback: 'Persoon',
  reportFallback: 'Rapport',
  thisPerson: 'Deze persoon',
  notCompleteReport: (name: string) =>
    `Het geboorterecord van ${name} is niet volledig genoeg om een rapport te berekenen. Vul de ontbrekende velden in op de`,
  personPageLink: 'persoonspagina',
  needsKnownTime: (name: string) =>
    `Het rapport steunt op huizen en hoeken, dus is een bekende geboortetijd nodig. De geboortetijd van ${name} is onbekend — dezelfde reden waarom hun horoscoop geen huizen heeft.`,

  heading: (name: string) => `Rapport van ${name}`,
  calculating: 'Berekenen…',
  error: (message: string) => `Het rapport kon niet worden berekend. ${message}`,
};

export const reportScreenMessages = { en, nl };
