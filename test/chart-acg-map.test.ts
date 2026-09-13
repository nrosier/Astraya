import { describe, expect, it } from 'vitest';
import type { AcgMapInput } from '../src/chart/acg-map.js';
import { renderAcgMapSvg } from '../src/chart/acg-map.js';
import type { AcgLine } from '../src/domain/astrocartography.js';
import { SE } from '../src/ephemeris/generated-constants.js';

function countTags(svg: string, tag: string): number {
  return svg.split(`<${tag} `).length - 1;
}

const NATAL_PLACE = { latitude: 51.5, longitude: -0.13, altitude: 0 };

function baseInput(overrides: Partial<AcgMapInput> = {}): AcgMapInput {
  return {
    lines: [],
    localSpaceLines: [],
    natalPlace: NATAL_PLACE,
    ...overrides,
  };
}

describe('renderAcgMapSvg (#171)', () => {
  it('sizes the map as exactly twice as wide as it is tall', () => {
    const map = renderAcgMapSvg(baseInput(), { width: 400 });
    expect(map.width).toBe(400);
    expect(map.height).toBe(200);
    expect(map.markup).toContain('width="400" height="200"');
  });

  it('projects longitude -180 near x=0 and longitude 180 near x=width', () => {
    const mcAt180: AcgLine = { kind: 'MC', body: SE.SE_SUN, longitude: 180 };
    const mcAtMinus180: AcgLine = { kind: 'MC', body: SE.SE_MOON, longitude: -180 };
    const map = renderAcgMapSvg(baseInput({ lines: [mcAtMinus180, mcAt180] }), { width: 900 });
    expect(map.markup).toContain('x1="0.00" y1="0.00" x2="0.00"');
    expect(map.markup).toContain('x1="900.00" y1="0.00" x2="900.00"');
  });

  it('emits one polyline per horizon-line segment', () => {
    const ac: AcgLine = {
      kind: 'AC',
      body: SE.SE_SUN,
      segments: [
        [
          { latitude: -80, longitude: 10 },
          { latitude: -70, longitude: 12 },
        ],
        [
          { latitude: 70, longitude: 15 },
          { latitude: 80, longitude: 17 },
        ],
      ],
    };
    const map = renderAcgMapSvg(baseInput({ lines: [ac] }));
    expect(countTags(map.markup, 'polyline')).toBe(2);
  });

  it('splits a segment that crosses the antimeridian into two polylines, neither spanning the full width', () => {
    const dc: AcgLine = {
      kind: 'DC',
      body: SE.SE_MARS,
      segments: [
        [
          { latitude: 0, longitude: 170 },
          { latitude: 5, longitude: 179 },
          { latitude: 10, longitude: -179 },
          { latitude: 15, longitude: -170 },
        ],
      ],
    };
    const map = renderAcgMapSvg(baseInput({ lines: [dc] }), { width: 900 });
    expect(countTags(map.markup, 'polyline')).toBe(2);
    const xs = [...map.markup.matchAll(/points="([^"]+)"/g)].map((match) =>
      (match[1] ?? '').split(' ').map((pair) => Number(pair.split(',')[0])),
    );
    for (const runXs of xs) {
      const spread = Math.max(...runXs) - Math.min(...runXs);
      expect(spread).toBeLessThan(900);
    }
  });

  it('suffixes the line class with the body key', () => {
    const mc: AcgLine = { kind: 'MC', body: SE.SE_VENUS, longitude: 0 };
    const map = renderAcgMapSvg(baseInput({ lines: [mc] }));
    expect(map.markup).toContain('class="acg-line-mc acg-line-mc-venus"');
  });

  it('renders both arms of a Local Space line, suffixed by body key', () => {
    const local = {
      body: SE.SE_JUPITER,
      azimuth: 45,
      forward: [
        { latitude: 51.5, longitude: -0.13 },
        { latitude: 55, longitude: 3 },
      ],
      backward: [
        { latitude: 51.5, longitude: -0.13 },
        { latitude: 48, longitude: -3 },
      ],
    };
    const map = renderAcgMapSvg(baseInput({ localSpaceLines: [local] }));
    expect(countTags(map.markup, 'polyline')).toBe(2);
    expect(map.markup).toContain('class="acg-line-local-space acg-line-local-space-jupiter"');
  });

  it('marks the natal place and, when given, the relocation place', () => {
    const withoutRelocation = renderAcgMapSvg(baseInput());
    expect(countTags(withoutRelocation.markup, 'circle')).toBe(1);
    expect(withoutRelocation.markup).toContain('class="acg-marker-natal"');
    expect(withoutRelocation.markup).not.toContain('acg-marker-relocation');

    const withRelocation = renderAcgMapSvg(
      baseInput({ relocationPlace: { latitude: -33.8688, longitude: 151.2093, altitude: 0 } }),
    );
    expect(countTags(withRelocation.markup, 'circle')).toBe(2);
    expect(withRelocation.markup).toContain('class="acg-marker-relocation"');
  });

  it('draws a graticule line every 30 degrees of latitude and longitude', () => {
    const map = renderAcgMapSvg(baseInput());
    // Latitudes -90..90 and longitudes -180..180, step 30: 7 + 13 = 20 lines.
    expect(countTags(map.markup, 'line')).toBe(20);
  });
});
