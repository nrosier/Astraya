/**
 * Sets the two Coordinates fields (#45) by searching for a birth place by name (#290) — now the
 * only way to do so. The previous map/pin/"Use my location"/"Fill in place name" flow (#159,
 * #248, #267, #291) sent exact birth coordinates to a third-party tile host and reverse-geocoder;
 * it was removed rather than kept alongside this search, since city/town-level precision from a
 * typed name is already what natal astrology needs (an Ascendant shift big enough to matter needs
 * roughly 111 km of position error), and a search-only flow never discloses an exact coordinate to
 * anyone but this app's own server.
 *
 * Results are always a click-to-confirm list, even for a single match, so a search never silently
 * sets the fields: picking one passes `onPick` its optional third argument so the coordinates and
 * the place label land in a single call, matching `PersonForm.tsx`'s note that setting both fields
 * from two separate calls risks one clobbering the other.
 */
import { useState } from 'react';
import { birthPlaceSearchMessages } from './BirthPlaceSearch.messages.js';
import { forwardGeocode } from './forward-geocode.js';
import { useMessages } from './messages.js';
import type { ForwardGeocodeResult } from './forward-geocode.js';

type SearchStatus = 'idle' | 'searching' | 'not-found' | 'error';

export function BirthPlaceSearch({
  onPick,
}: {
  onPick: (latitude: number, longitude: number, placeLabel?: string) => void;
}): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle');
  const [searchResults, setSearchResults] = useState<ForwardGeocodeResult[]>([]);
  const t = useMessages(birthPlaceSearchMessages);

  const searchByName = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (query === '') return;
    setSearchStatus('searching');
    setSearchResults([]);
    void forwardGeocode(query).then(
      (results) => {
        if (results.length === 0) {
          setSearchStatus('not-found');
          return;
        }
        setSearchStatus('idle');
        setSearchResults(results);
      },
      () => {
        setSearchStatus('error');
      },
    );
  };

  const pickSearchResult = (result: ForwardGeocodeResult): void => {
    onPick(result.latitude, result.longitude, result.displayName);
    setSearchQuery('');
    setSearchStatus('idle');
    setSearchResults([]);
  };

  return (
    <div className="birth-place-search">
      <form className="birth-place-search-form" onSubmit={searchByName}>
        <label>
          {t.searchByName}
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
            }}
            placeholder={t.searchByNamePlaceholder}
          />
        </label>
        <button type="submit" className="quiet" disabled={searchStatus === 'searching' || searchQuery.trim() === ''}>
          {searchStatus === 'searching' ? t.searching : t.search}
        </button>
      </form>
      {searchStatus === 'not-found' && (
        <p className="warning" role="alert">
          {t.searchNotFound}
        </p>
      )}
      {searchStatus === 'error' && (
        <p className="warning" role="alert">
          {t.searchFailed}
        </p>
      )}
      {searchResults.length > 0 && (
        <ul className="birth-place-search-results" aria-label={t.searchResultsLabel}>
          {searchResults.map((result) => (
            <li key={`${String(result.latitude)},${String(result.longitude)}`}>
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  pickSearchResult(result);
                }}
              >
                {result.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
