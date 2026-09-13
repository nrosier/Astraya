/**
 * Astrocartography (ACG) and Local Space lines (#171).
 *
 * Pure math, no `EphemerisProvider` import — same separation `fixed-stars.ts`
 * itself keeps. MC/IC/AC/DC reuse `armcAtAngle`/`EquatorialPoint` from
 * `fixed-stars.ts`: an ACG line is nothing but "every place whose local
 * sidereal time equals the ARMC this point needs for that angle," and that
 * ARMC is exactly what `armcAtAngle` already computes for parans. Azimuth for
 * Local Space lines comes from the engine's `swe_azalt` binding and is passed
 * in by the domain layer — the only genuinely new hand-rolled math here is the
 * great-circle forward-geodesic sampler, which has no ephemeris binding.
 */
import type { BodyId, Degrees, GeoPosition } from '../ephemeris/types.js';
import { armcAtAngle, type EquatorialPoint } from './fixed-stars.js';

function norm180(degrees: Degrees): Degrees {
  const positive = ((degrees % 360) + 360) % 360; // [0, 360)
  return positive >= 180 ? positive - 360 : positive;
}

/**
 * Geographic longitude in [-180, 180) at which ARMC equals `armc`, given the
 * reference ARMC at longitude 0 (`armc0`). Local sidereal time increases by
 * one degree of ARMC per degree of geographic longitude east of Greenwich, so
 * this is a plain (wrapped) subtraction — no trigonometry involved.
 */
export function longitudeFromArmc(armc: Degrees, armc0: Degrees): Degrees {
  return norm180(armc - armc0);
}

export interface MeridianLine {
  readonly kind: 'MC' | 'IC';
  readonly body: BodyId;
  /** Constant across every latitude — a meridian line is a straight vertical line on an equirectangular map. */
  readonly longitude: Degrees;
}

/** The MC or IC line for a point: every place currently on its meridian (culminating or anticulminating). */
export function meridianLine(kind: 'MC' | 'IC', body: BodyId, point: EquatorialPoint, armc0: Degrees): MeridianLine {
  const armc = armcAtAngle(point, 0, kind === 'MC' ? 'culminating' : 'anticulminating');
  if (armc === undefined) throw new Error('unreachable: culmination/anticulmination is always defined');
  return { kind, body, longitude: longitudeFromArmc(armc, armc0) };
}

export interface HorizonLinePoint {
  readonly latitude: Degrees;
  readonly longitude: Degrees;
}

export interface HorizonLine {
  readonly kind: 'AC' | 'DC';
  readonly body: BodyId;
  /**
   * One or more contiguous runs, ascending by latitude within each run. A new
   * segment starts wherever the body is circumpolar/never-rising at that
   * latitude (`armcAtAngle` returns `undefined`) — a structural break, not a
   * gap the renderer infers.
   */
  readonly segments: readonly (readonly HorizonLinePoint[])[];
}

export interface AcgSamplingOptions {
  /** Latitude step in degrees. Default 1. */
  readonly latitudeStepDeg?: Degrees;
  /** Sampled range is [-maxAbsLatitude, +maxAbsLatitude]; poles never sampled (tan(lat) blows up). Default 85. */
  readonly maxAbsLatitude?: Degrees;
}

/** The AC (rising) or DC (setting) line for a point, sampled by latitude. */
export function horizonLine(
  kind: 'AC' | 'DC',
  body: BodyId,
  point: EquatorialPoint,
  armc0: Degrees,
  options?: AcgSamplingOptions,
): HorizonLine {
  const step = options?.latitudeStepDeg ?? 1;
  const maxAbsLatitude = options?.maxAbsLatitude ?? 85;
  const angle = kind === 'AC' ? 'rising' : 'setting';

  const segments: HorizonLinePoint[][] = [];
  let current: HorizonLinePoint[] = [];
  const epsilon = step / 2;
  for (let latitude = -maxAbsLatitude; latitude <= maxAbsLatitude + epsilon; latitude += step) {
    const armc = armcAtAngle(point, latitude, angle);
    if (armc === undefined) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    current.push({ latitude, longitude: longitudeFromArmc(armc, armc0) });
  }
  if (current.length > 0) segments.push(current);
  return { kind, body, segments };
}

export interface GreatCirclePoint {
  readonly latitude: Degrees;
  readonly longitude: Degrees;
}

export interface GreatCircleSamplingOptions {
  /** Angular-distance step between sampled points, in degrees. Default 2. */
  readonly stepDeg?: Degrees;
  /** Maximum angular distance sampled out to, in degrees. Default 90. */
  readonly maxDistanceDeg?: Degrees;
}

/**
 * Points along the great circle leaving `origin` on initial bearing
 * `azimuthDeg`, out to `maxDistanceDeg`. The standard forward-geodesic
 * spherical-navigation formula; no ephemeris involved. Longitude is wrapped
 * to [-180, 180) rather than clamped, so a path crossing the antimeridian
 * shows up as a jump across that boundary between consecutive points — the
 * signal the chart layer's antimeridian splitter looks for, not a value
 * pinned at the edge.
 */
export function greatCirclePath(
  origin: GeoPosition,
  azimuthDeg: Degrees,
  options?: GreatCircleSamplingOptions,
): readonly GreatCirclePoint[] {
  const step = options?.stepDeg ?? 2;
  const maxDistance = options?.maxDistanceDeg ?? 90;
  const lat1 = (origin.latitude * Math.PI) / 180;
  const lon1 = (origin.longitude * Math.PI) / 180;
  const theta = (azimuthDeg * Math.PI) / 180;

  const points: GreatCirclePoint[] = [];
  const epsilon = step / 2;
  for (let distanceDeg = 0; distanceDeg <= maxDistance + epsilon; distanceDeg += step) {
    const d = (distanceDeg * Math.PI) / 180;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(theta));
    const lon2 =
      lon1 + Math.atan2(Math.sin(theta) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    points.push({ latitude: (lat2 * 180) / Math.PI, longitude: norm180((lon2 * 180) / Math.PI) });
  }
  return points;
}

export interface LocalSpaceLine {
  readonly body: BodyId;
  readonly azimuth: Degrees;
  readonly forward: readonly GreatCirclePoint[];
  /** Reciprocal bearing (`azimuth + 180`) — Local Space lines conventionally run through the birth point both ways. */
  readonly backward: readonly GreatCirclePoint[];
}

/** The Local Space line for a body: the great circle through `natalPlace` on bearing `azimuthDeg`, run both ways. */
export function localSpaceLine(
  body: BodyId,
  natalPlace: GeoPosition,
  azimuthDeg: Degrees,
  options?: GreatCircleSamplingOptions,
): LocalSpaceLine {
  return {
    body,
    azimuth: azimuthDeg,
    forward: greatCirclePath(natalPlace, azimuthDeg, options),
    backward: greatCirclePath(natalPlace, azimuthDeg + 180, options),
  };
}
