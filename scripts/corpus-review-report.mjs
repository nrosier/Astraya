/**
 * Selects the high-salience subset of the corpus #63 asks a human to read and
 * edit — "what users see most" — and prints it as a markdown checklist, so
 * the review is over an actual, current list of keys and text instead of
 * something a person has to reconstruct from the schema by hand.
 *
 * The four named buckets map onto what report.ts actually assembles into
 * every report (not a re-guess of what "high-salience" might mean):
 *   - Sun, Moon and Ascendant signs   → planet-in-sign & planet-in-house for
 *     sun/moon (coreIdentitySection), sign-on-cusp on house 1 for every sign
 *     (the Ascendant, report.ts:180).
 *   - Chart ruler entries             → planet-in-sign for every body that
 *     can rule an Ascendant sign (chartRulerSection, report.ts:284) — the
 *     same seven-body TRADITIONAL_RULER_KEYS set generate-batch.mjs uses for
 *     dignity-state, because only those seven have a classical rulership.
 *   - Angular placements              → planet-in-house and sign-on-cusp for
 *     houses 1, 4, 7, 10 (angular houses.ts terminology; house 1 overlaps the
 *     Ascendant bucket above and is not double-counted).
 *   - Pattern entries                 → out of scope today: report.ts/rules.ts
 *     don't produce a "pattern" category yet (see compose.ts's own note that
 *     nakshatra/pattern are excluded from #59/#60), so nothing to list.
 * "Long tail tagged internally as unreviewed for later passes" isn't
 * mechanical — it's a product decision (a `reviewed` corpus field? a
 * separate manifest?) this script doesn't make on its own; it just reports
 * the count of everything outside the four buckets so that decision has a
 * number to work from.
 *
 * Reviews the neutral voice only: it's the fallback every persona lookup
 * lands on and the text every reader sees before choosing a persona, so it
 * is the highest-leverage thing to get right first. Re-run per persona later
 * by passing --persona.
 *
 *   node scripts/corpus-review-report.mjs [--locale=en|nl] [--persona=<id>]
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TRADITIONAL_RULER_KEYS = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'];
const ANGULAR_HOUSES = new Set([1, 4, 7, 10]);

const rawArgs = process.argv.slice(2);
function flag(name, fallback) {
  const found = rawArgs.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}
const locale = flag('locale', 'en');
if (locale !== 'en' && locale !== 'nl') throw new Error(`--locale must be "en" or "nl", got "${locale}"`);
const personaFlag = flag('persona');

const entries = JSON.parse(await readFile(join(root, 'src', 'interpretation', 'corpus', `${locale}.json`), 'utf8'));
const scoped = entries.filter((entry) => entry.persona === personaFlag);

function parseKey(key) {
  const [category, ...rest] = key.split(':');
  return { category, rest };
}

const buckets = {
  'Sun, Moon and Ascendant signs': [],
  'Chart ruler entries (planet-in-sign, traditional rulers)': [],
  'Angular placements (houses 1, 4, 7, 10)': [],
  'Pattern entries': [], // always empty today — see file doc
};
const seenKeys = new Set();

function assign(bucket, entry) {
  if (seenKeys.has(entry.key)) return;
  seenKeys.add(entry.key);
  buckets[bucket].push(entry);
}

for (const entry of scoped) {
  const { category, rest } = parseKey(entry.key);
  if (category === 'planet-in-sign' && (rest[0] === 'sun' || rest[0] === 'moon')) {
    assign('Sun, Moon and Ascendant signs', entry);
  } else if (category === 'planet-in-house' && (rest[0] === 'sun' || rest[0] === 'moon')) {
    assign('Sun, Moon and Ascendant signs', entry);
  } else if (category === 'sign-on-cusp' && Number(rest[1]) === 1) {
    assign('Sun, Moon and Ascendant signs', entry);
  } else if (category === 'planet-in-sign' && TRADITIONAL_RULER_KEYS.includes(rest[0])) {
    assign('Chart ruler entries (planet-in-sign, traditional rulers)', entry);
  } else if (category === 'planet-in-house' && ANGULAR_HOUSES.has(Number(rest[1]))) {
    assign('Angular placements (houses 1, 4, 7, 10)', entry);
  } else if (category === 'sign-on-cusp' && ANGULAR_HOUSES.has(Number(rest[1]))) {
    assign('Angular placements (houses 1, 4, 7, 10)', entry);
  }
}

const highSalienceCount = Object.values(buckets).reduce((sum, list) => sum + list.length, 0);
const longTailCount = scoped.length - highSalienceCount;

console.log(`# Corpus review checklist — ${locale}/${personaFlag ?? 'neutral'}\n`);
console.log(
  `${String(highSalienceCount)} high-salience entries (of ${String(scoped.length)} total) across the buckets below; ${String(longTailCount)} long-tail entries not listed — ship those lint-validated, per #63.\n`,
);

for (const [title, list] of Object.entries(buckets)) {
  console.log(`## ${title} (${String(list.length)})\n`);
  if (list.length === 0) {
    console.log('_none — see file doc for why._\n');
    continue;
  }
  for (const entry of list.sort((a, b) => a.key.localeCompare(b.key))) {
    const reviewed = entry.provenance?.source === 'hand-written' ? ' _(hand-written)_' : '';
    console.log(`- [ ] \`${entry.key}\`${reviewed}: ${entry.text}`);
  }
  console.log('');
}
