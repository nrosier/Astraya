/**
 * Draft a CHANGELOG.md section from conventional commit subjects.
 *
 * This prints a draft; it does not write the file. That is deliberate. A generated
 * changelog reads like a list of commits, and a commit subject is written for a
 * reviewer, not for someone deciding whether to upgrade. The draft guarantees
 * nothing is *forgotten*; a human still says what changed for a user.
 *
 * Usage: npm run changelog:draft [-- <since-ref>]
 * Defaults to the range since the most recent tag.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

const explicit = process.argv[2];
let since = explicit;
if (since === undefined) {
  try {
    since = git('describe', '--tags', '--abbrev=0');
  } catch {
    since = undefined; // no tags yet: the whole history is the first release
  }
}
const range = since === undefined ? [] : [`${since}..HEAD`];

const subjects = git('log', '--no-merges', '--pretty=%s', ...range)
  .split('\n')
  .filter((line) => line !== '');

/** Conventional commit: type(scope)!: subject */
const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<subject>.+)$/;

// Ordered by what a reader cares about first. `fix` outranks `feat` because a
// correctness fix is the reason to upgrade in a hurry.
const SECTIONS = [
  ['breaking', 'Breaking changes'],
  ['fix', 'Fixed'],
  ['feat', 'Added'],
  ['perf', 'Performance'],
  ['refactor', 'Changed'],
  ['docs', 'Documentation'],
];
// Not shown: chore, test, ci, build, style — real work, but not news to a user.
//
// `style` is the trap in that list. Conventionally it means whitespace and
// formatting, which nobody wants in a changelog, but it also gets used for a
// visible redesign, which is exactly the kind of thing a user notices. So these are
// not dropped silently: they are printed on stderr for a human to rule on, the same
// as an unparseable subject.
const REVIEW_TYPES = new Set(['style', 'revert']);

const grouped = new Map(SECTIONS.map(([key]) => [key, []]));
const unconventional = [];
const needsRuling = [];

for (const subject of subjects) {
  const m = CONVENTIONAL.exec(subject);
  if (m?.groups === undefined) {
    unconventional.push(subject);
    continue;
  }
  const { type, scope, breaking, subject: text } = m.groups;
  const key = breaking === '!' ? 'breaking' : type;
  const bucket = grouped.get(key);
  if (bucket !== undefined) bucket.push(scope === undefined ? text : `**${scope}:** ${text}`);
  else if (REVIEW_TYPES.has(key)) needsRuling.push(subject);
}

const version = JSON.parse(readFileSync('./package.json', 'utf8')).version;
const today = new Date().toISOString().slice(0, 10);

const out = [`## [${version}] — ${today}`, ''];
for (const [key, heading] of SECTIONS) {
  const items = grouped.get(key);
  if (items === undefined || items.length === 0) continue;
  out.push(`### ${heading}`, '');
  for (const item of items) out.push(`- ${item}`);
  out.push('');
}
if (out.length === 2) out.push('_No user-facing changes in this range._', '');

console.log(out.join('\n'));

// Both lists go to stderr, so neither can end up pasted into the changelog by
// accident, and neither can be lost without someone having read past the draft.
if (unconventional.length > 0) {
  console.error(`\n${unconventional.length} commit(s) are not conventional and were skipped:`);
  for (const subject of unconventional) console.error(`  ${subject}`);
  console.error('Check none of these were user-facing before publishing.');
}

if (needsRuling.length > 0) {
  console.error(`\n${needsRuling.length} commit(s) need a ruling — usually invisible, sometimes not:`);
  for (const subject of needsRuling) console.error(`  ${subject}`);
  console.error('Add any that a user would notice to the draft by hand.');
}
