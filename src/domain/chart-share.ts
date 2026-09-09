/**
 * A whole chart — birth data plus the settings that reproduce it — as a URL.
 *
 * #65: sharing a chart must not involve our server at all, so the link has to carry
 * everything: the recipient's browser recomputes the chart from these parameters alone,
 * the same way `time/encode.ts` already lets a birth moment round-trip through a link.
 * This module wraps that encoding and adds the one thing a bare moment link doesn't need:
 * chart settings (house system, zodiac, wheel display, …), plus a version tag so a link
 * minted by an older or newer build still decodes under the rules it was written for.
 *
 * Settings are carried as opaque JSON, not as individually-named parameters. `Chart`
 * (`domain/chart.ts`) already treats settings as a verbatim bag whose keys are owned by
 * whichever module consumes them — duplicating that list of keys here would drift from it
 * the moment a new setting is added elsewhere. A share link keeps the same guarantee: a
 * setting this build has never heard of still round-trips untouched.
 */
import { decodeBirthMoment, encodeBirthMoment } from '../time/encode.js';
import type { BirthMomentInput } from '../time/types.js';
import type { JsonValue } from '../store/ops.js';

/** Bumped only when the *shape* of a link changes in a way old links must still decode against. */
const CURRENT_VERSION = 1;

export interface ChartShareData {
  readonly moment: BirthMomentInput;
  readonly settings: Readonly<Record<string, JsonValue>>;
  /**
   * Whether the birth time itself is known, as opposed to merely encoded as some
   * placeholder civil time. Carried separately from `moment` because a person with an
   * unknown birth time still has *a* recorded hour/minute in their record (whatever was
   * typed as a placeholder) — without this flag a recipient's chart would show houses and
   * an Ascendant computed from that placeholder as if they were real, which is exactly the
   * false certainty this app exists to avoid. Defaults to `true`, since most shared charts
   * do have a known time and the common link should stay short.
   */
  readonly housesKnown: boolean;
}

/** Thrown when a share link cannot be read. */
export class ChartShareLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChartShareLinkError';
  }
}

function isSettingsRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * UTF-8-safe base64url: `btoa` only accepts Latin1, and a display name or note in
 * settings could hold anything. `encodeURIComponent`/`decodeURIComponent` round-trip
 * arbitrary text through the Latin1-only `btoa`/`atob` pair without a text-encoder
 * dependency.
 */
function toBase64Url(json: string): string {
  const base64 = btoa(
    encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))),
  );
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const percentEncoded = Array.from(binary, (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join('');
  return decodeURIComponent(percentEncoded);
}

/** Encodes birth data plus chart settings as URL query parameters, versioned. */
export function encodeChartShareLink(data: ChartShareData): URLSearchParams {
  const params = encodeBirthMoment(data.moment);
  params.set('v', String(CURRENT_VERSION));
  if (!data.housesKnown) params.set('hk', '0');
  if (Object.keys(data.settings).length > 0) params.set('cs', toBase64Url(JSON.stringify(data.settings)));
  return params;
}

/** Decodes a share link produced by {@link encodeChartShareLink}, or throws {@link ChartShareLinkError}. */
export function decodeChartShareLink(params: URLSearchParams): ChartShareData {
  const rawVersion = params.get('v');
  // Absent `v` is treated as version 1 rather than rejected: a moment-only link (e.g. one
  // copied from `#/time` before this feature existed) still has no `v` and is exactly a
  // version-1 link with no settings.
  const version = rawVersion === null ? 1 : Number(rawVersion);
  if (!Number.isInteger(version) || version < 1) {
    throw new ChartShareLinkError(`\`v\` must be a positive whole number, not "${rawVersion ?? ''}".`);
  }
  if (version > CURRENT_VERSION) {
    throw new ChartShareLinkError(
      `This link was made by a newer version of Astraya (format v${String(version)}) than this one understands (v${String(CURRENT_VERSION)}). Open it in an up-to-date copy of the app.`,
    );
  }

  const moment = decodeBirthMoment(params);
  const housesKnown = params.get('hk') !== '0';

  const rawSettings = params.get('cs');
  if (rawSettings === null || rawSettings === '') return { moment, settings: {}, housesKnown };

  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(rawSettings));
  } catch {
    throw new ChartShareLinkError('`cs` is not readable chart settings.');
  }
  if (!isSettingsRecord(parsed)) throw new ChartShareLinkError('`cs` must decode to a settings object.');
  return { moment, settings: parsed, housesKnown };
}
