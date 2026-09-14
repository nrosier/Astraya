/**
 * Message catalogue for `HarmonicView.tsx` (#158).
 */
const en = {
  personFallback: 'Person',
  thisPerson: 'This person',
  harmonicChartsFallback: 'Harmonic & Varga charts',
  needsCompleteRecord: (name: string) =>
    `A harmonic chart needs a real Ascendant to build its own houses from, so it needs a complete birth record with a known time. ${name}’s does not have one yet. Fill in or correct it on the`,
  personPageLink: 'person page',

  heading: (name: string) => `${name}’s harmonic chart`,
  headingFallback: 'Harmonic chart',
  hint: 'Every longitude multiplied by a whole number and wrapped back into the zodiac, with whole-sign houses built from the multiplied Ascendant — the general mechanism behind both harmonic charts and Vedic Varga (divisional) charts. See the named presets’ own note on which Varga convention each one follows.',

  divisionalChartLabel: 'Divisional chart',
  customHarmonicOption: 'Custom harmonic…',
  harmonicNumberLabel: 'Harmonic number',
  harmonicLabel: (n: string) => `Harmonic ${n}`,
  invalidHarmonicNumber: 'Enter a whole number of 1 or more.',
};

const nl: typeof en = {
  personFallback: 'Persoon',
  thisPerson: 'Deze persoon',
  harmonicChartsFallback: 'Harmonische & Varga-horoscopen',
  needsCompleteRecord: (name: string) =>
    `Een harmonische horoscoop heeft een echte Ascendant nodig om zijn eigen huizen op te bouwen, dus is een volledig geboorterecord met een bekende tijd vereist. Dat van ${name} is nog niet compleet. Vul het aan of corrigeer het op de`,
  personPageLink: 'persoonspagina',

  heading: (name: string) => `Harmonische horoscoop van ${name}`,
  headingFallback: 'Harmonische horoscoop',
  hint: 'Elke lengtegraad vermenigvuldigd met een geheel getal en teruggevouwen in de dierenriem, met huizen-per-heel-teken opgebouwd uit de vermenigvuldigde Ascendant — het algemene mechanisme achter zowel harmonische horoscopen als Vedische Varga (divisionele) horoscopen. Zie de eigen toelichting van de benoemde presets over welke Varga-conventie elke preset volgt.',

  divisionalChartLabel: 'Divisionele horoscoop',
  customHarmonicOption: 'Aangepast harmonisch getal…',
  harmonicNumberLabel: 'Harmonisch getal',
  harmonicLabel: (n: string) => `Harmonisch ${n}`,
  invalidHarmonicNumber: 'Voer een geheel getal van 1 of meer in.',
};

export const harmonicViewMessages = { en, nl };
