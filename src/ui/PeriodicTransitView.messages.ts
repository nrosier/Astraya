/**
 * Message catalogue for `PeriodicTransitView.tsx` (#158).
 */
const en = {
  forecastFallback: 'Forecast',
  personFallback: 'Person',
  thisPerson: 'This person',
  thisFallback: 'this',
  notCompleteForecast: (name: string) =>
    `${name}’s birth record is not complete enough to calculate a forecast yet. Fill in the missing fields on the`,
  personPageLink: 'person page',
  needsKnownTime: (name: string) =>
    `A transit forecast casts against the natal houses, so it needs a known birth time. ${name}’s birth time is unknown — the same reason their chart has no houses.`,

  heading: (name: string) => `${name}’s forecast`,
  hint: (name: string) =>
    `What’s happening in the sky against ${name}’s natal chart: the transiting Moon and anything exact today, aspects going exact this week and this month, and this year’s solar return. All times are UT.`,
  asOfLabel: 'As of',
  calculating: 'Calculating…',
  error: (message: string) => `The forecast could not be calculated. ${message}`,

  signFallback: (n: string) => `sign ${n}`,

  dailyHeading: 'Daily',
  moonInLabel: 'Moon in',
  houseSuffix: (house: number) => `, house ${String(house)}`,
  retrograde: '(retrograde)',
  moonAspectsCaption: 'Moon’s aspects to the natal chart',
  exactTodayCaption: 'Exact today',
  stationsTodayCaption: 'Stations today',

  weeklyHeading: 'Weekly',
  exactThisWeekCaption: 'Exact this week',
  noAspectsWeek: 'No aspects go exact this week.',

  monthlyHeading: 'Monthly',
  sunInThisMonth: (signHouse: string, from: string, to: string) =>
    `Sun in ${signHouse} this month, from ${from} to ${to}.`,
  exactThisMonthCaption: 'Exact this month',
  noAspectsMonth: 'No aspects go exact this month.',

  yearlyHeading: 'Yearly',
  solarReturnSentence: (year: string, date: string, sign: string) =>
    `Solar return for ${year}: ${date}, Ascendant in ${sign}.`,
  solarReturnContactsCaption: 'Solar return contacts to the natal chart',

  exactLabel: 'Exact',
  forecastLabel: 'Forecast',
  bodyLabel: 'Body',
  directionLabel: 'Direction',
  orbLabel: 'Orb',
  applyingLabel: 'Applying',
  applying: 'Applying',
  separating: 'Separating',
  turnsRetrograde: 'Turns retrograde',
  turnsDirect: 'Turns direct',
};

const nl: typeof en = {
  forecastFallback: 'Vooruitzicht',
  personFallback: 'Persoon',
  thisPerson: 'Deze persoon',
  thisFallback: 'deze',
  notCompleteForecast: (name: string) =>
    `Het geboorterecord van ${name} is niet volledig genoeg om een vooruitzicht te berekenen. Vul de ontbrekende velden in op de`,
  personPageLink: 'persoonspagina',
  needsKnownTime: (name: string) =>
    `Een transitvooruitzicht wordt berekend tegen de natale huizen, dus is een bekende geboortetijd nodig. De geboortetijd van ${name} is onbekend — dezelfde reden waarom hun horoscoop geen huizen heeft.`,

  heading: (name: string) => `Vooruitzicht van ${name}`,
  hint: (name: string) =>
    `Wat er in de lucht gebeurt tegenover de natale horoscoop van ${name}: de transiterende Maan en alles wat vandaag exact is, aspecten die deze week en deze maand exact worden, en de solar return van dit jaar. Alle tijden zijn in UT.`,
  asOfLabel: 'Vanaf',
  calculating: 'Berekenen…',
  error: (message: string) => `Het vooruitzicht kon niet worden berekend. ${message}`,

  signFallback: (n: string) => `teken ${n}`,

  dailyHeading: 'Dagelijks',
  moonInLabel: 'Maan in',
  houseSuffix: (house: number) => `, huis ${String(house)}`,
  retrograde: '(retrograde)',
  moonAspectsCaption: 'Aspecten van de Maan met de natale horoscoop',
  exactTodayCaption: 'Exact vandaag',
  stationsTodayCaption: 'Stations vandaag',

  weeklyHeading: 'Wekelijks',
  exactThisWeekCaption: 'Exact deze week',
  noAspectsWeek: 'Er worden deze week geen aspecten exact.',

  monthlyHeading: 'Maandelijks',
  sunInThisMonth: (signHouse: string, from: string, to: string) =>
    `Zon in ${signHouse} deze maand, van ${from} tot ${to}.`,
  exactThisMonthCaption: 'Exact deze maand',
  noAspectsMonth: 'Er worden deze maand geen aspecten exact.',

  yearlyHeading: 'Jaarlijks',
  solarReturnSentence: (year: string, date: string, sign: string) =>
    `Solar return voor ${year}: ${date}, Ascendant in ${sign}.`,
  solarReturnContactsCaption: 'Contacten van de solar return met de natale horoscoop',

  exactLabel: 'Exact',
  forecastLabel: 'Vooruitzicht',
  bodyLabel: 'Hemellichaam',
  directionLabel: 'Richting',
  orbLabel: 'Orb',
  applyingLabel: 'Toenemend',
  applying: 'Toenemend',
  separating: 'Afnemend',
  turnsRetrograde: 'Wordt retrograde',
  turnsDirect: 'Wordt direct',
};

export const periodicTransitViewMessages = { en, nl };
