/**
 * Feedback-loop revision prompt for #381: takes an entry evaluate-corpus-batch.mjs's independent
 * judge flagged, plus the judge's own specific issues, and asks the *same* model that originally
 * wrote the entry (Gemini) to revise it — critically, not automatically. The explicit ask (user's
 * own instruction, not inferred): "don't apply [the feedback] blindly, take what is useful." A
 * second opinion can itself be wrong — overly literal, nitpicking a stylistic choice, or simply
 * mistaken about the astrology — so the model that already knows this placement's facts and this
 * corpus's own house style is the right one to decide what's actually worth acting on, not a
 * script that applies every flagged issue unconditionally.
 *
 * Reuses `buildSystemInstruction`'s own voice/constraints (NEUTRAL_SYSTEM_PROMPT,
 * NEGATIVE_CONSTRAINTS, VOICE_GUIDE) as the base, so a revision reads like it came from the same
 * house style as every other entry — this is additional instruction on top of that, not a
 * separate voice.
 */

export const IMPROVEMENT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['IMPROVED', 'UNCHANGED'] },
    reasoning: { type: 'string' },
    text: { type: 'string' },
  },
  required: ['verdict', 'reasoning', 'text'],
};

const TASK_INSTRUCTION = [
  '',
  'REVISION TASK',
  'You previously wrote the entry given below for this exact placement. An independent reviewer raised the specific concerns listed below about it.',
  'Evaluate each concern critically before acting on it — you are not required to agree. A concern may itself be mistaken about the astrology, too literal about phrasing that was intentional, or a matter of taste rather than a real problem. Only revise the text where you genuinely agree a concern points at a real shortcoming for this specific placement; ignore any concern you disagree with and leave the corresponding part of the text as it was.',
  'If, after this review, no concern holds up, output verdict=UNCHANGED and text identical to the original — do not rewrite just to be seen doing something. If at least one concern is genuinely valid, output verdict=IMPROVED and a revised text that fixes only what you agreed was wrong, still obeying every constraint above (length, voice, no jargon, no stereotypes). Either way, reasoning briefly states which concerns you accepted and which you rejected and why — one short sentence per concern is enough.',
].join('\n');

/** Builds the revision prompt: `baseSystemInstruction` is the same house-style instruction the original generation used. */
export function buildImprovementPrompt({ baseSystemInstruction, factsDescription, originalText, issues }) {
  const systemInstruction = `${baseSystemInstruction}\n${TASK_INSTRUCTION}`;
  const userContent = [
    `PLACEMENT FACTS: ${factsDescription}`,
    '',
    `YOUR ORIGINAL TEXT: ${originalText}`,
    '',
    "REVIEWER'S CONCERNS:",
    ...issues.map((issue) => `- ${issue}`),
  ].join('\n');
  return { systemInstruction, userContent };
}
