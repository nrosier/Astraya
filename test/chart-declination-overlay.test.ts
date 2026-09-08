import { describe, expect, it } from 'vitest';
import type { DeclinationContact } from '../src/astrology/declinations.js';
import { pointOnCircle, wheelAngle } from '../src/chart/wheel.js';
import { filterDeclinationContactsForDisplay, renderDeclinationOverlaySvg } from '../src/chart/declination-overlay.js';

describe('filterDeclinationContactsForDisplay (#148)', () => {
  const contacts: readonly DeclinationContact[] = [
    { a: 1, b: 2, kind: 'parallel', orb: 0.5 },
    { a: 2, b: 3, kind: 'contraparallel', orb: 2 },
    { a: 1, b: 3, kind: 'parallel', orb: 0.1 },
  ];

  it('passes every contact through with no filter', () => {
    expect(filterDeclinationContactsForDisplay(contacts)).toEqual(contacts);
  });

  it('keeps only the listed contact kinds', () => {
    const result = filterDeclinationContactsForDisplay(contacts, { visibleKinds: ['contraparallel'] });
    expect(result).toEqual([{ a: 2, b: 3, kind: 'contraparallel', orb: 2 }]);
  });

  it('drops any contact wider than the orb-tightness threshold', () => {
    const result = filterDeclinationContactsForDisplay(contacts, { maxOrb: 1 });
    expect(result).toEqual([
      { a: 1, b: 2, kind: 'parallel', orb: 0.5 },
      { a: 1, b: 3, kind: 'parallel', orb: 0.1 },
    ]);
  });

  it('combines both filter criteria', () => {
    const result = filterDeclinationContactsForDisplay(contacts, { visibleKinds: ['parallel'], maxOrb: 0.2 });
    expect(result).toEqual([{ a: 1, b: 3, kind: 'parallel', orb: 0.1 }]);
  });
});

describe('renderDeclinationOverlaySvg (#148)', () => {
  const longitudes = new Map<number, number>([
    [1, 10],
    [2, 100],
  ]);
  const longitudeOf = (body: number): number => {
    const longitude = longitudes.get(body);
    if (longitude === undefined) throw new Error(`test fixture bug: no longitude for body ${body}`);
    return longitude;
  };

  it("draws one line per contact, chording the requested radius at each body's longitude", () => {
    const contacts: readonly DeclinationContact[] = [{ a: 1, b: 2, kind: 'parallel', orb: 0.5 }];
    const svg = renderDeclinationOverlaySvg(contacts, longitudeOf, 0, 300, 300, 200);
    expect(svg.split('<line').length - 1).toBe(1);

    const angleA = wheelAngle(10, 0);
    const angleB = wheelAngle(100, 0);
    const pointA = pointOnCircle(300, 300, 200, angleA);
    const pointB = pointOnCircle(300, 300, 200, angleB);
    expect(svg).toContain(`x1="${pointA.x.toFixed(2)}" y1="${pointA.y.toFixed(2)}"`);
    expect(svg).toContain(`x2="${pointB.x.toFixed(2)}" y2="${pointB.y.toFixed(2)}"`);
  });

  it('styles parallel and contraparallel contacts with distinct classes', () => {
    const contacts: readonly DeclinationContact[] = [
      { a: 1, b: 2, kind: 'parallel', orb: 0.5 },
      { a: 1, b: 2, kind: 'contraparallel', orb: 1 },
    ];
    const svg = renderDeclinationOverlaySvg(contacts, longitudeOf, 0, 300, 300, 200);
    expect(svg).toContain('chart-declination chart-declination-parallel');
    expect(svg).toContain('chart-declination chart-declination-contraparallel');
  });

  it("threads orientationOptions through to wheelAngle, matching renderWheelSvg's layer (#43)", () => {
    const contacts: readonly DeclinationContact[] = [{ a: 1, b: 2, kind: 'parallel', orb: 0.5 }];
    const defaultSvg = renderDeclinationOverlaySvg(contacts, longitudeOf, 0, 300, 300, 200);
    const ariesUpSvg = renderDeclinationOverlaySvg(contacts, longitudeOf, 0, 300, 300, 200, {
      orientation: 'aries-up',
    });
    expect(ariesUpSvg).not.toBe(defaultSvg);
  });

  it('renders nothing for an empty contact list', () => {
    expect(renderDeclinationOverlaySvg([], longitudeOf, 0, 300, 300, 200)).toBe('');
  });
});
