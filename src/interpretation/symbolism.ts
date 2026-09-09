/**
 * Per-planet and per-sign symbol sheets (#54): the reference content that
 * keeps voice consistent across generation batches — Saturn's core
 * symbolism must read the same whether it was generated in the first batch
 * or the thousandth. `buildSymbolismContext` is what #56's generator will
 * inject into every generation prompt; this module owns the content, #56
 * owns calling the model.
 *
 * Scoped to `BODIES` entries whose category is `luminary` or `planet` —
 * the ten bodies colloquially called "the planets" (Sun through Pluto).
 * The nodes, Lilith variants, Chiron and the asteroids read placements
 * through the same schema (#53) but need their own symbolism sheets later;
 * leaving them out here is a scope boundary, not an oversight.
 */
import { BODIES } from '../astrology/bodies.js';
import { SIGNS } from '../astrology/signs.js';

export interface PlanetSymbolism {
  readonly key: string;
  readonly core: string;
  readonly keywords: readonly string[];
}

export interface SignSymbolism {
  readonly index: number;
  readonly core: string;
  readonly keywords: readonly string[];
}

export const PLANET_SYMBOLISM: readonly PlanetSymbolism[] = [
  {
    key: 'sun',
    core: 'Identity, will and the self one is consciously building a life around.',
    keywords: ['identity', 'vitality', 'purpose', 'ego', 'recognition'],
  },
  {
    key: 'moon',
    core: 'Instinctive emotional response — what feels safe, and what is needed to feel it.',
    keywords: ['emotion', 'instinct', 'habit', 'nurture', 'memory'],
  },
  {
    key: 'mercury',
    core: 'How information is gathered, processed and exchanged — the mind in motion.',
    keywords: ['communication', 'reasoning', 'perception', 'learning', 'exchange'],
  },
  {
    key: 'venus',
    core: 'What is found attractive or valuable, and how affection and resources are given and received.',
    keywords: ['attraction', 'value', 'harmony', 'pleasure', 'relating'],
  },
  {
    key: 'mars',
    core: 'How desire is pursued and asserted — the drive to act, compete and defend.',
    keywords: ['drive', 'assertion', 'desire', 'conflict', 'initiative'],
  },
  {
    key: 'jupiter',
    core: 'Where confidence, growth and meaning are sought beyond one’s immediate circumstances.',
    keywords: ['expansion', 'confidence', 'belief', 'excess', 'opportunity'],
  },
  {
    key: 'saturn',
    core: 'Where discipline, limitation and long-term responsibility are learned, often the hard way.',
    keywords: ['discipline', 'limitation', 'responsibility', 'mastery', 'delay'],
  },
  {
    key: 'uranus',
    core: 'The sudden break from convention — disruption that clears space for something genuinely new.',
    keywords: ['disruption', 'independence', 'innovation', 'rebellion', 'insight'],
  },
  {
    key: 'neptune',
    core: 'Where boundaries dissolve — imagination, idealism, and the risk of self-deception that comes with them.',
    keywords: ['imagination', 'idealism', 'dissolution', 'sensitivity', 'illusion'],
  },
  {
    key: 'pluto',
    core: 'Where transformation happens through what must first be broken down or surrendered.',
    keywords: ['transformation', 'power', 'intensity', 'renewal', 'the unseen'],
  },
];

export const SIGN_SYMBOLISM: readonly SignSymbolism[] = [
  {
    index: 0,
    core: 'Direct, self-starting energy that acts before it deliberates.',
    keywords: ['initiating', 'bold', 'impulsive', 'competitive'],
  },
  {
    index: 1,
    core: 'Steady, sensory energy that builds slowly and holds firm once it commits.',
    keywords: ['grounded', 'patient', 'sensory', 'possessive'],
  },
  {
    index: 2,
    core: 'Quick, curious energy that gathers and connects rather than settling on one answer.',
    keywords: ['curious', 'versatile', 'talkative', 'restless'],
  },
  {
    index: 3,
    core: 'Protective, feeling-led energy oriented around home and emotional security.',
    keywords: ['nurturing', 'protective', 'moody', 'attached'],
  },
  {
    index: 4,
    core: 'Warm, expressive energy that wants what it does to be seen and to matter.',
    keywords: ['expressive', 'confident', 'generous', 'proud'],
  },
  {
    index: 5,
    core: 'Precise, service-oriented energy that improves things by attending to detail.',
    keywords: ['analytical', 'meticulous', 'practical', 'self-critical'],
  },
  {
    index: 6,
    core: 'Relational, balance-seeking energy that weighs both sides before choosing.',
    keywords: ['diplomatic', 'fair-minded', 'indecisive', 'sociable'],
  },
  {
    index: 7,
    core: 'Intense, private energy that goes to the root of things rather than the surface.',
    keywords: ['intense', 'guarded', 'perceptive', 'transformative'],
  },
  {
    index: 8,
    core: 'Expansive, meaning-seeking energy oriented toward the far away and the not-yet-tried.',
    keywords: ['adventurous', 'philosophical', 'blunt', 'optimistic'],
  },
  {
    index: 9,
    core: 'Disciplined, structure-building energy that measures progress over the long term.',
    keywords: ['disciplined', 'ambitious', 'reserved', 'enduring'],
  },
  {
    index: 10,
    core: 'Detached, idea-driven energy oriented toward the collective rather than the personal.',
    keywords: ['independent', 'unconventional', 'idealistic', 'detached'],
  },
  {
    index: 11,
    core: 'Absorptive, boundary-blurring energy that feels what is around it more than it names it.',
    keywords: ['empathetic', 'dreamy', 'elusive', 'adaptable'],
  },
];

/**
 * Rules the generator (#56) applies to every entry it produces, regardless
 * of placement. Kept short and imperative on purpose — this is prompt
 * content, not documentation prose.
 */
export const VOICE_GUIDE: readonly string[] = [
  'Write in second person, addressing the chart’s owner directly.',
  'State the placement’s meaning plainly before qualifying it — lead with the claim, not the hedge.',
  'Avoid fatalism: describe a tendency or a pull, never a certainty or a verdict.',
  'Do not repeat the placement’s name back verbatim as the entry’s first words (e.g. do not open with "Mars in Aries...").',
  'Keep each entry to one to three sentences; depth comes from precision, not length.',
  'Never use disclaimers, hedging about astrology’s validity, or references to the entry being AI-generated.',
];

function bySymbolismKey<T extends { readonly key?: string; readonly index?: number }>(
  items: readonly T[],
  key: string | number,
): T | undefined {
  return items.find((item) => item.key === key || item.index === key);
}

export function planetSymbolism(bodyKey: string): PlanetSymbolism | undefined {
  return bySymbolismKey(PLANET_SYMBOLISM, bodyKey);
}

export function signSymbolism(signIndex: number): SignSymbolism | undefined {
  return bySymbolismKey(SIGN_SYMBOLISM, signIndex);
}

const PLANET_BODY_KEYS = new Set(
  BODIES.filter((body) => body.category === 'luminary' || body.category === 'planet').map((body) => body.key),
);

/**
 * Assembles the full symbolism reference as plain text, ready to be
 * injected into #56's generation prompt. Verifies its own coverage at
 * build time — a `BODIES` entry added without a matching symbolism sheet,
 * or a symbolism sheet for a body that doesn't exist, throws rather than
 * silently shipping an incomplete prompt.
 */
export function buildSymbolismContext(): string {
  const symbolismKeys = new Set(PLANET_SYMBOLISM.map((entry) => entry.key));
  const missing = [...PLANET_BODY_KEYS].filter((key) => !symbolismKeys.has(key));
  const extra = [...symbolismKeys].filter((key) => !PLANET_BODY_KEYS.has(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `PLANET_SYMBOLISM is out of sync with BODIES — missing: [${missing.join(', ')}], unexpected: [${extra.join(', ')}]`,
    );
  }
  if (SIGN_SYMBOLISM.length !== SIGNS.length) {
    throw new Error(`SIGN_SYMBOLISM has ${String(SIGN_SYMBOLISM.length)} entries, expected ${String(SIGNS.length)}`);
  }

  const planetLines = PLANET_SYMBOLISM.map((entry) => {
    const name = BODIES.find((body) => body.key === entry.key)?.name ?? entry.key;
    return `- ${name}: ${entry.core} (${entry.keywords.join(', ')})`;
  });
  const signLines = SIGN_SYMBOLISM.map((entry) => {
    const name = SIGNS[entry.index]?.name ?? String(entry.index);
    return `- ${name}: ${entry.core} (${entry.keywords.join(', ')})`;
  });

  return [
    'PLANET SYMBOLISM',
    ...planetLines,
    '',
    'SIGN SYMBOLISM',
    ...signLines,
    '',
    'VOICE AND TONE RULES',
    ...VOICE_GUIDE.map((rule) => `- ${rule}`),
  ].join('\n');
}
