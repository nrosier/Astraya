/**
 * Wording for the interpretation entries shown under a wheel selection (#415): each entry's heading,
 * built from its placement so the reader sees *which* placement the text below belongs to. Pure and
 * locale-aware, kept apart from the component so both languages can be tested without a DOM.
 */
import type { CorpusPlacement, DignityState, Locale } from '../interpretation/schema.js';
import { SIGNS } from '../astrology/signs.js';
import { aspectDisplayName, bodyDisplayName, signDisplayName } from './astro-names.messages.js';

export interface SelectionHeadingLabels {
  readonly house: string;
  readonly dignityStates: Readonly<Record<DignityState, string>>;
  readonly cuspOf: (sign: string, house: number) => string;
}

function signName(index: number, locale: Locale): string {
  return signDisplayName(SIGNS[((index % 12) + 12) % 12]?.name ?? '', locale);
}

/** A short heading for a placement, or `undefined` for a category the wheel never selects. */
export function placementHeading(
  placement: CorpusPlacement,
  locale: Locale,
  labels: SelectionHeadingLabels,
): string | undefined {
  switch (placement.category) {
    case 'planet-in-sign':
      return `${bodyDisplayName(placement.body, locale)} — ${signName(placement.sign, locale)}`;
    case 'planet-in-house':
      return `${bodyDisplayName(placement.body, locale)} — ${labels.house} ${String(placement.house)}`;
    case 'dignity-state':
      return `${bodyDisplayName(placement.body, locale)} — ${labels.dignityStates[placement.state]}`;
    case 'aspect-pair':
      return `${bodyDisplayName(placement.bodyA, locale)} ${aspectDisplayName(placement.aspect, locale).toLowerCase()} ${bodyDisplayName(placement.bodyB, locale)}`;
    case 'sign-on-cusp':
      return labels.cuspOf(signName(placement.sign, locale), placement.house);
    default:
      return undefined;
  }
}

/** How many entries are shown before a "show all" control, so a busy planet does not bury the facts. */
export const SELECTION_TEXT_LIMIT = 6;
