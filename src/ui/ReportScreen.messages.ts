/**
 * Message catalogue for `ReportScreen.tsx` (#271).
 */
const en = {
  personFallback: 'Person',
  reportFallback: 'Interpretation',
  thisPerson: 'This person',
  notCompleteReport: (name: string) =>
    `${name}’s birth record is not complete enough to calculate an interpretation yet. Fill in the missing fields on the`,
  personPageLink: 'person page',
  needsKnownTime: (name: string) =>
    `The interpretation leans on houses and angles, so it needs a known birth time. ${name}’s birth time is unknown — the same reason their chart has no houses.`,
  housesUndefined: (name: string) =>
    `The interpretation leans on houses and angles, but the chosen house system has no valid solution for ${name}’s birth place at this exact time — try a different house system in Extended settings on the chart page, or a location further from the poles.`,

  heading: (name: string) => `${name}’s interpretation`,
  calculating: 'Calculating…',
  error: (message: string) => `The interpretation could not be calculated. ${message}`,
};

const nl: typeof en = {
  personFallback: 'Persoon',
  reportFallback: 'Interpretatie',
  thisPerson: 'Deze persoon',
  notCompleteReport: (name: string) =>
    `Het geboorterecord van ${name} is niet volledig genoeg om een interpretatie te berekenen. Vul de ontbrekende velden in op de`,
  personPageLink: 'persoonspagina',
  needsKnownTime: (name: string) =>
    `De interpretatie steunt op huizen en hoeken, dus is een bekende geboortetijd nodig. De geboortetijd van ${name} is onbekend — dezelfde reden waarom hun horoscoop geen huizen heeft.`,
  housesUndefined: (name: string) =>
    `De interpretatie steunt op huizen en hoeken, maar het gekozen huizensysteem heeft geen geldige oplossing voor de geboorteplaats van ${name} op dit exacte moment — probeer een ander huizensysteem bij Uitgebreide instellingen op de horoscooppagina, of een locatie verder van de polen.`,

  heading: (name: string) => `Interpretatie van ${name}`,
  calculating: 'Berekenen…',
  error: (message: string) => `De interpretatie kon niet worden berekend. ${message}`,
};

export const reportScreenMessages = { en, nl };
