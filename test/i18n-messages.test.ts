/**
 * CI-level parity check for UI message catalogues (#158).
 *
 * `typeof en` already turns a mismatched catalogue into a compile error (part of
 * `npm run typecheck`, itself part of `npm run check`), which is most of the enforcement. This
 * test exists as a second, more legible signal — one that names the exact file and key, and
 * that would still fail if a catalogue file were ever written without the `typeof en` pattern.
 * Aggregates every mismatch into one failure, matching `src/interpretation/loader.ts`'s corpus
 * parity check, rather than stopping at the first offender.
 */
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Scans all of `src/`, not just `src/ui/`: most catalogues are colocated with a component
// there, but a few (e.g. `domain/person-form.messages.ts`) belong to a domain module whose
// validation output is user-facing text, and must stay in parity the same way.
const SRC_ROOT = resolve(import.meta.dirname, '..', 'src');

function messageFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...messageFiles(path));
    else if (entry.name.endsWith('.messages.ts')) files.push(path);
  }
  return files;
}

function relative(file: string): string {
  return file.slice(SRC_ROOT.length + 1);
}

/** A catalogue module exports exactly one `{ en, nl }` object; the export's name varies per file. */
function catalogsOf(module: Record<string, unknown>): Record<string, unknown>[] {
  return Object.values(module).filter(
    (value): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && 'en' in value && 'nl' in value,
  );
}

describe('UI message catalogues stay in parity (#158)', () => {
  it('gives every locale the same keys as every other', async () => {
    const files = messageFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const problems: string[] = [];
    for (const file of files) {
      const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      const catalogs = catalogsOf(module);
      if (catalogs.length === 0) {
        problems.push(`${relative(file)}: no exported { en, nl } catalogue found`);
        continue;
      }
      for (const catalog of catalogs) {
        const en = catalog.en as Record<string, unknown>;
        const nl = catalog.nl as Record<string, unknown>;
        const enKeys = new Set(Object.keys(en));
        const nlKeys = new Set(Object.keys(nl));
        for (const key of enKeys) {
          if (!nlKeys.has(key)) problems.push(`${relative(file)}: "${key}" is in en but missing from nl`);
        }
        for (const key of nlKeys) {
          if (!enKeys.has(key)) problems.push(`${relative(file)}: "${key}" is in nl but missing from en`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
