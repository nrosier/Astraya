/**
 * Guardrail (#360) for the one free-text field in the whole Tier-2 request
 * `placementKeys`' structural shape-constraint doesn't cover: the
 * style/tone/focus instructions a user types before their placements are
 * sent to a third-party model. Two distinct risks live in that one field —
 * a naive instruction asking the model for exactly the kind of claim Tier
 * 1's own corpus lint (`lint.ts`) already forbids, and prompt injection,
 * the one class of attack unique to text that becomes part of the prompt
 * itself rather than sanitized data.
 *
 * Environment-agnostic and pure, like `lint.ts` itself: no model call, so
 * importable from both `server/interpretation-routes.ts` (the authoritative
 * check) and `ReportView.tsx` (an inline UX nicety, not a security
 * boundary — the server runs this same check regardless of what the client
 * already filtered).
 */
import { FATALISTIC_PHRASES, MEDICAL_LEGAL_FINANCIAL_TERMS, containsTermFromWordStart } from './lint.ts';

export type GuardrailRule =
  'length' | 'prompt-injection' | 'fatalistic-phrasing' | 'medical-legal-financial-claim' | 'pii-shape';

export interface GuardrailIssue {
  readonly rule: GuardrailRule;
  readonly message: string;
}

export const MAX_CUSTOM_PROMPT_LENGTH = 500;

/**
 * The injection surface unique to this field: phrases that try to redirect
 * the model's behavior rather than describe a style. Not reusing
 * `lint.ts`'s lists for this rule — those are about claims a corpus entry
 * makes to a reader, this is about a user's text trying to talk to the
 * model rather than describe one.
 *
 * Both locales this app ships (`en`, `nl`) are included, unlike `lint.ts`'s
 * English-only phrase lists: this check runs against live user input on a
 * request that actually reaches a model, so a Dutch-only phrasing bypassing
 * it isn't a corpus-review gap, it's a live guardrail bypass.
 */
const PROMPT_INJECTION_PHRASES = [
  'ignore previous instructions',
  'ignore all previous instructions',
  'disregard the system prompt',
  'you are now',
  'act as if you are',
  'pretend you are',
  'system prompt',
  'reveal your instructions',
  'jailbreak',
  'developer mode',
  // Dutch
  'negeer vorige instructies',
  'negeer alle vorige instructies',
  'negeer de systeeminstructies',
  'je bent nu',
  'doe alsof je',
  'systeeminstructies',
  'onthul je instructies',
  'ontwikkelaarsmodus',
];

// Best-effort, not structural — unlike a placement key (shape-constrained by construction),
// free text can't be made structurally incapable of carrying a birth date or coordinate. This
// catches the shapes that matter (a date, a lat/long pair) without pretending to catch a plain
// name too.
const DATE_LIKE_RE = /\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/;
const COORDINATE_LIKE_RE = /-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+/;

/** Every issue found in `text` — empty when it's clean. A caller shows/disables on `.length > 0`, not on any one rule. */
export function checkCustomPrompt(text: string): GuardrailIssue[] {
  const issues: GuardrailIssue[] = [];

  if (text.length === 0 || text.length > MAX_CUSTOM_PROMPT_LENGTH) {
    issues.push({ rule: 'length', message: `Must be between 1 and ${String(MAX_CUSTOM_PROMPT_LENGTH)} characters.` });
  }

  const lower = text.toLowerCase();
  if (PROMPT_INJECTION_PHRASES.some((phrase) => lower.includes(phrase))) {
    issues.push({ rule: 'prompt-injection', message: 'Looks like an attempt to redirect the model, not a style.' });
  }

  if (FATALISTIC_PHRASES.some((phrase) => lower.includes(phrase))) {
    issues.push({ rule: 'fatalistic-phrasing', message: 'Contains absolute, no-way-out phrasing.' });
  }

  if (MEDICAL_LEGAL_FINANCIAL_TERMS.some((term) => containsTermFromWordStart(lower, term))) {
    issues.push({ rule: 'medical-legal-financial-claim', message: 'Asks for medical, legal, or financial advice.' });
  }

  if (DATE_LIKE_RE.test(text) || COORDINATE_LIKE_RE.test(text)) {
    issues.push({ rule: 'pii-shape', message: 'Looks like it contains a date or coordinate.' });
  }

  return issues;
}
