/**
 * Fallback composition (#59): a corpus entry is never guaranteed to exist for
 * every placement — today's corpus is empty (#55/#56 haven't landed), and
 * even a full ~1200-entry corpus won't cover every placement the exhaustive
 * cross-product below enumerates. `resolvePlacementText` guarantees non-empty
 * text either way: look the key up in the given corpus first, and if it
 * isn't there, mechanically compose a plain sentence from the same reference
 * data (`BODIES`, `SIGNS`, `ASPECTS`, `DIGNITY_STATES`) that already validates
 * a placement's fields (`schema.ts`).
 *
 * The fallback is deliberately plain and repetitive — it exists so a report
 * is never blank, not to read as hand-written prose. #55/#56's real entries
 * are what a report actually wants to show; this is what stands in for them
 * until they exist.
 *
 * Scoped to the same five categories #60's rule engine covers
 * (planet-in-sign, planet-in-house, sign-on-cusp, aspect-pair, dignity-state).
 * `nakshatra` and `pattern` are out of scope for the same reason #60 excluded
 * them: neither is produced by anything currently feeding this module, and
 * both would need chart data (sidereal longitude, whole-chart shape) rather
 * than a `CorpusPlacement`'s own fields.
 *
 * Dutch terminology note: the twelve sign names, ten planet/luminary names
 * and five major-aspect names below are standard, unremarkable translations.
 * The minor-aspect names (semisextiel, halfvierkant, kwintiel, sesquikwadraat,
 * biquintiel) follow the same calque pattern Dutch astrological writing
 * generally uses for them, but — unlike everything else in this codebase —
 * they could not be cross-checked against an independent source before being
 * hardcoded here, because the web-search tool used for that check was
 * unavailable (repeated `400` errors) at the time this was written. Treat
 * them as good-faith placeholders worth a native-speaker or #63 review pass,
 * not as verified facts the way the rest of this file's content is.
 */
import { bodyByKey } from '../astrology/bodies.js';
import { aspectByKey } from '../astrology/aspects.js';
import { SIGNS } from '../astrology/signs.js';
import type { CorpusEntry, CorpusPlacement, DignityState, Locale, PersonaId } from './schema.js';
import { placementKey } from './schema.js';

type NameTable = Readonly<Record<string, string>>;

export const SIGN_NAMES: Readonly<Record<Locale, readonly string[]>> = {
  en: SIGNS.map((sign) => sign.name),
  nl: [
    'Ram',
    'Stier',
    'Tweelingen',
    'Kreeft',
    'Leeuw',
    'Maagd',
    'Weegschaal',
    'Schorpioen',
    'Boogschutter',
    'Steenbok',
    'Waterman',
    'Vissen',
  ],
};

export const BODY_NAMES: Readonly<Record<Locale, NameTable>> = {
  en: {
    sun: 'the Sun',
    moon: 'the Moon',
    mercury: 'Mercury',
    venus: 'Venus',
    mars: 'Mars',
    jupiter: 'Jupiter',
    saturn: 'Saturn',
    uranus: 'Uranus',
    neptune: 'Neptune',
    pluto: 'Pluto',
    meanNode: 'the Mean Node',
    trueNode: 'the True Node',
    meanLilith: 'Mean Lilith',
    osculatingLilith: 'Osculating Lilith',
    interpolatedLilith: 'Interpolated Lilith',
    chiron: 'Chiron',
    ceres: 'Ceres',
    pallas: 'Pallas',
    juno: 'Juno',
    vesta: 'Vesta',
  },
  nl: {
    sun: 'de Zon',
    moon: 'de Maan',
    mercury: 'Mercurius',
    venus: 'Venus',
    mars: 'Mars',
    jupiter: 'Jupiter',
    saturn: 'Saturnus',
    uranus: 'Uranus',
    neptune: 'Neptunus',
    pluto: 'Pluto',
    meanNode: 'de Gemiddelde Maansknoop',
    trueNode: 'de Ware Maansknoop',
    meanLilith: 'Gemiddelde Lilith',
    osculatingLilith: 'Osculerende Lilith',
    interpolatedLilith: 'Geïnterpoleerde Lilith',
    chiron: 'Chiron',
    ceres: 'Ceres',
    pallas: 'Pallas',
    juno: 'Juno',
    vesta: 'Vesta',
  },
};

const ASPECT_NAMES: Readonly<Record<Locale, NameTable>> = {
  en: {
    conjunction: 'conjunction',
    semisextile: 'semisextile',
    semisquare: 'semisquare',
    sextile: 'sextile',
    quintile: 'quintile',
    square: 'square',
    trine: 'trine',
    sesquiquadrate: 'sesquiquadrate',
    biquintile: 'biquintile',
    quincunx: 'quincunx',
    opposition: 'opposition',
  },
  nl: {
    conjunction: 'conjunctie',
    semisextile: 'semisextiel',
    semisquare: 'halfvierkant',
    sextile: 'sextiel',
    quintile: 'kwintiel',
    square: 'vierkant',
    trine: 'driehoek',
    sesquiquadrate: 'sesquikwadraat',
    biquintile: 'biquintiel',
    quincunx: 'quincunx',
    opposition: 'oppositie',
  },
};

/** Predicate phrases, not nouns — written to slot directly after "{Body} is/geeft ...". */
const DIGNITY_PREDICATES: Readonly<Record<Locale, Readonly<Record<DignityState, string>>>> = {
  en: {
    ruler: 'the ruler of the sign it occupies',
    exalted: 'exalted in the sign it occupies',
    detriment: 'in detriment in the sign it occupies',
    fall: 'in fall in the sign it occupies',
  },
  nl: {
    ruler: 'heerser over het teken waarin het staat',
    exalted: 'verheven in het teken waarin het staat',
    detriment: 'in ballingschap in het teken waarin het staat',
    fall: 'in val in het teken waarin het staat',
  },
};

function signName(index: number, locale: Locale): string {
  const name = SIGN_NAMES[locale][index];
  if (name === undefined) throw new Error(`sign index ${String(index)} out of range 0-11`);
  return name;
}

function bodyName(key: string, locale: Locale): string {
  const name = BODY_NAMES[locale][key];
  if (name !== undefined) return name;
  const body = bodyByKey(key);
  return body === undefined ? key : body.name;
}

function aspectName(key: string, locale: Locale): string {
  const name = ASPECT_NAMES[locale][key];
  if (name !== undefined) return name;
  const aspect = aspectByKey(key);
  return aspect === undefined ? key : aspect.name;
}

/** Abbreviated ordinal suffix. Houses only ever run 1-12, but this is correct for any positive integer. */
function ordinal(n: number, locale: Locale): string {
  if (locale === 'nl') return `${String(n)}e`;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${String(n)}th`;
  switch (n % 10) {
    case 1:
      return `${String(n)}st`;
    case 2:
      return `${String(n)}nd`;
    case 3:
      return `${String(n)}rd`;
    default:
      return `${String(n)}th`;
  }
}

function capitalize(text: string): string {
  const first = text.charAt(0);
  return first === '' ? text : first.toUpperCase() + text.slice(1);
}

/**
 * A plain, mechanically generated sentence for a placement — used only when
 * no corpus entry exists for it. Every branch is a pure function of names
 * already validated elsewhere (`schema.ts`), so it can never itself fail to
 * produce non-empty text for a well-formed placement.
 */
export function composeFallbackText(placement: CorpusPlacement, locale: Locale): string {
  switch (placement.category) {
    case 'planet-in-sign': {
      const body = capitalize(bodyName(placement.body, locale));
      const sign = signName(placement.sign, locale);
      return `${body} in ${sign}.`;
    }
    case 'planet-in-house': {
      const body = capitalize(bodyName(placement.body, locale));
      const house = ordinal(placement.house, locale);
      return locale === 'nl' ? `${body} in het ${house} huis.` : `${body} in the ${house} house.`;
    }
    case 'sign-on-cusp': {
      const sign = capitalize(signName(placement.sign, locale));
      const house = ordinal(placement.house, locale);
      return locale === 'nl'
        ? `${sign} op de cusp van het ${house} huis.`
        : `${sign} on the cusp of the ${house} house.`;
    }
    case 'aspect-pair': {
      const aspect = aspectName(placement.aspect, locale);
      const bodyA = bodyName(placement.bodyA, locale);
      const bodyB = bodyName(placement.bodyB, locale);
      return locale === 'nl'
        ? `${capitalize(aspect)} tussen ${bodyA} en ${bodyB}.`
        : `${capitalize(aspect)} between ${bodyA} and ${bodyB}.`;
    }
    case 'dignity-state': {
      const body = capitalize(bodyName(placement.body, locale));
      const predicate = DIGNITY_PREDICATES[locale][placement.state];
      return `${body} is ${predicate}.`;
    }
    case 'nakshatra':
    case 'pattern':
      throw new Error(`composeFallbackText: category "${placement.category}" is out of scope for #59 (see file doc)`);
  }
}

/**
 * The corpus entry matching `placement` in `locale`, if the corpus has one.
 * The same lookup `resolvePlacementText` uses internally, exposed on its own
 * so a caller that needs to tell corpus text apart from the mechanical
 * fallback — #62's provenance view — doesn't have to re-derive the key or
 * duplicate the lookup.
 *
 * When `persona` is given, prefers that persona's entry but falls back to
 * the neutral entry (no `persona`) if that persona hasn't been written for
 * this placement yet. Omitting `persona` matches only the neutral entry.
 */
export function findCorpusEntry(
  placement: CorpusPlacement,
  locale: Locale,
  corpus: readonly CorpusEntry[],
  persona?: PersonaId,
): CorpusEntry | undefined {
  const key = placementKey(placement);
  const candidates = corpus.filter((candidate) => candidate.key === key && candidate.locale === locale);
  if (persona !== undefined) {
    const specific = candidates.find((candidate) => candidate.persona === persona);
    if (specific !== undefined) return specific;
  }
  return candidates.find((candidate) => candidate.persona === undefined);
}

/**
 * The text a report should show for `placement` in `locale`: a matching
 * corpus entry if one exists (preferring `persona`'s voice, falling back to
 * the neutral entry), otherwise `composeFallbackText`'s mechanical sentence.
 * This is the guarantee #59 asks for — never `""`, whatever the corpus
 * currently holds.
 */
export function resolvePlacementText(
  placement: CorpusPlacement,
  locale: Locale,
  corpus: readonly CorpusEntry[],
  persona?: PersonaId,
): string {
  const entry = findCorpusEntry(placement, locale, corpus, persona);
  return entry !== undefined ? entry.text : composeFallbackText(placement, locale);
}
