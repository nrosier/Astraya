/**
 * Fetches reference planetary longitudes from NASA/JPL Horizons and writes them
 * to test/fixtures/horizons-positions.json.
 *
 * Why this exists: the golden-chart gate must compare against values from an
 * external authority. Reference positions must never be written from memory —
 * a plausible-looking wrong number would make the gate certify a broken engine.
 *
 * The fixture is committed so tests run offline and deterministically. This
 * script is committed too, so anyone can reproduce or audit the fixture:
 *
 *   node scripts/fetch-horizons-fixture.mjs
 *
 * What is being validated is Astraea's *use* of the ephemeris — time conversion,
 * flags, coordinate frame, normalisation — rather than the underlying DE431 data,
 * which Horizons also derives from. For an independent check of the data itself,
 * see the astronomy-engine cross-check in the same test file.
 *
 * Quantity 31 is observer ecliptic longitude and latitude: apparent, light-time
 * corrected, referred to the true ecliptic and equinox of date. That matches the
 * Swiss Ephemeris default (apparent geocentric ecliptic of date), so the two are
 * directly comparable with no frame conversion.
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'test', 'fixtures', 'horizons-positions.json');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

/**
 * Epochs chosen to exercise different parts of the pipeline, not just one date:
 * J2000 as the canonical reference, a mid-20th-century time within the messy
 * historical-timezone era, and a future date well inside the shipped data range.
 */
const EPOCHS = [
  { id: 'j2000', horizons: '2000-Jan-01 12:00:00', utc: [2000, 1, 1, 12, 0, 0] },
  { id: 'apollo11', horizons: '1969-Jul-20 20:17:40', utc: [1969, 7, 20, 20, 17, 40] },
  { id: 'future2035', horizons: '2035-Mar-15 06:45:00', utc: [2035, 3, 15, 6, 45, 0] },
];

/** Swiss Ephemeris body id -> Horizons COMMAND. */
const BODIES = [
  { name: 'Sun', se: 0, command: '10' },
  { name: 'Moon', se: 1, command: '301' },
  { name: 'Mercury', se: 2, command: '199' },
  { name: 'Venus', se: 3, command: '299' },
  { name: 'Mars', se: 4, command: '499' },
  { name: 'Jupiter', se: 5, command: '599' },
  { name: 'Saturn', se: 6, command: '699' },
  { name: 'Uranus', se: 7, command: '799' },
  { name: 'Neptune', se: 8, command: '899' },
  { name: 'Pluto', se: 9, command: '999' },
  { name: 'Chiron', se: 15, command: '2060;' },
];

const tlist = EPOCHS.map((e) => `'${e.horizons}'`).join(' ');

async function fetchBody(body) {
  const params = new URLSearchParams({
    format: 'text',
    COMMAND: `'${body.command}'`,
    EPHEM_TYPE: 'OBSERVER',
    CENTER: "'500@399'", // geocentric
    TLIST: tlist,
    QUANTITIES: "'31'", // observer ecliptic lon/lat
    ANG_FORMAT: 'DEG',
    CSV_FORMAT: 'YES',
  });
  const response = await fetch(`${API}?${params}`);
  if (!response.ok) throw new Error(`Horizons returned ${response.status} for ${body.name}`);
  const text = await response.text();

  const block = text.match(/\$\$SOE\n([\s\S]*?)\$\$EOE/);
  if (!block?.[1]) throw new Error(`No ephemeris block for ${body.name}:\n${text.slice(0, 400)}`);

  const rows = new Map();
  for (const line of block[1].trim().split('\n')) {
    const cells = line.split(',').map((c) => c.trim());
    const [stamp, , , lon, lat] = cells;
    if (!stamp || lon === undefined || lat === undefined) continue;
    // Horizons returns rows sorted by time, not in TLIST order, so match on the
    // timestamp rather than on position. Getting this wrong would silently pair
    // each body with the wrong epoch.
    const key = stamp.replace(/\.\d+$/, '');
    rows.set(key, { longitude: Number(lon), latitude: Number(lat) });
  }

  return EPOCHS.map((epoch) => {
    const value = rows.get(epoch.horizons);
    if (!value) {
      throw new Error(`${body.name}: no row for ${epoch.horizons}; got ${[...rows.keys()].join(' | ')}`);
    }
    return { epoch: epoch.id, ...value };
  });
}

const positions = {};
for (const body of BODIES) {
  const rows = await fetchBody(body);
  for (const row of rows) {
    positions[row.epoch] ??= {};
    positions[row.epoch][body.name] = { se: body.se, longitude: row.longitude, latitude: row.latitude };
  }
  console.log(`  ${body.name.padEnd(8)} ${rows.map((r) => r.longitude.toFixed(6).padStart(11)).join('  ')}`);
  // Be a considerate API client.
  await new Promise((r) => setTimeout(r, 350));
}

const fixture = {
  $provenance: {
    source: 'NASA/JPL Horizons system',
    api: API,
    retrieved: new Date().toISOString().slice(0, 10),
    quantity: '31 (observer ecliptic longitude and latitude)',
    center: '500@399 (geocentric)',
    frame: 'apparent, light-time corrected, true ecliptic and equinox of date',
    units: 'degrees',
    timeScale: 'UT',
    reproduce: 'node scripts/fetch-horizons-fixture.mjs',
    note: 'Do not edit by hand. These are external reference values; hand-editing defeats the purpose of the gate.',
  },
  epochs: Object.fromEntries(EPOCHS.map((e) => [e.id, { utc: e.utc, horizons: e.horizons }])),
  positions,
};

await writeFile(OUT, JSON.stringify(fixture, null, 2) + '\n');
console.log(`\nwrote ${OUT}`);
