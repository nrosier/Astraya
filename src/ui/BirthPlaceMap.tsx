/**
 * A second, complementary way to set the two Coordinates fields (#45) alongside typing raw
 * decimal latitude/longitude: an embedded Leaflet + OpenStreetMap map with a draggable pin.
 * Either way stays a single source of truth — this component only reads and writes the same
 * two fields the box inputs do, via `onPick`.
 *
 * Leaflet is loaded with a runtime `import()` rather than a static one, so its ~145 KB minified
 * core lands in its own chunk instead of the main one (see `scripts/check-bundle-size.mjs`),
 * mirroring how `src/ephemeris/client.ts` keeps the Swiss Ephemeris WASM engine out of the main
 * chunk. `leaflet/dist/leaflet.css` stays a static import: it's small, and needs to be present
 * before Leaflet's first paint.
 *
 * "Use my location" (#248) is opt-in and only offered while there are no coordinates yet — it
 * only pans/zooms the map to the browser's reported position, never the pin or the fields
 * themselves, so a visitor centering the map is never mistaken for one who picked a birth place.
 */
import { useEffect, useRef, useState } from 'react';
import markerIconUrl from 'leaflet/dist/images/marker-icon.png';
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png';
import 'leaflet/dist/leaflet.css';
import { birthPlaceMapMessages } from './BirthPlaceMap.messages.js';
import { useMessages } from './messages.js';
import type { LeafletMouseEvent, Map as LeafletMap, Marker } from 'leaflet';

// No API key, no account, no setup required for this default. A self-hoster can point both this
// and the server's `ASTRAYA_TILE_ORIGIN` (which grants the origin in the CSP) at their own tile
// server instead — see README.md and .env.example. `VITE_TILE_URL_TEMPLATE`, if set, always wins
// over `VITE_MAPTILER_API_KEY` below: a deployer who has gone to the trouble of pointing at their
// own tile server has already solved the problem the MapTiler key exists to solve.
const DEFAULT_TILE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const rawTileUrlTemplate: unknown = import.meta.env.VITE_TILE_URL_TEMPLATE;
const explicitTileUrlTemplate =
  typeof rawTileUrlTemplate === 'string' && rawTileUrlTemplate !== '' ? rawTileUrlTemplate : undefined;

// A MapTiler Cloud API key (#267) sidesteps the default OSM host's referrer-based anti-abuse
// blocking entirely — MapTiler authenticates by this key, not by `Referer`/`Origin` headers, so it
// works unchanged under the server's `Referrer-Policy: no-referrer`. Requires `ASTRAYA_TILE_ORIGIN`
// set to `https://api.maptiler.com` server-side too, exactly like the self-hosted case above, or
// the CSP blocks the tiles.
const rawMaptilerApiKey: unknown = import.meta.env.VITE_MAPTILER_API_KEY;
const maptilerApiKey =
  typeof rawMaptilerApiKey === 'string' && rawMaptilerApiKey !== '' ? rawMaptilerApiKey : undefined;
function maptilerTileUrlTemplate(apiKey: string): string {
  return `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${apiKey}`;
}

// True only for the true zero-config default: no self-hosted server and no MapTiler key. This is
// the one case that actually needs the `referrerPolicy` override below, and the one the startup
// warning below is about.
const usingDefaultOsmTiles = explicitTileUrlTemplate === undefined && maptilerApiKey === undefined;
const TILE_URL_TEMPLATE =
  explicitTileUrlTemplate ??
  (maptilerApiKey !== undefined ? maptilerTileUrlTemplate(maptilerApiKey) : DEFAULT_TILE_URL_TEMPLATE);
const TILE_ATTRIBUTION =
  maptilerApiKey !== undefined
    ? '&copy; <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// How long to wait for the first tile to load before treating the map as unavailable rather than
// leaving it blank — the issue's requirement is a visible "unavailable" state, not silence.
const TILE_LOAD_TIMEOUT_MS = 8000;

// OSM's anti-abuse system can return `200 OK` with a small, otherwise-valid "blocked" placeholder
// tile instead of an error (#267) — Leaflet's `tileload` event fires normally for it, since it is
// a real image that really loaded, so it alone can never distinguish that case from a genuinely
// rendered tile. A raw `fetch()` of one tile URL sidesteps the opacity of an `<img>` load: OSM's
// blocked response carries an `x-blocked` header (and grants `access-control-allow-origin: *`, so
// a cross-origin fetch can read it), which a real tile response never has. Scoped to the default
// OSM host only — the one case this specific anti-abuse behaviour is known to apply to — and to
// exactly the origin `img-src` already trusts for these tiles (`server/csp.ts`'s `connect-src`
// grant mirrors it one-for-one, never wider).
async function probeForOsmBlock(): Promise<boolean> {
  const probeUrl = DEFAULT_TILE_URL_TEMPLATE.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0');
  try {
    const response = await fetch(probeUrl, { referrerPolicy: 'origin' });
    return response.headers.has('x-blocked');
  } catch {
    return false;
  }
}

// The user-facing "unavailable" message (below) can't name the fix: it's shown to whoever opens
// this form, not to whoever runs the deployment, and "set VITE_TILE_URL_TEMPLATE" means nothing
// to the former. This warns the latter, in whatever console they have open, the one time tiles
// actually fail — distinguishing "OSM's tile server enforces a usage policy that free-floating
// production traffic is expected to eventually trip" (#261, #267) from a generic network hiccup,
// and pointing at the fixes already documented in README.md's tile server sections.
let warnedAboutDefaultTileServer = false;
function warnIfDefaultTileServer(): void {
  if (!usingDefaultOsmTiles || warnedAboutDefaultTileServer) return;
  warnedAboutDefaultTileServer = true;
  console.warn(
    "Astraya: the birth-place map's tiles failed to load from OpenStreetMap's public tile " +
      'server (the default when neither VITE_TILE_URL_TEMPLATE nor VITE_MAPTILER_API_KEY is set). ' +
      'That server enforces a usage policy that blocks unidentified or high-volume clients — ' +
      'likely, not a transient network issue, if this keeps happening even with the referrer-' +
      'policy override this build already applies to tile requests. Set a MapTiler API key or ' +
      "point at your own tile server instead: see README.md's tile server sections.",
  );
}

const WORLD_CENTER: [number, number] = [20, 0];
const WORLD_ZOOM = 2;
const PIN_ZOOM = 6;

type Status = 'loading' | 'ready' | 'unavailable';

// Only ever changes the map *view* (#248) — never the pin or the Latitude/Longitude fields, so
// a visitor who merely wants the map centered somewhere useful is never mistaken for one who
// just picked their birth coordinates.
type GeoStatus = 'idle' | 'locating' | 'denied' | 'unavailable';

export function BirthPlaceMap({
  latitude,
  longitude,
  onPick,
}: {
  latitude: number | undefined;
  longitude: number | undefined;
  onPick: (latitude: number, longitude: number) => void;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | undefined>(undefined);
  const markerRef = useRef<Marker | undefined>(undefined);
  // `onPick` is read from a ref inside Leaflet's own event handlers, which are attached once on
  // mount: this keeps those handlers calling whichever `onPick` is current without having to
  // tear down and recreate the map every time `PersonForm` re-renders with a new closure.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const [status, setStatus] = useState<Status>('loading');
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('idle');
  const t = useMessages(birthPlaceMapMessages);
  const hasCoordinates = latitude !== undefined && longitude !== undefined;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return undefined;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    void import('leaflet')
      .then((L) => {
        if (cancelled) return;

        // `Icon.Default._getIconUrl` always prepends an auto-detected `imagePath` in front of
        // its `iconUrl`/`shadowUrl` options — even fully-qualified ones — so `mergeOptions`
        // can't just be pointed at the asset URLs Vite produced; it still mangles them into a
        // broken, doubled path. Leaflet's own fix for bundlers is to replace the default icon
        // outright with a plain `Icon` (whose `_getIconUrl` has no such prepending) instead.
        L.Marker.prototype.options.icon = L.icon({
          iconUrl: markerIconUrl,
          iconRetinaUrl: markerIcon2xUrl,
          shadowUrl: markerShadowUrl,
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          tooltipAnchor: [16, -28],
          shadowSize: [41, 41],
        });

        const initialCenter: [number, number] =
          latitude !== undefined && longitude !== undefined ? [latitude, longitude] : WORLD_CENTER;
        const map = L.map(container).setView(initialCenter, hasCoordinates ? PIN_ZOOM : WORLD_ZOOM);
        mapRef.current = map;

        const tileLayer = L.tileLayer(TILE_URL_TEMPLATE, {
          attribution: TILE_ATTRIBUTION,
          // Only the zero-config OSM default needs this: the server's blanket `Referrer-Policy:
          // no-referrer` header (set for every response, tile requests included) otherwise strips
          // the referrer from these `<img>` requests, and OSM's anti-abuse system treats a missing
          // referrer as unidentified traffic and silently serves a "blocked" placeholder tile
          // instead of an error (#267). `'origin'` discloses just this site's origin, not the full
          // page URL — enough for OSM to identify the requester without leaking a birth-chart URL.
          ...(usingDefaultOsmTiles ? { referrerPolicy: 'origin' as const } : {}),
        }).addTo(map);

        // GridLayer's `'load'` fires once every requested tile has settled, whether each one
        // succeeded or errored — a fully-blocked tile host still fires `'load'` almost immediately
        // (every request resolves as a tile error). Tracking `tileload` separately is what
        // actually distinguishes "tiles rendered" from "tiles all failed but finished trying".
        let tileLoaded = false;
        tileLayer.on('tileload', () => {
          tileLoaded = true;
        });

        const markUnavailable = (): void => {
          setStatus('unavailable');
          warnIfDefaultTileServer();
        };

        timeoutId = setTimeout(() => {
          if (!cancelled) markUnavailable();
        }, TILE_LOAD_TIMEOUT_MS);

        tileLayer.once('load', () => {
          if (cancelled) return;
          clearTimeout(timeoutId);
          if (!tileLoaded) {
            markUnavailable();
            return;
          }
          // `tileLoaded` alone can't rule out OSM's silent block (#267) — confirm with the
          // header probe before declaring the map ready.
          if (usingDefaultOsmTiles) {
            void probeForOsmBlock().then((blocked) => {
              if (cancelled) return;
              if (blocked) markUnavailable();
              else setStatus('ready');
            });
          } else {
            setStatus('ready');
          }
        });

        const marker = L.marker(initialCenter, { draggable: true }).addTo(map);
        markerRef.current = marker;

        marker.on('dragend', () => {
          const position = marker.getLatLng();
          onPickRef.current(position.lat, position.lng);
        });

        map.on('click', (event: LeafletMouseEvent) => {
          marker.setLatLng(event.latlng);
          onPickRef.current(event.latlng.lat, event.latlng.lng);
        });
      })
      .catch(() => {
        if (!cancelled) setStatus('unavailable');
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      mapRef.current?.remove();
      mapRef.current = undefined;
      markerRef.current = undefined;
    };
    // Deliberately runs once: the map and marker are created here, and the effect below keeps
    // them synced with prop changes without recreating either. `latitude`/`longitude` are read
    // only for the initial view, so they're deliberately left out of the dependency array.
  }, []);

  // Keeps the pin in sync when the box fields are typed into directly, without fighting a drag
  // already in progress: it only moves the marker if its position actually differs from props.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (map === undefined || marker === undefined || latitude === undefined || longitude === undefined) return;
    const current = marker.getLatLng();
    if (current.lat === latitude && current.lng === longitude) return;
    marker.setLatLng([latitude, longitude]);
    map.panTo([latitude, longitude]);
  }, [latitude, longitude]);

  const useMyLocation = (): void => {
    if (!('geolocation' in navigator)) {
      setGeoStatus('unavailable');
      return;
    }
    setGeoStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoStatus('idle');
        mapRef.current?.setView([position.coords.latitude, position.coords.longitude], PIN_ZOOM);
      },
      (error) => {
        setGeoStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
    );
  };

  return (
    <div className="birth-place-map">
      {!hasCoordinates && (
        <div className="birth-place-map-geo">
          <button type="button" className="quiet" onClick={useMyLocation} disabled={geoStatus === 'locating'}>
            {geoStatus === 'locating' ? t.locating : t.useMyLocation}
          </button>
          {geoStatus === 'denied' && (
            <p className="warning" role="alert">
              {t.permissionDenied(t.enterCoordinatesHint)}
            </p>
          )}
          {geoStatus === 'unavailable' && (
            <p className="warning" role="alert">
              {t.positionUnavailable(t.enterCoordinatesHint)}
            </p>
          )}
        </div>
      )}
      <div className="birth-place-map-canvas" ref={containerRef} />
      {status === 'unavailable' && (
        <p className="warning" role="alert">
          {t.tilesUnavailable(t.enterCoordinatesHint)}
        </p>
      )}
    </div>
  );
}
