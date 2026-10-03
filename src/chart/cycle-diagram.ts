/**
 * The zodiac with a planetary cycle's points joined in order (#410).
 *
 * Plot where each successive exact aspect of a cycle falls and join them in sequence: Venus's
 * inferior conjunctions with the Sun, each ~144° from the last, close into a five-pointed star
 * over eight years; Jupiter and Saturn's great conjunctions step ~240° each and walk round the
 * zodiac through one element for two centuries. Hence a diagram rather than a list — the
 * *pattern* is the cycle.
 *
 * Aries sits at twelve o'clock and longitude runs counterclockwise, the same convention the
 * chart wheel uses with its `aries-up` orientation, via the shared `wheelAngle`/`pointOnCircle`.
 * Colour lives in CSS (`app.css`), as everywhere in `src/chart/**`.
 */
import { SIGNS } from '../astrology/signs.js';
import type { Degrees } from '../ephemeris/types.js';
import { renderGlyph, signGlyph } from './glyphs.js';
import { baselineOffset, circle, escapeXml, fmt, line, text } from './svg-primitives.js';
import { pointOnCircle, wheelAngle } from './wheel.js';

export interface CyclePoint {
  readonly longitude: Degrees;
  /** Short label drawn beside the point — typically its position in the sequence. */
  readonly label: string;
}

/** Points closer than this share a neighbourhood, so their labels are stacked rather than overprinted. */
const LABEL_CROWD_DEG = 8;

function angularGap(a: Degrees, b: Degrees): Degrees {
  const diff = Math.abs((((a - b) % 360) + 360) % 360);
  return diff > 180 ? 360 - diff : diff;
}

const ORIENTATION = { orientation: 'aries-up', sweep: 'counterclockwise' } as const;

export function renderCycleDiagramSvg(points: readonly CyclePoint[], size = 380): string {
  const c = size / 2;
  const ringOuter = size * 0.47;
  const ringInner = size * 0.39;
  const signRadius = (ringOuter + ringInner) / 2;
  const pointRadius = ringInner - size * 0.02;
  const labelRadius = pointRadius - size * 0.055;
  const parts: string[] = [circle(c, c, ringOuter, 'cycle-ring'), circle(c, c, ringInner, 'cycle-ring')];

  for (const sign of SIGNS) {
    const boundary = wheelAngle(sign.index * 30, 0, ORIENTATION);
    const outer = pointOnCircle(c, c, ringOuter, boundary);
    const inner = pointOnCircle(c, c, ringInner, boundary);
    parts.push(line(outer.x, outer.y, inner.x, inner.y, 'cycle-sign-boundary'));
    const definition = signGlyph(sign.name);
    if (definition) {
      const middle = pointOnCircle(c, c, signRadius, wheelAngle(sign.index * 30 + 15, 0, ORIENTATION));
      parts.push(
        renderGlyph(
          definition,
          middle.x,
          middle.y,
          size * 0.06,
          `chart-sign-glyph chart-sign-glyph-${sign.name.toLowerCase()} chart-sign-element-${sign.element}`,
        ),
      );
    }
  }

  const placed = points.map((point) => pointOnCircle(c, c, pointRadius, wheelAngle(point.longitude, 0, ORIENTATION)));
  for (let i = 1; i < placed.length; i++) {
    const from = placed[i - 1];
    const to = placed[i];
    if (from && to) parts.push(line(from.x, from.y, to.x, to.y, 'cycle-link'));
  }
  points.forEach((point, index) => {
    const at = placed[index];
    if (!at) return;
    parts.push(`<circle cx="${fmt(at.x)}" cy="${fmt(at.y)}" r="${fmt(size * 0.012)}" class="cycle-point" />`);
    // A point that nearly coincides with earlier ones (the sixth point of the Venus pentagram
    // closes on the first) gets its label one step further in, so the labels stay legible.
    const crowding = points
      .slice(0, index)
      .filter((other) => angularGap(other.longitude, point.longitude) < LABEL_CROWD_DEG).length;
    const label = pointOnCircle(
      c,
      c,
      labelRadius - crowding * size * 0.05,
      wheelAngle(point.longitude, 0, ORIENTATION),
    );
    parts.push(
      text(
        label.x,
        label.y + baselineOffset(size * 0.035),
        'middle',
        'cycle-point-label',
        escapeXml(point.label),
        size * 0.035,
      ),
    );
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(size)} ${fmt(size)}" width="${fmt(size)}" height="${fmt(size)}" class="cycle-diagram">${parts.join('')}</svg>`;
}
