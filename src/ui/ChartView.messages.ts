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

  positionsCaption: 'Positions',
  housesCaption: 'Houses',
  anglesCaption: 'Angles',
  aspectsCaption: 'Aspects',
  dignitiesCaption: 'Dignities',
  derivedPointsCaption: 'Derived points',

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

  positionsCaption: 'Posities',
  housesCaption: 'Huizen',
  anglesCaption: 'Hoeken',
  aspectsCaption: 'Aspecten',
  dignitiesCaption: 'Waardigheden',
  derivedPointsCaption: 'Afgeleide punten',

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
};

export const chartViewMessages = { en, nl };
