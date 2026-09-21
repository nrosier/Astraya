/**
 * Message catalogue for `BirthPlaceMap.tsx` (#158). The map tile attribution stays untranslated —
 * standard practice for OpenStreetMap/Leaflet legal credit, matching how house-system and
 * ayanamsa proper nouns are left alone elsewhere in this rollout.
 */
const en = {
  locating: 'Locating…',
  useMyLocation: 'Use my location',
  enterCoordinatesHint: 'You can still enter coordinates in the fields above.',
  permissionDenied: (hint: string) => `Location permission was denied. ${hint}`,
  positionUnavailable: (hint: string) => `Your location could not be determined. ${hint}`,
  tilesUnavailable: (hint: string) => `Map tiles could not be loaded, so the map is unavailable. ${hint}`,
  fillPlaceName: 'Fill in place name',
  lookingUpPlaceName: 'Looking up place name…',
  placeNameNotFound: 'No place name could be found for these coordinates.',
  placeNameLookupFailed: 'The place name lookup failed. You can still type it in yourself.',
  searchByName: 'Search for a place by name',
  searchByNamePlaceholder: 'e.g. Paris, France',
  search: 'Search',
  searching: 'Searching…',
  searchNotFound: 'No matching place was found.',
  searchFailed: 'The place search failed. You can still enter coordinates yourself.',
  searchResultsLabel: 'Matching places — choose one',
};

const nl: typeof en = {
  locating: 'Locatie bepalen…',
  useMyLocation: 'Gebruik mijn locatie',
  enterCoordinatesHint: 'Je kunt nog steeds coördinaten invoeren in de velden hierboven.',
  permissionDenied: (hint: string) => `Locatietoegang werd geweigerd. ${hint}`,
  positionUnavailable: (hint: string) => `Je locatie kon niet worden bepaald. ${hint}`,
  tilesUnavailable: (hint: string) =>
    `De kaarttegels konden niet worden geladen, dus de kaart is niet beschikbaar. ${hint}`,
  fillPlaceName: 'Vul plaatsnaam in',
  lookingUpPlaceName: 'Plaatsnaam opzoeken…',
  placeNameNotFound: 'Er is geen plaatsnaam gevonden voor deze coördinaten.',
  placeNameLookupFailed: 'De plaatsnaam kon niet worden opgezocht. Je kunt hem nog steeds zelf intypen.',
  searchByName: 'Zoek een plaats op naam',
  searchByNamePlaceholder: 'bijv. Amsterdam, Nederland',
  search: 'Zoeken',
  searching: 'Zoeken…',
  searchNotFound: 'Er is geen overeenkomende plaats gevonden.',
  searchFailed: 'Het zoeken naar de plaats is mislukt. Je kunt nog steeds zelf coördinaten invoeren.',
  searchResultsLabel: 'Overeenkomende plaatsen — kies er een',
};

export const birthPlaceMapMessages = { en, nl };
