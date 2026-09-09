/**
 * Tests for hash routing.
 *
 * The failures worth catching are the quiet ones: a link that lands on the home page
 * instead of the screen it names, and a mistyped person id that opens the form and reports
 * a person who never existed as deleted. Both look like the app working.
 */
import { describe, expect, it } from 'vitest';
import { newId } from '../src/domain/id.js';
import { parseRoute } from '../src/ui/route.js';

const ID = newId('p');

describe('parseRoute', () => {
  it('routes the named screens', () => {
    expect(parseRoute('#/about')).toEqual({ kind: 'about' });
    expect(parseRoute('#/changelog')).toEqual({ kind: 'changelog' });
    expect(parseRoute('#/time')).toEqual({ kind: 'time' });
    expect(parseRoute('#/people')).toEqual({ kind: 'people' });
  });

  it('routes an empty hash home, as a browser leaves it', () => {
    // A fresh visit, a bare '#' after an anchor click, and an explicit '#/' are the same
    // request. Any of them falling through to a 404 screen would be a bug nobody typed.
    expect(parseRoute('')).toEqual({ kind: 'home' });
    expect(parseRoute('#')).toEqual({ kind: 'home' });
    expect(parseRoute('#/')).toEqual({ kind: 'home' });
  });

  it('keeps the query out of the match', () => {
    // #/time carries the whole birth record in its query, which is what makes the panel
    // shareable. Matching the raw hash would break every shared link.
    expect(parseRoute('#/time?y=1960&mo=6')).toEqual({ kind: 'time' });
    expect(parseRoute(`#/person/${ID}?x=1`)).toEqual({ kind: 'person', personId: ID });
  });

  it('routes a shared chart link (#65), which also carries its whole record in the query', () => {
    expect(parseRoute('#/shared?v=1&d=1960-06-15&t=14:30&la=38.7478&lo=-85.0672')).toEqual({ kind: 'shared' });
    expect(parseRoute('#/shared')).toEqual({ kind: 'shared' });
  });

  it('tolerates a trailing slash', () => {
    expect(parseRoute('#/people/')).toEqual({ kind: 'people' });
    expect(parseRoute(`#/person/${ID}/`)).toEqual({ kind: 'person', personId: ID });
  });

  it('carries a person id through', () => {
    expect(parseRoute(`#/person/${ID}`)).toEqual({ kind: 'person', personId: ID });
  });

  it('routes a chart id through', () => {
    expect(parseRoute(`#/chart/${ID}`)).toEqual({ kind: 'chart', personId: ID });
    expect(parseRoute(`#/chart/${ID}/`)).toEqual({ kind: 'chart', personId: ID });
    expect(parseRoute(`#/chart/${ID}?x=1`)).toEqual({ kind: 'chart', personId: ID });
  });

  it('sends a malformed chart id home rather than to a blank chart', () => {
    expect(parseRoute('#/chart/')).toEqual({ kind: 'home' });
    expect(parseRoute('#/chart/nope')).toEqual({ kind: 'home' });
    expect(parseRoute('#/chart/../about')).toEqual({ kind: 'home' });
  });

  it('sends an id that is not one of ours home rather than to an empty form', () => {
    // The form would render "there is no person with that id — they may have been deleted",
    // which is a confident, wrong explanation for a truncated link.
    expect(parseRoute('#/person/')).toEqual({ kind: 'home' });
    expect(parseRoute('#/person/nope')).toEqual({ kind: 'home' });
    expect(parseRoute('#/person/p-short')).toEqual({ kind: 'home' });
    // A chart id is well-formed and still not a person.
    expect(parseRoute(`#/person/${newId('c')}`)).toEqual({ kind: 'home' });
    // Path traversal in a hash cannot reach anything, but it must not become an id either.
    expect(parseRoute('#/person/../about')).toEqual({ kind: 'home' });
  });

  it('sends an unknown route home', () => {
    expect(parseRoute('#/nonsense')).toEqual({ kind: 'home' });
    expect(parseRoute('#/aboutus')).toEqual({ kind: 'home' });
  });
});
