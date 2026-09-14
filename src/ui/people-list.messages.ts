/**
 * Message catalogue for `people-list.ts`'s `summary()` (#158).
 */
const en = {
  noChartYet: (missing: string) => `No chart yet — still needed: ${missing}`,
  birthData: 'birth data',
  timeUnknown: 'time unknown',
  placeNotRecorded: 'place not recorded',
};

const nl: typeof en = {
  noChartYet: (missing: string) => `Nog geen horoscoop — nog nodig: ${missing}`,
  birthData: 'geboortegegevens',
  timeUnknown: 'tijd onbekend',
  placeNotRecorded: 'plaats niet geregistreerd',
};

export const peopleListMessages = { en, nl };
