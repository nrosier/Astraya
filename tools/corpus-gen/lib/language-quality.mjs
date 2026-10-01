/**
 * Language-quality judge prompt: catches what lint.ts's `language-mismatch`
 * rule structurally can't — that rule only checks whether an entry contains
 * at least one of its locale's common words, so it misses an entry that is
 * mostly-correct prose with a stray word or phrase from another language
 * mixed in, a spelling mistake, or phrasing a native speaker would never
 * produce, as long as a handful of ordinary function words are still
 * present. Those need an actual reader, not a keyword count.
 *
 * Three-way verdict, not fact-grounding's two-way grounded/not: a wrong
 * language or an ambiguous problem (BAD) needs a human decision (remove and
 * regenerate), but a clear, mechanical slip — a typo, a Dutch d/t-fout, a
 * missing standard punctuation mark — can be corrected right here instead of
 * costing a regeneration cycle (FIXED). GOOD means exactly what it says: no
 * change made. Confidence-gated deliberately high (per the rubric below) so
 * FIXED never means "rewrote this to sound better" — rule 3 explicitly bans
 * that — only "corrected an unambiguous mechanical error."
 *
 * One rubric, not one hand-written-and-translated rubric per locale (as a
 * `verify.mjs`-style `RUBRIC[locale]` lookup would be): instructions in
 * English about a named target language work fine for any locale a model
 * already knows, and the corpus already supports locales beyond today's
 * en/nl. A per-locale lookup would need a human to add and translate a new
 * block for every future locale, and silently judging an unknown locale
 * against the wrong language's rubric (the obvious fallback) is worse than
 * no check at all.
 *
 * Validated against gemini-3.5-flash-lite and gemini-3.8-flash with 6
 * hand-picked cases (clean text, an obvious typo, valid-but-unusual style
 * that must NOT be rewritten, a classic Dutch d/t-fout, wrong-language text,
 * and word-salad nonsense): both scored 6/6, flash-lite with zero thinking
 * tokens against 3.8-flash's ~900 for the same 6 calls. flash-lite is the
 * one actually wired up as this script's default for that reason — see
 * language-quality-batch.mjs.
 */

export const LANGUAGE_QUALITY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['GOOD', 'FIXED', 'BAD'] },
    confidence: { type: 'number' },
    correctedText: { type: 'string' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'confidence', 'correctedText', 'issues'],
};

/**
 * `Intl.DisplayNames` turns a locale code into the name a judge model
 * actually needs ("nl" → "Dutch"), rather than this file hard-coding that
 * map itself. Falls back to the bare code for a tag the runtime doesn't
 * recognize, which still gives the model something, just a less friendly
 * one.
 */
function languageName(locale) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale);
  } catch {
    return locale;
  }
}

function systemInstruction(language) {
  return [
    `You are an expert, high-precision proofreader for ${language}.`,
    '',
    'Your goal is to correct minor spelling, punctuation, capitalization, and grammatical errors ONLY when your confidence in the correction is extremely high (95%+ confidence).',
    '',
    'RULES:',
    '1. If an error is clear, unambiguous, and high-confidence (e.g., obvious typos, clear d/t-fouten, missing standard punctuation), correct it.',
    '2. If a sentence is grammatically acceptable, or if a potential "error" is a matter of personal style, dialect, domain jargon, or preference, DO NOT change it (keep confidence low).',
    '3. Do NOT rewrite or rephrase valid sentences to "improve" their flow.',
    '4. Output your response as a valid JSON object following the schema provided.',
    '',
    'Classify as exactly one verdict:',
    '- GOOD: no changes needed. correctedText equals the original exactly. issues is empty.',
    '- FIXED: one or more small, high-confidence corrections were made. correctedText holds the corrected text. issues lists each fix in plain language.',
    '- BAD: wrong language entirely, or problems you are not highly confident how to fix (ambiguous, garbled, nonsensical). correctedText equals the original unchanged. issues lists what is wrong.',
    'confidence is 0 to 1, your confidence in the verdict/correction given.',
  ].join('\n');
}

/** Builds the judge's system/user content for one entry's language quality alone. */
export function buildLanguageQualityPrompt({ entryText, locale }) {
  return {
    systemInstruction: systemInstruction(languageName(locale)),
    userContent: `TEXT:\n${entryText}`,
  };
}
