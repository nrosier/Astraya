/**
 * Message catalogue for `About.tsx` (#158).
 */
const en = {
  heading: 'About Astraya',

  versionHeading: 'Version',
  releaseLabel: 'Release',
  commitLabel: 'Commit',
  builtLabel: 'Built',
  swissEphemerisLabel: 'Swiss Ephemeris',
  notLoaded: 'not loaded',
  changelogLink: 'What changed in this release',

  yourDataHeading: 'Your data',
  yourDataParagraph1Before: 'Charts are calculated ',
  yourDataParagraph1Strong: 'entirely in your browser',
  yourDataParagraph1After:
    '. Birth data you enter is stored on this device, in its IndexedDB storage, and that copy is the authoritative one.',
  yourDataParagraph2Before: 'If you are not signed in, ',
  yourDataParagraph2Strong: 'nothing you enter ever leaves this device',
  yourDataParagraph2After:
    '. There is no analytics, no tracking and no third-party request; the app makes no network call at all once it has loaded.',
  yourDataParagraph3Before: 'If you sign in, your people and charts sync to ',
  yourDataParagraph3Em: 'this server',
  yourDataParagraph3After:
    ' so they reach your other devices. They are not shared with anyone else and are never sent to a third party. They are encrypted at rest. Note honestly that this protects a stolen database file or backup, not someone who has compromised the server itself, because the server needs the key in order to run.',
  yourDataParagraph4:
    'You can delete any person, along with every chart derived from them, from the person list. Deleting clears the local copy and instructs the server to drop its copy.',
  yourDataParagraph5:
    'Interpretation text is written ahead of release and shipped as part of the application. No AI service is contacted while you use Astraya — the Content Security Policy makes that impossible rather than merely unintended.',

  licenceHeading: 'Licence and source',
  licenceParagraphBefore: 'Astraya is free software under the ',
  licenceParagraphStrong: 'GNU Affero General Public License, version 3 or later',
  licenceParagraphAfter:
    '. You may use, study, modify and redistribute it under those terms. Because the AGPL covers use over a network, you are entitled to the source code of this running instance:',
  sourceCodeLink: 'Source code for this build',

  acknowledgementsHeading: 'Acknowledgements',
  acknowledgementsParagraph1Before: 'Positions are computed with the ',
  acknowledgementsParagraph1Strong: 'Swiss Ephemeris',
  acknowledgementsParagraph1After:
    ', copyright © 1997–2021 Astrodienst AG, Zürich, used under the AGPL. Swiss Ephemeris derives from the NASA JPL DE431 planetary ephemeris. Astrodienst asks that this credit be visible, and it is.',
  acknowledgementsParagraph2Before:
    'Reference positions used to test Astraya come from the NASA JPL Horizons system. A full list of third-party components and their licences is in ',
  acknowledgementsParagraph2After: '.',
};

const nl: typeof en = {
  heading: 'Over Astraya',

  versionHeading: 'Versie',
  releaseLabel: 'Release',
  commitLabel: 'Commit',
  builtLabel: 'Gebouwd',
  swissEphemerisLabel: 'Swiss Ephemeris',
  notLoaded: 'niet geladen',
  changelogLink: 'Wat er veranderd is in deze release',

  yourDataHeading: 'Jouw gegevens',
  yourDataParagraph1Before: 'Horoscopen worden ',
  yourDataParagraph1Strong: 'volledig in je browser',
  yourDataParagraph1After:
    ' berekend. Geboortegegevens die je invoert worden op dit apparaat opgeslagen, in de IndexedDB-opslag, en die kopie is de gezaghebbende.',
  yourDataParagraph2Before: 'Als je niet bent ingelogd, ',
  yourDataParagraph2Strong: 'verlaat niets wat je invoert dit apparaat',
  yourDataParagraph2After:
    '. Er is geen analytics, geen tracking en geen aanvraag naar derden; de app doet helemaal geen netwerkverzoek zodra hij geladen is.',
  yourDataParagraph3Before: 'Als je inlogt, synchroniseren je personen en horoscopen naar ',
  yourDataParagraph3Em: 'deze server',
  yourDataParagraph3After:
    ' zodat ze je andere apparaten bereiken. Ze worden met niemand anders gedeeld en nooit naar derden verzonden. Ze zijn versleuteld opgeslagen. Om eerlijk te zijn: dit beschermt tegen een gestolen databasebestand of backup, niet tegen iemand die de server zelf heeft gecompromitteerd, omdat de server de sleutel nodig heeft om te draaien.',
  yourDataParagraph4:
    'Je kunt elke persoon, samen met elke horoscoop die daarvan is afgeleid, verwijderen vanuit de personenlijst. Verwijderen wist de lokale kopie en instrueert de server om zijn kopie te laten vallen.',
  yourDataParagraph5:
    'Interpretatietekst wordt voorafgaand aan de release geschreven en meegeleverd als onderdeel van de applicatie. Er wordt geen AI-dienst benaderd terwijl je Astraya gebruikt — het Content Security Policy maakt dat onmogelijk in plaats van slechts onbedoeld.',

  licenceHeading: 'Licentie en broncode',
  licenceParagraphBefore: 'Astraya is vrije software onder de ',
  licenceParagraphStrong: 'GNU Affero General Public License, versie 3 of later',
  licenceParagraphAfter:
    '. Je mag het gebruiken, bestuderen, aanpassen en verspreiden onder die voorwaarden. Omdat de AGPL gebruik via een netwerk dekt, heb je recht op de broncode van deze draaiende instantie:',
  sourceCodeLink: 'Broncode voor deze build',

  acknowledgementsHeading: 'Dankwoord',
  acknowledgementsParagraph1Before: 'Posities worden berekend met de ',
  acknowledgementsParagraph1Strong: 'Swiss Ephemeris',
  acknowledgementsParagraph1After:
    ', copyright © 1997–2021 Astrodienst AG, Zürich, gebruikt onder de AGPL. Swiss Ephemeris is afgeleid van de NASA JPL DE431 planetaire ephemeris. Astrodienst vraagt dat deze credit zichtbaar is, en dat is hij.',
  acknowledgementsParagraph2Before:
    'Referentieposities die worden gebruikt om Astraya te testen komen van het NASA JPL Horizons-systeem. Een volledige lijst van externe componenten en hun licenties staat in ',
  acknowledgementsParagraph2After: '.',
};

export const aboutMessages = { en, nl };
