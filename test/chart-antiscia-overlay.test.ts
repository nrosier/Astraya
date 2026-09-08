import { describe, expect, it } from 'vitest';
import type { AntiscialContact } from '../src/astrology/antiscia.js';
import { pointOnCircle, wheelAngle } from '../src/chart/wheel.js';
import { filterAntisciaForDisplay, renderAntisciaOverlaySvg } from '../src/chart/antiscia-overlay.js';

describe('filterAntisciaForDisplay (#148)', () => {
  const contacts: readonly AntiscialContact[] = [
    { body: 1, kind: 'antiscion', contact: 2, orb: 0.5 },
    { body: 2, kind: 'antiscion', contact: 1, orb: 0.5 }, // mirror of the contact above
    { body: 1, kind: 'contraAntiscion', contact: 3, orb: 2 },
    { body: 2, kind: 'antiscion', contact: 4, orb: 0.1 },
  ];

  it('dedupes a mirrored contact (same pair and kind, from each side) to a single entry', () => {
    const result = filterAntisciaForDisplay(contacts);
    expect(result).toHaveLength(3);
    const mirrored = result.filter(
      (c) => c.kind === 'antiscion' && ((c.body === 1 && c.contact === 2) || (c.body === 2 && c.contact === 1)),
    );
    expect(mirrored).toHaveLength(1);
  });

  it('keeps only the listed contact kinds', () => {
    const result = filterAntisciaForDisplay(contacts, { visibleKinds: ['contraAntiscion'] });
    expect(result).toEqual([{ body: 1, kind: 'contraAntiscion', contact: 3, orb: 2 }]);
  });

  it('drops any contact wider than the orb-tightness threshold', () => {
    const result = filterAntisciaForDisplay(contacts, { maxOrb: 1 });
    expect(result.map((c) => c.orb)).toEqual([0.5, 0.1]);
  });

  it('passes every (deduped) contact through with no filter', () => {
    expect(filterAntisciaForDisplay([])).toEqual([]);
  });
});

describe('renderAntisciaOverlaySvg (#148)', () => {
  const longitudes = new Map<number, number>([
    [1, 10],
    [2, 100],
  ]);
  const longitudeOf = (body: number): number => {
    const longitude = longitudes.get(body);
    if (longitude === undefined) throw new Error(`test fixture bug: no longitude for body ${body}`);
    return longitude;
  };

  it('draws one line per contact, chording the requested radius', () => {
    const contacts: readonly AntiscialContact[] = [{ body: 1, kind: 'antiscion', contact: 2, orb: 0.5 }];
    const svg = renderAntisciaOverlaySvg(contacts, longitudeOf, 0, 300, 300, 200);
    expect(svg.split('<line').length - 1).toBe(1);

    const angleA = wheelAngle(10, 0);
    const angleB = wheelAngle(100, 0);
    const pointA = pointOnCircle(300, 300, 200, angleA);
    const pointB = pointOnCircle(300, 300, 200, angleB);
    expect(svg).toContain(`x1="${pointA.x.toFixed(2)}" y1="${pointA.y.toFixed(2)}"`);
    expect(svg).toContain(`x2="${pointB.x.toFixed(2)}" y2="${pointB.y.toFixed(2)}"`);
  });

  it('styles antiscion and contra-antiscion contacts with distinct classes', () => {
    const contacts: readonly AntiscialContact[] = [
      { body: 1, kind: 'antiscion', contact: 2, orb: 0.5 },
      { body: 1, kind: 'contraAntiscion', contact: 2, orb: 1 },
    ];
    const svg = renderAntisciaOverlaySvg(contacts, longitudeOf, 0, 300, 300, 200);
    expect(svg).toContain('chart-antiscia chart-antiscia-antiscion');
    expect(svg).toContain('chart-antiscia chart-antiscia-contra-antiscion');
  });

  it("threads orientationOptions through to wheelAngle, matching renderWheelSvg's layer (#43)", () => {
    const contacts: readonly AntiscialContact[] = [{ body: 1, kind: 'antiscion', contact: 2, orb: 0.5 }];
    const defaultSvg = renderAntisciaOverlaySvg(contacts, longitudeOf, 0, 300, 300, 200);
    const ariesUpSvg = renderAntisciaOverlaySvg(contacts, longitudeOf, 0, 300, 300, 200, { orientation: 'aries-up' });
    const clockwiseSvg = renderAntisciaOverlaySvg(contacts, longitudeOf, 0, 300, 300, 200, { sweep: 'clockwise' });
    expect(ariesUpSvg).not.toBe(defaultSvg);
    expect(clockwiseSvg).not.toBe(defaultSvg);
  });

  it('renders nothing for an empty contact list', () => {
    expect(renderAntisciaOverlaySvg([], longitudeOf, 0, 300, 300, 200)).toBe('');
  });
});
