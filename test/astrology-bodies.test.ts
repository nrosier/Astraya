import { describe, expect, it } from 'vitest';
import { BODIES, bodyByKey, bodyById, southNode } from '../src/astrology/bodies.js';
import { getEngine } from './engine-harness.js';

describe('the canonical body set (#17)', () => {
  it('has no duplicate ids or keys', () => {
    expect(new Set(BODIES.map((b) => b.id)).size).toBe(BODIES.length);
    expect(new Set(BODIES.map((b) => b.key)).size).toBe(BODIES.length);
  });

  it('round-trips through bodyById and bodyByKey', () => {
    for (const body of BODIES) {
      expect(bodyById(body.id)).toBe(body);
      expect(bodyByKey(body.key)).toBe(body);
    }
  });

  it('computes a position with a non-zero speed for every body', async () => {
    const engine = await getEngine();
    const jd = await engine.julianDay(2000, 1, 1, 12);
    for (const body of BODIES) {
      const position = await engine.position(jd, body.id);
      expect(position.longitude, body.name).toBeGreaterThanOrEqual(0);
      expect(position.longitude, body.name).toBeLessThan(360);
      expect(position.longitudeSpeed, `${body.name} speed`).not.toBe(0);
      expect(position.retrograde, body.name).toBe(position.longitudeSpeed < 0);
    }
  });

  it('agrees on Chiron and the four main-belt asteroids across a second epoch', async () => {
    const engine = await getEngine();
    const jd = await engine.julianDay(1969, 7, 20, 20);
    for (const key of ['chiron', 'ceres', 'pallas', 'juno', 'vesta']) {
      const body = bodyByKey(key);
      if (!body) throw new Error(`missing body: ${key}`);
      const position = await engine.position(jd, body.id);
      expect(Number.isFinite(position.longitude), body.name).toBe(true);
      expect(Number.isFinite(position.latitude), body.name).toBe(true);
    }
  });
});

describe('south node is always opposite the requested north node (#17)', () => {
  it('holds for the mean node', async () => {
    const engine = await getEngine();
    const jd = await engine.julianDay(2024, 3, 15, 12);
    const meanNode = bodyByKey('meanNode');
    if (!meanNode) throw new Error('missing meanNode');
    const north = await engine.position(jd, meanNode.id);
    const south = southNode(north.longitude);
    expect(south).toBeCloseTo((north.longitude + 180) % 360, 9);
  });

  it('wraps correctly near 0/360', () => {
    expect(southNode(10)).toBeCloseTo(190, 9);
    expect(southNode(190)).toBeCloseTo(10, 9);
    expect(southNode(350)).toBeCloseTo(170, 9);
  });
});
