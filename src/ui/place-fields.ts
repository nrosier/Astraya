/**
 * Parsing a typed latitude or longitude (shared by the horary and electional forms): a plain
 * decimal in degrees, typed with either `.` or `,` — a Dutch keyboard's — and within its range.
 */

const DECIMAL_PATTERN = /^-?\d+(?:[.,]\d+)?$/;

function parseDecimal(text: string): number | undefined {
  const trimmed = text.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) return undefined;
  return Number(trimmed.replace(',', '.'));
}

/** Degrees north, or `undefined` if not a plain number from -90 to 90. */
export function parseLatitude(text: string): number | undefined {
  const value = parseDecimal(text);
  return value === undefined || value < -90 || value > 90 ? undefined : value;
}

/** Degrees east, or `undefined` if not a plain number from -180 to 180. */
export function parseLongitude(text: string): number | undefined {
  const value = parseDecimal(text);
  return value === undefined || value < -180 || value > 180 ? undefined : value;
}
