/**
 * Report section assembly (#61): turns one already-computed `ChartData` into
 * an ordered set of named sections, each a list of non-empty paragraphs —
 * the shape a report screen actually renders, instead of every caller having
 * to know which placements matter and how to look their text up itself.
 *
 * Built entirely on prior interpretation pieces: #60's rule engine picks
 * which placements the "Aspect patterns" section shows and in what order,
 * and #59's `resolvePlacementText` guarantees every paragraph that comes
 * from a placement is non-empty, corpus or no corpus. The handful of
 * paragraphs that aren't placement text (temperament, sect, dispositor
 * chain, chart shape) are plain locale-templated sentences over data this
 * module already has, so they can't be empty either.
 *
 * A pure, synchronous function of one `ChartData`: no ephemeris access, no
 * "now". That is a deliberate scope cut on this issue's last checklist item,
 * "current timing from progressions and the year's solar return" —
 * `SecondaryProgressionData`/a solar-return chart is not itself a
 * `ChartData` (no `dignities` or `sect`, and its cross-chart contacts aren't
 * the intra-chart `aspects` an `aspect-pair` placement models), and deciding
 * what a "current timing" placement even keys off is a real design question
 * of its own. Left for a follow-up rather than forced into this module's
 * shape.
 *
 * "Nodes and Chiron axis" covers the True Node and Chiron, each with their
 * own `BODIES` entry and computed position. The South Node does not: it has
 * no `BodyDefinition` of its own (it's always exactly 180° from the North
 * Node — `southNode()` in `bodies.ts`), so it has no `CorpusPlacement` body
 * key to resolve text for, and isn't given its own paragraph here. That's a
 * scoping note, not a bug: nothing currently feeding this module treats the
 * South Node as an independent placement.
 */
import { bodyById, bodyByKey, type BodyDefinition } from '../astrology/bodies.js';
import { rulerOf } from '../astrology/dignities.js';
import { dispositorChain, type DispositorChain } from '../astrology/dispositors.js';
import { elementBalance, houseOf, modalityBalance } from '../astrology/emphasis.js';
import { jonesShapeOf, type JonesShape } from '../astrology/jones-shapes.js';
import type { Element, Modality } from '../astrology/signs.js';
import { signIndex } from '../astrology/signs.js';
import type { ChartData } from '../domain/chart-compute.js';
import type { BodyId, Degrees } from '../ephemeris/types.js';
import { resolvePlacementText } from './compose.js';
import { derivePlacements, rankPlacements } from './rules.js';
import { dignityState, type CorpusEntry, type CorpusPlacement, type Locale } from './schema.js';

export type ReportSectionId =
  'core-identity' | 'temperament' | 'chart-ruler' | 'houses' | 'aspect-patterns' | 'dignities-sect' | 'nodes-chiron';

export interface ReportSection {
  readonly id: ReportSectionId;
  readonly title: string;
  /** Ordered, each already guaranteed non-empty. */
  readonly paragraphs: readonly string[];
}

export interface Report {
  readonly sections: readonly ReportSection[];
}

const SECTION_TITLES: Readonly<Record<ReportSectionId, Readonly<Record<Locale, string>>>> = {
  'core-identity': { en: 'Core identity: Sun, Moon, Ascendant', nl: 'Kernidentiteit: Zon, Maan, Ascendant' },
  temperament: { en: 'Temperament and elemental balance', nl: 'Temperament en elementenbalans' },
  'chart-ruler': { en: 'Chart ruler and dispositor chain', nl: 'Horoscoopheerser en dispositorketen' },
  houses: { en: 'Houses and life areas', nl: 'Huizen en levensgebieden' },
  'aspect-patterns': { en: 'Aspect patterns', nl: 'Aspectpatronen' },
  'dignities-sect': { en: 'Dignities and sect', nl: 'Waardigheden en sect' },
  'nodes-chiron': { en: 'Nodes and Chiron axis', nl: 'Maansknopen en Chiron-as' },
};

/** How many of the chart's most salient aspects "Aspect patterns" shows, so a busy chart doesn't dump all of them. */
const ASPECT_PATTERNS_LIMIT = 8;

function positionsMap(chart: ChartData): ReadonlyMap<BodyId, Degrees> {
  return new Map(chart.positions.map((position) => [position.body, position.longitude]));
}

function bodyPosition(chart: ChartData, key: string): { readonly body: BodyDefinition; readonly longitude: Degrees } {
  const body = bodyByKey(key);
  if (body === undefined) throw new Error(`unreachable: unknown body key "${key}"`);
  const position = chart.positions.find((candidate) => candidate.body === body.id);
  if (position === undefined) throw new Error(`unreachable: chart has no position for "${key}"`);
  return { body, longitude: position.longitude };
}

function section(id: ReportSectionId, locale: Locale, paragraphs: readonly string[]): ReportSection {
  return { id, title: SECTION_TITLES[id][locale], paragraphs };
}

function placementText(placement: CorpusPlacement, locale: Locale, corpus: readonly CorpusEntry[]): string {
  return resolvePlacementText(placement, locale, corpus);
}

function planetInSignText(chart: ChartData, key: string, locale: Locale, corpus: readonly CorpusEntry[]): string {
  const { longitude } = bodyPosition(chart, key);
  return placementText({ category: 'planet-in-sign', body: key, sign: signIndex(longitude) }, locale, corpus);
}

function planetInHouseText(chart: ChartData, key: string, locale: Locale, corpus: readonly CorpusEntry[]): string {
  const { longitude } = bodyPosition(chart, key);
  const house = houseOf(longitude, chart.houses.cusps);
  return placementText({ category: 'planet-in-house', body: key, house }, locale, corpus);
}

function coreIdentitySection(chart: ChartData, locale: Locale, corpus: readonly CorpusEntry[]): ReportSection {
  const ascendantSign = signIndex(chart.houses.ascendant);
  return section('core-identity', locale, [
    planetInSignText(chart, 'sun', locale, corpus),
    planetInHouseText(chart, 'sun', locale, corpus),
    planetInSignText(chart, 'moon', locale, corpus),
    planetInHouseText(chart, 'moon', locale, corpus),
    placementText({ category: 'sign-on-cusp', sign: ascendantSign, house: 1 }, locale, corpus),
  ]);
}

/** Classical Hippocratic-Galenic element-temperament correspondence — standard, not requiring verification. */
const ELEMENT_TEMPERAMENT: Readonly<Record<Element, Readonly<Record<Locale, string>>>> = {
  fire: { en: 'choleric', nl: 'cholerisch' },
  earth: { en: 'melancholic', nl: 'melancholisch' },
  air: { en: 'sanguine', nl: 'sanguinisch' },
  water: { en: 'phlegmatic', nl: 'flegmatisch' },
};

const ELEMENT_NAMES: Readonly<Record<Element, Readonly<Record<Locale, string>>>> = {
  fire: { en: 'Fire', nl: 'Vuur' },
  earth: { en: 'Earth', nl: 'Aarde' },
  air: { en: 'Air', nl: 'Lucht' },
  water: { en: 'Water', nl: 'Water' },
};

const MODALITY_NAMES: Readonly<Record<Modality, Readonly<Record<Locale, string>>>> = {
  cardinal: { en: 'Cardinal', nl: 'Kardinaal' },
  fixed: { en: 'Fixed', nl: 'Vast' },
  mutable: { en: 'Mutable', nl: 'Beweeglijk' },
};

const ELEMENT_ORDER: readonly Element[] = ['fire', 'earth', 'air', 'water'];
const MODALITY_ORDER: readonly Modality[] = ['cardinal', 'fixed', 'mutable'];

/** The key with the highest tally in `balance`; ties broken by earliest position in `order`. */
function dominantOf<K extends string>(balance: Readonly<Record<K, number>>, order: readonly K[]): K {
  let best = order[0];
  if (best === undefined) throw new Error('unreachable: order is never empty');
  for (const key of order) {
    if (balance[key] > balance[best]) best = key;
  }
  return best;
}

function temperamentSection(chart: ChartData, locale: Locale): ReportSection {
  const positions = positionsMap(chart);
  const elements = elementBalance(positions);
  const modalities = modalityBalance(positions);
  const dominantElement = dominantOf(elements, ELEMENT_ORDER);
  const dominantModality = dominantOf(modalities, MODALITY_ORDER);

  const elementSentence =
    locale === 'nl'
      ? `Vuur ${String(elements.fire)}, aarde ${String(elements.earth)}, lucht ${String(elements.air)} en water ${String(elements.water)} — ${ELEMENT_NAMES[dominantElement].nl.toLowerCase()} overheerst.`
      : `Fire ${String(elements.fire)}, earth ${String(elements.earth)}, air ${String(elements.air)}, water ${String(elements.water)} — ${ELEMENT_NAMES[dominantElement].en.toLowerCase()} dominates.`;

  const temperamentSentence =
    locale === 'nl'
      ? `Dat wijst op een ${ELEMENT_TEMPERAMENT[dominantElement].nl} temperament, met een ${MODALITY_NAMES[dominantModality].nl.toLowerCase()} inslag.`
      : `That points to a ${ELEMENT_TEMPERAMENT[dominantElement].en} temperament, with a ${MODALITY_NAMES[dominantModality].en.toLowerCase()} bent.`;

  return section('temperament', locale, [elementSentence, temperamentSentence]);
}

function chainBodyName(id: BodyId): string {
  const body = bodyById(id);
  if (body === undefined) throw new Error(`unreachable: dispositorChain only ever returns known body ids`);
  return body.name;
}

function describeDispositorChain(chain: DispositorChain, locale: Locale): string {
  const path = chain.chain.map(chainBodyName).join(' → ');
  if (chain.cycle) {
    return locale === 'nl'
      ? `Dispositorketen: ${path} — sluit in een kringloop in plaats van bij een uiteindelijke heerser.`
      : `Dispositor chain: ${path} — closes in a cycle rather than at a final dispositor.`;
  }
  return locale === 'nl'
    ? `Dispositorketen: ${path} — komt uiteindelijk uit bij zijn eigen heerserschap.`
    : `Dispositor chain: ${path} — ultimately terminates at its own rulership.`;
}

function chartRulerSection(chart: ChartData, locale: Locale, corpus: readonly CorpusEntry[]): ReportSection {
  const ascendantSign = signIndex(chart.houses.ascendant);
  const rulerId = rulerOf(ascendantSign);
  const ruler = bodyById(rulerId);
  const rulerPosition = chart.positions.find((position) => position.body === rulerId);
  if (ruler === undefined || rulerPosition === undefined) {
    throw new Error('unreachable: the ascendant ruler is always one of BODIES with a computed position');
  }

  const rulerSignText = placementText(
    { category: 'planet-in-sign', body: ruler.key, sign: signIndex(rulerPosition.longitude) },
    locale,
    corpus,
  );
  const chain = dispositorChain(rulerId, positionsMap(chart));

  return section('chart-ruler', locale, [rulerSignText, describeDispositorChain(chain, locale)]);
}

function housesSection(chart: ChartData, locale: Locale, corpus: readonly CorpusEntry[]): ReportSection {
  const houseCount = chart.houses.cusps.length - 1;
  const bodiesByHouse = new Map<number, BodyId[]>();
  for (const position of chart.positions) {
    const house = houseOf(position.longitude, chart.houses.cusps);
    const list = bodiesByHouse.get(house);
    if (list) list.push(position.body);
    else bodiesByHouse.set(house, [position.body]);
  }

  const paragraphs: string[] = [];
  for (let house = 1; house <= houseCount; house++) {
    const cusp = chart.houses.cusps[house];
    if (cusp === undefined) continue;
    paragraphs.push(placementText({ category: 'sign-on-cusp', sign: signIndex(cusp), house }, locale, corpus));
    for (const bodyId of bodiesByHouse.get(house) ?? []) {
      const body = bodyById(bodyId);
      if (body === undefined) continue;
      paragraphs.push(placementText({ category: 'planet-in-house', body: body.key, house }, locale, corpus));
    }
  }
  return section('houses', locale, paragraphs);
}

const JONES_SHAPE_NAMES: Readonly<Record<JonesShape, Readonly<Record<Locale, string>>>> = {
  bundle: { en: 'Bundle', nl: 'Bundel' },
  bowl: { en: 'Bowl', nl: 'Schaal' },
  locomotive: { en: 'Locomotive', nl: 'Locomotief' },
  bucket: { en: 'Bucket', nl: 'Emmer' },
  seesaw: { en: 'Seesaw', nl: 'Wip' },
  splay: { en: 'Splay', nl: 'Waaier' },
  splash: { en: 'Splash', nl: 'Spreiding' },
};

function jonesShapeSentence(chart: ChartData, locale: Locale): string {
  const shape = jonesShapeOf(positionsMap(chart)).shape;
  const name = JONES_SHAPE_NAMES[shape][locale];
  return locale === 'nl' ? `Je horoscoop vormt een ${name}-patroon.` : `Your chart forms a ${name} pattern.`;
}

function aspectPatternsSection(chart: ChartData, locale: Locale, corpus: readonly CorpusEntry[]): ReportSection {
  const aspectPlacements = rankPlacements(derivePlacements(chart))
    .filter((placement) => placement.placement.category === 'aspect-pair')
    .slice(0, ASPECT_PATTERNS_LIMIT);
  const paragraphs = aspectPlacements.map((placement) => placementText(placement.placement, locale, corpus));

  // jonesShapeOf needs at least 2 positions; every real ChartData has far more, but a minimal fixture might not.
  const shape = chart.positions.length >= 2 ? [jonesShapeSentence(chart, locale)] : [];

  return section('aspect-patterns', locale, [...shape, ...paragraphs]);
}

function dignitiesSectSection(chart: ChartData, locale: Locale, corpus: readonly CorpusEntry[]): ReportSection {
  const sectSentence =
    locale === 'nl'
      ? chart.sect === 'day'
        ? 'Dit is een daghoroscoop: de Zon staat boven de horizon.'
        : 'Dit is een nachthoroscoop: de Zon staat onder de horizon.'
      : chart.sect === 'day'
        ? 'This is a day chart: the Sun is above the horizon.'
        : 'This is a night chart: the Sun is below the horizon.';

  const dignityParagraphs = Array.from(chart.dignities.entries()).flatMap(([id, dignities]) => {
    const state = dignityState(dignities);
    if (state === undefined) return [];
    const body = bodyById(id);
    if (body === undefined) return [];
    return [placementText({ category: 'dignity-state', body: body.key, state }, locale, corpus)];
  });

  return section('dignities-sect', locale, [sectSentence, ...dignityParagraphs]);
}

const NODE_CHIRON_KEYS = ['trueNode', 'chiron'] as const;

function nodesChironSection(chart: ChartData, locale: Locale, corpus: readonly CorpusEntry[]): ReportSection {
  const paragraphs = NODE_CHIRON_KEYS.flatMap((key) => {
    const body = bodyByKey(key);
    if (body === undefined || !chart.positions.some((position) => position.body === body.id)) return [];
    return [planetInSignText(chart, key, locale, corpus), planetInHouseText(chart, key, locale, corpus)];
  });
  return section('nodes-chiron', locale, paragraphs);
}

export function assembleReport(chart: ChartData, locale: Locale, corpus: readonly CorpusEntry[]): Report {
  return {
    sections: [
      coreIdentitySection(chart, locale, corpus),
      temperamentSection(chart, locale),
      chartRulerSection(chart, locale, corpus),
      housesSection(chart, locale, corpus),
      aspectPatternsSection(chart, locale, corpus),
      dignitiesSectSection(chart, locale, corpus),
      nodesChironSection(chart, locale, corpus),
    ],
  };
}
