/**
 * Prompt content for #56, transcribed from the issue's confirmed
 * generation-run settings (issue #56, comment 2026-09-07) rather than
 * re-derived — this is the one place that text should live so the real
 * batch runner and this demo script can't drift apart.
 */

/**
 * The voice for a persona-less ("neutral") entry — the default a reader gets
 * before choosing a persona, and the fallback every persona-specific lookup
 * lands on when its own voice has nothing for this placement yet (#211). Not
 * one of `personas.json`'s five flavors: no character, no signature style —
 * matches the tone #55's hand-written exemplars already established (name
 * the strength a placement gives, then its natural pitfall, without
 * dramatizing either).
 */
export const NEUTRAL_SYSTEM_PROMPT = {
  en: "You are a psychologically grounded, even-handed astrologer writing the default entry in an interpretation corpus — the text every reader sees before picking a more particular voice. Address the chart's owner directly, in the second person, as every other voice in this corpus does. Describe the placement's standing disposition: name the strength or gift it gives first, then its natural pitfall or shadow, in plain, warm-but-precise prose, without dramatizing either side. Adopt no persona or signature style of your own — this is the chart speaking, not a character.",
  nl: 'Je bent een psychologisch onderlegde, evenwichtige astroloog die de standaardtekst schrijft in een interpretatiecorpus — de tekst die elke lezer ziet voordat die een specifiekere stem kiest. Spreek de eigenaar van de horoscoop rechtstreeks aan, in de tweede persoon, zoals elke andere stem in dit corpus dat doet. Beschrijf de blijvende aanleg van de stand: noem eerst de kracht of de gave die ze geeft, dan de natuurlijke valkuil of schaduwzijde, in heldere, warme maar precieze taal, zonder een van beide te dramatiseren. Neem geen eigen persona of stijl aan — dit is de horoscoop die spreekt, niet een personage.',
};

/**
 * Ollama models (unlike Gemini) have been observed to drift to English mid-batch
 * for non-English locales (#371) — a local model with no locale hint defaults toward
 * its dominant training language. Gemini stays on-locale without this, so it's opt-in
 * per `buildSystemInstruction`'s `forceLanguageDirective` param rather than always-on.
 */
export const FORCE_LANGUAGE_DIRECTIVE = {
  nl: 'BELANGRIJK: Schrijf uitsluitend in het Nederlands. Elke zin moet Nederlands zijn. Gebruik geen Engels.',
};

export const NEGATIVE_CONSTRAINTS = [
  'Do not use astrological jargon that duplicates what the chart data already states: cosmic, alignment, transit, energies, vibration, native, or the placement’s own terms (the planet name, sign name, house number).',
  'Do not state numbers or degrees. The rule engine owns every figure; a number in prose can contradict the chart.',
  'Do not use AI-tell vocabulary: tapestry, dance, delve, realm, intricate, navigate, testament, symphony, weave.',
  'Do not predict a future event or give advice ("you will meet...", "you should..."). Describe a standing disposition, not a forecast.',
  'Keep the entire entry between 40 and 1600 characters, typically two to three sentences unless the placement warrants more depth — shorter reads as a stub, longer stops being one placement\'s contribution to a report that stacks a dozen of these; either way is rejected by the corpus lint pass regardless of quality.',
];

/** Builds the model-facing instruction block shared by every request, regardless of persona. */
export function buildNegativeConstraintsBlock() {
  return [
    'HARD CONSTRAINTS (violating any of these makes the output unusable)',
    ...NEGATIVE_CONSTRAINTS.map((rule) => `- ${rule}`),
  ].join('\n');
}

/**
 * The "3 gold-standard hand-written fragments" #56 originally asked for,
 * sourced from the corpus's own `anchor: true` marking (#211) instead of a
 * hardcoded key list picked ad hoc per batch — the corpus itself says what's
 * an anchor, in whichever locale the request is for.
 *
 * Optional, not required (#368): originally this threw when a locale had no
 * anchors, on the theory that every model needs a few-shot example to match
 * house style against. `qwen2.5:14b`, used for a full from-scratch
 * regeneration, was judged capable of reasoning to the same tone/length/depth
 * constraints directly from the system instruction and negative constraints
 * alone, with no example text needed — the user's own call. Returns
 * `undefined` (not a thrown error) when a locale has no anchors, so
 * `buildUserContent` can simply omit the section rather than every caller
 * needing its own now-unnecessary "seed some anchors first" workaround.
 */
export function buildAnchorsBlock(corpusEntries, locale, persona) {
  const anchors = corpusEntries.filter((entry) => entry.anchor === true && entry.locale === locale);
  if (anchors.length === 0) return undefined;
  // Anchors are always neutral-voiced (schema.ts forbids an anchor from declaring a persona), so
  // when a persona is generating, "match this tone" would fight the persona's own system prompt
  // above. Scope the instruction to what anchors actually establish across every voice — depth,
  // length, concreteness — and leave tone to the persona voice instead of the neutral examples.
  const matchInstruction = persona
    ? 'match this depth, length and level of concreteness — but keep the voice above, not this tone'
    : 'match this tone, depth and length';
  return [
    `GOLD-STANDARD EXAMPLES (${matchInstruction} — do not copy their content)`,
    ...anchors.map((entry) => `- ${entry.text}`),
  ].join('\n');
}

/**
 * Combines a voice with the neutral rules every entry must still obey.
 * `persona` is optional — omit it (or pass `undefined`) to generate the
 * default/neutral entry instead of a persona's flavor.
 */
export function buildSystemInstruction({ persona, symbolismContext, locale, forceLanguageDirective }) {
  const personaPrompt = persona
    ? (persona.systemPrompts[locale] ?? persona.systemPrompts.en)
    : (NEUTRAL_SYSTEM_PROMPT[locale] ?? NEUTRAL_SYSTEM_PROMPT.en);
  const languageDirective = forceLanguageDirective ? FORCE_LANGUAGE_DIRECTIVE[locale] : undefined;
  return [
    ...(languageDirective ? [languageDirective, ''] : []),
    personaPrompt,
    '',
    'Even in this voice, the output feeds a structured interpretation corpus, not a chat reply — the constraints below override any instinct the voice above has to hedge, moralize or use extended metaphor.',
    '',
    buildNegativeConstraintsBlock(),
    '',
    symbolismContext,
  ].join('\n');
}

export function buildUserContent({ placementDescription, corpusEntries, locale, persona }) {
  const anchorsBlock = buildAnchorsBlock(corpusEntries, locale, persona);
  return [
    `TARGET PLACEMENT: ${placementDescription}`,
    '',
    ...(anchorsBlock ? [anchorsBlock, ''] : []),
    'Write one corpus entry for the target placement, in the voice above, obeying every hard constraint.',
  ].join('\n');
}
