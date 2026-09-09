/**
 * Prompt content for #56, transcribed from the issue's confirmed
 * generation-run settings (issue #56, comment 2026-09-07) rather than
 * re-derived — this is the one place that text should live so the real
 * batch runner and this demo script can't drift apart.
 */

export const NEGATIVE_CONSTRAINTS = [
  'Do not use astrological jargon that duplicates what the chart data already states: cosmic, alignment, transit, energies, vibration, native, or the placement’s own terms (the planet name, sign name, house number).',
  'Do not state numbers or degrees. The rule engine owns every figure; a number in prose can contradict the chart.',
  'Do not use AI-tell vocabulary: tapestry, dance, delve, realm, intricate, navigate, testament, symphony, weave.',
  'Do not predict a future event or give advice ("you will meet...", "you should..."). Describe a standing disposition, not a forecast.',
];

/** Builds the model-facing instruction block shared by every request, regardless of persona. */
export function buildNegativeConstraintsBlock() {
  return ['HARD CONSTRAINTS (violating any of these makes the output unusable)', ...NEGATIVE_CONSTRAINTS.map((rule) => `- ${rule}`)].join(
    '\n',
  );
}

/**
 * The "3 gold-standard hand-written fragments" #56 asks for, now sourced
 * from the corpus's own `anchor: true` marking (#211) instead of a hardcoded
 * key list picked ad hoc per batch — the corpus itself says what's an
 * anchor, in whichever locale the request is for.
 */
export function buildAnchorsBlock(corpusEntries, locale) {
  const anchors = corpusEntries.filter((entry) => entry.anchor === true && entry.locale === locale);
  if (anchors.length === 0) throw new Error(`no anchor entries found for locale "${locale}"`);
  return [
    'GOLD-STANDARD EXAMPLES (match this tone, depth and length — do not copy their content)',
    ...anchors.map((entry) => `- ${entry.text}`),
  ].join('\n');
}

/** Combines a persona's voice with the neutral rules every entry must still obey. */
export function buildSystemInstruction({ persona, symbolismContext, locale }) {
  const personaPrompt = persona.systemPrompts[locale] ?? persona.systemPrompts.en;
  return [
    personaPrompt,
    '',
    'Even in this voice, the output feeds a structured interpretation corpus, not a chat reply — the constraints below override any instinct the voice above has to hedge, moralize or use extended metaphor.',
    '',
    buildNegativeConstraintsBlock(),
    '',
    symbolismContext,
  ].join('\n');
}

export function buildUserContent({ placementDescription, corpusEntries, locale }) {
  return [
    `TARGET PLACEMENT: ${placementDescription}`,
    '',
    buildAnchorsBlock(corpusEntries, locale),
    '',
    'Write one corpus entry for the target placement, in the voice above, obeying every hard constraint.',
  ].join('\n');
}
