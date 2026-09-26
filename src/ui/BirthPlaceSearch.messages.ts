/**
 * Message catalogue for `BirthPlaceSearch.tsx` (#290).
 */
const en = {
  searchByName: 'Search for a place by name',
  searchByNamePlaceholder: 'e.g. Paris, France',
  search: 'Search',
  searching: 'Searching…',
  searchNotFound: 'No matching place was found.',
  searchFailed: 'The place search failed. You can still enter coordinates yourself.',
  searchResultsLabel: 'Matching places — choose one',
};

const nl: typeof en = {
  searchByName: 'Zoek een plaats op naam',
  searchByNamePlaceholder: 'bijv. Amsterdam, Nederland',
  search: 'Zoeken',
  searching: 'Zoeken…',
  searchNotFound: 'Er is geen overeenkomende plaats gevonden.',
  searchFailed: 'Het zoeken naar de plaats is mislukt. Je kunt nog steeds zelf coördinaten invoeren.',
  searchResultsLabel: 'Overeenkomende plaatsen — kies er een',
};

export const birthPlaceSearchMessages = { en, nl };
