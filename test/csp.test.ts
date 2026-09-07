/**
 * The Content Security Policy is served twice — as a header by the Fastify server,
 * and as a `<meta>` tag in index.html so the policy still holds if the built app is
 * hosted as plain static files. Two copies drift. These tests make drift a build
 * failure instead of a silent weakening of the policy.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CSP_DIRECTIVES, CSP_HEADER, CSP_META } from '../server/csp.js';

const indexHtml = readFileSync(resolve(import.meta.dirname, '..', 'index.html'), 'utf8');

/** The meta tag is indented across lines for legibility; compare on content. */
function normalize(policy: string): string {
  return policy.replace(/\s+/g, ' ').trim();
}

function metaPolicy(): string {
  const match = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(indexHtml);
  if (match?.[1] === undefined) throw new Error('index.html has no Content-Security-Policy meta tag.');
  return match[1];
}

describe('content security policy', () => {
  it('index.html carries the same policy as the server header', () => {
    expect(normalize(metaPolicy())).toBe(normalize(CSP_META));
  });

  it('forbids any external connection, which is what keeps model providers unreachable', () => {
    // The interpretation corpus is generated at build time and shipped as data. If
    // connect-src ever gains a host, that guarantee is gone — so assert the exact
    // value rather than merely that the directive exists.
    expect(CSP_DIRECTIVES).toContain("connect-src 'self'");
    expect(normalize(metaPolicy())).toContain("connect-src 'self'");
  });

  it('allows WASM compilation without allowing eval of JavaScript', () => {
    const scriptSrc = CSP_DIRECTIVES.find((directive) => directive.startsWith('script-src'));
    expect(scriptSrc).toBe("script-src 'self' 'wasm-unsafe-eval'");
    // 'unsafe-eval' would permit arbitrary JavaScript eval; 'wasm-unsafe-eval' does not.
    expect(scriptSrc).not.toMatch(/'unsafe-eval'/);
  });

  it('keeps frame-ancestors out of the meta tag, where it would be ignored', () => {
    // A meta tag cannot express frame-ancestors. Putting it there looks like
    // protection and provides none.
    expect(CSP_META).not.toContain('frame-ancestors');
    expect(CSP_HEADER).toContain("frame-ancestors 'none'");
  });
});
