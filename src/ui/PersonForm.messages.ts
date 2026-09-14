/**
 * Message catalogue for `PersonForm.tsx` (#158).
 */
const en = {
  accuracyRecorded: 'Recorded — from a certificate or record',
  accuracyRemembered: 'Remembered — someone’s recollection',
  accuracyApproximate: 'Approximate — “around teatime”',
  accuracyUnknown: 'Unknown — no time on record',

  newPerson: 'New person',
  tagline:
    'A one-hour error moves the Ascendant about 15°, so the resolved offset and how it was decided are shown below the fields that produced them.',
  saveFailed: (message: string) => `That did not save, so nothing was changed. ${message}`,

  birthRecordHeading: 'Birth record',

  whoLegend: 'Who',
  nameLabel: 'Name',
  placeOfBirthLabel: 'Place of birth',
  placeOfBirthPlaceholder: 'Vevay, Indiana',

  whenLegend: 'When',
  dateLabel: 'Date',
  timeLabel: 'Time',
  timeKnownLabel: 'How the time is known',

  coordinatesLegend: 'Coordinates',
  latitudeLabel: 'Latitude',
  longitudeLabel: 'Longitude',

  calendarZoneLegend: 'Calendar & time zone',
  calendarLabel: 'Calendar',
  calendarAutomatic: 'Automatic',
  calendarGregorian: 'Gregorian',
  calendarJulian: 'Julian',
  utcOffsetOverrideLabel: 'UTC offset override',
  offsetOverridePlaceholder: 'minutes, e.g. -300',
  timezoneOverrideLabel: 'Timezone override',
  timezoneOverridePlaceholder: 'America/Indiana/Vevay',
  timezoneHint:
    'Leave the override empty to use the timezone database. Enter it in minutes east of UTC — a birth certificate that states the offset beats any lookup we can do, and 0 means UTC rather than “no override”.',

  notesLegend: 'Notes',
  notesLabel: 'Notes',

  resolvedHeading: 'Resolved',
  utcOffsetLabel: 'UTC offset',
  derivedFromLabel: 'Derived from',
  timezoneLabel: 'Timezone',
  noneOffsetFromLongitude: 'none — the offset came from longitude or from you',
  calendarResolvedLabel: 'Calendar',
  alsoValidLabel: 'Also valid',
  tzdbHint: (fingerprint: string) =>
    `Resolved against timezone data ${fingerprint}, which is stored with the record so a saved chart does not move when a timezone update ships.`,

  worthCheckingHeading: 'Worth checking',

  unknownTimeHint:
    'With no birth time, houses, the Ascendant and the Midheaven cannot be calculated at all — they are not approximate, they are undefined. Planetary positions are still meaningful, and the Moon moves about 13° a day, so its sign may be uncertain.',

  saving: 'Saving…',
  saveButton: 'Save',
  savedStatus: 'Saved on this device.',
  fillFieldsHint: 'Fill in the fields marked above to save.',

  deleteHeading: 'Delete',
  deleteHint:
    'Deleting hides this person and their charts. Nothing is really removed, so it can be undone from the people list.',
  deleteButton: (name: string) => `Delete ${name}`,
  thisPerson: 'this person',
};

const nl: typeof en = {
  accuracyRecorded: 'Vastgelegd — van een certificaat of document',
  accuracyRemembered: 'Herinnerd — iemands herinnering',
  accuracyApproximate: 'Ongeveer — “rond etenstijd”',
  accuracyUnknown: 'Onbekend — geen tijd bekend',

  newPerson: 'Nieuwe persoon',
  tagline:
    'Een fout van een uur verplaatst de Ascendant ongeveer 15°, dus de opgeloste afwijking en hoe die is bepaald staan hieronder bij de velden die ze hebben opgeleverd.',
  saveFailed: (message: string) => `Dat is niet opgeslagen, er is dus niets veranderd. ${message}`,

  birthRecordHeading: 'Geboortegegevens',

  whoLegend: 'Wie',
  nameLabel: 'Naam',
  placeOfBirthLabel: 'Geboorteplaats',
  placeOfBirthPlaceholder: 'Vevay, Indiana',

  whenLegend: 'Wanneer',
  dateLabel: 'Datum',
  timeLabel: 'Tijd',
  timeKnownLabel: 'Hoe de tijd bekend is',

  coordinatesLegend: 'Coördinaten',
  latitudeLabel: 'Breedtegraad',
  longitudeLabel: 'Lengtegraad',

  calendarZoneLegend: 'Kalender & tijdzone',
  calendarLabel: 'Kalender',
  calendarAutomatic: 'Automatisch',
  calendarGregorian: 'Gregoriaans',
  calendarJulian: 'Juliaans',
  utcOffsetOverrideLabel: 'UTC-afwijking overschrijven',
  offsetOverridePlaceholder: 'minuten, bijv. -300',
  timezoneOverrideLabel: 'Tijdzone overschrijven',
  timezoneOverridePlaceholder: 'America/Indiana/Vevay',
  timezoneHint:
    'Laat de overschrijving leeg om de tijdzonedatabase te gebruiken. Voer deze in minuten oost van UTC in — een geboortecertificaat dat de afwijking vermeldt, verslaat elke opzoeking die wij kunnen doen, en 0 betekent UTC in plaats van “geen overschrijving”.',

  notesLegend: 'Notities',
  notesLabel: 'Notities',

  resolvedHeading: 'Opgelost',
  utcOffsetLabel: 'UTC-afwijking',
  derivedFromLabel: 'Afgeleid van',
  timezoneLabel: 'Tijdzone',
  noneOffsetFromLongitude: 'geen — de afwijking kwam van de lengtegraad of van jou',
  calendarResolvedLabel: 'Kalender',
  alsoValidLabel: 'Ook geldig',
  tzdbHint: (fingerprint: string) =>
    `Opgelost tegen tijdzonedata ${fingerprint}, die bij het record wordt opgeslagen zodat een opgeslagen horoscoop niet verschuift wanneer een tijdzone-update uitkomt.`,

  worthCheckingHeading: 'Het controleren waard',

  unknownTimeHint:
    'Zonder geboortetijd kunnen huizen, de Ascendant en de Midheaven helemaal niet worden berekend — ze zijn niet bij benadering, ze zijn onbepaald. Planeetposities blijven wel betekenisvol, en de Maan verplaatst ongeveer 13° per dag, dus haar teken kan onzeker zijn.',

  saving: 'Opslaan…',
  saveButton: 'Opslaan',
  savedStatus: 'Opgeslagen op dit apparaat.',
  fillFieldsHint: 'Vul de hierboven gemarkeerde velden in om op te slaan.',

  deleteHeading: 'Verwijderen',
  deleteHint:
    'Verwijderen verbergt deze persoon en hun horoscopen. Er wordt niets echt verwijderd, dus het kan ongedaan worden gemaakt vanuit de personenlijst.',
  deleteButton: (name: string) => `${name} verwijderen`,
  thisPerson: 'deze persoon',
};

export const personFormMessages = { en, nl };
