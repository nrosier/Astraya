/**
 * One-off smoke test for #56: generates a single entry for one persona,
 * one locale and one placement, and shows the raw result plus a lint/dedupe
 * check against the shipped corpus. Does not write to
 * src/interpretation/corpus/*.json — this is a "does the pipeline work and
 * is the output usable" check, not the batch runner (#56's other
 * checkboxes — batching, resumability — are not built yet).
 *
 *   npx tsx --env-file=.env.local tools/corpus-gen/generate-sample.mjs <personaId|neutral> [category] [body] [signOrHouse] [--locale=en|nl]
 *   npx tsx --env-file=.env.local tools/corpus-gen/generate-sample.mjs traditionalist planet-in-sign jupiter 8
 *   npx tsx --env-file=.env.local tools/corpus-gen/generate-sample.mjs mystic planet-in-sign moon 5 --locale=nl
 *   npx tsx --env-file=.env.local tools/corpus-gen/generate-sample.mjs neutral planet-in-sign moon 5 --locale=nl
 *
 * Plain `node` cannot run this file: schema.ts/symbolism.ts import bodies.ts/
 * signs.ts as real runtime values through `.js` specifiers that only a
 * TS-aware loader (tsx) remaps back to the sibling .ts files.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateStructured } from './lib/gemini.mjs';
import { buildSystemInstruction, buildUserContent } from './lib/prompt.mjs';
import { CORPUS_ENTRY_RESPONSE_SCHEMA, placementKey } from '../../src/interpretation/schema.ts';
import { buildSymbolismContext, planetSymbolism, signSymbolism } from '../../src/interpretation/symbolism.ts';
import { lintEntry } from '../../src/interpretation/lint.ts';
import { findNearDuplicates } from '../../src/interpretation/dedupe.ts';
import { BODIES } from '../../src/astrology/bodies.ts';
import { SIGNS } from '../../src/astrology/signs.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const rawArgs = process.argv.slice(2);
const localeFlag = rawArgs.find((arg) => arg.startsWith('--locale='));
const locale = localeFlag ? localeFlag.slice('--locale='.length) : 'en';
if (locale !== 'en' && locale !== 'nl') throw new Error(`--locale must be "en" or "nl", got "${locale}"`);
const positional = rawArgs.filter((arg) => !arg.startsWith('--'));

const [personaId, category = 'planet-in-sign', body = 'jupiter', signOrHouseRaw = '8'] = positional;
const signOrHouse = Number(signOrHouseRaw);

const personas = JSON.parse(await readFile(join(root, 'tools', 'corpus-gen', 'personas.json'), 'utf8')).personas;
const knownIds = ['neutral', ...personas.map((p) => p.id)];
if (!personaId) throw new Error(`personaId is required — known: ${knownIds.join(', ')}`);
const persona = personaId === 'neutral' ? undefined : personas.find((candidate) => candidate.id === personaId);
if (personaId !== 'neutral' && !persona)
  throw new Error(`unknown persona "${personaId}" — known: ${knownIds.join(', ')}`);

if (category !== 'planet-in-sign' && category !== 'planet-in-house') {
  throw new Error(`this smoke test only supports planet-in-sign / planet-in-house, got "${category}"`);
}
const placement =
  category === 'planet-in-sign' ? { category, body, sign: signOrHouse } : { category, body, house: signOrHouse };
const key = placementKey(placement);

const corpusEntries = JSON.parse(
  await readFile(join(root, 'src', 'interpretation', 'corpus', `${locale}.json`), 'utf8'),
);
if (corpusEntries.some((entry) => entry.key === key)) {
  console.warn(
    `note: "${key}" already has a shipped entry — this run will not overwrite it, just show a second draft.`,
  );
}

const bodyName = BODIES.find((b) => b.key === body)?.name ?? body;
const placementDescription =
  category === 'planet-in-sign'
    ? `${bodyName} in ${SIGNS[signOrHouse]?.name ?? String(signOrHouse)} (${planetSymbolism(body)?.core ?? ''} / ${signSymbolism(signOrHouse)?.core ?? ''})`
    : `${bodyName} in house ${String(signOrHouse)} (${planetSymbolism(body)?.core ?? ''})`;

const systemInstruction = buildSystemInstruction({ persona, symbolismContext: buildSymbolismContext(locale), locale });
const userContent = buildUserContent({ placementDescription, corpusEntries, locale });

console.log('='.repeat(80));
console.log(`PERSONA: ${persona ? `${persona.title.en} (${persona.id})` : 'neutral (no persona)'}`);
console.log(`PLACEMENT: ${key} — ${placementDescription}`);
console.log(`MODEL: ${process.env.GEMINI_MODEL}  TEMPERATURE: ${process.env.GEMINI_TEMPERATURE}`);
console.log('='.repeat(80));

let result;
try {
  result = await generateStructured({
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL,
    baseUrl: process.env.GEMINI_BASE_URL,
    temperature: Number(process.env.GEMINI_TEMPERATURE ?? '0.75'),
    systemInstruction,
    userContent,
    responseSchema: CORPUS_ENTRY_RESPONSE_SCHEMA,
  });
} catch (error) {
  console.error('\nGENERATION FAILED');
  console.error(error.message);
  process.exit(1);
}

console.log('\nRAW MODEL OUTPUT');
console.log(JSON.stringify(result, null, 2));

const draftEntry = {
  key,
  locale,
  text: result.text,
  tier: result.tier,
  tags: placement.category === 'dignity-state' ? [placement.state] : [],
  ...(persona ? { persona: persona.id } : {}),
  provenance: {
    source: 'generated',
    model: process.env.GEMINI_MODEL,
    generatedAt: new Date().toISOString().slice(0, 10),
  },
};

console.log('\nLINT CHECK');
const lintIssues = lintEntry(draftEntry);
if (lintIssues.length === 0) console.log('clean — no lint issues');
else for (const issue of lintIssues) console.log(`  [${issue.rule}] ${issue.message}`);

console.log(`\nDEDUPE CHECK (against the shipped ${locale} corpus)`);
const { pairs } = findNearDuplicates([...corpusEntries, draftEntry]);
const near = pairs.filter((pair) => pair.keyA === key || pair.keyB === key);
if (near.length === 0) console.log('clean — no near-duplicates at or above the threshold');
else for (const pair of near) console.log(`  ${pair.keyA} <-> ${pair.keyB}: ${pair.similarity.toFixed(3)}`);

console.log(`\nNot written to ${locale}.json — this script only generates and checks, per the smoke-test scope above.`);
