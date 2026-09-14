/**
 * Message catalogue for `SynastryView.tsx` (#158).
 */
const en = {
  personFallback: 'Person',
  thisPerson: 'This person',
  synastryFallback: 'Synastry',
  needsCompleteRecord: (name: string) =>
    `A synastry bi-wheel needs houses on both rings, so it needs a complete birth record with a known time. ${name}’s does not have one yet. Fill in or correct it on the`,
  personPageLink: 'person page',

  heading: (name: string) => `${name}’s synastry`,
  hint: 'A bi-wheel comparing two natal charts, plus the aspects between them. Only people with a complete, known-time birth record can be compared.',

  compareWithLabel: 'Compare with',
  choosePersonOption: 'Choose a person…',
  unnamedOption: 'Unnamed',
  partnerGoneWarning: 'That person is no longer available to compare with.',

  calculating: 'Calculating…',
  error: (message: string) => `Synastry could not be calculated. ${message}`,

  aspectsCaption: 'Aspects',
  personALabel: 'Person A',
  aspectLabel: 'Aspect',
  personBLabel: 'Person B',
  orbLabel: 'Orb',
  applyingLabel: 'Applying',
  applying: 'Applying',
  separating: 'Separating',
};

const nl: typeof en = {
  personFallback: 'Persoon',
  thisPerson: 'Deze persoon',
  synastryFallback: 'Synastrie',
  needsCompleteRecord: (name: string) =>
    `Een synastrie-biwiel heeft huizen op beide ringen nodig, dus is een volledig geboorterecord met een bekende tijd vereist. Dat van ${name} is nog niet compleet. Vul het aan of corrigeer het op de`,
  personPageLink: 'persoonspagina',

  heading: (name: string) => `Synastrie van ${name}`,
  hint: 'Een biwiel dat twee natale horoscopen vergelijkt, plus de aspecten daartussen. Alleen mensen met een volledig, bekend-tijd geboorterecord kunnen worden vergeleken.',

  compareWithLabel: 'Vergelijken met',
  choosePersonOption: 'Kies een persoon…',
  unnamedOption: 'Naamloos',
  partnerGoneWarning: 'Die persoon is niet langer beschikbaar om mee te vergelijken.',

  calculating: 'Berekenen…',
  error: (message: string) => `Synastrie kon niet worden berekend. ${message}`,

  aspectsCaption: 'Aspecten',
  personALabel: 'Persoon A',
  aspectLabel: 'Aspect',
  personBLabel: 'Persoon B',
  orbLabel: 'Orb',
  applyingLabel: 'Toenemend',
  applying: 'Toenemend',
  separating: 'Afnemend',
};

export const synastryViewMessages = { en, nl };
