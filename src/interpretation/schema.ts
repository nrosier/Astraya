/**
 * Interpretation corpus schema (#53): the single source of truth for both the
 * AI Studio generator's `responseSchema` (#56) and this app's own runtime
 * validation (`loader.ts`). A corpus entry's `key` is always derived from a
 * `CorpusPlacement` by `placementKey`, never hand-typed, so the generator, the
 * lint/dedupe passes (#57/#58) and the rule engine (#60) all agree on an
 * entry's identity without re-deriving it independently.
 *
 * `category` is deliberately not a separate field on `CorpusEntry` — it is
 * always the key's first segment, recoverable with `categoryOfKey`. Keeping
 * one encoding of "what this entry is about" avoids a `category` field ever
 * silently drifting from its own key.
 *
 * Placement fields are validated against the real astrology reference data
 * (`BODIES`, `SIGNS`, `ASPECTS`, `NAKSHATRAS`) rather than accepted as
 * arbitrary strings, so a typo'd body or aspect key fails validation instead
 * of silently never matching any chart.
 */
import { bodyByKey } from '../astrology/bodies.js';
import { aspectByKey } from '../astrology/aspects.js';
import { SIGNS } from '../astrology/signs.js';
import { NAKSHATRAS } from '../astrology/nakshatras.js';
import type { EssentialDignities } from '../astrology/dignities.js';

export const CORPUS_CATEGORIES = [
  'planet-in-sign',
  'planet-in-house',
  'sign-on-cusp',
  'aspect-pair',
  'dignity-state',
  'nakshatra',
  'pattern',
] as const;
export type CorpusCategory = (typeof CORPUS_CATEGORIES)[number];

/**
 * Editorial importance, assigned by whoever writes or reviews the entry —
 * not the same thing as the rule engine's computed salience (#60), which
 * also weighs dignity, sect and angularity. `tier` is one input a rule can
 * weigh; it is not itself the ranking. `core` marks the placements almost
 * every report will want to say something about; `nuance` marks deep-cut
 * detail that only matters once the obvious things have been said.
 */
export const CORPUS_TIERS = ['core', 'notable', 'nuance'] as const;
export type CorpusTier = (typeof CORPUS_TIERS)[number];

export const CORPUS_LOCALES = ['en', 'nl'] as const;
export type Locale = (typeof CORPUS_LOCALES)[number];

/**
 * Mirrors the `id`s in `tools/corpus-gen/personas.json` — kept as a plain
 * literal here rather than read from that file so this module stays a pure,
 * synchronous value with no filesystem access (`test/no-runtime-llm-access.
 * test.ts`'s spirit). A test asserts the two lists stay in sync.
 */
export const PERSONA_IDS = ['traditionalist', 'big_sister', 'cynic', 'mystic', 'pragmatist'] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];

/**
 * A body has at most one of these true under a given rulership scheme
 * (`essentialDignities`, #25) — this is that state, not a separate taxonomy
 * invented for the corpus.
 */
export const DIGNITY_STATES = ['ruler', 'exalted', 'detriment', 'fall'] as const;
export type DignityState = (typeof DIGNITY_STATES)[number];

/** Derives the single dignity state an entry should key off, if any is true. */
export function dignityState(dignities: EssentialDignities): DignityState | undefined {
  if (dignities.ruler) return 'ruler';
  if (dignities.exalted) return 'exalted';
  if (dignities.detriment) return 'detriment';
  if (dignities.fall) return 'fall';
  return undefined;
}

/**
 * What one entry is about. `body`/`bodyA`/`bodyB` are `BodyDefinition.key`
 * values (e.g. `"sun"`), never numeric `BodyId` — a corpus entry is authored
 * content, keyed the way a human (or #56's generator) names a placement.
 *
 * `pattern` is a free-form kebab-case key rather than a closed enum: today
 * only `jonesShapeOf` (#35) actually classifies a whole-chart pattern (its
 * seven shapes), but "pattern" is meant to also cover detectors this repo
 * doesn't have yet (grand trine, T-square, yod — M10 territory), so the
 * schema doesn't hard-code today's detector as the category's ceiling.
 */
export type CorpusPlacement =
  | { readonly category: 'planet-in-sign'; readonly body: string; readonly sign: number }
  | { readonly category: 'planet-in-house'; readonly body: string; readonly house: number }
  | { readonly category: 'sign-on-cusp'; readonly sign: number; readonly house: number }
  | { readonly category: 'aspect-pair'; readonly aspect: string; readonly bodyA: string; readonly bodyB: string }
  | { readonly category: 'dignity-state'; readonly body: string; readonly state: DignityState }
  | { readonly category: 'nakshatra'; readonly body: string; readonly nakshatra: number }
  | { readonly category: 'pattern'; readonly pattern: string };

const PATTERN_KEY_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Canonical, deterministic string encoding of a placement — the entry's `key`. */
export function placementKey(placement: CorpusPlacement): string {
  switch (placement.category) {
    case 'planet-in-sign':
      return `planet-in-sign:${placement.body}:${String(placement.sign)}`;
    case 'planet-in-house':
      return `planet-in-house:${placement.body}:${String(placement.house)}`;
    case 'sign-on-cusp':
      return `sign-on-cusp:${String(placement.sign)}:${String(placement.house)}`;
    case 'aspect-pair': {
      const [bodyA, bodyB] = canonicalPair(placement.bodyA, placement.bodyB);
      return `aspect-pair:${placement.aspect}:${bodyA}:${bodyB}`;
    }
    case 'dignity-state':
      return `dignity-state:${placement.body}:${placement.state}`;
    case 'nakshatra':
      return `nakshatra:${placement.body}:${String(placement.nakshatra)}`;
    case 'pattern':
      return `pattern:${placement.pattern}`;
  }
}

/** Alphabetical order — an aspect pair has no inherent direction, so this is the one canonical order. */
function canonicalPair(bodyA: string, bodyB: string): readonly [string, string] {
  return bodyA <= bodyB ? [bodyA, bodyB] : [bodyB, bodyA];
}

/** The category a key encodes, without parsing the rest of it. */
export function categoryOfKey(key: string): CorpusCategory | undefined {
  const prefix = key.split(':', 1)[0];
  return (CORPUS_CATEGORIES as readonly string[]).includes(prefix ?? '') ? (prefix as CorpusCategory) : undefined;
}

/** Parses a key back into a structured placement, e.g. for looking up display glyphs (#62). */
export function parsePlacementKey(key: string): CorpusPlacement | undefined {
  const parts = key.split(':');
  const [category, ...rest] = parts;
  switch (category) {
    case 'planet-in-sign': {
      const [body, sign] = rest;
      if (body === undefined || sign === undefined) return undefined;
      return { category, body, sign: Number(sign) };
    }
    case 'planet-in-house': {
      const [body, house] = rest;
      if (body === undefined || house === undefined) return undefined;
      return { category, body, house: Number(house) };
    }
    case 'sign-on-cusp': {
      const [sign, house] = rest;
      if (sign === undefined || house === undefined) return undefined;
      return { category, sign: Number(sign), house: Number(house) };
    }
    case 'aspect-pair': {
      const [aspect, bodyA, bodyB] = rest;
      if (aspect === undefined || bodyA === undefined || bodyB === undefined) return undefined;
      return { category, aspect, bodyA, bodyB };
    }
    case 'dignity-state': {
      const [body, state] = rest;
      if (body === undefined || !isDignityState(state)) return undefined;
      return { category, body, state };
    }
    case 'nakshatra': {
      const [body, nakshatra] = rest;
      if (body === undefined || nakshatra === undefined) return undefined;
      return { category, body, nakshatra: Number(nakshatra) };
    }
    case 'pattern': {
      const pattern = rest.join(':');
      if (pattern === '') return undefined;
      return { category, pattern };
    }
    default:
      return undefined;
  }
}

function isDignityState(value: string | undefined): value is DignityState {
  return (DIGNITY_STATES as readonly string[]).includes(value ?? '');
}

export type CorpusProvenanceSource = 'hand-written' | 'generated';

export interface CorpusProvenance {
  readonly source: CorpusProvenanceSource;
  /** Set when `source` is `"generated"`, e.g. `"gemini-2.5-pro"`. */
  readonly model?: string;
  /** Identifies which generator prompt produced this entry, e.g. `"corpus-generator-v1"`. Set when `source` is `"generated"`. */
  readonly promptVersion?: string;
  /** ISO 8601 date. Set when `source` is `"generated"`. */
  readonly generatedAt?: string;
  /** Set once #63's human review has covered this entry. */
  readonly reviewedBy?: string;
  /** ISO 8601 date. */
  readonly reviewedAt?: string;
}

export interface CorpusEntry {
  readonly key: string;
  readonly locale: Locale;
  readonly text: string;
  readonly tier: CorpusTier;
  readonly tags: readonly string[];
  readonly provenance: CorpusProvenance;
  /** Absent means the neutral, persona-agnostic entry used when no persona-specific one exists. */
  readonly persona?: PersonaId;
  /**
   * Marks one of the "gold-standard exemplars" #56's generator injects into
   * every request, regardless of persona. Never combined with `persona` —
   * an anchor is neutral by definition. See `validateProvenance` for what
   * provenance an anchor requires.
   */
  readonly anchor?: boolean;
}

/**
 * The fields #56's generator asks the model to fill. `key`, `locale` and
 * `provenance` are assigned by the generation pipeline itself, from the
 * placement it is generating for — the model is never asked to invent an
 * entry's identity or its own provenance.
 */
export const CORPUS_ENTRY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    tier: { type: 'string', enum: CORPUS_TIERS },
  },
  required: ['text', 'tier'],
} as const;

export interface CorpusValidationIssue {
  readonly index: number;
  readonly message: string;
}

export type CorpusValidationResult =
  | { readonly ok: true; readonly entries: readonly CorpusEntry[] }
  | { readonly ok: false; readonly issues: readonly CorpusValidationIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validatePlacementFields(placement: CorpusPlacement): string[] {
  const errors: string[] = [];
  const checkBody = (body: string, label: string): void => {
    if (bodyByKey(body) === undefined) errors.push(`unknown body key "${body}" (${label})`);
  };
  const checkSign = (sign: number, label: string): void => {
    if (!Number.isInteger(sign) || sign < 0 || sign >= SIGNS.length) {
      errors.push(`sign index ${String(sign)} out of range 0-${String(SIGNS.length - 1)} (${label})`);
    }
  };
  const checkHouse = (house: number, label: string): void => {
    if (!Number.isInteger(house) || house < 1 || house > 12) {
      errors.push(`house ${String(house)} out of range 1-12 (${label})`);
    }
  };

  switch (placement.category) {
    case 'planet-in-sign':
      checkBody(placement.body, 'body');
      checkSign(placement.sign, 'sign');
      break;
    case 'planet-in-house':
      checkBody(placement.body, 'body');
      checkHouse(placement.house, 'house');
      break;
    case 'sign-on-cusp':
      checkSign(placement.sign, 'sign');
      checkHouse(placement.house, 'house');
      break;
    case 'aspect-pair':
      if (aspectByKey(placement.aspect) === undefined) errors.push(`unknown aspect key "${placement.aspect}"`);
      checkBody(placement.bodyA, 'bodyA');
      checkBody(placement.bodyB, 'bodyB');
      if (placement.bodyA === placement.bodyB) errors.push(`aspect-pair bodyA and bodyB are both "${placement.bodyA}"`);
      else if (placement.bodyA > placement.bodyB) {
        errors.push(
          `aspect-pair bodies must be in alphabetical order — got "${placement.bodyA}", "${placement.bodyB}"`,
        );
      }
      break;
    case 'dignity-state':
      checkBody(placement.body, 'body');
      break;
    case 'nakshatra':
      checkBody(placement.body, 'body');
      if (
        !Number.isInteger(placement.nakshatra) ||
        placement.nakshatra < 0 ||
        placement.nakshatra >= NAKSHATRAS.length
      ) {
        errors.push(`nakshatra index ${String(placement.nakshatra)} out of range 0-${String(NAKSHATRAS.length - 1)}`);
      }
      break;
    case 'pattern':
      if (!PATTERN_KEY_RE.test(placement.pattern)) {
        errors.push(`pattern key "${placement.pattern}" is not lowercase kebab-case`);
      }
      break;
  }
  return errors;
}

/** Re-derives the placement encoded by `key` and checks it's actually well-formed. */
function validateKey(key: string): string[] {
  const placement = parsePlacementKey(key);
  if (placement === undefined) return [`key "${key}" does not parse as a known category`];
  const errors = validatePlacementFields(placement);
  const canonical = placementKey(placement);
  if (canonical !== key) errors.push(`key "${key}" is not canonical — expected "${canonical}"`);
  return errors;
}

function validateProvenance(value: unknown): string[] {
  if (!isRecord(value)) return ['provenance must be an object'];
  const errors: string[] = [];
  const source = value.source;
  if (source !== 'hand-written' && source !== 'generated') {
    errors.push(`provenance.source must be "hand-written" or "generated", got ${JSON.stringify(source)}`);
  }
  for (const field of ['model', 'promptVersion', 'generatedAt', 'reviewedBy', 'reviewedAt']) {
    const fieldValue = value[field];
    if (fieldValue !== undefined && typeof fieldValue !== 'string') {
      errors.push(`provenance.${field} must be a string if present`);
    }
  }
  return errors;
}

function isPersonaId(value: unknown): value is PersonaId {
  return (PERSONA_IDS as readonly unknown[]).includes(value);
}

/**
 * An anchor's provenance must show a human stands behind the exact words:
 * either it was hand-written, or it was generated and has since been
 * reviewed (`reviewedBy`/`reviewedAt` both set) — the same fields #63's
 * review pass already uses to mark generated text as checked.
 */
function isAcceptableAnchorProvenance(provenance: CorpusProvenance): boolean {
  if (provenance.source === 'hand-written') return true;
  return provenance.source === 'generated' && provenance.reviewedBy !== undefined && provenance.reviewedAt !== undefined;
}

/** Validates one raw entry's shape and placement-key correctness, without checking cross-locale parity. */
export function validateCorpusEntries(raw: readonly unknown[]): CorpusValidationResult {
  const issues: CorpusValidationIssue[] = [];
  const entries: CorpusEntry[] = [];
  const seenKeys = new Set<string>();

  raw.forEach((item, index) => {
    const report = (message: string): void => {
      issues.push({ index, message });
    };
    if (!isRecord(item)) {
      report('entry must be an object');
      return;
    }
    const { key, locale, text, tier, tags, provenance, persona, anchor } = item;
    if (typeof key !== 'string') {
      report('key must be a string');
      return;
    }
    for (const error of validateKey(key)) report(error);
    if (persona !== undefined && !isPersonaId(persona)) {
      report(`persona must be one of ${PERSONA_IDS.join(', ')}, got ${JSON.stringify(persona)}`);
    }
    const dedupeKey = `${key}::${typeof persona === 'string' ? persona : ''}`;
    if (seenKeys.has(dedupeKey)) {
      report(persona === undefined ? `duplicate key "${key}"` : `duplicate key "${key}" for persona "${String(persona)}"`);
    }
    seenKeys.add(dedupeKey);

    if (!(CORPUS_LOCALES as readonly unknown[]).includes(locale))
      report(`locale must be one of ${CORPUS_LOCALES.join(', ')}`);
    if (typeof text !== 'string' || text.trim() === '') report('text must be a non-empty string');
    if (!(CORPUS_TIERS as readonly unknown[]).includes(tier)) report(`tier must be one of ${CORPUS_TIERS.join(', ')}`);
    if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string'))
      report('tags must be an array of strings');
    for (const error of validateProvenance(provenance)) report(error);

    if (anchor !== undefined) {
      if (typeof anchor !== 'boolean') report('anchor must be a boolean if present');
      else if (anchor) {
        if (persona !== undefined) report('anchor entries must not declare a persona — anchors are neutral');
        if (isRecord(provenance) && !isAcceptableAnchorProvenance(provenance as unknown as CorpusProvenance)) {
          report('anchor entries must be hand-written, or generated and reviewed (reviewedBy + reviewedAt set)');
        }
      }
    }

    const hasErrorsForThisEntry = issues.some((issue) => issue.index === index);
    if (!hasErrorsForThisEntry) {
      entries.push({
        key,
        locale: locale as Locale,
        text: text as string,
        tier: tier as CorpusTier,
        tags: tags as readonly string[],
        provenance: provenance as CorpusProvenance,
        ...(persona !== undefined ? { persona: persona as PersonaId } : {}),
        ...(anchor !== undefined ? { anchor: anchor as boolean } : {}),
      });
    }
  });

  return issues.length === 0 ? { ok: true, entries } : { ok: false, issues };
}
