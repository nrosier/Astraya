/**
 * Classical-source triage for #359, scoped to `dignity-state` only: checks a
 * corpus entry's text against a short excerpt from a real classical source
 * (William Lilly's *Christian Astrology*, 1647 — see
 * `classical-texts/dignity-state.en.json` for the excerpts and full
 * provenance) describing the same body in the same dignity state, and
 * additively tags any entry the judge finds substantively at odds with it
 * as `diverges-from-classical-source`. Same non-destructive, triage-not-gate
 * pattern as `verify.mjs`/`verify-batch.mjs`: never touches `reviewedBy`,
 * never deletes or rewrites `text`. A human reviewer for #292 makes the real
 * call; this only flags entries worth their attention.
 *
 * Deliberately narrow, like the fact-grounding judge: agreement in substance
 * (the same broad character — is this a flattering or unflattering portrait,
 * roughly the same traits?), not agreement in wording, tone, or persona
 * voice. A "cynic"-persona entry is allowed to be sarcastic about a trait
 * Lilly describes gravely; it should only be flagged if it describes the
 * *opposite* character to what the classical source says for that state.
 */

export const CLASSICAL_TRIAGE_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    matches: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['matches', 'issues'],
};

const RUBRIC = {
  en: "You are comparing one entry from a modern astrology corpus against a genuine excerpt from a classical astrological source (William Lilly, Christian Astrology, 1647) describing the same planet in the same dignity state (rulership, exaltation, detriment, or fall). You are not an astrologer judging correctness in the abstract — you are checking substantive agreement between two texts about the same thing. Ignore differences in tone, era, vocabulary, persona voice (the modern entry may be sarcastic, clinical, or playful where the classical source is grave), and length. Judge only whether the modern entry's overall character portrait broadly agrees with the classical excerpt's — roughly the same traits, the same positive-or-negative valence — or whether it describes something substantively different or contradictory (for example, describing generosity and reliability for a state the classical source calls stubborn and stingy). Set matches=false only for a real substantive divergence, and list each one in issues (one plain-language sentence per array entry). If the entries broadly agree in substance, set matches=true and issues to an empty array.",
};

/** Builds the judge's system/user content for one dignity-state entry against its classical excerpt. */
export function buildClassicalTriagePrompt({ classicalExcerpt, entryText, locale }) {
  const systemInstruction = RUBRIC[locale] ?? RUBRIC.en;
  const userContent = [
    'CLASSICAL SOURCE EXCERPT (William Lilly, Christian Astrology, 1647):',
    classicalExcerpt,
    '',
    'MODERN CORPUS ENTRY:',
    entryText,
    '',
    'Judge these per the rubric above.',
  ].join('\n');
  return { systemInstruction, userContent };
}
