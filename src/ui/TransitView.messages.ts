/**
 * Message catalogue for `TransitView.tsx` (#158).
 */
const en = {
  transitsFallback: 'Transits',
  personFallback: 'Person',
  thisPerson: 'this person',
  notCompleteTransits: (name: string) =>
    `${name}’s birth record is not complete enough to calculate transits yet. Fill in the missing fields on the`,
  personPageLink: 'person page',
  needsKnownTime: (name: string) =>
    `A transit wheel needs houses on both rings, so it needs a known birth time. ${name}’s birth time is unknown — the same reason their chart has no houses.`,

  heading: (name: string) => `${name}’s transits`,
  hint: (name: string) =>
    `A bi-wheel: ${name}’s natal chart on the inner ring, transiting positions for the chosen date on the outer ring, cast for their natal place.`,
  asOfLabel: 'As of',
  calculating: 'Calculating…',
  error: (message: string) => `Transits could not be calculated. ${message}`,

  contactsCaption: 'Contacts',
  transitingLabel: 'Transiting',
  aspectLabel: 'Aspect',
  natalLabel: 'Natal',
  transitRingLabel: 'Transit',
  orbLabel: 'Orb',
  applyingLabel: 'Applying',
  applying: 'Applying',
  separating: 'Separating',
};

const nl: typeof en = {
  transitsFallback: 'Transits',
  personFallback: 'Persoon',
  thisPerson: 'deze persoon',
  notCompleteTransits: (name: string) =>
    `Het geboorterecord van ${name} is niet volledig genoeg om transits te berekenen. Vul de ontbrekende velden in op de`,
  personPageLink: 'persoonspagina',
  needsKnownTime: (name: string) =>
    `Een transitwiel heeft huizen op beide ringen nodig, dus is een bekende geboortetijd vereist. De geboortetijd van ${name} is onbekend — dezelfde reden waarom hun horoscoop geen huizen heeft.`,

  heading: (name: string) => `Transits van ${name}`,
  hint: (name: string) =>
    `Een biwiel: de natale horoscoop van ${name} op de binnenring, transiterende posities voor de gekozen datum op de buitenring, berekend voor hun geboorteplaats.`,
  asOfLabel: 'Vanaf',
  calculating: 'Berekenen…',
  error: (message: string) => `Transits konden niet worden berekend. ${message}`,

  contactsCaption: 'Contacten',
  transitingLabel: 'Transiterend',
  aspectLabel: 'Aspect',
  natalLabel: 'Natal',
  transitRingLabel: 'Transit',
  orbLabel: 'Orb',
  applyingLabel: 'Toenemend',
  applying: 'Toenemend',
  separating: 'Afnemend',
};

export const transitViewMessages = { en, nl };
