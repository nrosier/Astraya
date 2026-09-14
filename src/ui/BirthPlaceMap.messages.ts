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
};

const nl: typeof en = {
  locating: 'Locatie bepalen…',
  useMyLocation: 'Gebruik mijn locatie',
  enterCoordinatesHint: 'Je kunt nog steeds coördinaten invoeren in de velden hierboven.',
  permissionDenied: (hint: string) => `Locatietoegang werd geweigerd. ${hint}`,
  positionUnavailable: (hint: string) => `Je locatie kon niet worden bepaald. ${hint}`,
  tilesUnavailable: (hint: string) =>
    `De kaarttegels konden niet worden geladen, dus de kaart is niet beschikbaar. ${hint}`,
};

export const birthPlaceMapMessages = { en, nl };
