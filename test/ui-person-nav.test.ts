/**
 * Tests for the persistent per-person tab bar's pure logic (#234). No DOM: `PersonNav.tsx`
 * itself is thin wiring around `activeTabKey`/`isTabEnabled`, so the behaviour worth pinning
 * lives here rather than behind a component render.
 */
import { describe, expect, it } from 'vitest';
import { newId } from '../src/domain/id.js';
import { activeTabKey, isTabEnabled, PERSON_TABS } from '../src/ui/person-nav.js';
import type { Route } from '../src/ui/route.js';

const ID = newId('p');

describe('activeTabKey', () => {
  it('maps every person-scoped route kind to its tab', () => {
    expect(activeTabKey({ kind: 'person', personId: ID }, `#/person/${ID}`)).toBe('birth-record');
    expect(activeTabKey({ kind: 'profections', personId: ID }, `#/profections/${ID}`)).toBe('profections');
    expect(activeTabKey({ kind: 'transit', personId: ID }, `#/transit/${ID}`)).toBe('transit');
    expect(activeTabKey({ kind: 'synastry', personId: ID }, `#/synastry/${ID}`)).toBe('synastry');
    expect(activeTabKey({ kind: 'composite', personId: ID }, `#/composite/${ID}`)).toBe('composite');
    expect(activeTabKey({ kind: 'harmonic', personId: ID }, `#/harmonic/${ID}`)).toBe('harmonic');
    expect(activeTabKey({ kind: 'periodic-transit', personId: ID }, `#/periodic-transit/${ID}`)).toBe(
      'periodic-transit',
    );
    expect(activeTabKey({ kind: 'astrocartography', personId: ID }, `#/astrocartography/${ID}`)).toBe(
      'astrocartography',
    );
  });

  it('splits chart into natal chart vs. report by the ?tab= query, defaulting to the chart', () => {
    expect(activeTabKey({ kind: 'chart', personId: ID }, `#/chart/${ID}`)).toBe('chart');
    expect(activeTabKey({ kind: 'chart', personId: ID }, `#/chart/${ID}?tab=positions`)).toBe('chart');
    expect(activeTabKey({ kind: 'chart', personId: ID }, `#/chart/${ID}?tab=report`)).toBe('report');
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
      expect(activeTabKey(route, '#/whatever')).toBeNull();
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
      report: `#/chart/${ID}?tab=report`,
      profections: `#/profections/${ID}`,
      transit: `#/transit/${ID}`,
      synastry: `#/synastry/${ID}`,
      composite: `#/composite/${ID}`,
      harmonic: `#/harmonic/${ID}`,
      'periodic-transit': `#/periodic-transit/${ID}`,
      astrocartography: `#/astrocartography/${ID}`,
    });
  });
});
