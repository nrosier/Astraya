/**
 * Mechanical enforcement of the build-time-only decision (#64).
 *
 * The interpretation corpus is drafted offline by #56's generator and committed as
 * data (schema.ts's `CorpusProvenanceSource` even records which model wrote an
 * entry) — but `src/` is what ships to the browser, and it must never be able to
 * reach a model provider or hold a credential for one. `server/csp.ts` already
 * makes the network half of that structural (`connect-src 'self'`, asserted
 * exactly in `test/csp.test.ts`); this file covers the two things a CSP cannot:
 * a credential sitting in the bundle, and `src/` importing the generator itself.
 *
 * Matching is identifier-shaped (`API_KEY`, `apiKey`, an import path), not a
 * grep for provider names — this codebase's own zodiac sign is "Gemini", and
 * `schema.ts` documents `"gemini-2.5-pro"` as an example provenance value, so a
 * plain word match would fail on legitimate code today.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CSP_DIRECTIVES } from '../server/csp.js';

const SRC_ROOT = resolve(import.meta.dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const FILES = sourceFiles(SRC_ROOT);

function relative(file: string): string {
  return file.slice(SRC_ROOT.length + 1);
}

describe('no runtime LLM access in src/ (#64)', () => {
  it('carries no connect-src exception for a model provider', () => {
    const connectSrc = CSP_DIRECTIVES.find((directive) => directive.startsWith('connect-src'));
    expect(connectSrc).toBe("connect-src 'self'");
  });

  it('holds no API key identifier', () => {
    // Substring, not a word-bounded match: a real key constant is usually prefixed
    // (`GEMINI_API_KEY`, `VITE_GEMINI_API_KEY`), and `_` counts as a word character,
    // so `\bAPI_KEY\b` would silently pass over exactly the names that matter.
    const pattern = /API_KEY|apiKey/;
    const offenders = FILES.filter((file) => pattern.test(readFileSync(file, 'utf8'))).map(relative);
    expect(offenders).toEqual([]);
  });

  it('never imports from a tools/ directory', () => {
    // The generator (#56) is invoked at build time, from tools/, and must stay
    // there — src/ importing it would pull an offline-only script (and whatever
    // SDK it depends on) into the shipped bundle.
    const pattern = /(?:from\s+|require\()\s*['"][^'"]*\btools\//;
    const offenders = FILES.filter((file) => pattern.test(readFileSync(file, 'utf8'))).map(relative);
    expect(offenders).toEqual([]);
  });
});
