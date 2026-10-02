/**
 * Tests for the persistent per-person tab bar's pure logic (#234). No DOM: `PersonNav.tsx`
 * itself is thin wiring around `activeTabKey`/`isTabEnabled`, so the behaviour worth pinning
 * lives here rather than behind a component render.
 */
import { describe, expect, it } from 'vitest';
import { newId } from '../src/domain/id.js';
import { activeTabKey, familyForTab, isTabEnabled, PERSON_TAB_FAMILIES, PERSON_TABS } from '../src/ui/person-nav.js';
import type { Route } from '../src/ui/route.js';

const ID = newId('p');

describe('activeTabKey', () => {
  it('maps every person-scoped route kind to its tab', () => {
    expect(activeTabKey({ kind: 'person', personId: ID })).toBe('birth-record');
    expect(activeTabKey({ kind: 'chart', personId: ID })).toBe('chart');
    expect(activeTabKey({ kind: 'report', personId: ID })).toBe('report');
    expect(activeTabKey({ kind: 'profections', personId: ID })).toBe('profections');
    expect(activeTabKey({ kind: 'progressions', personId: ID })).toBe('progressions');
    expect(activeTabKey({ kind: 'solar-arc', personId: ID })).toBe('solar-arc');
    expect(activeTabKey({ kind: 'transit', personId: ID })).toBe('transit');
    expect(activeTabKey({ kind: 'synastry', personId: ID })).toBe('synastry');
    expect(activeTabKey({ kind: 'composite', personId: ID })).toBe('composite');
    expect(activeTabKey({ kind: 'harmonic', personId: ID })).toBe('harmonic');
    expect(activeTabKey({ kind: 'draconic', personId: ID })).toBe('draconic');
    expect(activeTabKey({ kind: 'periodic-transit', personId: ID })).toBe('periodic-transit');
    expect(activeTabKey({ kind: 'astrocartography', personId: ID })).toBe('astrocartography');
  });

  it('is null for routes with no tab of their own', () => {
    const nonPersonRoutes: Route[] = [
      { kind: 'home' },
      { kind: 'about' },
      { kind: 'changelog' },
      { kind: 'people' },
      { kind: 'shared' },
      { kind: 'admin' },
      { kind: 'set-password' },
      { kind: 'setup' },
    ];
    for (const route of nonPersonRoutes) {
      expect(activeTabKey(route)).toBeNull();
    }
  });
});

describe('isTabEnabled', () => {
  it('always enables the birth record tab', () => {
    expect(isTabEnabled('birth-record', false)).toBe(true);
    expect(isTabEnabled('birth-record', true)).toBe(true);
  });

  it('gates every other tab on a stored birth moment', () => {
    for (const tab of PERSON_TABS) {
      if (tab.key === 'birth-record') continue;
      expect(isTabEnabled(tab.key, false)).toBe(false);
      expect(isTabEnabled(tab.key, true)).toBe(true);
    }
  });
});

describe('PERSON_TABS', () => {
  it('builds the same hrefs the old nav chain used', () => {
    const hrefs = Object.fromEntries(PERSON_TABS.map((tab) => [tab.key, tab.buildHref(ID)]));
    expect(hrefs).toEqual({
      'birth-record': `#/person/${ID}`,
      chart: `#/chart/${ID}`,
      report: `#/report/${ID}`,
      profections: `#/profections/${ID}`,
      progressions: `#/progressions/${ID}`,
      'solar-arc': `#/solar-arc/${ID}`,
      transit: `#/transit/${ID}`,
      synastry: `#/synastry/${ID}`,
      composite: `#/composite/${ID}`,
      harmonic: `#/harmonic/${ID}`,
      draconic: `#/draconic/${ID}`,
      'periodic-transit': `#/periodic-transit/${ID}`,
      astrocartography: `#/astrocartography/${ID}`,
    });
  });
});

describe('PERSON_TAB_FAMILIES (#398)', () => {
  it('keeps the three fixed tabs and astrocartography out of every family', () => {
    const grouped = new Set(PERSON_TAB_FAMILIES.flatMap((family) => family.members));
    expect(grouped.has('birth-record')).toBe(false);
    expect(grouped.has('chart')).toBe(false);
    expect(grouped.has('report')).toBe(false);
    expect(grouped.has('astrocartography')).toBe(false);
  });

  it('places every other tab in exactly one family', () => {
    const groupable = PERSON_TABS.filter(
      (tab) =>
        tab.key !== 'birth-record' && tab.key !== 'chart' && tab.key !== 'report' && tab.key !== 'astrocartography',
    );
    for (const tab of groupable) {
      const matches = PERSON_TAB_FAMILIES.filter((family) => family.members.includes(tab.key));
      expect(matches).toHaveLength(1);
    }
  });
});

describe('familyForTab (#398)', () => {
  it('returns the family a grouped tab belongs to', () => {
    expect(familyForTab('profections')).toBe('progressions-directions');
    expect(familyForTab('progressions')).toBe('progressions-directions');
    expect(familyForTab('solar-arc')).toBe('progressions-directions');
    expect(familyForTab('transit')).toBe('transits-forecast');
    expect(familyForTab('periodic-transit')).toBe('transits-forecast');
    expect(familyForTab('synastry')).toBe('relationship-charts');
    expect(familyForTab('composite')).toBe('relationship-charts');
    expect(familyForTab('harmonic')).toBe('chart-variants');
    expect(familyForTab('draconic')).toBe('chart-variants');
  });

  it('returns undefined for the three fixed tabs and astrocartography', () => {
    expect(familyForTab('birth-record')).toBeUndefined();
    expect(familyForTab('chart')).toBeUndefined();
    expect(familyForTab('report')).toBeUndefined();
    expect(familyForTab('astrocartography')).toBeUndefined();
  });
});
