/**
 * Message catalogue for `AstrocartographyView.tsx` (#158).
 */
const en = {
  personFallback: 'Person',
  astrocartographyFallback: 'Astrocartography',
  thisPerson: 'This person',
  notCompleteMap: (name: string) =>
    `${name}’s birth record is not complete enough to calculate a map yet. Fill in the missing fields on the`,
  personPageLink: 'person page',
  needsKnownTime: (name: string) =>
    `Astrocartography lines shift about 15° of longitude per hour of birth-time error, so this needs a known birth time. ${name}’s birth time is unknown — the same reason their chart has no houses.`,

  heading: (name: string) => `${name}’s astrocartography`,
  hint: 'Where in the world each body’s angles (MC/IC/AC/DC) fall on the horizon or meridian right now, plus optional Local Space lines (azimuth vectors from the birthplace). Line kind is shown by both colour and dash pattern, so it stays readable without colour.',

  lineTypesLegend: 'Line types',
  mc: 'MC (Midheaven)',
  ic: 'IC (Nadir)',
  ac: 'AC (Ascendant)',
  dc: 'DC (Descendant)',

  bodiesLegend: 'Bodies',
  extendedSummary: 'Extended',

  localSpaceLegend: 'Local Space',
  showLocalSpaceLines: 'Show Local Space lines for the checked bodies',

  relocationLegend: 'Relocation (optional)',
  relocationHint: 'Recomputes the Ascendant/Midheaven for another place, without changing any line above.',
  latitudeLabel: 'Latitude',
  longitudeLabel: 'Longitude',
  relocatedAscendantMidheaven: (ascendant: string, midheaven: string) =>
    `Ascendant: ${ascendant} · Midheaven: ${midheaven}`,

  calculating: 'Calculating…',
  error: (message: string) => `The map could not be calculated. ${message}`,

  downloadSvg: 'Download SVG',
  pngResolutionLabel: 'PNG resolution',
  rendering: 'Rendering…',
  downloadPng: 'Download PNG',

  pngSmall: 'Small (900px)',
  pngMedium: 'Medium (1800px)',
  pngLarge: 'Large (3600px)',
};

const nl: typeof en = {
  personFallback: 'Persoon',
  astrocartographyFallback: 'Astrocartografie',
  thisPerson: 'Deze persoon',
  notCompleteMap: (name: string) =>
    `Het geboorterecord van ${name} is niet volledig genoeg om een kaart te berekenen. Vul de ontbrekende velden in op de`,
  personPageLink: 'persoonspagina',
  needsKnownTime: (name: string) =>
    `Astrocartografielijnen verschuiven ongeveer 15° lengtegraad per uur geboortetijdfout, dus is een bekende geboortetijd vereist. De geboortetijd van ${name} is onbekend — dezelfde reden waarom hun horoscoop geen huizen heeft.`,

  heading: (name: string) => `Astrocartografie van ${name}`,
  hint: 'Waar op de wereld de hoeken (MC/IC/AC/DC) van elk hemellichaam nu op de horizon of meridiaan vallen, plus optionele Local Space-lijnen (azimutvectoren vanaf de geboorteplaats). Het lijntype wordt zowel door kleur als streeppatroon getoond, zodat het ook zonder kleur leesbaar blijft.',

  lineTypesLegend: 'Lijntypen',
  mc: 'MC (Midheaven)',
  ic: 'IC (Nadir)',
  ac: 'AC (Ascendant)',
  dc: 'DC (Descendant)',

  bodiesLegend: 'Hemellichamen',
  extendedSummary: 'Uitgebreid',

  localSpaceLegend: 'Local Space',
  showLocalSpaceLines: 'Toon Local Space-lijnen voor de aangevinkte hemellichamen',

  relocationLegend: 'Relocatie (optioneel)',
  relocationHint:
    'Berekent de Ascendant/Midheaven opnieuw voor een andere plaats, zonder de lijnen hierboven te wijzigen.',
  latitudeLabel: 'Breedtegraad',
  longitudeLabel: 'Lengtegraad',
  relocatedAscendantMidheaven: (ascendant: string, midheaven: string) =>
    `Ascendant: ${ascendant} · Midheaven: ${midheaven}`,

  calculating: 'Berekenen…',
  error: (message: string) => `De kaart kon niet worden berekend. ${message}`,

  downloadSvg: 'SVG downloaden',
  pngResolutionLabel: 'PNG-resolutie',
  rendering: 'Renderen…',
  downloadPng: 'PNG downloaden',

  pngSmall: 'Klein (900px)',
  pngMedium: 'Middel (1800px)',
  pngLarge: 'Groot (3600px)',
};

export const astrocartographyViewMessages = { en, nl };
