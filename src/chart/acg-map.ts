/**
 * Astrocartography (ACG) world map (#171).
 *
 * A graticule-only equirectangular projection — no coastline/border dataset,
 * matching every other renderer in this directory being 100% hand-rolled SVG
 * with no new third-party dependency (see the plan's context note on bundle
 * budget). `x = (lon + 180) / 360 * width`, `y = (90 - lat) / 180 * height`,
 * so the map is exactly twice as wide as it is tall — equirectangular's
 * natural aspect ratio.
 *
 * `HorizonLine.segments` already break wherever a body is circumpolar at a
 * sampled latitude (an astronomical break); this module additionally splits
 * any point run wherever consecutive longitudes jump by more than 180°, a
 * *projection* break (the run crossed the map's left/right edge) that has
 * nothing to do with circumpolarity and would otherwise draw a spurious line
 * clean across the map.
 */
import type { LocalSpaceLine } from '../astrology/astrocartography.js';
import { bodyById } from '../astrology/bodies.js';
import type { AcgLine } from '../domain/astrocartography.js';
import type { GeoPosition } from '../ephemeris/types.js';
import { circle, line, polyline } from './svg-primitives.js';

const DEFAULT_WIDTH = 900;
const GRATICULE_STEP_DEG = 30;

export interface AcgMapInput {
  readonly lines: readonly AcgLine[];
  readonly localSpaceLines: readonly LocalSpaceLine[];
  readonly natalPlace: GeoPosition;
  readonly relocationPlace?: GeoPosition;
}

export interface AcgMapOptions {
  /** Map width in px; height is always `width / 2`. Default 900. */
  readonly width?: number;
}

export interface AcgMap {
  readonly markup: string;
  readonly width: number;
  readonly height: number;
}

interface Point {
  readonly latitude: number;
  readonly longitude: number;
}

/** Splits a point run wherever consecutive longitudes jump by more than 180° — a map-edge crossing, not a data gap. */
function splitAtAntimeridian(points: readonly Point[]): (readonly Point[])[] {
  const runs: Point[][] = [];
  let current: Point[] = [];
  let previousLongitude: number | undefined;
  for (const point of points) {
    if (previousLongitude !== undefined && Math.abs(point.longitude - previousLongitude) > 180) {
      if (current.length > 0) runs.push(current);
      current = [];
    }
    current.push(point);
    previousLongitude = point.longitude;
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

function bodyKeyOf(body: number): string {
  return bodyById(body)?.key ?? 'unknown';
}

export function renderAcgMapSvg(input: AcgMapInput, options?: AcgMapOptions): AcgMap {
  const width = options?.width ?? DEFAULT_WIDTH;
  const height = width / 2;
  const project = (point: Point): { x: number; y: number } => ({
    x: ((point.longitude + 180) / 360) * width,
    y: ((90 - point.latitude) / 180) * height,
  });

  const parts: string[] = [];

  for (let latitude = -90; latitude <= 90; latitude += GRATICULE_STEP_DEG) {
    const y = project({ latitude, longitude: 0 }).y;
    parts.push(line(0, y, width, y, 'acg-graticule'));
  }
  for (let longitude = -180; longitude <= 180; longitude += GRATICULE_STEP_DEG) {
    const x = project({ latitude: 0, longitude }).x;
    parts.push(line(x, 0, x, height, 'acg-graticule'));
  }

  for (const acgLine of input.lines) {
    const key = bodyKeyOf(acgLine.body);
    switch (acgLine.kind) {
      case 'MC':
      case 'IC': {
        const kindClass = acgLine.kind === 'MC' ? 'acg-line-mc' : 'acg-line-ic';
        const x = project({ latitude: 0, longitude: acgLine.longitude }).x;
        parts.push(line(x, 0, x, height, `${kindClass} ${kindClass}-${key}`));
        break;
      }
      case 'AC':
      case 'DC': {
        const kindClass = acgLine.kind === 'AC' ? 'acg-line-ac' : 'acg-line-dc';
        for (const segment of acgLine.segments) {
          for (const run of splitAtAntimeridian(segment)) {
            parts.push(polyline(run.map(project), `${kindClass} ${kindClass}-${key}`));
          }
        }
        break;
      }
    }
  }

  for (const localSpaceLine of input.localSpaceLines) {
    const key = bodyKeyOf(localSpaceLine.body);
    const className = `acg-line-local-space acg-line-local-space-${key}`;
    for (const arm of [localSpaceLine.forward, localSpaceLine.backward]) {
      for (const run of splitAtAntimeridian(arm)) {
        parts.push(polyline(run.map(project), className));
      }
    }
  }

  const natalPoint = project(input.natalPlace);
  parts.push(circle(natalPoint.x, natalPoint.y, 5, 'acg-marker-natal'));
  if (input.relocationPlace !== undefined) {
    const relocationPoint = project(input.relocationPlace);
    parts.push(circle(relocationPoint.x, relocationPoint.y, 5, 'acg-marker-relocation'));
  }

  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}" class="acg-map">${parts.join('')}</svg>`;
  return { markup, width, height };
}
