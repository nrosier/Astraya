/**
 * The typed loader (#53): combines the per-locale corpus arrays, validates
 * each with `validateCorpusEntries`, and enforces the one check that needs
 * both locales at once — every key in `en` must also exist in `nl` and vice
 * versa. This is the single place that decision is made; the generator
 * (#56) and lint/dedupe passes (#57/#58) work one locale at a time and rely
 * on this loader as the final gate.
 *
 * Failure is loud: one aggregated `Error` listing every problem, rather than
 * a partial corpus with silent gaps. A missing translation is a missing
 * report section, so it fails the build the same way a broken calculation
 * would.
 */
import type { CorpusEntry, CorpusValidationIssue, Locale } from './schema.js';
import { CORPUS_LOCALES, validateCorpusEntries } from './schema.js';

export type CorpusByLocale = Readonly<Record<Locale, readonly unknown[]>>;

function formatIssues(locale: Locale, issues: readonly CorpusValidationIssue[]): string[] {
  return issues.map((issue) => `[${locale}] entry ${String(issue.index)}: ${issue.message}`);
}

/**
 * Validates and combines the corpus. Throws one `Error` (message joined by
 * newlines) describing every problem found, across both locales, if any
 * entry fails validation or a key is missing from either locale.
 */
export function loadCorpus(byLocale: CorpusByLocale): readonly CorpusEntry[] {
  const problems: string[] = [];
  const entriesByLocale: Record<Locale, readonly CorpusEntry[]> = { en: [], nl: [] };

  for (const locale of CORPUS_LOCALES) {
    const result = validateCorpusEntries(byLocale[locale]);
    if (!result.ok) {
      problems.push(...formatIssues(locale, result.issues));
      continue;
    }
    for (const entry of result.entries) {
      if (entry.locale !== locale) {
        problems.push(`[${locale}] entry "${entry.key}" declares locale "${entry.locale}", expected "${locale}"`);
      }
    }
    entriesByLocale[locale] = result.entries;
  }

  if (problems.length === 0) {
    /** `key::persona` (empty suffix for the neutral entry) — parity must hold per persona, not just per key. */
    const identityOf = (entry: CorpusEntry): string => `${entry.key}::${entry.persona ?? ''}`;
    const describeIdentity = (entry: CorpusEntry): string =>
      entry.persona === undefined ? `key "${entry.key}"` : `key "${entry.key}" for persona "${entry.persona}"`;

    const identitiesByLocale = new Map(
      CORPUS_LOCALES.map((locale) => [
        locale,
        new Map(entriesByLocale[locale].map((entry) => [identityOf(entry), entry])),
      ]),
    );
    for (const locale of CORPUS_LOCALES) {
      const ownIdentities = identitiesByLocale.get(locale);
      if (ownIdentities === undefined) continue;
      for (const otherLocale of CORPUS_LOCALES) {
        if (otherLocale === locale) continue;
        const otherIdentities = identitiesByLocale.get(otherLocale);
        if (otherIdentities === undefined) continue;
        for (const [identity, entry] of ownIdentities) {
          if (!otherIdentities.has(identity))
            problems.push(`${describeIdentity(entry)} exists in locale "${locale}" but not in "${otherLocale}"`);
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`corpus failed validation:\n${problems.join('\n')}`);
  }

  return CORPUS_LOCALES.flatMap((locale) => entriesByLocale[locale]);
}
