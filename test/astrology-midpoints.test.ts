import { describe, expect, it } from 'vitest';
import {
  allMidpoints,
  dialPosition,
  midpointOf,
  midpointTree,
  oppositeMidpointOf,
} from '../src/astrology/midpoints.js';

describe('midpointOf (#30)', () => {
  it('is the plain average when the two points are less than 180 degrees apart', () => {
    expect(midpointOf(10, 20)).toBe(15);
  });

  it('takes the shorter arc rather than the naive average', () => {
    // 0 and 200 are 160 degrees apart the short way (through 300/0), not 200 apart.
    expect(midpointOf(0, 200)).toBe(280);
  });

  it('wraps across the 360/0 seam', () => {
    expect(midpointOf(350, 10)).toBe(0);
  });

  it('is symmetric regardless of argument order', () => {
    expect(midpointOf(200, 0)).toBe(midpointOf(0, 200));
  });
});

describe('oppositeMidpointOf (#30)', () => {
  it('is 180 degrees from the near midpoint', () => {
    expect(oppositeMidpointOf(10, 20)).toBe(195);
  });
});

describe('allMidpoints (#30)', () => {
  it('returns every unique body pair exactly once', () => {
    const positions = new Map([
      [0, 10],
      [1, 100],
      [2, 200],
    ]);
    const pairs = allMidpoints(positions);
    expect(pairs).toHaveLength(3); // 3 choose 2
    expect(pairs).toEqual(
      expect.arrayContaining([
        { a: 0, b: 1, midpoint: midpointOf(10, 100) },
        { a: 0, b: 2, midpoint: midpointOf(10, 200) },
        { a: 1, b: 2, midpoint: midpointOf(100, 200) },
      ]),
    );
  });
});

describe('dialPosition (#30)', () => {
  it('collapses conjunction, square and opposition to the same dial position', () => {
    const position = dialPosition(35);
    expect(dialPosition(35 + 90)).toBe(position);
    expect(dialPosition(35 + 180)).toBe(position);
    expect(dialPosition(35 + 270)).toBe(position);
  });

  it('wraps longitude before projecting', () => {
    expect(dialPosition(-10)).toBe(dialPosition(350));
  });
});

describe('midpointTree (#30)', () => {
  it('finds a body sitting on another pair midpoint within orb', () => {
    // Sun/Moon midpoint is 15. A body at 15.5 is a conjunction hit; one 90 away is a square hit.
    const positions = new Map([
      [0, 10], // sun
      [1, 20], // moon
      [2, 15.5], // mercury: near-conjunct the Sun/Moon midpoint
      [3, 105.5], // venus: square the midpoint, same dial position
    ]);
    const hits = midpointTree(positions, 1);
    expect(hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: 2, a: 0, b: 1 }),
        expect.objectContaining({ body: 3, a: 0, b: 1 }),
      ]),
    );
  });

  it('excludes a pair from its own midpoint hit', () => {
    const positions = new Map([
      [0, 10],
      [1, 20],
    ]);
    const hits = midpointTree(positions, 5);
    expect(hits.filter((hit) => hit.body === 0 || hit.body === 1)).toHaveLength(0);
  });

  it('omits pairs outside the given orb', () => {
    const positions = new Map([
      [0, 10],
      [1, 20],
      [2, 50], // far from the Sun/Moon midpoint (15) on the dial
    ]);
    expect(midpointTree(positions, 1)).toHaveLength(0);
  });
});
