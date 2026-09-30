/**
 * Fixed chart pool for benchmark-batch.mjs (#368 Part 3): astrologyapi.com's
 * report endpoints take a real birth chart, not an arbitrary placement — you
 * can't ask it for "Sun in Leo" directly, only "Sun's sign report for this
 * chart" (whatever sign that turns out to be). Rather than searching for a
 * chart that happens to produce a specific target placement, this computes a
 * handful of fixed charts and samples from whatever placements they
 * actually contain, guaranteeing the astrologyapi.com report call and
 * Astraya's text describe the exact same placement.
 *
 * Originally planned to compute these charts with Astraya's own engine
 * (`src/domain/chart-compute.ts`), but `src/ephemeris/assets.ts` reads
 * `import.meta.env.BASE_URL` at module load time, which only exists under
 * Vite/Vitest — no script or server code in this repo runs the ephemeris
 * engine outside those two today, and a plain tsx script crashes on import.
 * Per the user's own call, this instead derives each fixed chart's real
 * positions/houses from astrologyapi.com itself — sidesteps the Vite/WASM
 * boundary entirely, and grounds both sides of the benchmark in the same
 * vendor computation for that call. Sign/house/aspect derivation still runs
 * through Astraya's own pure math (`signIndex`, `houseOf`, `findAspects` —
 * none of which touch the ephemeris engine), only the raw longitudes are
 * borrowed from the vendor.
 *
 * `western_horoscope` — the single combined call originally used here — is
 * **currently broken on astrologyapi.com's own server** (confirmed against a
 * real account/key on the first real run of this tool, 2026-09-30):
 * every call returns HTTP 200 with an internal Lambda crash as the body
 * ("Cannot find module '../locale/[wildcard]/msg'", /var/task/calc/western.js) —
 * a vendor-side packaging bug, reproduced 3x with different parameters and
 * independently by this project's own astrology MCP tool integration. Two
 * separate endpoints, `planets/tropical` and `house_cusps/tropical`, return
 * the same underlying data without going through that broken code path, and
 * their exact response shape was captured directly (not guessed) against
 * that same account: a bare array of `{name, fullDegree, speed, sign,
 * house}` for the former, `{houses: [{house, sign, degree}], ascendant,
 * midheaven, vertex}` for the latter. If `western_horoscope` gets fixed
 * server-side, switching back is a one-line change (see `fetchChart` below);
 * until then, this file never calls it.
 *
 * Restricted to the 7 traditional planets: only Sun was pilot-verified
 * against astrologyapi.com's sign/house report endpoints, and astrologyapi.com
 * is a Vedic-oriented vendor unlikely to support outer planets/nodes/Lilith/
 * asteroids on those specific report endpoints. A report call that 4xxs for
 * an unsupported body is the caller's problem to skip, not assumed clean here.
 */
import { bodyByKey } from '../../../src/astrology/bodies.ts';
import { signIndex } from '../../../src/astrology/signs.ts';
import { houseOf } from '../../../src/astrology/emphasis.ts';
import { findAspects } from '../../../src/astrology/aspects.ts';
import { placementKey } from '../../../src/interpretation/schema.ts';

const BASE_URL = 'https://json.astrologyapi.com/v1';

export const TRADITIONAL_PLANETS = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'];
const NAME_TO_BODY_KEY = new Map(TRADITIONAL_PLANETS.map((key) => [bodyByKey(key).name.toLowerCase(), key]));

/** astrologyapi.com's lowercase planet slug — identical to Astraya's own body key for all 7. */
export function astrologyApiPlanetSlug(bodyKey) {
  return bodyKey;
}

/** Fixed, arbitrary sample charts, spread across hemispheres/seasons for placement diversity —
 * this tool probes benchmark quality, not real people, so there's no need for a "golden" fixture
 * the way test/golden-chart.test.ts has one. Same field shape pilot-benchmark-cost.mjs's own
 * PERSON_A already uses. */
export const CHARTS = [
  { label: 'chart-a', day: 15, month: 6, year: 1990, hour: 14, min: 30, lat: 52.379189, lon: 4.899431, tzone: 1 },
  { label: 'chart-b', day: 3, month: 12, year: 1985, hour: 6, min: 45, lat: -33.86882, lon: 151.20929, tzone: 11 },
  { label: 'chart-c', day: 21, month: 3, year: 2001, hour: 22, min: 10, lat: 40.712776, lon: -74.005974, tzone: -5 },
];

/** The body fields every astrologyapi.com endpoint used by this tool expects. */
export function astrologyApiBirthBody(chart) {
  return {
    day: chart.day,
    month: chart.month,
    year: chart.year,
    hour: chart.hour,
    min: chart.min,
    lat: chart.lat,
    lon: chart.lon,
    tzone: chart.tzone,
  };
}

async function callAstrologyApi(apiKey, path, body) {
  const response = await fetch(`${BASE_URL}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-astrologyapi-key': apiKey },
    body: JSON.stringify(body),
  });
  const rawText = await response.text();
  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    json = undefined;
  }
  // astrologyapi.com returns HTTP 200 even for its own internal errors (the `western_horoscope`
  // crash this file now avoids returned 200 with an `errorType`/`errorMessage` body) — `ok` alone
  // isn't a reliable success signal for this vendor, so every caller also checks for that shape.
  if (!response.ok || (json && typeof json === 'object' && 'errorType' in json)) {
    throw new Error(`${path} failed: status ${String(response.status)} — ${rawText.slice(0, 500)}`);
  }
  return json;
}

/** `planets/tropical`'s and `house_cusps/tropical`'s exact response shapes, captured directly
 * against a real account (see this file's own doc comment) — not guessed, so this throws instead
 * of silently coping if the vendor ever changes it. */
function parsePlanetsTropical(json) {
  if (!Array.isArray(json)) {
    throw new Error(
      `planets/tropical response shape not recognized — expected a bare array, got: ${JSON.stringify(json).slice(0, 300)}`,
    );
  }
  const planets = new Map();
  for (const raw of json) {
    const bodyKey = typeof raw.name === 'string' ? NAME_TO_BODY_KEY.get(raw.name.toLowerCase()) : undefined;
    if (bodyKey === undefined || typeof raw.fullDegree !== 'number') continue; // not one of our 7 traditional planets (e.g. "Ascendant"), or an unrecognized entry
    planets.set(bodyKey, { longitude: raw.fullDegree, speed: raw.speed ?? 0 });
  }
  if (planets.size === 0) {
    throw new Error(
      `planets/tropical had no entries matching a traditional planet — got names: ${json.map((p) => p.name).join(', ')}`,
    );
  }
  return planets;
}

function parseHouseCuspsTropical(json) {
  const housesRaw = json?.houses;
  if (!Array.isArray(housesRaw)) {
    throw new Error(
      `house_cusps/tropical response shape not recognized — expected a "houses" array, got top-level keys: ${Object.keys(json ?? {}).join(', ')}`,
    );
  }
  const cusps = new Array(13); // index 0 unused, matching HousePositions.cusps' own convention
  for (const raw of housesRaw) {
    if (typeof raw.house === 'number' && typeof raw.degree === 'number') cusps[raw.house] = raw.degree;
  }
  if (cusps.slice(1).some((c) => c === undefined)) {
    throw new Error(
      `house_cusps/tropical did not yield all 12 cusps — got: ${JSON.stringify(housesRaw).slice(0, 300)}`,
    );
  }
  return cusps;
}

/** Two separate calls, not the single `western_horoscope` one — see this file's own doc comment
 * for why. */
async function fetchChart(apiKey, chart) {
  const body = { ...astrologyApiBirthBody(chart), house_type: 'placidus' };
  const [planetsJson, housesJson] = await Promise.all([
    callAstrologyApi(apiKey, 'planets/tropical', body),
    callAstrologyApi(apiKey, 'house_cusps/tropical', body),
  ]);
  return { planets: parsePlanetsTropical(planetsJson), cusps: parseHouseCuspsTropical(housesJson) };
}

/**
 * Every in-scope real placement across the fixed chart pool — one entry per placement, each
 * carrying its originating chart so benchmark-batch.mjs can call astrologyapi.com for the exact
 * same chart/body/house/aspect Astraya's own text is being compared against. Deduped by key:
 * if two charts happen to produce the same placement, only the first occurrence is kept.
 */
export async function buildRealPlacements(apiKey) {
  const placements = [];

  for (const chart of CHARTS) {
    const { planets, cusps } = await fetchChart(apiKey, chart);

    for (const [body, { longitude }] of planets) {
      const sign = signIndex(longitude);
      placements.push({
        category: 'planet-in-sign',
        chart,
        planetSlug: astrologyApiPlanetSlug(body),
        key: placementKey({ category: 'planet-in-sign', body, sign }),
        placement: { category: 'planet-in-sign', body, sign },
      });

      const house = houseOf(longitude, cusps);
      placements.push({
        category: 'planet-in-house',
        chart,
        planetSlug: astrologyApiPlanetSlug(body),
        houseNumber: house,
        key: placementKey({ category: 'planet-in-house', body, house }),
        placement: { category: 'planet-in-house', body, house },
      });
    }

    for (let house = 1; house <= 12; house++) {
      const cusp = cusps[house];
      const sign = signIndex(cusp);
      placements.push({
        category: 'sign-on-cusp',
        chart,
        houseNumber: house,
        key: placementKey({ category: 'sign-on-cusp', sign, house }),
        placement: { category: 'sign-on-cusp', sign, house },
      });
    }

    const subjects = [...planets].map(([body, { longitude, speed }]) => ({
      body,
      category: bodyByKey(body).category,
      position: { longitude, longitudeSpeed: speed, latitude: 0, latitudeSpeed: 0, distance: 0 },
    }));
    for (const aspect of findAspects(subjects)) {
      placements.push({
        category: 'aspect-pair',
        chart,
        bodyA: aspect.bodyA,
        bodyB: aspect.bodyB,
        aspectKey: aspect.aspect.key,
        key: placementKey({
          category: 'aspect-pair',
          aspect: aspect.aspect.key,
          bodyA: aspect.bodyA,
          bodyB: aspect.bodyB,
        }),
        placement: { category: 'aspect-pair', aspect: aspect.aspect.key, bodyA: aspect.bodyA, bodyB: aspect.bodyB },
      });
    }
  }

  const seen = new Map();
  for (const p of placements) if (!seen.has(p.key)) seen.set(p.key, p);
  return [...seen.values()];
}
