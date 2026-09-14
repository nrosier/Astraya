/**
 * Message catalogue for `People.tsx` (#158).
 */
const en = {
  heading: 'People',
  tagline: 'Charts belong to a person, so this is where they start. Everything here is stored on this device.',
  saveFailed: 'That did not save.',
  addPerson: 'Add a person',
  empty:
    'Nobody yet. Add a person and their birth record; a chart can be drawn once the date, time and coordinates are in.',
  unnamed: 'Unnamed',
  hintPrefix: 'A',
  hintSuffix:
    'after an offset means resolving it raised something — a timezone boundary, an hour the clocks repeated, or a date before standard time. Open the person to see what and to overrule it.',
  deletedHeading: 'Deleted',
  restore: 'Restore',
  deletePermanently: 'Delete permanently',
  unnamedPersonPlaceholder: 'this person',
  confirmDelete: (name: string) => `Permanently delete ${name}? This cannot be undone.`,
};

const nl: typeof en = {
  heading: 'Personen',
  tagline: 'Horoscopen horen bij een persoon, dus hier begint het. Alles hier wordt op dit apparaat opgeslagen.',
  saveFailed: 'Dat is niet opgeslagen.',
  addPerson: 'Persoon toevoegen',
  empty:
    'Nog niemand. Voeg een persoon en hun geboortegegevens toe; een horoscoop kan worden getekend zodra de datum, tijd en coördinaten bekend zijn.',
  unnamed: 'Naamloos',
  hintPrefix: 'Een',
  hintSuffix:
    'na een offset betekent dat het herleiden ervan iets opleverde — een tijdzonegrens, een uur dat de klok herhaalde, of een datum van vóór de standaardtijd. Open de persoon om te zien wat, en om het te overschrijven.',
  deletedHeading: 'Verwijderd',
  restore: 'Herstellen',
  deletePermanently: 'Definitief verwijderen',
  unnamedPersonPlaceholder: 'deze persoon',
  confirmDelete: (name: string) => `${name} definitief verwijderen? Dit kan niet ongedaan worden gemaakt.`,
};

export const peopleMessages = { en, nl };
