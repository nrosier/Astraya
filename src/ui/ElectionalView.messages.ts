/** Message catalogue for `ElectionalView.tsx` (#409). */
const en = {
  heading: 'Electional search',
  hint: 'Find the best times in a span of days to begin something. Choose which traditional rules matter for your purpose; the search walks the span and ranks the stretches of time by how many of your rules hold. No moment satisfies every rule at once, so this narrows the choice rather than naming one time.',
  fromDateLabel: 'From (UTC date)',
  toDateLabel: 'To (UTC date, inclusive)',
  latitudeLabel: 'Latitude',
  longitudeLabel: 'Longitude',
  stepLabel: 'Check every',
  stepOption: (minutes: number) =>
    minutes === 60 ? '1 hour' : minutes < 60 ? `${String(minutes)} minutes` : `${String(minutes / 60)} hours`,
  rulesLegend: 'Rules',
  findButton: 'Find times',
  finding: 'Searching…',
  fieldErrors: {
    fromDate: 'Enter a real start date.',
    toDate: 'Enter a real end date.',
    order: 'The end date must not be before the start date.',
    span: (max: number) => `Search at most ${String(max)} days at a time.`,
    latitude: 'Enter a latitude in decimal degrees, from -90 to 90.',
    longitude: 'Enter a longitude in decimal degrees, from -180 to 180.',
    rules: 'Choose at least one rule.',
  },
  error: (message: string) => `The search could not be completed. ${message}`,
  noWindows: 'No windows to show.',
  summary: (count: number, enabled: number) =>
    `Best ${String(count)} ${count === 1 ? 'window' : 'windows'}, ranked by how many of your ${String(enabled)} ${enabled === 1 ? 'rule holds' : 'rules hold'} (times in UTC).`,
  tableCaption: 'Candidate times',
  startColumn: 'From (UTC)',
  endColumn: 'Until (UTC)',
  durationColumn: 'Lasts',
  scoreColumn: 'Rules met',
  satisfiedColumn: 'Holds',
  violatedColumn: 'Does not hold',
  score: (met: number, total: number) => `${String(met)} of ${String(total)}`,
  none: '—',
  rules: {
    'moon-not-void': {
      label: 'Moon not void of course',
      explanation: 'The Moon still has an aspect to make before leaving its sign.',
    },
    'moon-not-via-combusta': {
      label: 'Moon outside the Via Combusta',
      explanation: 'Not between 15° Libra and 15° Scorpio, the “burnt way”.',
    },
    'mercury-direct': {
      label: 'Mercury direct',
      explanation: 'Mercury is not retrograde — the usual caution for contracts, travel and messages.',
    },
    'moon-not-weak': {
      label: 'Moon not in detriment or fall',
      explanation: 'Not in Capricorn or Scorpio, where the Moon is weakest.',
    },
    'moon-waxing': {
      label: 'Moon waxing',
      explanation: 'Increasing in light, between the New and Full Moon — favouring beginnings.',
    },
    'benefic-angular': {
      label: 'A benefic on an angle',
      explanation: 'Venus or Jupiter in the 1st, 4th, 7th or 10th house at the place.',
    },
    'moon-aids-benefic': {
      label: 'Moon applying to a benefic',
      explanation: 'The Moon is closing on a conjunction, sextile or trine of Venus or Jupiter, within 3°.',
    },
  } as Record<string, { label: string; explanation: string }>,
  electionalLink: 'Electional search',
};

const nl: typeof en = {
  heading: 'Electieve zoektocht',
  hint: 'Vind de beste momenten in een reeks dagen om iets te beginnen. Kies welke traditionele regels voor jouw doel tellen; de zoektocht loopt de reeks door en rangschikt de tijdvakken naar hoeveel van je regels gelden. Geen moment voldoet aan alle regels tegelijk, dus dit beperkt de keuze in plaats van één tijdstip aan te wijzen.',
  fromDateLabel: 'Van (UTC-datum)',
  toDateLabel: 'Tot (UTC-datum, inclusief)',
  latitudeLabel: 'Breedtegraad',
  longitudeLabel: 'Lengtegraad',
  stepLabel: 'Controleer elke',
  stepOption: (minutes: number) =>
    minutes === 60 ? '1 uur' : minutes < 60 ? `${String(minutes)} minuten` : `${String(minutes / 60)} uur`,
  rulesLegend: 'Regels',
  findButton: 'Tijden zoeken',
  finding: 'Zoeken…',
  fieldErrors: {
    fromDate: 'Voer een bestaande begindatum in.',
    toDate: 'Voer een bestaande einddatum in.',
    order: 'De einddatum mag niet vóór de begindatum liggen.',
    span: (max: number) => `Zoek maximaal ${String(max)} dagen tegelijk.`,
    latitude: 'Voer een breedtegraad in decimale graden in, van -90 tot 90.',
    longitude: 'Voer een lengtegraad in decimale graden in, van -180 tot 180.',
    rules: 'Kies minstens één regel.',
  },
  error: (message: string) => `De zoekopdracht kon niet worden voltooid. ${message}`,
  noWindows: 'Geen tijdvakken om te tonen.',
  summary: (count: number, enabled: number) =>
    `Beste ${String(count)} ${count === 1 ? 'tijdvak' : 'tijdvakken'}, gerangschikt naar hoeveel van je ${String(enabled)} ${enabled === 1 ? 'regel geldt' : 'regels gelden'} (tijden in UTC).`,
  tableCaption: 'Kandidaat-tijden',
  startColumn: 'Van (UTC)',
  endColumn: 'Tot (UTC)',
  durationColumn: 'Duurt',
  scoreColumn: 'Regels voldaan',
  satisfiedColumn: 'Geldt',
  violatedColumn: 'Geldt niet',
  score: (met: number, total: number) => `${String(met)} van ${String(total)}`,
  none: '—',
  rules: {
    'moon-not-void': {
      label: 'Maan niet zonder koers',
      explanation: 'De Maan maakt nog een aspect voordat ze haar teken verlaat.',
    },
    'moon-not-via-combusta': {
      label: 'Maan buiten de Via Combusta',
      explanation: 'Niet tussen 15° Weegschaal en 15° Schorpioen, de “verbrande weg”.',
    },
    'mercury-direct': {
      label: 'Mercurius directlopend',
      explanation: 'Mercurius is niet retrograde — de gebruikelijke waarschuwing voor contracten, reizen en berichten.',
    },
    'moon-not-weak': {
      label: 'Maan niet in schade of val',
      explanation: 'Niet in Steenbok of Schorpioen, waar de Maan het zwakst is.',
    },
    'moon-waxing': {
      label: 'Wassende Maan',
      explanation: 'Toenemend in licht, tussen nieuwe en volle maan — gunstig voor een begin.',
    },
    'benefic-angular': {
      label: 'Een weldoener op een hoek',
      explanation: 'Venus of Jupiter in het 1e, 4e, 7e of 10e huis op de plaats.',
    },
    'moon-aids-benefic': {
      label: 'Maan nadert een weldoener',
      explanation: 'De Maan nadert een conjunctie, sextiel of trigoon van Venus of Jupiter, binnen 3°.',
    },
  },
  electionalLink: 'Electieve zoektocht',
};

export const electionalViewMessages = { en, nl };
