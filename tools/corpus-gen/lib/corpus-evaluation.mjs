/**
 * Second-opinion evaluation rubric for #381: unlike verify.mjs's own fact-grounding judge (a
 * narrow mechanical check — does the text name a wrong body/sign/house/aspect/dignity? — by
 * design indifferent to writing quality or psychological depth), this rubric also asks whether
 * the entry actually captures *this specific placement*, or defaults to a generic trope that
 * would fit many other placements just as well, or a shadow framed as an extreme emotional
 * symptom rather than a specific functional tension — the same failure mode #379/#380's own
 * prompt-engineering work (NEUTRAL_SYSTEM_PROMPT, VOICE_GUIDE) exists to prevent at generation
 * time. This is that same quality bar, applied after the fact by an independent model, instead
 * of only trusted to the generator's own prompt.
 *
 * Validated empirically against gpt-5-nano, gpt-5.4-nano, gpt-5.6-luna and gpt-6-luna with 6
 * hand-picked cases (a correct entry, a wrong-dignity entry, a Saturn cliché-shadow entry, a
 * correct functional-tension entry, a wrong-sign entry, a generic Mars trope): gpt-6-luna and
 * gpt-5.6-luna both scored 6/6; gpt-5-nano also scored 6/6 but used 10-14x more completion
 * tokens for the same answers (erasing its lower per-token price); gpt-5.4-nano scored only 4/6
 * (two false positives against genuinely fine entries). gpt-6-luna is the one actually wired up
 * as this feature's default — see evaluate-corpus-batch.mjs's own doc comment.
 *
 * `priorRejection` closes the loop the other direction: when improve-corpus-batch.mjs's judge
 * (Gemini, the model that wrote the entry) reviews a flagged entry and rejects the complaint
 * (verdict UNCHANGED), that rejection — the issues it rejected and its own reasoning for doing
 * so — is handed back to *this* judge on the entry's next evaluation
 * (evaluate-corpus-batch.mjs reads it from eval-tracking.mjs's `lastRejection`), so ChatGPT is
 * reviewing with the full back-and-forth in view, not re-flagging the same thing in a loop with
 * neither side ever seeing the other's reasoning.
 *
 * `VARIANT_BODY_NOTE` (#395): a real, recurring disagreement surfaced by the above loop, not a
 * hypothetical one — meanLilith/trueLilith/osculatingLilith/interpolatedLilith and meanNode/
 * trueNode are different *calculation methods* for one real point (the Moon's apogee, or its
 * orbital node), not different astrological significators; no tradition assigns them distinct
 * psychological meaning, and the app offers them as a mutually-exclusive user setting — a reader
 * only ever sees whichever one they picked, never two side by side. ChatGPT was repeatedly
 * flagging these entries as generic/interchangeable precisely because sibling variants *do* read
 * near-identically, which is correct, not a defect — and Gemini was repeatedly (correctly)
 * rejecting that complaint, citing the house style's jargon ban as the reason it couldn't
 * differentiate them, which was the right instinct for the wrong-sounding reason: there's nothing
 * true to differentiate, with or without jargon. This note gives the judge that fact up front
 * instead of relitigating it per entry.
 */
const VARIANT_BODY_NOTE = [
  'Six bodies — meanLilith, trueLilith, osculatingLilith, interpolatedLilith, meanNode, trueNode',
  "— are different calculation methods for one real point (the Moon's apogee, or its orbital",
  'node), not different astrological significators, and the app offers them as a mutually',
  'exclusive user setting: a reader only ever sees whichever one they picked, never two side by',
  'side. If this placement involves one of these six bodies, do not flag the entry as generic,',
  'interchangeable, or lacking specificity on the grounds that it reads similarly to how a',
  'sibling variant of the same point would be written — that similarity is correct, not a defect.',
  'Judge it only against its own stated facts, the same way you would any other entry.',
].join(' ');

export const EVALUATION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    correct: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['correct', 'issues'],
  additionalProperties: false,
};

const SYSTEM_INSTRUCTION = [
  'You are an expert astrologer reviewing one short entry from an interpretation corpus for a specific placement.',
  "You are given the placement's computed facts (the only facts that exist for this entry) and the entry's text.",
  'Judge two things: (1) is the text factually consistent with the given facts — does it name a wrong body, sign, house, aspect, or dignity state? (2) does it actually capture this specific placement\'s meaning, or does it default to a generic trope/stereotype/cliché that would fit many other placements just as well, or describe a shadow as an extreme emotional symptom (e.g. "harsh self-criticism", "exhausting burden") rather than a specific functional tension?',
  "Set correct=false if there is a factual error OR a real shortcoming of kind (2) — not for minor stylistic preference. List each specific issue in issues as a short, concrete sentence (what is wrong AND why), in English regardless of the entry's own language. If there is no real issue, set correct=true and issues to an empty array.",
  VARIANT_BODY_NOTE,
].join(' ');

/**
 * Builds the judge's system/user content for one entry against its own placement's facts.
 * `priorRejection` — `{ issues, reasoning }` from a previous round's `UNCHANGED` verdict, if any
 * — is appended as its own block so the judge can decide whether to re-flag with that rebuttal
 * already in view, rather than relitigating blind.
 */
export function buildEvaluationPrompt({ factsDescription, entryText, priorRejection }) {
  const priorRejectionBlock =
    priorRejection === undefined
      ? ''
      : [
          '',
          '',
          'On a previous review, this entry was flagged for:',
          ...priorRejection.issues.map((issue) => `- ${issue}`),
          '',
          'The model that originally wrote this entry reviewed that feedback and rejected it, explaining:',
          priorRejection.reasoning,
          '',
          'Take this into account: only flag this entry again if you still believe there is a genuine problem despite that rebuttal. If you agree the rebuttal is valid, set correct=true.',
        ].join('\n');
  return {
    systemInstruction: SYSTEM_INSTRUCTION,
    userContent: `PLACEMENT FACTS: ${factsDescription}\n\nENTRY TEXT: ${entryText}${priorRejectionBlock}`,
  };
}
