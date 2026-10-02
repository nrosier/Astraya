/**
 * Regression coverage for `tools/corpus-gen/lib/corpus-evaluation.mjs`'s `buildEvaluationPrompt`
 * (#381): specifically the `priorRejection` block, which hands a previous round's Gemini
 * rejection (issues it declined + its own reasoning) back to the next evaluation of the same
 * entry, so the two models' feedback loop doesn't re-litigate blind every round.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs, no type declarations; cast to known shapes below.
import { buildEvaluationPrompt as buildEvaluationPromptUntyped } from '../tools/corpus-gen/lib/corpus-evaluation.mjs';

const buildEvaluationPrompt = buildEvaluationPromptUntyped as (params: {
  readonly factsDescription: string;
  readonly entryText: string;
  readonly priorRejection?: { readonly issues: readonly string[]; readonly reasoning: string };
}) => { readonly systemInstruction: string; readonly userContent: string };

describe('buildEvaluationPrompt (#381)', () => {
  it('omits any prior-rejection block when there is none', () => {
    const { userContent } = buildEvaluationPrompt({
      factsDescription: 'Sun in Capricorn',
      entryText: 'Some entry text.',
    });
    expect(userContent).toBe('PLACEMENT FACTS: Sun in Capricorn\n\nENTRY TEXT: Some entry text.');
    expect(userContent).not.toContain('previous review');
  });

  it('includes the rejected issues and reasoning when a prior rejection is given', () => {
    const { userContent } = buildEvaluationPrompt({
      factsDescription: 'Sun in Capricorn',
      entryText: 'Some entry text.',
      priorRejection: {
        issues: ['Relies on a generic trope.', 'Shadow framing is vague.'],
        reasoning: 'Both concerns are stylistic preference, not factual or specificity problems.',
      },
    });
    expect(userContent).toContain('On a previous review, this entry was flagged for:');
    expect(userContent).toContain('- Relies on a generic trope.');
    expect(userContent).toContain('- Shadow framing is vague.');
    expect(userContent).toContain('Both concerns are stylistic preference, not factual or specificity problems.');
    expect(userContent).toContain('only flag this entry again if you still believe there is a genuine problem');
  });

  it('does not mutate factsDescription/entryText ordering when a prior rejection is present', () => {
    const { userContent } = buildEvaluationPrompt({
      factsDescription: 'Moon in Cancer',
      entryText: 'Entry body.',
      priorRejection: { issues: ['x'], reasoning: 'y' },
    });
    expect(userContent.startsWith('PLACEMENT FACTS: Moon in Cancer\n\nENTRY TEXT: Entry body.')).toBe(true);
  });

  it('tells the judge not to penalize Lilith/node calculation-method variants for reading alike (#395)', () => {
    const { systemInstruction } = buildEvaluationPrompt({
      factsDescription: 'interpolatedLilith trine Saturn',
      entryText: 'Some entry text.',
    });
    for (const body of ['meanLilith', 'trueLilith', 'osculatingLilith', 'interpolatedLilith', 'meanNode', 'trueNode']) {
      expect(systemInstruction).toContain(body);
    }
    expect(systemInstruction).toContain('mutually');
    expect(systemInstruction).toContain('not a defect');
  });
});
