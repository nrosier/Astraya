/**
 * Corpus lint pass (#57): style rules the hand-written exemplars (#55) and the
 * generator's output (#56) must both pass before an entry ships. Every rule here
 * is heuristic — a keyword or a length bound, not an understanding of the
 * sentence — because that is what makes the pass deterministic and cheap enough
 * to run on every entry in CI. #63's human review is what catches what these
 * heuristics cannot.
 *
 * Per-entry rules (`lintEntry`) run independently of the rest of the corpus.
 * `lintCorpus` adds the one rule that needs the whole set at once: a corpus
 * where too many entries open the same way reads as templated even if no two
 * entries are otherwise alike, which is a different failure from #58's
 * near-duplicate detection (that catches whole-text similarity; this catches
 * only the opening).
 */
import type { CorpusEntry } from './schema.js';

export type LintRule =
  'length' | 'fatalistic-phrasing' | 'medical-legal-financial-claim' | 'gendered-assumption' | 'repetitive-openings';

export interface LintIssue {
  readonly rule: LintRule;
  readonly key: string;
  readonly message: string;
}

/**
 * Guesses at what a one-to-three-sentence report-section paragraph should span.
 * Too short reads as a stub; too long stops being one placement's contribution
 * to a report that stacks a dozen of these (#61). Both bounds are a starting
 * point for #63's review to tighten, not a fact derived from anything.
 */
export const MIN_LENGTH = 40;
export const MAX_LENGTH = 480;

/**
 * Absolute, no-way-out phrasing. Astrology describes tendencies, and an entry
 * that reads as a verdict rather than a tendency is a craft failure independent
 * of whether the sentence is otherwise well written.
 */
const FATALISTIC_PHRASES = [
  'you will never',
  'you will always',
  'you can never',
  "you'll never",
  "you'll always",
  'you are doomed',
  "there's nothing you can do",
  'there is nothing you can do',
  'it is impossible for you',
  "you're incapable of",
  'you are incapable of',
  'fated to fail',
  'destined to fail',
  'no matter what you do',
];

/**
 * Keyword surface for the three professions a chart reading is not: this is not
 * a diagnosis, a verdict, or a recommendation to move money. Keyword matching
 * necessarily over- and under-fires — "grounded" is fine, "diagnose" almost
 * never is — so this list stays short and clearly on the wrong side of the
 * line, leaving the rest to #63.
 */
const MEDICAL_LEGAL_FINANCIAL_TERMS = [
  // Not "diagnos", "prescri", or "invest in": spot-checked against the shipped
  // corpus, every hit for these was a metaphor astrology text actually needs —
  // "diagnostic instincts", "a knack for diagnosing problems" (Pallas as an
  // analytical placement), "the prescribed path" (nothing medical), "invest in
  // a sense of belonging" — a 100% false-positive rate that cost review time
  // without ever catching a real claim.
  'medication',
  'cures',
  'cured by',
  'treats your',
  'lawsuit',
  'sue ',
  'legal advice',
  'financial advice',
  'guaranteed return',
  'guaranteed profit',
  'tax advice',
];

/**
 * The entry addresses "you"; the reader's gender is never known, so a third
 * singular pronoun in an entry almost always means the entry drifted into
 * describing someone else instead — a partner, a parent — which is the actual
 * problem this rule is standing in for. Matched as whole words, case-sensitive
 * lowercase, so "His" in "History" or capitalised proper nouns are not touched.
 */
const GENDERED_WORDS = ['he', 'she', 'him', 'her', 'his', 'hers', 'himself', 'herself'];

/** How large a share of one locale's entries may share the same opening word before it reads as templated. */
const MAX_SHARED_OPENING_SHARE = 0.15;
const MIN_ENTRIES_FOR_OPENING_CHECK = 20;

/**
 * Second-person address is what these interpretations are for: "you"/"your"
 * (and Dutch "je"/"jij"/"jouw", "u"/"uw" for formal address) legitimately open
 * a huge share of every persona's entries, in both locales, by design — not
 * because the text is templated. Excluding them from the opening-variety check
 * keeps that check aimed at what it actually means to catch: many entries
 * starting with the same distinctive word or phrase, which reads as templated.
 */
const GENERIC_OPENING_WORDS = new Set(['you', 'your', 'je', 'jij', 'jouw', 'u', 'uw']);

function containsWholeWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`).test(text);
}

/**
 * Matches only from a word boundary, so a short/stem term like "sue " or
 * "cures" doesn't fire on "pursue " or "obscures" — those contain the term as
 * a bare substring but not as its own word or word-start.
 */
function containsTermFromWordStart(text: string, term: string): boolean {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text);
}

function openingWord(text: string): string | undefined {
  const match = /^[a-z]+/i.exec(text.trim());
  return match?.[0].toLowerCase();
}

/** Lints one entry against every rule that needs nothing but its own text. */
export function lintEntry(entry: CorpusEntry): LintIssue[] {
  const issues: LintIssue[] = [];
  const text = entry.text;
  const lower = text.toLowerCase();

  if (text.trim().length < MIN_LENGTH) {
    issues.push({
      rule: 'length',
      key: entry.key,
      message: `text is ${String(text.trim().length)} characters, below the ${String(MIN_LENGTH)}-character minimum`,
    });
  } else if (text.length > MAX_LENGTH) {
    issues.push({
      rule: 'length',
      key: entry.key,
      message: `text is ${String(text.length)} characters, over the ${String(MAX_LENGTH)}-character maximum`,
    });
  }

  for (const phrase of FATALISTIC_PHRASES) {
    if (lower.includes(phrase)) {
      issues.push({ rule: 'fatalistic-phrasing', key: entry.key, message: `contains fatalistic phrasing "${phrase}"` });
    }
  }

  for (const term of MEDICAL_LEGAL_FINANCIAL_TERMS) {
    if (containsTermFromWordStart(lower, term)) {
      issues.push({
        rule: 'medical-legal-financial-claim',
        key: entry.key,
        message: `contains a medical/legal/financial term "${term.trim()}"`,
      });
    }
  }

  for (const word of GENDERED_WORDS) {
    if (containsWholeWord(lower, word)) {
      issues.push({
        rule: 'gendered-assumption',
        key: entry.key,
        message: `contains the gendered pronoun "${word}", which assumes the reader's gender`,
      });
    }
  }

  return issues;
}

/**
 * Lints a whole locale's entries: every per-entry rule, plus the one rule that
 * only makes sense over the full set. Corpora smaller than
 * `MIN_ENTRIES_FOR_OPENING_CHECK` skip the opening-variety check — with only a
 * handful of entries, any shared opening is a coincidence, not a pattern.
 */
export function lintCorpus(entries: readonly CorpusEntry[]): LintIssue[] {
  const issues = entries.flatMap(lintEntry);

  if (entries.length >= MIN_ENTRIES_FOR_OPENING_CHECK) {
    const byOpening = new Map<string, CorpusEntry[]>();
    for (const entry of entries) {
      const opening = openingWord(entry.text);
      if (opening === undefined || GENERIC_OPENING_WORDS.has(opening)) continue;
      const group = byOpening.get(opening) ?? [];
      group.push(entry);
      byOpening.set(opening, group);
    }

    const threshold = entries.length * MAX_SHARED_OPENING_SHARE;
    for (const [opening, group] of byOpening) {
      if (group.length > threshold) {
        for (const entry of group) {
          issues.push({
            rule: 'repetitive-openings',
            key: entry.key,
            message: `${String(group.length)} of ${String(entries.length)} entries open with "${opening}", over the ${String(Math.round(MAX_SHARED_OPENING_SHARE * 100))}% limit`,
          });
        }
      }
    }
  }

  return issues;
}
