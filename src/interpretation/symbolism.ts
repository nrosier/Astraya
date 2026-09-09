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
import { BODY_NAMES, SIGN_NAMES } from './compose.js';
import type { Locale } from './schema.js';

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

/**
 * Dutch symbol sheets and voice guide (#211), same structure and order as
 * the English tables above so `buildSymbolismContext` can pick either set
 * without the caller needing to know the difference. Content is original
 * Dutch phrasing of the same concepts, not a literal word-for-word
 * translation.
 */
export const PLANET_SYMBOLISM_NL: readonly PlanetSymbolism[] = [
  {
    key: 'sun',
    core: 'Identiteit, wil en het zelf dat je bewust aan het opbouwen bent.',
    keywords: ['identiteit', 'vitaliteit', 'doel', 'ego', 'erkenning'],
  },
  {
    key: 'moon',
    core: 'Instinctieve emotionele reactie — wat veilig aanvoelt, en wat nodig is om dat te voelen.',
    keywords: ['emotie', 'instinct', 'gewoonte', 'koestering', 'herinnering'],
  },
  {
    key: 'mercury',
    core: 'Hoe informatie wordt verzameld, verwerkt en uitgewisseld — de geest in beweging.',
    keywords: ['communicatie', 'redenering', 'waarneming', 'leren', 'uitwisseling'],
  },
  {
    key: 'venus',
    core: 'Wat aantrekkelijk of waardevol wordt gevonden, en hoe genegenheid en middelen worden gegeven en ontvangen.',
    keywords: ['aantrekking', 'waarde', 'harmonie', 'plezier', 'verbinding'],
  },
  {
    key: 'mars',
    core: 'Hoe verlangen wordt nagejaagd en doorgezet — de drang om te handelen, te concurreren en te verdedigen.',
    keywords: ['drijfveer', 'assertiviteit', 'verlangen', 'conflict', 'initiatief'],
  },
  {
    key: 'jupiter',
    core: 'Waar vertrouwen, groei en betekenis worden gezocht buiten de eigen directe omstandigheden.',
    keywords: ['expansie', 'vertrouwen', 'overtuiging', 'overvloed', 'kans'],
  },
  {
    key: 'saturn',
    core: 'Waar discipline, beperking en langetermijnverantwoordelijkheid worden geleerd, vaak op de moeilijke manier.',
    keywords: ['discipline', 'beperking', 'verantwoordelijkheid', 'meesterschap', 'vertraging'],
  },
  {
    key: 'uranus',
    core: 'De plotselinge breuk met conventie — verstoring die ruimte maakt voor iets werkelijk nieuws.',
    keywords: ['verstoring', 'onafhankelijkheid', 'innovatie', 'opstandigheid', 'inzicht'],
  },
  {
    key: 'neptune',
    core: 'Waar grenzen vervagen — verbeelding, idealisme, en het risico op zelfbedrog dat daarmee gepaard gaat.',
    keywords: ['verbeelding', 'idealisme', 'vervaging', 'gevoeligheid', 'illusie'],
  },
  {
    key: 'pluto',
    core: 'Waar transformatie plaatsvindt door wat eerst afgebroken of losgelaten moet worden.',
    keywords: ['transformatie', 'macht', 'intensiteit', 'vernieuwing', 'het onzichtbare'],
  },
];

export const SIGN_SYMBOLISM_NL: readonly SignSymbolism[] = [
  {
    index: 0,
    core: 'Directe, zelfstartende energie die handelt voordat ze overweegt.',
    keywords: ['initiatiefrijk', 'moedig', 'impulsief', 'competitief'],
  },
  {
    index: 1,
    core: 'Stabiele, zintuiglijke energie die langzaam opbouwt en standvastig blijft eenmaal toegewijd.',
    keywords: ['gegrond', 'geduldig', 'zintuiglijk', 'bezitterig'],
  },
  {
    index: 2,
    core: 'Snelle, nieuwsgierige energie die verzamelt en verbindt in plaats van zich op één antwoord vast te leggen.',
    keywords: ['nieuwsgierig', 'veelzijdig', 'spraakzaam', 'onrustig'],
  },
  {
    index: 3,
    core: 'Beschermende, gevoelsgeleide energie gericht op thuis en emotionele veiligheid.',
    keywords: ['zorgzaam', 'beschermend', 'wisselvallig', 'gehecht'],
  },
  {
    index: 4,
    core: 'Warme, expressieve energie die wil dat wat ze doet gezien wordt en telt.',
    keywords: ['expressief', 'zelfverzekerd', 'gul', 'trots'],
  },
  {
    index: 5,
    core: 'Precieze, dienstbare energie die dingen verbetert door op details te letten.',
    keywords: ['analytisch', 'nauwgezet', 'praktisch', 'zelfkritisch'],
  },
  {
    index: 6,
    core: 'Relationele, evenwichtszoekende energie die beide kanten afweegt voor ze kiest.',
    keywords: ['diplomatiek', 'rechtvaardig', 'besluiteloos', 'sociaal'],
  },
  {
    index: 7,
    core: 'Intense, private energie die tot de wortel van dingen gaat in plaats van het oppervlak.',
    keywords: ['intens', 'gesloten', 'doorziend', 'transformerend'],
  },
  {
    index: 8,
    core: 'Expansieve, betekenisgerichte energie gericht op het verre en het nog-niet-geprobeerde.',
    keywords: ['avontuurlijk', 'filosofisch', 'onomwonden', 'optimistisch'],
  },
  {
    index: 9,
    core: 'Gedisciplineerde, structuurbouwende energie die vooruitgang op de lange termijn meet.',
    keywords: ['gedisciplineerd', 'ambitieus', 'gereserveerd', 'doorzettend'],
  },
  {
    index: 10,
    core: 'Afstandelijke, ideeëngedreven energie gericht op het collectief in plaats van het persoonlijke.',
    keywords: ['onafhankelijk', 'onconventioneel', 'idealistisch', 'afstandelijk'],
  },
  {
    index: 11,
    core: 'Absorberende, grensvervagende energie die voelt wat rondom is meer dan ze het benoemt.',
    keywords: ['empathisch', 'dromerig', 'ongrijpbaar', 'aanpasbaar'],
  },
];

export const VOICE_GUIDE_NL: readonly string[] = [
  'Schrijf in de tweede persoon, spreek de eigenaar van de horoscoop direct aan.',
  'Zeg de betekenis van de plaatsing eerst gewoon voordat je nuanceert — leid met de bewering, niet met het voorbehoud.',
  'Vermijd fatalisme: beschrijf een neiging of een drang, nooit een zekerheid of een oordeel.',
  'Herhaal de naam van de plaatsing niet letterlijk als de eerste woorden van de tekst (bijv. begin niet met "Mars in Ram...").',
  'Houd elke tekst tot één tot drie zinnen; diepgang komt van precisie, niet van lengte.',
  'Gebruik nooit disclaimers, twijfel over de geldigheid van astrologie, of verwijzingen naar het feit dat de tekst door AI is gegenereerd.',
];

const SECTION_HEADERS: Readonly<Record<Locale, Readonly<{ planet: string; sign: string; voice: string }>>> = {
  en: { planet: 'PLANET SYMBOLISM', sign: 'SIGN SYMBOLISM', voice: 'VOICE AND TONE RULES' },
  nl: { planet: 'PLANEETSYMBOLIEK', sign: 'TEKENSYMBOLIEK', voice: 'STEM- EN TOONREGELS' },
};

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
 * injected into #56's generation prompt, in the given locale's own tables
 * and section headers — a Dutch generation request should read as Dutch
 * throughout, not English scaffolding around Dutch fragments. Verifies its
 * own coverage at build time — a `BODIES` entry added without a matching
 * symbolism sheet, or a symbolism sheet for a body that doesn't exist,
 * throws rather than silently shipping an incomplete prompt.
 */
export function buildSymbolismContext(locale: Locale = 'en'): string {
  const planetTable = locale === 'nl' ? PLANET_SYMBOLISM_NL : PLANET_SYMBOLISM;
  const signTable = locale === 'nl' ? SIGN_SYMBOLISM_NL : SIGN_SYMBOLISM;
  const voiceGuide = locale === 'nl' ? VOICE_GUIDE_NL : VOICE_GUIDE;

  const symbolismKeys = new Set(planetTable.map((entry) => entry.key));
  const missing = [...PLANET_BODY_KEYS].filter((key) => !symbolismKeys.has(key));
  const extra = [...symbolismKeys].filter((key) => !PLANET_BODY_KEYS.has(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `PLANET_SYMBOLISM (${locale}) is out of sync with BODIES — missing: [${missing.join(', ')}], unexpected: [${extra.join(', ')}]`,
    );
  }
  if (signTable.length !== SIGNS.length) {
    throw new Error(`SIGN_SYMBOLISM (${locale}) has ${String(signTable.length)} entries, expected ${String(SIGNS.length)}`);
  }

  const planetLines = planetTable.map((entry) => {
    const name = BODY_NAMES[locale][entry.key] ?? BODIES.find((body) => body.key === entry.key)?.name ?? entry.key;
    return `- ${name}: ${entry.core} (${entry.keywords.join(', ')})`;
  });
  const signLines = signTable.map((entry) => {
    const name = SIGN_NAMES[locale][entry.index] ?? SIGNS[entry.index]?.name ?? String(entry.index);
    return `- ${name}: ${entry.core} (${entry.keywords.join(', ')})`;
  });

  const headers = SECTION_HEADERS[locale];
  return [
    headers.planet,
    ...planetLines,
    '',
    headers.sign,
    ...signLines,
    '',
    headers.voice,
    ...voiceGuide.map((rule) => `- ${rule}`),
  ].join('\n');
}
