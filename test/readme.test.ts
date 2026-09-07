/**
 * The README's release badge is hard-coded, so CI has to be the thing that notices.
 *
 * A badge claiming a version the repository is not at is a small lie in the most
 * prominent place, and it goes stale by omission rather than by anyone deciding to
 * leave it wrong. Asserting it here means a forgotten bump fails the release's own
 * check run rather than being spotted by a reader months later.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

describe('README badges', () => {
  it('states the version in package.json', () => {
    const badge = /release-v([^-\s)]+)-blue/.exec(readme);
    expect(badge?.[1]).toBe(version);
  });

  it('points its CI and licence badges at this repository', () => {
    expect(readme).toContain('nrosier/Astraya/actions/workflows/ci.yml/badge.svg');
    // The licence badge is not decorative: AGPL is a condition of using the Swiss
    // Ephemeris, so a badge that drifted to MIT would advertise a licence we cannot
    // grant.
    expect(readme).toContain('license-AGPL--3.0--or--later-blue');
  });
});
