/**
 * Message catalogue for `BiWheelSelectionPanel.tsx` (#418).
 */
const en = {
  clear: 'Clear',
  hint: 'Click a planet, sign or aspect line to highlight it and its connections. Click it again, or an empty spot, to clear.',
  retrograde: 'retrograde',
  orbLabel: 'Orb',
  applying: 'applying',
  separating: 'separating',
  /** "Saturn (Transiting)" — a body together with the ring it is on. */
  onRing: (body: string, ring: string) => `${body} (${ring})`,
  /** "In Natal house 7" — where a body of one ring falls among the first ring's houses. */
  inHouse: (ring: string, house: number) => `In ${ring} house ${String(house)}`,
  noContacts: 'No aspects to the other ring within orb.',
  contactsHeading: 'Aspects to the other ring',
  ownAspectsHeading: (ring: string) => `Aspects within ${ring}`,
  signEmpty: 'No planets in this sign.',
  aspectBetween: (aspect: string, a: string, b: string) => `${aspect}: ${a} and ${b}`,
};

const nl: typeof en = {
  clear: 'Wissen',
  hint: 'Klik op een planeet, teken of aspectlijn om die en de verbindingen te markeren. Klik er nogmaals op, of op een lege plek, om te wissen.',
  retrograde: 'retrograde',
  orbLabel: 'Orb',
  applying: 'toenemend',
  separating: 'afnemend',
  onRing: (body, ring) => `${body} (${ring})`,
  inHouse: (ring, house) => `In ${ring} huis ${String(house)}`,
  noContacts: 'Geen aspecten naar de andere ring binnen de orb.',
  contactsHeading: 'Aspecten naar de andere ring',
  ownAspectsHeading: (ring) => `Aspecten binnen ${ring}`,
  signEmpty: 'Geen planeten in dit teken.',
  aspectBetween: (aspect, a, b) => `${aspect}: ${a} en ${b}`,
};

export const biWheelSelectionPanelMessages = { en, nl };
