/**
 * Message catalogue for `App.tsx` (#158).
 */
const en = {
  openingLocalData: 'Opening your local data…',
  noLocalStorage: 'No local storage',
  noLocalStorageWarning: (message: string) =>
    `Your data is stored in this browser, and this browser will not let us open it. ${message}`,
  noLocalStorageHint:
    'Private-browsing windows and blocked site data are the usual causes. Nothing has been lost — anything saved earlier is still there once storage is available again.',

  loadingEphemeris: 'Loading ephemeris…',
  loadingScreen: 'Loading…',

  changelogLink: (version: string) => `Version ${version}`,
  aboutLink: 'about & licence',
};

const nl: typeof en = {
  openingLocalData: 'Lokale gegevens worden geopend…',
  noLocalStorage: 'Geen lokale opslag',
  noLocalStorageWarning: (message: string) =>
    `Je gegevens worden opgeslagen in deze browser, en deze browser laat ons dit niet openen. ${message}`,
  noLocalStorageHint:
    'Privénavigatievensters en geblokkeerde sitegegevens zijn de gebruikelijke oorzaken. Er is niets verloren gegaan — alles wat eerder is opgeslagen, staat er nog zodra opslag weer beschikbaar is.',

  loadingEphemeris: 'Ephemeris wordt geladen…',
  loadingScreen: 'Laden…',

  changelogLink: (version: string) => `Versie ${version}`,
  aboutLink: 'over & licentie',
};

export const appMessages = { en, nl };
