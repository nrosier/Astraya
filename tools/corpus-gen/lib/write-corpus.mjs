import { readFile, writeFile } from 'node:fs/promises';
import * as prettier from 'prettier';

/**
 * Splits a corpus file's raw JSON text into the [start, end) span of each
 * top-level array element, respecting string literals (so a literal `{`/`}`
 * inside an entry's `text` can never miscount brace depth). depth counts
 * `[`/`{` together: depth 1 is the top-level array itself, depth 2 is an
 * entry object — an entry's span is recorded the moment its own `{`/`}`
 * transitions depth across that boundary.
 */
function splitEntrySpans(rawText) {
  const spans = [];
  let depth = 0;
  let entryStart = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < rawText.length; i += 1) {
    const ch = rawText[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') {
      if (ch === '{' && depth === 1) entryStart = i;
      depth += 1;
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (ch === '}' && depth === 1) spans.push({ start: entryStart, end: i + 1 });
    }
  }
  return spans;
}

/** Prettier's canonical text for one entry object, at the array's own 2-space indent. */
async function formatEntry(entry, filepath) {
  const wrapped = await prettier.format(JSON.stringify([entry]), { filepath });
  return wrapped.slice(wrapped.indexOf('{'), wrapped.lastIndexOf('}') + 1);
}

/**
 * Writes a corpus array back to its JSON file, touching only the entries
 * that actually changed relative to what's on disk right now, plus
 * appending any brand-new ones at the end — everything else keeps its exact
 * original bytes, comma and all. Relies on both callers' own invariant that
 * existing entries are never reordered or removed, only replaced in place
 * (`verify-batch.mjs`) or appended after (`generate-batch.mjs`) — so
 * `corpus[i]` is asserted to still be the same entry as the file's i-th
 * span, by `key`.
 *
 * Whole-file `JSON.stringify` reformatting was tried first and rejected:
 * Prettier's object-brace "preserve expansion" rule reads its hint from the
 * input's own newlines, so reformatting from minified JSON silently changed
 * unrelated entries' formatting throughout the file, not just the ones a
 * caller (say, `--category=dignity-state`) meant to touch.
 */
export async function writeCorpus(path, corpus) {
  const rawText = await readFile(path, 'utf8');
  const spans = splitEntrySpans(rawText);

  const pieces = [rawText.slice(0, spans[0]?.start ?? rawText.length)];

  for (let i = 0; i < spans.length; i += 1) {
    const { start, end } = spans[i];
    const originalText = rawText.slice(start, end);
    const original = JSON.parse(originalText);
    const entry = corpus[i];
    if (entry === undefined || entry.key !== original.key) {
      throw new Error(
        `writeCorpus: entry order changed at index ${String(i)} (file has "${original.key}", corpus has "${entry?.key ?? 'undefined'}") — this writer only supports in-place edits and end-appends`,
      );
    }
    const unchanged = JSON.stringify(entry) === JSON.stringify(original);
    pieces.push(unchanged ? originalText : await formatEntry(entry, path));
    pieces.push(rawText.slice(end, i + 1 < spans.length ? spans[i + 1].start : rawText.length));
  }

  const appendedText = [];
  for (let i = spans.length; i < corpus.length; i += 1) {
    appendedText.push(`,\n  ${await formatEntry(corpus[i], path)}`);
  }
  pieces[pieces.length - 1] = appendedText.join('') + pieces[pieces.length - 1];

  await writeFile(path, pieces.join(''), 'utf8');
}
