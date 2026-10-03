/**
 * Message catalogue for `ChartView.tsx` (#158).
 */
const en = {
  signLabel: 'Sign',
  degLabel: 'Deg',
  minLabel: 'Min',
  secLabel: 'Sec',
  houseLabel: 'House',
  speedLabel: 'Speed',
  rxLabel: 'Rx',
  symbolLabel: 'Symbol',
  bodyLabel: 'Body',
  angleLabel: 'Angle',
  bodyALabel: 'Body A',
  aspectLabel: 'Aspect',
  bodyBLabel: 'Body B',
  orbLabel: 'Orb',
  applyingLabel: 'Applying',
  applying: 'Applying',
  separating: 'Separating',
  rulerLabel: 'Ruler',
  exaltedLabel: 'Exalted',
  detrimentLabel: 'Detriment',
  fallLabel: 'Fall',
  pointLabel: 'Point',
  anareticLabel: 'Anaretic',
  outOfBoundsLabel: 'OOB',
  triplicityLabel: 'Triplicity',
  boundLabel: 'Bound',
  faceLabel: 'Face',
  dignityPointsLabel: 'Points',
  peregrineLabel: 'Peregrine',
  chainLabel: 'Chain',
  finalDispositorLabel: 'Final dispositor',
  mutualReceptionLabel: 'Mutual reception',
  cycleLabel: 'Cycle',
  contactLabel: 'Contact',
  kindLabel: 'Kind',
  starLabel: 'Star',
  parallel: 'Parallel',
  contraparallel: 'Contraparallel',
  antiscion: 'Antiscion',
  contraAntiscion: 'Contra-antiscion',

  positionsCaption: 'Positions',
  housesCaption: 'Houses',
  anglesCaption: 'Angles',
  aspectsCaption: 'Aspects',
  dignitiesCaption: 'Dignities',
  derivedPointsCaption: 'Derived points',
  dispositorsCaption: 'Dispositors',
  declinationsCaption: 'Declinations',
  antisciaCaption: 'Antiscia',
  fixedStarsCaption: 'Fixed stars',

  almutenOfAscendantSentence: (names: string) => `Almuten of the Ascendant: ${names}`,
  // Jones' own seven pattern names (#35, #398) have no established Dutch astrological
  // vocabulary, the same out-of-scope treatment house-system names and "Harmonic"/"Solar
  // return" already get (#158's glossary) — kept untranslated in both locales.
  jonesShapeLabels: {
    bundle: 'Bundle',
    bowl: 'Bowl',
    locomotive: 'Locomotive',
    bucket: 'Bucket',
    seesaw: 'Seesaw',
    splay: 'Splay',
    splash: 'Splash',
  },
  chartShapeSentence: (shape: string, handle: string | undefined) =>
    handle === undefined ? `Chart shape: ${shape}.` : `Chart shape: ${shape} (handle: ${handle}).`,

  lunarPhaseLabels: {
    new: 'New Moon',
    crescent: 'Crescent Moon',
    'first-quarter': 'First Quarter Moon',
    gibbous: 'Gibbous Moon',
    full: 'Full Moon',
    disseminating: 'Disseminating Moon',
    'last-quarter': 'Last Quarter Moon',
    balsamic: 'Balsamic Moon',
  },
  lunarPhaseSentence: (phase: string, elongation: string, waxing: boolean, litPercent: number) =>
    `Lunar phase: ${phase} — ${elongation} ahead of the Sun, ${waxing ? 'waxing' : 'waning'}, ${String(litPercent)}% lit.`,

  sectPrefix: 'Sect:',
  dayChart: 'Day chart',
  nightChart: 'Night chart',

  pngSmall: 'Small (600px)',
  pngMedium: 'Medium (1200px)',
  pngLarge: 'Large (2400px)',

  linkCopied: 'Link copied',
  copyShareLink: 'Copy share link',
  shareLinkHint:
    'The link holds the whole birth record and settings — nothing is sent to us to create it, and opening it needs no account.',
  // The other side of the same fact (#341): because the data is in the link and not on a
  // server, there is nothing to revoke. Worth saying at the moment of copying rather than
  // in a settings screen nobody opens.
  shareLinkWarning:
    'Anyone who has the link can read that birth data, and it cannot be revoked — sharing it is permanent wherever it is pasted.',

  housesUnknownHint: (name: string) =>
    `The birth time for ${name} is unknown, so houses, angles and the Ascendant-based derived points cannot be calculated — they are not shown below. Positions, aspects and dignities are still meaningful, though the Moon’s sign may be uncertain.`,

  housesUndefinedHint: (name: string) =>
    `The chosen house system has no valid solution for ${name}’s birth place at this exact time, so houses, angles and the Ascendant-based derived points are not shown below. This is different from an unknown birth time — try a different house system in Extended settings, or a location further from the poles. Positions, aspects and dignities are still meaningful.`,

  calculating: 'Calculating…',
  chartError: (message: string) => `The chart could not be calculated. ${message}`,

  astrochartReferenceHeading: 'AstroChart reference rendering (dev only)',
  astrochartReferenceHint: 'Shown for comparison only — exports always use Astraya’s own rendering above.',

  downloadSvg: 'Download SVG',
  pngResolutionLabel: 'PNG resolution',
  rendering: 'Rendering…',
  downloadPng: 'Download PNG',
  exportPdf: 'Export PDF…',
  exportPdfHint:
    '“Export PDF” opens your browser’s print dialog with the wheel and every data table laid out for paper — choose “Save as PDF” there.',

  chartDataTablist: 'Chart data',

  thisPerson: 'this person',
  thisPersonCapitalized: 'This person',
  personFallback: 'Person',
  chartFallback: 'Chart',
  natalFallback: 'Natal',
  notCompleteChart: (name: string) =>
    `${name}’s birth record is not complete enough to calculate a chart yet. Fill in the missing fields on the`,
  personPageLink: 'person page',

  isolationClear: 'Clear',
  isolationSignEmpty: 'No planets in this sign.',
  wheelClickHint:
    'Click a planet, sign or aspect line to highlight it and its connections. Click it again, or an empty spot, to clear.',
};

const nl: typeof en = {
  signLabel: 'Teken',
  degLabel: 'Gr',
  minLabel: 'Min',
  secLabel: 'Sec',
  houseLabel: 'Huis',
  speedLabel: 'Snelheid',
  rxLabel: 'Rx',
  symbolLabel: 'Symbool',
  bodyLabel: 'Hemellichaam',
  angleLabel: 'Hoek',
  bodyALabel: 'Hemellichaam A',
  aspectLabel: 'Aspect',
  bodyBLabel: 'Hemellichaam B',
  orbLabel: 'Orb',
  applyingLabel: 'Toenemend',
  applying: 'Toenemend',
  separating: 'Afnemend',
  rulerLabel: 'Heerser',
  exaltedLabel: 'Verheven',
  detrimentLabel: 'Val (detriment)',
  fallLabel: 'Val',
  pointLabel: 'Punt',
  anareticLabel: 'Anaretisch',
  outOfBoundsLabel: 'OOB',
  triplicityLabel: 'Triplicitiet',
  boundLabel: 'Bound',
  faceLabel: 'Decaan',
  dignityPointsLabel: 'Punten',
  peregrineLabel: 'Peregrine',
  chainLabel: 'Keten',
  finalDispositorLabel: 'Uiteindelijke dispositor',
  mutualReceptionLabel: 'Wederzijdse ontvangst',
  cycleLabel: 'Kringloop',
  contactLabel: 'Contact',
  kindLabel: 'Soort',
  starLabel: 'Ster',
  parallel: 'Parallel',
  contraparallel: 'Contraparallel',
  antiscion: 'Antiscion',
  contraAntiscion: 'Contra-antiscion',

  positionsCaption: 'Posities',
  housesCaption: 'Huizen',
  anglesCaption: 'Hoeken',
  aspectsCaption: 'Aspecten',
  dignitiesCaption: 'Waardigheden',
  derivedPointsCaption: 'Afgeleide punten',
  dispositorsCaption: 'Dispositors',
  declinationsCaption: 'Declinaties',
  antisciaCaption: 'Antiscia',
  fixedStarsCaption: 'Vaste sterren',

  almutenOfAscendantSentence: (names: string) => `Almuten van de Ascendant: ${names}`,
  jonesShapeLabels: {
    bundle: 'Bundle',
    bowl: 'Bowl',
    locomotive: 'Locomotive',
    bucket: 'Bucket',
    seesaw: 'Seesaw',
    splay: 'Splay',
    splash: 'Splash',
  },
  chartShapeSentence: (shape: string, handle: string | undefined) =>
    handle === undefined ? `Horoscoopvorm: ${shape}.` : `Horoscoopvorm: ${shape} (handvat: ${handle}).`,

  lunarPhaseLabels: {
    new: 'Nieuwe maan',
    crescent: 'Wassende sikkel',
    'first-quarter': 'Eerste kwartier',
    gibbous: 'Wassende maan',
    full: 'Volle maan',
    disseminating: 'Afnemende maan',
    'last-quarter': 'Laatste kwartier',
    balsamic: 'Balsamische maan',
  },
  lunarPhaseSentence: (phase: string, elongation: string, waxing: boolean, litPercent: number) =>
    `Maanfase: ${phase} — ${elongation} voor op de Zon, ${waxing ? 'wassend' : 'afnemend'}, ${String(litPercent)}% verlicht.`,

  sectPrefix: 'Sect:',
  dayChart: 'Daghoroscoop',
  nightChart: 'Nachthoroscoop',

  pngSmall: 'Klein (600px)',
  pngMedium: 'Middel (1200px)',
  pngLarge: 'Groot (2400px)',

  linkCopied: 'Link gekopieerd',
  copyShareLink: 'Deellink kopiëren',
  shareLinkHint:
    'De link bevat het hele geboorterecord en de instellingen — er wordt niets naar ons verzonden om hem te maken, en het openen ervan vereist geen account.',
  shareLinkWarning:
    'Iedereen met de link kan die geboortegegevens lezen, en de link kan niet worden ingetrokken — delen is definitief, waar de link ook geplakt wordt.',

  housesUnknownHint: (name: string) =>
    `De geboortetijd van ${name} is onbekend, dus huizen, hoeken en de op de Ascendant gebaseerde afgeleide punten kunnen niet worden berekend — ze worden hieronder niet getoond. Posities, aspecten en waardigheden blijven zinvol, al kan het teken van de Maan onzeker zijn.`,

  housesUndefinedHint: (name: string) =>
    `Het gekozen huizensysteem heeft geen geldige oplossing voor de geboorteplaats van ${name} op dit exacte moment, dus huizen, hoeken en de op de Ascendant gebaseerde afgeleide punten worden hieronder niet getoond. Dit is iets anders dan een onbekende geboortetijd — probeer een ander huizensysteem bij Uitgebreide instellingen, of een locatie verder van de polen. Posities, aspecten en waardigheden blijven zinvol.`,

  calculating: 'Berekenen…',
  chartError: (message: string) => `De horoscoop kon niet worden berekend. ${message}`,

  astrochartReferenceHeading: 'AstroChart-referentieweergave (alleen dev)',
  astrochartReferenceHint:
    'Alleen getoond ter vergelijking — exports gebruiken altijd Astraya’s eigen weergave hierboven.',

  downloadSvg: 'SVG downloaden',
  pngResolutionLabel: 'PNG-resolutie',
  rendering: 'Renderen…',
  downloadPng: 'PNG downloaden',
  exportPdf: 'PDF exporteren…',
  exportPdfHint:
    '“PDF exporteren” opent het afdrukdialoogvenster van je browser met het wiel en elke gegevenstabel opgemaakt voor papier — kies daar “Opslaan als PDF”.',

  chartDataTablist: 'Horoscoopgegevens',

  thisPerson: 'deze persoon',
  thisPersonCapitalized: 'Deze persoon',
  personFallback: 'Persoon',
  chartFallback: 'Horoscoop',
  natalFallback: 'Natal',
  notCompleteChart: (name: string) =>
    `Het geboorterecord van ${name} is niet volledig genoeg om een horoscoop te berekenen. Vul de ontbrekende velden in op de`,
  personPageLink: 'persoonspagina',

  isolationClear: 'Wissen',
  isolationSignEmpty: 'Geen planeten in dit teken.',
  wheelClickHint:
    'Klik op een planeet, teken of aspectlijn om die en zijn verbindingen uit te lichten. Klik nogmaals, of op een lege plek, om te wissen.',
};

export const chartViewMessages = { en, nl };
