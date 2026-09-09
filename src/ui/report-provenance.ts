/**
 * Pure formatting helpers for #62's provenance view: turning a
 * `ReportParagraph`'s `source`/`placement`/`factors` into the short, plain-
 * English strings a "why this text?" toggle shows underneath a paragraph.
 *
 * Kept separate from `ReportView.tsx` (and untyped against React at all) so
 * these can be exercised directly with Vitest, the same "thin `.tsx`, tested
 * `.ts`" split `table-sort.ts`/`SortableTable.tsx` already use.
 *
 * English-only: there is no locale switcher anywhere in this app yet (a
 * separate concern from provenance traceability), so `ReportView.tsx` always
 * requests the report in `'en'`, and these labels follow the same body/sign/
 * aspect English names already exported from `astrology/*` rather than
 * duplicating `compose.ts`'s locale tables for a UI that has nowhere to
 * switch away from English.
 */
import { bodyByKey } from '../astrology/bodies.js';
import { aspectByKey } from '../astrology/aspects.js';
import { SIGNS } from '../astrology/signs.js';
import type { ParagraphSource, ReportParagraph } from '../interpretation/report.js';
import type { CorpusPlacement } from '../interpretation/schema.js';
import type { SalienceFactor } from '../interpretation/rules.js';

function bodyLabel(key: string): string {
  return bodyByKey(key)?.name ?? key;
}

function signLabel(index: number): string {
  return SIGNS[index]?.name ?? `sign ${String(index)}`;
}

function aspectLabel(key: string): string {
  return aspectByKey(key)?.name.toLowerCase() ?? key;
}

/** A short label for the placement a paragraph resolves, e.g. "Sun in Aries" or "Mars square Venus". */
export function describePlacement(placement: CorpusPlacement): string {
  switch (placement.category) {
    case 'planet-in-sign':
      return `${bodyLabel(placement.body)} in ${signLabel(placement.sign)}`;
    case 'planet-in-house':
      return `${bodyLabel(placement.body)} in house ${String(placement.house)}`;
    case 'sign-on-cusp':
      return `${signLabel(placement.sign)} on the house ${String(placement.house)} cusp`;
    case 'aspect-pair':
      return `${bodyLabel(placement.bodyA)} ${aspectLabel(placement.aspect)} ${bodyLabel(placement.bodyB)}`;
    case 'dignity-state':
      return `${bodyLabel(placement.body)}: ${placement.state}`;
    case 'nakshatra':
      return `${bodyLabel(placement.body)}, nakshatra ${String(placement.nakshatra)}`;
    case 'pattern':
      return placement.pattern;
  }
}

/** Where a paragraph's text came from, and (for a corpus entry) who/what wrote it and when. */
export function describeSource(source: ParagraphSource): string {
  switch (source.kind) {
    case 'corpus': {
      const { provenance } = source.entry;
      if (provenance.source === 'hand-written') return 'Hand-written corpus entry';
      const parts = ['Generated corpus entry'];
      if (provenance.model !== undefined) parts.push(`model: ${provenance.model}`);
      if (provenance.promptVersion !== undefined) parts.push(`prompt: ${provenance.promptVersion}`);
      if (provenance.generatedAt !== undefined) parts.push(`generated: ${provenance.generatedAt}`);
      return parts.join(', ');
    }
    case 'fallback':
      return 'Mechanical fallback text — no corpus entry exists for this placement yet';
    case 'derived':
      return 'Derived directly from chart data, not a corpus placement';
  }
}

/** One factor as a short "rule: detail (weight N)" fragment. */
function describeFactor(factor: SalienceFactor): string {
  return `${factor.rule}: ${factor.detail} (weight ${String(factor.weight)})`;
}

/** All of a paragraph's contributing factors, joined for display; `undefined` when there are none to show. */
export function describeFactors(factors: readonly SalienceFactor[]): string | undefined {
  return factors.length === 0 ? undefined : factors.map(describeFactor).join('; ');
}

/** Everything the provenance toggle shows for one paragraph, pre-joined into display-ready lines. */
export interface ParagraphProvenance {
  readonly source: string;
  readonly placement: string | undefined;
  readonly factors: string | undefined;
}

export function describeParagraphProvenance(paragraph: ReportParagraph): ParagraphProvenance {
  return {
    source: describeSource(paragraph.source),
    placement: paragraph.placement === undefined ? undefined : describePlacement(paragraph.placement),
    factors: describeFactors(paragraph.factors),
  };
}
