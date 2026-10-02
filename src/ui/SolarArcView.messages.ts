/**
 * Message catalogue for `SolarArcView.tsx` (#398).
 */
const en = {
  personFallback: 'Person',
  solarArcFallback: 'Solar Arc',
  thisPerson: 'This person',
  notCompleteSolarArc: (name: string) =>
    `${name}’s birth record is not complete enough to calculate solar arc directions yet. Fill in the missing fields on the`,
  personPageLink: 'person page',
  needsKnownTime: (name: string) =>
    `Solar arc directions need a known birth time. ${name}’s birth time is unknown — the same reason their chart has no houses.`,

  heading: (name: string) => `${name}’s solar arc directions`,
  hint: 'Every natal body and angle is shifted by the same arc — the distance the Sun itself has moved since birth, in symbolic (a-day-for-a-year) time. Unlike a progressed chart, nothing here depends on a progressed Moon or planetary speed.',
  asOfLabel: 'As of',
  calculating: 'Calculating…',
  error: (message: string) => `Solar arc directions could not be calculated. ${message}`,

  ageLine: (age: string) => `Age ${age}`,
  beforeBirth: '(before birth)',
  arcLine: (arc: string) => `Arc: ${arc}°`,

  positionsCaption: 'Directed positions',
  contactsCaption: 'Directed-to-natal contacts',
  noContacts: 'No directed-to-natal contacts within orb.',

  bodyLabel: 'Body',
  signLabel: 'Sign',
  degLabel: 'Deg',
  minLabel: 'Min',
  secLabel: 'Sec',
  houseLabel: 'House',

  bodyALabel: 'Directed',
  aspectLabel: 'Aspect',
  bodyBLabel: 'Natal',
  orbLabel: 'Orb',
  applyingLabel: 'Applying',
  applying: 'Applying',
  separating: 'Separating',
  exactOnLabel: 'Exact on',
  exactOnUnknown: 'outside search window',
};

const nl: typeof en = {
  personFallback: 'Persoon',
  solarArcFallback: 'Solar Arc',
  thisPerson: 'Deze persoon',
  notCompleteSolarArc: (name: string) =>
    `Het geboorterecord van ${name} is niet volledig genoeg om solar arc-directies te berekenen. Vul de ontbrekende velden in op de`,
  personPageLink: 'persoonspagina',
  needsKnownTime: (name: string) =>
    `Solar arc-directies vereisen een bekende geboortetijd. De geboortetijd van ${name} is onbekend — dezelfde reden waarom hun horoscoop geen huizen heeft.`,

  heading: (name: string) => `Solar arc-directies van ${name}`,
  hint: 'Elk natal hemellichaam en elke hoek wordt verschoven met dezelfde boog — de afstand die de Zon zelf heeft afgelegd sinds de geboorte, in symbolische (een-dag-voor-een-jaar) tijd. In tegenstelling tot een progressieve horoscoop hangt hier niets af van een progressieve Maan of planetaire snelheid.',
  asOfLabel: 'Vanaf',
  calculating: 'Berekenen…',
  error: (message: string) => `Solar arc-directies konden niet worden berekend. ${message}`,

  ageLine: (age: string) => `Leeftijd ${age}`,
  beforeBirth: '(vóór de geboorte)',
  arcLine: (arc: string) => `Boog: ${arc}°`,

  positionsCaption: 'Gedirigeerde posities',
  contactsCaption: 'Gedirigeerd-natale contacten',
  noContacts: 'Geen gedirigeerd-natale contacten binnen orb.',

  bodyLabel: 'Hemellichaam',
  signLabel: 'Teken',
  degLabel: 'Gr',
  minLabel: 'Min',
  secLabel: 'Sec',
  houseLabel: 'Huis',

  bodyALabel: 'Gedirigeerd',
  aspectLabel: 'Aspect',
  bodyBLabel: 'Natal',
  orbLabel: 'Orb',
  applyingLabel: 'Toenemend',
  applying: 'Toenemend',
  separating: 'Afnemend',
  exactOnLabel: 'Exact op',
  exactOnUnknown: 'buiten zoekvenster',
};

export const solarArcViewMessages = { en, nl };
