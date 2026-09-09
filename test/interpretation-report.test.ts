import { describe, expect, it } from 'vitest';
import { assembleReport, type ReportSectionId } from '../src/interpretation/report.js';
import { composeFallbackText } from '../src/interpretation/compose.js';
import { bodyByKey } from '../src/astrology/bodies.js';
import type { Aspect } from '../src/astrology/aspects.js';
import type { EssentialDignities } from '../src/astrology/dignities.js';
import type { ChartData } from '../src/domain/chart-compute.js';
import type { CorpusEntry, Locale } from '../src/interpretation/schema.js';
import type { BodyId, BodyPosition, Degrees, HousePositions } from '../src/ephemeris/types.js';

function bodyId(key: string): BodyId {
  const body = bodyByKey(key);
  if (body === undefined) throw new Error(`unknown body key "${key}" in test fixture`);
  return body.id;
}

function position(key: string, longitude: Degrees, overrides: Partial<BodyPosition> = {}): BodyPosition {
  return {
    body: bodyId(key),
    longitude,
    latitude: 0,
    distance: 1,
    longitudeSpeed: 1,
    latitudeSpeed: 0,
    distanceSpeed: 0,
    retrograde: false,
    ...overrides,
  };
}

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** Equal 12-house cusps starting from `ascendant`, matching an equal-house layout. */
function equalHouses(ascendant: Degrees): HousePositions {
  const cusps: Degrees[] = [0];
  for (let house = 1; house <= 12; house++) cusps.push(norm360(ascendant + (house - 1) * 30));
  const midheaven = cusps[10];
  if (midheaven === undefined) throw new Error('unreachable: house 10 cusp always exists');
  return {
    cusps,
    ascendant,
    midheaven,
    armc: midheaven,
    vertex: 0,
    equatorialAscendant: ascendant,
    coAscendantKoch: ascendant,
    coAscendantMunkasey: ascendant,
    polarAscendant: ascendant,
    system: 'P',
  };
}

const NO_DIGNITY: EssentialDignities = { ruler: false, exalted: false, detriment: false, fall: false };
const RULER: EssentialDignities = { ruler: true, exalted: false, detriment: false, fall: false };

/**
 * A full-ish chart: Aries rising, with Mars in Aries so the dispositor chain
 * (which walks every traditional ruler it's asked to) terminates in one
 * step. Includes all seven traditional rulers plus the True Node and
 * Chiron, so every section has something to say.
 */
function makeFullChart(overrides: Partial<ChartData> = {}): ChartData {
  const positions: BodyPosition[] = [
    position('sun', 10), // Aries, house 1
    position('moon', 100), // Cancer, house 4
    position('mercury', 40), // Taurus, house 2
    position('venus', 70), // Gemini, house 3
    position('mars', 5), // Aries, house 1 -- rules its own sign
    position('jupiter', 250), // Sagittarius, house 9 -- rules its own sign
    position('saturn', 280), // Capricorn, house 10 -- rules its own sign
    position('trueNode', 130), // Leo, house 5
    position('chiron', 160), // Virgo, house 6
  ];
  const dignities = new Map<BodyId, EssentialDignities>(positions.map((p) => [p.body, NO_DIGNITY]));
  dignities.set(bodyId('mars'), RULER);
  dignities.set(bodyId('jupiter'), RULER);
  dignities.set(bodyId('saturn'), RULER);

  return {
    positions,
    houses: equalHouses(0),
    aspects: [],
    dignities,
    sect: 'day',
    partOfFortune: 0,
    partOfSpirit: 0,
    ...overrides,
  };
}

function makeAspect(bodyAKey: string, bodyBKey: string, angle: number, orb: number): Aspect {
  return {
    bodyA: bodyId(bodyAKey),
    bodyB: bodyId(bodyBKey),
    aspect: {
      key: angle === 120 ? 'trine' : angle === 90 ? 'square' : 'conjunction',
      name: 'x',
      angle,
      family: 'major',
    },
    separation: angle + orb,
    orb,
    applying: false,
  };
}

const LOCALES: readonly Locale[] = ['en', 'nl'];

function allParagraphs(chart: ChartData, locale: Locale, corpus: readonly CorpusEntry[] = []): readonly string[] {
  return assembleReport(chart, locale, corpus).sections.flatMap((section) => section.paragraphs);
}

describe('assembleReport (#61)', () => {
  it('produces the seven sections in a fixed order', () => {
    const report = assembleReport(makeFullChart(), 'en', []);
    const ids = report.sections.map((section) => section.id);
    expect(ids).toEqual<ReportSectionId[]>([
      'core-identity',
      'temperament',
      'chart-ruler',
      'houses',
      'aspect-patterns',
      'dignities-sect',
      'nodes-chiron',
    ]);
  });

  it('titles every section in the requested locale', () => {
    const en = assembleReport(makeFullChart(), 'en', []);
    const nl = assembleReport(makeFullChart(), 'nl', []);
    expect(en.sections.map((s) => s.title)).not.toEqual(nl.sections.map((s) => s.title));
    expect(en.sections.every((s) => s.title.trim() !== '')).toBe(true);
    expect(nl.sections.every((s) => s.title.trim() !== '')).toBe(true);
  });

  it('never produces an empty paragraph, in either locale, with no corpus at all', () => {
    const chart = makeFullChart();
    for (const locale of LOCALES) {
      const paragraphs = allParagraphs(chart, locale);
      expect(paragraphs.length).toBeGreaterThan(0);
      expect(paragraphs.every((p) => p.trim() !== '')).toBe(true);
    }
  });

  it('is deterministic: the same chart assembles structurally identical reports every time', () => {
    const chart = makeFullChart();
    expect(assembleReport(chart, 'en', [])).toEqual(assembleReport(chart, 'en', []));
  });

  it('produces different paragraph text per locale for the same chart', () => {
    const chart = makeFullChart();
    const en = assembleReport(chart, 'en', []).sections[0]?.paragraphs;
    const nl = assembleReport(chart, 'nl', []).sections[0]?.paragraphs;
    expect(en).not.toEqual(nl);
  });

  it('prefers a matching corpus entry over the fallback for a section paragraph', () => {
    const chart = makeFullChart();
    const entry: CorpusEntry = {
      key: 'planet-in-sign:sun:0',
      locale: 'en',
      text: 'A hand-written exemplar for Sun in Aries.',
      tier: 'core',
      tags: [],
      provenance: { source: 'hand-written' },
    };
    const report = assembleReport(chart, 'en', [entry]);
    expect(report.sections[0]?.paragraphs).toContain(entry.text);
  });
});

describe('core identity section (#61)', () => {
  it('covers Sun sign, Sun house, Moon sign, Moon house and the Ascendant', () => {
    const chart = makeFullChart();
    const paragraphs = assembleReport(chart, 'en', []).sections[0]?.paragraphs;
    expect(paragraphs).toEqual([
      composeFallbackText({ category: 'planet-in-sign', body: 'sun', sign: 0 }, 'en'),
      composeFallbackText({ category: 'planet-in-house', body: 'sun', house: 1 }, 'en'),
      composeFallbackText({ category: 'planet-in-sign', body: 'moon', sign: 3 }, 'en'),
      composeFallbackText({ category: 'planet-in-house', body: 'moon', house: 4 }, 'en'),
      composeFallbackText({ category: 'sign-on-cusp', sign: 0, house: 1 }, 'en'),
    ]);
  });
});

describe('temperament section (#61)', () => {
  it('names the dominant element and a matching classical temperament', () => {
    // Every body in makeFullChart's fire/earth/water signs; Aries/Leo/Sagittarius
    // are fire, and fire has the most placements (sun, mars, trueNode).
    const chart = makeFullChart();
    const paragraphs = assembleReport(chart, 'en', []).sections[1]?.paragraphs ?? [];
    expect(paragraphs.some((p) => /choleric/i.test(p))).toBe(true);
  });

  it('produces a Dutch temperament label distinct from the English one', () => {
    const chart = makeFullChart();
    const en = assembleReport(chart, 'en', []).sections[1]?.paragraphs.join(' ') ?? '';
    const nl = assembleReport(chart, 'nl', []).sections[1]?.paragraphs.join(' ') ?? '';
    expect(en).not.toBe(nl);
    expect(nl).toMatch(/cholerisch/i);
  });
});

describe('chart ruler and dispositor chain section (#61)', () => {
  it('names Mars as the Aries ascendant ruler, terminating at itself', () => {
    const chart = makeFullChart();
    const paragraphs = assembleReport(chart, 'en', []).sections[2]?.paragraphs ?? [];
    expect(paragraphs[0]).toBe(composeFallbackText({ category: 'planet-in-sign', body: 'mars', sign: 0 }, 'en'));
    expect(paragraphs[1]).toContain('Mars');
    expect(paragraphs[1]).toContain('ultimately terminates at its own rulership');
  });

  it('describes a multi-step chain when the ruler does not rule its own sign', () => {
    // Aries rising, but Mars now in Cancer (ruled by the Moon, in Cancer too -> self).
    const chart = makeFullChart({
      positions: makeFullChart().positions.map((p) => (p.body === bodyId('mars') ? { ...p, longitude: 95 } : p)),
    });
    const paragraphs = assembleReport(chart, 'en', []).sections[2]?.paragraphs ?? [];
    expect(paragraphs[1]).toContain('Mars → Moon');
  });

  it('describes a cycle rather than claiming a final dispositor that does not exist', () => {
    // Aries rising (ruler Mars). Mars in Taurus (ruled by Venus), Venus in Aries (ruled by Mars): a cycle.
    const base = makeFullChart();
    const positions = base.positions.map((p) => {
      if (p.body === bodyId('mars')) return { ...p, longitude: 40 };
      if (p.body === bodyId('venus')) return { ...p, longitude: 5 };
      return p;
    });
    const chart = makeFullChart({ positions });
    const paragraphs = assembleReport(chart, 'en', []).sections[2]?.paragraphs ?? [];
    expect(paragraphs[1]).toContain('closes in a cycle');
  });
});

describe('houses section (#61)', () => {
  it('has one sign-on-cusp paragraph per house plus one planet-in-house paragraph per body', () => {
    const chart = makeFullChart();
    const paragraphs = assembleReport(chart, 'en', []).sections[3]?.paragraphs ?? [];
    expect(paragraphs).toHaveLength(12 + chart.positions.length);
    expect(paragraphs).toContain(composeFallbackText({ category: 'sign-on-cusp', sign: 0, house: 1 }, 'en'));
    expect(paragraphs).toContain(composeFallbackText({ category: 'planet-in-house', body: 'moon', house: 4 }, 'en'));
  });
});

describe('aspect patterns section (#61)', () => {
  it('leads with a whole-chart Jones shape sentence', () => {
    const chart = makeFullChart();
    const paragraphs = assembleReport(chart, 'en', []).sections[4]?.paragraphs ?? [];
    expect(paragraphs[0]).toMatch(/Your chart forms a .+ pattern\./);
  });

  it("lists aspect-pair text for the chart's aspects, tightest first", () => {
    const tight = makeAspect('venus', 'mars', 120, 0.1);
    const wide = makeAspect('sun', 'moon', 90, 6);
    const chart = makeFullChart({ aspects: [wide, tight] });
    const paragraphs = assembleReport(chart, 'en', []).sections[4]?.paragraphs ?? [];
    const tightText = composeFallbackText(
      { category: 'aspect-pair', aspect: 'trine', bodyA: 'mars', bodyB: 'venus' },
      'en',
    );
    const wideText = composeFallbackText(
      { category: 'aspect-pair', aspect: 'square', bodyA: 'moon', bodyB: 'sun' },
      'en',
    );
    expect(paragraphs.indexOf(tightText)).toBeGreaterThan(-1);
    expect(paragraphs.indexOf(wideText)).toBeGreaterThan(-1);
    expect(paragraphs.indexOf(tightText)).toBeLessThan(paragraphs.indexOf(wideText));
  });

  it('caps the number of aspects shown even when the chart has many', () => {
    const pairs: [string, string][] = [
      ['sun', 'moon'],
      ['sun', 'mercury'],
      ['sun', 'venus'],
      ['sun', 'mars'],
      ['sun', 'jupiter'],
      ['sun', 'saturn'],
      ['moon', 'mercury'],
      ['moon', 'venus'],
      ['moon', 'mars'],
    ];
    const aspects = pairs.map(([a, b]) => makeAspect(a, b, 90, 1));
    const chart = makeFullChart({ aspects });
    const paragraphs = assembleReport(chart, 'en', []).sections[4]?.paragraphs ?? [];
    // 1 Jones-shape sentence + at most 8 aspect sentences.
    expect(paragraphs.length).toBeLessThanOrEqual(9);
  });
});

describe('dignities and sect section (#61)', () => {
  it('states the sect and lists every dignified body, but no peregrine one', () => {
    const chart = makeFullChart();
    const paragraphs = assembleReport(chart, 'en', []).sections[5]?.paragraphs ?? [];
    expect(paragraphs[0]).toContain('day chart');
    expect(paragraphs).toContain(
      composeFallbackText({ category: 'dignity-state', body: 'mars', state: 'ruler' }, 'en'),
    );
    expect(paragraphs).toContain(
      composeFallbackText({ category: 'dignity-state', body: 'jupiter', state: 'ruler' }, 'en'),
    );
    expect(paragraphs.some((p) => p.includes('Mercury') && p.includes('ruler'))).toBe(false);
  });

  it('states a night chart correctly', () => {
    const chart = makeFullChart({ sect: 'night' });
    const paragraphs = assembleReport(chart, 'en', []).sections[5]?.paragraphs ?? [];
    expect(paragraphs[0]).toContain('night chart');
  });
});

describe('nodes and Chiron axis section (#61)', () => {
  it('covers both the True Node and Chiron sign and house placements', () => {
    const chart = makeFullChart();
    const paragraphs = assembleReport(chart, 'en', []).sections[6]?.paragraphs ?? [];
    expect(paragraphs).toEqual([
      composeFallbackText({ category: 'planet-in-sign', body: 'trueNode', sign: 4 }, 'en'),
      composeFallbackText({ category: 'planet-in-house', body: 'trueNode', house: 5 }, 'en'),
      composeFallbackText({ category: 'planet-in-sign', body: 'chiron', sign: 5 }, 'en'),
      composeFallbackText({ category: 'planet-in-house', body: 'chiron', house: 6 }, 'en'),
    ]);
  });

  it('omits Chiron entirely when the chart has no computed position for it', () => {
    const chart = makeFullChart({
      positions: makeFullChart().positions.filter((p) => p.body !== bodyId('chiron')),
    });
    const paragraphs = assembleReport(chart, 'en', []).sections[6]?.paragraphs ?? [];
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs.every((p) => !p.includes('Chiron'))).toBe(true);
  });
});
