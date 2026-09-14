/**
 * Message-catalogue entries duplicated verbatim across many components (#158) — one shared
 * source instead of a copy pasted into each component's own catalogue file.
 */
const en = {
  back: 'Back',
  people: 'People',
  notFoundHeading: 'Not found',
  notFoundBody: 'There is no person with that id on this device. If they were deleted, they can be restored from the',
  peopleList: 'people list',
  confirmPasswordLabel: 'Confirm password',
  passwordMismatch: 'Those two passwords do not match.',
  usernameLabel: 'Username',
};

const nl: typeof en = {
  back: 'Terug',
  people: 'Personen',
  notFoundHeading: 'Niet gevonden',
  notFoundBody:
    'Er staat geen persoon met dat id op dit apparaat. Als deze verwijderd is, kan hij worden hersteld vanuit de',
  peopleList: 'personenlijst',
  confirmPasswordLabel: 'Wachtwoord bevestigen',
  passwordMismatch: 'Die twee wachtwoorden komen niet overeen.',
  usernameLabel: 'Gebruikersnaam',
};

export const sharedMessages = { en, nl };
