/**
 * Message catalogue for `ProgressionsView.tsx` (#398).
 */
const en = {
  personFallback: 'Person',
  progressionsFallback: 'Progressions',
  thisPerson: 'This person',
  notCompleteProgressions: (name: string) =>
    `${name}’s birth record is not complete enough to calculate progressions yet. Fill in the missing fields on the`,
  personPageLink: 'person page',
  needsKnownTime: (name: string) =>
    `Progressed houses need a known birth time. ${name}’s birth time is unknown — the same reason their chart has no houses.`,

  heading: (name: string) => `${name}’s progressions`,
  hint: 'A progressed chart substitutes elapsed time since birth for a symbolic unit of time, then recomputes positions and houses as if that substituted moment were the real one. The three techniques below differ only in which substitution they use.',
  techniqueLabel: 'Technique',
  secondaryTechnique: 'Secondary (a day for a year)',
  tertiaryTechnique: 'Tertiary (a lunar month for a year)',
  minorTechnique: 'Minor (a lunar month for a lunar month... scaled to a year)',
  mcMethodLabel: 'MC method',
  quotidianMethod: 'Quotidian (recompute houses directly at the progressed moment)',
  naibodMethod: 'Naibod (mean solar motion)',
  solarArcMethod: 'Solar arc (match the Sun’s own progressed arc)',
  asOfLabel: 'As of',
  calculating: 'Calculating…',
  error: (message: string) => `Progressions could not be calculated. ${message}`,

  ageLine: (age: string) => `Age ${age}`,
  beforeBirth: '(before birth)',
  mcMethodLine: (method: string) => `MC method: ${method}`,

  positionsCaption: 'Progressed positions',
  contactsCaption: 'Progressed-to-natal contacts',
  noContacts: 'No progressed-to-natal contacts within orb.',

  symbolLabel: 'Symbol',
  bodyLabel: 'Body',
  signLabel: 'Sign',
  degLabel: 'Deg',
  minLabel: 'Min',
  secLabel: 'Sec',
  houseLabel: 'House',

  bodyALabel: 'Progressed',
  aspectLabel: 'Aspect',
  bodyBLabel: 'Natal',
  orbLabel: 'Orb',
  applyingLabel: 'Applying',
  applying: 'Applying',
  separating: 'Separating',
};

const nl: typeof en = {
  personFallback: 'Persoon',
  progressionsFallback: 'Progressies',
  thisPerson: 'Deze persoon',
  notCompleteProgressions: (name: string) =>
    `Het geboorterecord van ${name} is niet volledig genoeg om progressies te berekenen. Vul de ontbrekende velden in op de`,
  personPageLink: 'persoonspagina',
  needsKnownTime: (name: string) =>
    `Progressieve huizen vereisen een bekende geboortetijd. De geboortetijd van ${name} is onbekend — dezelfde reden waarom hun horoscoop geen huizen heeft.`,

  heading: (name: string) => `Progressies van ${name}`,
  hint: 'Een progressieve horoscoop vervangt de verstreken tijd sinds de geboorte door een symbolische tijdseenheid, en berekent vervolgens posities en huizen opnieuw alsof dat vervangende moment het echte moment was. De drie technieken hieronder verschillen alleen in welke vervanging ze gebruiken.',
  techniqueLabel: 'Techniek',
  secondaryTechnique: 'Secundair (een dag voor een jaar)',
  tertiaryTechnique: 'Tertiair (een maanmaand voor een jaar)',
  minorTechnique: 'Minor (een maanmaand voor een maanmaand... geschaald naar een jaar)',
  mcMethodLabel: 'MC-methode',
  quotidianMethod: 'Quotidian (huizen direct herberekenen op het progressieve moment)',
  naibodMethod: 'Naibod (gemiddelde zonnebeweging)',
  solarArcMethod: 'Solar arc (gelijk aan de eigen progressieve boog van de Zon)',
  asOfLabel: 'Vanaf',
  calculating: 'Berekenen…',
  error: (message: string) => `Progressies konden niet worden berekend. ${message}`,

  ageLine: (age: string) => `Leeftijd ${age}`,
  beforeBirth: '(vóór de geboorte)',
  mcMethodLine: (method: string) => `MC-methode: ${method}`,

  positionsCaption: 'Progressieve posities',
  contactsCaption: 'Progressief-natale contacten',
  noContacts: 'Geen progressief-natale contacten binnen orb.',

  symbolLabel: 'Symbool',
  bodyLabel: 'Hemellichaam',
  signLabel: 'Teken',
  degLabel: 'Gr',
  minLabel: 'Min',
  secLabel: 'Sec',
  houseLabel: 'Huis',

  bodyALabel: 'Progressief',
  aspectLabel: 'Aspect',
  bodyBLabel: 'Natal',
  orbLabel: 'Orb',
  applyingLabel: 'Toenemend',
  applying: 'Toenemend',
  separating: 'Afnemend',
};

export const progressionsViewMessages = { en, nl };
