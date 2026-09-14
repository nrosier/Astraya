/**
 * Message catalogue for `CompositeView.tsx` (#158).
 */
const en = {
  personFallback: 'Person',
  thisPerson: 'This person',
  compositeFallback: 'Composite',
  needsCompleteRecord: (name: string) =>
    `A composite chart needs midpoint houses from both people, so it needs a complete birth record with a known time. ${name}’s does not have one yet. Fill in or correct it on the`,
  personPageLink: 'person page',

  heading: (name: string) => `${name}’s composite`,
  hint: 'A synthetic midpoint chart between two natal charts — every position and house cusp is the near-arc midpoint of the two. Only people with a complete, known-time birth record can be combined.',

  composeWithLabel: 'Compose with',
  choosePersonOption: 'Choose a person…',
  unnamedOption: 'Unnamed',
  partnerGoneWarning: 'That person is no longer available to compose with.',

  personALabel: 'Person A',
  personBLabel: 'Person B',
};

const nl: typeof en = {
  personFallback: 'Persoon',
  thisPerson: 'Deze persoon',
  compositeFallback: 'Composiet',
  needsCompleteRecord: (name: string) =>
    `Een composiethoroscoop heeft middelpunt-huizen van beide mensen nodig, dus is een volledig geboorterecord met een bekende tijd vereist. Dat van ${name} is nog niet compleet. Vul het aan of corrigeer het op de`,
  personPageLink: 'persoonspagina',

  heading: (name: string) => `Composiet van ${name}`,
  hint: 'Een synthetische middelpunt-horoscoop tussen twee natale horoscopen — elke positie en huisspits is het kortste-boog-middelpunt van de twee. Alleen mensen met een volledig, bekend-tijd geboorterecord kunnen worden gecombineerd.',

  composeWithLabel: 'Combineren met',
  choosePersonOption: 'Kies een persoon…',
  unnamedOption: 'Naamloos',
  partnerGoneWarning: 'Die persoon is niet langer beschikbaar om mee te combineren.',

  personALabel: 'Persoon A',
  personBLabel: 'Persoon B',
};

export const compositeViewMessages = { en, nl };
