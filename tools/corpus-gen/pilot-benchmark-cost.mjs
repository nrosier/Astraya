/**
 * #368 — pilot for the not-yet-built benchmark-batch.mjs (which would validate
 * Astraya's generated interpretation corpus against astrologyapi.com's own
 * prose as an external quality signal). Standing directive from the user,
 * verbatim: "create a pilot to verify the cost. keep the results. once
 * everything is confirmed we can run the benchmark-batch." Do not build or
 * run benchmark-batch.mjs until this pilot's findings have been reviewed.
 *
 * Per-call cost is already known from astrologyapi.com's own account
 * dashboard billing breakdown (checked manually by the user, not measurable
 * in-band from any response) — every endpoint below costs $0.0025 or
 * $0.0050 per call. So this pilot doesn't probe cost; it makes one real
 * (paid) call to each natal prose-report endpoint whose content maps to one
 * of Astraya's own corpus categories (`CORPUS_CATEGORIES` in
 * interpretation/schema.ts), so their prose format/tone can be eyeballed
 * against what Astraya generates for the same placement:
 *
 *   - general_sign_report/tropical/{planet}  -> planet-in-sign
 *   - general_house_report/tropical/{planet} -> planet-in-house
 *   - natal_house_cusp_report                -> sign-on-cusp
 *   - natal_aspects_report                   -> aspect-pair
 *   - natal_chart_interpretation              -> whole-chart summary (no
 *     single corpus category — kept as a reference point, not a benchmark
 *     target)
 *
 * Two-person coverage (synastry/composite) stays out of scope: Astraya has
 * no "love compatibility" feature, and astrologyapi.com's own
 * synastry_horoscope/love_compatibility_report endpoints either return raw
 * positions (no prose) or are romance-specific — neither maps to Astraya's
 * general SynastryView/CompositeView. Revisit only if a genuine
 * synastry/composite *prose* endpoint turns up.
 *
 * Findings (full raw responses, not just a pass/fail) are written to
 * --out=FILE so they're kept rather than only printed and discarded, per the
 * user's own framing. This script never prints or writes the literal
 * ASTROLOGYAPI_API_KEY value — only `process.env.ASTROLOGYAPI_API_KEY` is
 * read, and only response headers/bodies (never request headers) are logged.
 *
 *   npx tsx --env-file=.env.local tools/corpus-gen/pilot-benchmark-cost.mjs [--out=FILE]
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const BASE_URL = 'https://json.astrologyapi.com/v1';

const rawArgs = process.argv.slice(2);
function flag(name, fallback) {
  const found = rawArgs.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}
const outPath = flag('out');

const apiKey = process.env.ASTROLOGYAPI_API_KEY;
if (!apiKey) throw new Error('ASTROLOGYAPI_API_KEY is not set — check .env.local');

// Fixed, arbitrary sample data — this pilot probes endpoint shape/prose, not astrological
// correctness, so there's no need for a "golden" fixture the way test/golden-chart.test.ts has one.
const PERSON_A = { day: 15, month: 6, year: 1990, hour: 14, min: 30, lat: 52.379189, lon: 4.899431, tzone: 1 };
const HOUSE_TYPE = 'placidus';

async function callEndpoint(path, body) {
  const url = `${BASE_URL}/${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-astrologyapi-key': apiKey },
    body: JSON.stringify(body),
  });
  const headers = Object.fromEntries(response.headers.entries());
  const rawText = await response.text();
  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    json = undefined;
  }
  return { url, status: response.status, ok: response.ok, headers, json, rawText };
}

const lines = [];
function log(line = '') {
  lines.push(line);
  console.log(line);
}

const REPORTS = [
  { label: 'general_sign_report/tropical/sun', corpusCategory: 'planet-in-sign', path: 'general_sign_report/tropical/sun', body: { ...PERSON_A } },
  { label: 'general_house_report/tropical/sun', corpusCategory: 'planet-in-house', path: 'general_house_report/tropical/sun', body: { ...PERSON_A, house_type: HOUSE_TYPE } },
  { label: 'natal_house_cusp_report', corpusCategory: 'sign-on-cusp', path: 'natal_house_cusp_report', body: { ...PERSON_A, house_type: HOUSE_TYPE } },
  { label: 'natal_aspects_report', corpusCategory: 'aspect-pair', path: 'natal_aspects_report', body: { ...PERSON_A } },
  { label: 'natal_chart_interpretation', corpusCategory: '(whole-chart, reference only)', path: 'natal_chart_interpretation', body: { ...PERSON_A, house_type: HOUSE_TYPE } },
];

log('#368 pilot: astrologyapi.com natal prose-report probe (cost already known from dashboard billing breakdown)');
log(`base URL: ${BASE_URL}`);
log('never logs the literal ASTROLOGYAPI_API_KEY value.');
log();

const results = [];
for (const report of REPORTS) {
  log(`--- ${report.label} (maps to corpus category: ${report.corpusCategory}) ---`);
  try {
    const result = await callEndpoint(report.path, report.body);
    results.push({ ...report, result });
    log(`status: ${String(result.status)} ok=${String(result.ok)}`);
    if (result.ok) {
      log(`response body (full, for keeping): ${JSON.stringify(result.json ?? result.rawText)}`);
    } else {
      log(`non-2xx — raw body kept below for a manual look at astrologyapi.com's error message.`);
      log(`raw body: ${result.rawText.slice(0, 2000)}`);
    }
  } catch (error) {
    log(`[ERROR] ${report.label} call failed: ${error.message}`);
  }
  log();
}

log('SUMMARY');
for (const { label, corpusCategory, result } of results) {
  const status = result?.ok ? 'confirmed working — see kept response body above' : 'FAILED — see raw body above';
  log(`- ${label} (${corpusCategory}): ${status}`);
}
log();
log(
  'Next: read each kept response body by hand and judge whether its prose is close enough in scope ' +
    "to Astraya's own per-placement corpus entries for that category to be a usable external quality " +
    'signal, before building benchmark-batch.mjs.',
);

const report = lines.join('\n');
if (outPath) {
  await writeFile(resolve(outPath), `${report}\n`);
  console.log(`\nWrote report to ${outPath}`);
}
