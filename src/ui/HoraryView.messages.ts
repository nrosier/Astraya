/** Message catalogue for `HoraryView.tsx` (#406). */
const en = {
  heading: 'Horary chart',
  hint: 'Cast a chart for the moment and place a question was asked, and check the traditional considerations before judgment. This tells you whether the chart is fit to be judged; it does not answer the question.',
  dateLabel: 'Date the question was asked',
  timeLabel: 'Local time',
  latitudeLabel: 'Latitude',
  longitudeLabel: 'Longitude',
  houseSystemLabel: 'House system',
  houseSystems: {
    R: 'Regiomontanus (the horary tradition’s)',
    P: 'Placidus',
    W: 'Whole sign',
  } as Record<string, string>,
  castButton: 'Cast chart',
  casting: 'Casting…',
  fieldErrors: {
    date: 'Enter a real date.',
    time: 'Enter a time such as 14:30.',
    latitude: 'Enter a latitude in decimal degrees, from -90 to 90.',
    longitude: 'Enter a longitude in decimal degrees, from -180 to 180.',
  },
  error: (message: string) => `The chart could not be cast. ${message}`,
  considerationsHeading: 'Considerations before judgment',
  radical: 'None of the considerations applies: the chart is fit to be judged.',
  notRadical: (count: number) =>
    `${String(count)} ${count === 1 ? 'consideration applies' : 'considerations apply'}. Traditionally the chart should then not be judged, or judged only with great care.`,
  applies: 'Applies',
  clear: 'Clear',
  considerations: {
    'ascendant-too-early': {
      label: 'Ascendant too early',
      explanation: 'The Ascendant is in the first 3° of its sign: the matter is not yet ripe to judge.',
    },
    'ascendant-too-late': {
      label: 'Ascendant too late',
      explanation: 'The Ascendant is in the last 3° of its sign: the matter is already decided.',
    },
    'moon-void-of-course': {
      label: 'Moon void of course',
      explanation: 'The Moon makes no further major aspect before leaving its sign: nothing will come of the matter.',
    },
    'moon-via-combusta': {
      label: 'Moon in the Via Combusta',
      explanation: 'The Moon is between 15° Libra and 15° Scorpio, the “burnt way”.',
    },
    'saturn-in-seventh': {
      label: 'Saturn in the seventh house',
      explanation: 'Saturn in the astrologer’s own house is said to impair the astrologer’s judgment.',
    },
  } as Record<string, { label: string; explanation: string }>,
  chartName: 'Horary chart',
  noHouses: 'No houses can be cast for this place and time, so the Ascendant and Saturn’s house cannot be checked.',
  horaryLink: 'Horary chart',
};

const nl: typeof en = {
  heading: 'Horoscoop voor een vraag',
  hint: 'Maak een horoscoop voor het moment en de plaats waarop een vraag werd gesteld, en controleer de traditionele overwegingen vóór het oordeel. Dit zegt of de horoscoop geschikt is om te beoordelen; het beantwoordt de vraag niet.',
  dateLabel: 'Datum waarop de vraag werd gesteld',
  timeLabel: 'Lokale tijd',
  latitudeLabel: 'Breedtegraad',
  longitudeLabel: 'Lengtegraad',
  houseSystemLabel: 'Huizensysteem',
  houseSystems: {
    R: 'Regiomontanus (dat van de horaire traditie)',
    P: 'Placidus',
    W: 'Hele tekens',
  },
  castButton: 'Horoscoop maken',
  casting: 'Bezig…',
  fieldErrors: {
    date: 'Voer een bestaande datum in.',
    time: 'Voer een tijd in zoals 14:30.',
    latitude: 'Voer een breedtegraad in decimale graden in, van -90 tot 90.',
    longitude: 'Voer een lengtegraad in decimale graden in, van -180 tot 180.',
  },
  error: (message: string) => `De horoscoop kon niet worden gemaakt. ${message}`,
  considerationsHeading: 'Overwegingen vóór het oordeel',
  radical: 'Geen van de overwegingen is van toepassing: de horoscoop is geschikt om te beoordelen.',
  notRadical: (count: number) =>
    `${String(count)} ${count === 1 ? 'overweging is van toepassing' : 'overwegingen zijn van toepassing'}. Traditioneel moet de horoscoop dan niet worden beoordeeld, of alleen met grote zorg.`,
  applies: 'Van toepassing',
  clear: 'Niet van toepassing',
  considerations: {
    'ascendant-too-early': {
      label: 'Ascendant te vroeg',
      explanation: 'De Ascendant staat in de eerste 3° van zijn teken: de zaak is nog niet rijp om te beoordelen.',
    },
    'ascendant-too-late': {
      label: 'Ascendant te laat',
      explanation: 'De Ascendant staat in de laatste 3° van zijn teken: de zaak is al beslist.',
    },
    'moon-void-of-course': {
      label: 'Maan zonder koers',
      explanation: 'De Maan maakt geen hoofdaspect meer voordat ze haar teken verlaat: er komt niets van de zaak.',
    },
    'moon-via-combusta': {
      label: 'Maan in de Via Combusta',
      explanation: 'De Maan staat tussen 15° Weegschaal en 15° Schorpioen, de “verbrande weg”.',
    },
    'saturn-in-seventh': {
      label: 'Saturnus in het zevende huis',
      explanation: 'Saturnus in het eigen huis van de astroloog zou het oordeel van de astroloog schaden.',
    },
  },
  chartName: 'Horoscoop voor een vraag',
  noHouses:
    'Voor deze plaats en tijd kunnen geen huizen worden berekend, dus de Ascendant en het huis van Saturnus kunnen niet worden gecontroleerd.',
  horaryLink: 'Horoscoop voor een vraag',
};

export const horaryViewMessages = { en, nl };
