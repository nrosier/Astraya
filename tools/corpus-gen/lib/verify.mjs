/**
 * Fact-grounding judge prompt for #359: checks a generated corpus entry's
 * text against nothing but its own placement's computed facts (body/sign/
 * house/aspect/dignity state) — no reference or "correct" text is needed,
 * since a placement's facts are deterministic and already known before the
 * entry is even written. This is the first verification signal of any kind
 * ahead of #292's human review, for both the existing (never-reviewed)
 * corpus and any new one generated after this.
 *
 * Deliberately narrow: the judge is asked only whether the text names a
 * fact inconsistent with what was given (a wrong body, sign, house, aspect
 * or dignity state) — not whether the interpretation itself is good
 * astrology, well-written, or true in some deeper sense. That broader
 * judgment call stays with #292's human reviewer; this pass only catches
 * the kind of mechanical mismatch (e.g. text describing a "detriment" for a
 * placement whose computed state is "ruler") a human reviewer could easily
 * miss on a fast skim of thousands of entries.
 */

export const VERIFICATION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    grounded: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['grounded', 'issues'],
};

const RUBRIC = {
  en: 'You are a fact-checker for an astrology interpretation corpus, not an astrologer. You are given a placement\'s computed facts (the only facts that exist for this entry) and one entry\'s text. Judge only whether the text is consistent with those facts: does it name a body, sign, house, aspect or dignity state other than the one(s) given? Does it contradict a given fact (for example, describing a "ruler" placement as a "detriment", or a trine as a square)? Ignore tone, writing quality, and any claim that cannot be checked against the given facts alone, such as psychological interpretation. Set grounded=false only if the text names or clearly implies a specific fact that conflicts with what was given, and list each such conflict in issues (one plain-language sentence per array entry, in English regardless of the entry\'s own language). If there is no conflict, set grounded=true and issues to an empty array.',
  nl: 'Je bent een feitencontroleur voor een astrologisch interpretatiecorpus, geen astroloog. Je krijgt de berekende feiten van een plaatsing (de enige feiten die voor deze entry bestaan) en de tekst van één entry. Beoordeel uitsluitend of de tekst consistent is met die feiten: noemt de tekst een andere planeet, teken, huis, aspect of waardigheidsstatus dan gegeven is? Spreekt de tekst een gegeven feit tegen (bijvoorbeeld een "heerser"-plaatsing "val" noemen, of een driehoek een vierkant)? Negeer toon, schrijfkwaliteit en elke uitspraak die niet uitsluitend aan de gegeven feiten te toetsen is, zoals psychologische interpretatie. Zet grounded=false alleen als de tekst een specifiek feit noemt of duidelijk impliceert dat in strijd is met wat gegeven is, en vermeld elke tegenspraak in issues (één duidelijke zin per element, in het Engels, ongeacht de taal van de entry zelf). Is er geen tegenspraak, zet dan grounded=true en issues op een lege array.',
};

/** Builds the judge's system/user content for one entry against its own placement's facts. */
export function buildVerificationPrompt({ factsDescription, entryText, locale }) {
  const systemInstruction = RUBRIC[locale] ?? RUBRIC.en;
  const userContent = [
    `PLACEMENT FACTS: ${factsDescription}`,
    '',
    `ENTRY TEXT: ${entryText}`,
    '',
    'Judge this entry per the rubric above.',
  ].join('\n');
  return { systemInstruction, userContent };
}
