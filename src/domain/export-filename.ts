/**
 * Filenames for a chart export (#67/#68): derived from the person and chart, never typed
 * separately, so a downloaded file always says whose chart it is without the exporter
 * having to ask.
 */

/** Lowercases, strips anything that isn't a filename-safe character, and collapses runs of it into one `-`. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `displayName` may be empty (a person can exist before there is anything to call them,
 * per `Person`'s own doc comment) — an empty or entirely-punctuation name falls back to
 * `chart` rather than producing a bare `-natal.svg`.
 */
export function deriveExportFilename(displayName: string, chartKind: string, extension: string): string {
  const namePart = slugify(displayName) || 'chart';
  const kindPart = slugify(chartKind) || 'chart';
  return `${namePart}-${kindPart}.${extension}`;
}
