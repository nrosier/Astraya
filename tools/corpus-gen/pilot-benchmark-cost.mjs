/**
 * #368 — pilot for the not-yet-built benchmark-batch.mjs (which would validate
 * Astraya's generated interpretation corpus against astrologyapi.com's own
 * prose as an external quality signal). Standing directive from the user,
 * verbatim: "create a pilot to verify the cost. keep the results. once
 * everything is confirmed we can run the benchmark-batch." Do not build or
 * run benchmark-batch.mjs until this pilot's findings have been reviewed.
 *
 * Makes a small, fixed handful of real (paid) calls against astrologyapi.com's
 * "Access tokens" scheme — a single `x-astrologyapi-key` header, JSON body —
 * to:
 *   1. Confirm the already-known-working single-person endpoint
 *      (`western_horoscope`) still behaves as documented, and look for any
 *      in-band usage/credit signal in its response headers by calling it
 *      twice and diffing them (no dedicated balance-check endpoint is
 *      documented, so this is the cheapest empirical proxy available).
 *   2. Discover/confirm the two-person compatibility-report endpoint and
 *      param shape. `love_compatibility_report/tropical` is this script's
 *      best-founded guess at the path; for the body shape it reuses the
 *      p_/s_ (primary/secondary) prefix convention already visible on this
 *      project's own configured astrology MCP server tools for the same
 *      vendor's other two-person Western endpoints (synastry_horoscope,
 *      composite_horoscope) — not documented on astrologyapi.com's own pages
 *      for this specific path, so this call's result is itself a finding.
 *   3. Check whether that endpoint's prose is parseable per-aspect-pair, or
 *      is a single monolithic block of text.
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

// Fixed, arbitrary sample data — this pilot probes cost and endpoint shape, not astrological
// correctness, so there's no need for a "golden" fixture the way test/golden-chart.test.ts has one.
const PERSON_A = { day: 15, month: 6, year: 1990, hour: 14, min: 30, lat: 52.379189, lon: 4.899431, tzone: 1 };
const PERSON_B = { day: 22, month: 11, year: 1988, hour: 9, min: 15, lat: 52.379189, lon: 4.899431, tzone: 1 };

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

/** Any response header present on both calls whose value differs and looks numeric — the cheapest
 * available proxy for an in-band usage/credit signal, since no dedicated balance endpoint is
 * documented. */
function diffNumericHeaders(before, after) {
  const diffs = [];
  for (const [key, beforeValue] of Object.entries(before)) {
    const afterValue = after[key];
    if (afterValue === undefined || afterValue === beforeValue) continue;
    const beforeNum = Number(beforeValue);
    const afterNum = Number(afterValue);
    if (Number.isFinite(beforeNum) && Number.isFinite(afterNum)) {
      diffs.push({ key, before: beforeValue, after: afterValue, delta: afterNum - beforeNum });
    }
  }
  return diffs;
}

/** Heuristic only — real parseability would need a second pass reading actual prose once seen. */
function assessCompatibilityShape(json) {
  if (!json || typeof json !== 'object') return 'response is not a JSON object — cannot assess shape';
  const arrayFields = Object.entries(json).filter(([, v]) => Array.isArray(v));
  if (arrayFields.length > 0) {
    return (
      `found array field(s) [${arrayFields.map(([k]) => k).join(', ')}] — plausibly structured ` +
      `per-item (e.g. per aspect pair) rather than one prose blob; needs a manual read of the ` +
      `written report to confirm what each array entry actually contains.`
    );
  }
  const stringFields = Object.entries(json).filter(([, v]) => typeof v === 'string' && v.length > 200);
  if (stringFields.length > 0) {
    return (
      `only long string field(s) [${stringFields.map(([k]) => k).join(', ')}] found, no array — ` +
      `looks like a single monolithic prose block, not pre-segmented per-aspect-pair. Splitting it ` +
      `per aspect (if that's needed for benchmark-batch.mjs) would require our own text parsing, ` +
      `not something the API hands back structured.`
    );
  }
  return `no long string or array field found — response shape doesn't obviously carry prose at all: ${JSON.stringify(json).slice(0, 300)}`;
}

const lines = [];
function log(line = '') {
  lines.push(line);
  console.log(line);
}

log('#368 pilot: astrologyapi.com cost + compatibility-endpoint probe');
log(`base URL: ${BASE_URL}`);
log('never logs the literal ASTROLOGYAPI_API_KEY value.');
log();

log('--- Call 1: western_horoscope (confirmed single-person endpoint, baseline) ---');
let call1;
try {
  call1 = await callEndpoint('western_horoscope', {
    ...PERSON_A,
    house_type: 'placidus',
    is_asteroids: false,
  });
  log(`status: ${String(call1.status)} ok=${String(call1.ok)}`);
  log(`response headers: ${JSON.stringify(call1.headers)}`);
} catch (error) {
  log(`[ERROR] western_horoscope call 1 failed: ${error.message}`);
}
log();

log('--- Call 2: western_horoscope again, identical body (diff headers vs. call 1) ---');
let call2;
try {
  call2 = await callEndpoint('western_horoscope', {
    ...PERSON_A,
    house_type: 'placidus',
    is_asteroids: false,
  });
  log(`status: ${String(call2.status)} ok=${String(call2.ok)}`);
  log(`response headers: ${JSON.stringify(call2.headers)}`);
} catch (error) {
  log(`[ERROR] western_horoscope call 2 failed: ${error.message}`);
}
log();

if (call1?.headers && call2?.headers) {
  const diffs = diffNumericHeaders(call1.headers, call2.headers);
  if (diffs.length > 0) {
    log(`possible in-band usage/credit signal — header(s) changed between calls:`);
    for (const d of diffs) log(`  ${d.key}: ${d.before} -> ${d.after} (delta ${String(d.delta)})`);
  } else {
    log(
      `no response header changed numerically between the two identical calls — astrologyapi.com ` +
        `does not appear to expose a per-call credit/usage counter in-band. Cost cannot be confirmed ` +
        `from the API response alone; check the account dashboard balance before/after running this ` +
        `script and compare manually.`,
    );
  }
}
log();

log('--- Call 3: love_compatibility_report/tropical (discovery attempt, two-person shape) ---');
let call3;
try {
  call3 = await callEndpoint('love_compatibility_report/tropical', {
    p_day: PERSON_A.day,
    p_month: PERSON_A.month,
    p_year: PERSON_A.year,
    p_hour: PERSON_A.hour,
    p_min: PERSON_A.min,
    p_lat: PERSON_A.lat,
    p_lon: PERSON_A.lon,
    p_tzone: PERSON_A.tzone,
    s_day: PERSON_B.day,
    s_month: PERSON_B.month,
    s_year: PERSON_B.year,
    s_hour: PERSON_B.hour,
    s_min: PERSON_B.min,
    s_lat: PERSON_B.lat,
    s_lon: PERSON_B.lon,
    s_tzone: PERSON_B.tzone,
  });
  log(`status: ${String(call3.status)} ok=${String(call3.ok)}`);
  log(`response headers: ${JSON.stringify(call3.headers)}`);
  if (call3.ok) {
    log(`response body (full, for keeping): ${JSON.stringify(call3.json ?? call3.rawText)}`);
    log(`shape assessment: ${assessCompatibilityShape(call3.json)}`);
  } else {
    log(
      `non-2xx — the p_/s_ prefix convention (borrowed from this project's configured astrology ` +
        `MCP server tool schemas for the same vendor's synastry_horoscope/composite_horoscope) is ` +
        `likely wrong for this REST path, or the path itself is wrong. Raw body kept below for a ` +
        `manual look at whatever error message astrologyapi.com actually returned.`,
    );
    log(`raw body: ${call3.rawText.slice(0, 2000)}`);
  }
} catch (error) {
  log(`[ERROR] love_compatibility_report/tropical call failed: ${error.message}`);
}
log();

log('SUMMARY');
const call1Ok = call1?.ok === true;
const call3Ok = call3?.ok === true;
log(`- western_horoscope: ${call1Ok ? 'confirmed working' : 'FAILED — check credential/network before anything else'}`);
log(
  `- love_compatibility_report/tropical: ${call3Ok ? 'confirmed working — see shape assessment above' : 'not confirmed working with the p_/s_ guess — endpoint/param shape still needs manual doc lookup or a different guess'}`,
);
log(
  `- per-call cost: not observable in-band from response headers (see diff result above) — must be ` +
    `read from the account dashboard balance before/after this run, not from anything this script can measure itself.`,
);
log();
log('PROPOSED NEXT STEPS');
if (!call1Ok) {
  log('Fix the credential/connectivity problem first — nothing else here is meaningful until call 1 succeeds.');
} else if (!call3Ok) {
  log(
    `Re-run with a corrected path/body for the compatibility endpoint before deciding anything about ` +
      `benchmark-batch.mjs's two-person coverage — candidates worth trying next (from the same docs ` +
      `section): synastry_horoscope, romantic_forecast_report/tropical, romantic_personality_report/tropical.`,
  );
} else {
  log(
    `Both endpoints are confirmed reachable and their param shapes now known. Before building ` +
      `benchmark-batch.mjs: (1) check the astrologyapi.com dashboard balance delta from this pilot's ` +
      `3 calls to get an actual per-call cost figure, since no endpoint exposes it in-band, and ` +
      `(2) read call 3's kept response body above to judge by hand whether its prose is usable for ` +
      `per-aspect-pair comparison as-is, or needs our own text segmentation first.`,
  );
}

const report = lines.join('\n');
if (outPath) {
  await writeFile(resolve(outPath), `${report}\n`);
  console.log(`\nWrote report to ${outPath}`);
}
