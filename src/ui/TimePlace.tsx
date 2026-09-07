/**
 * When and where — the panel that turns a birth record into an instant.
 *
 * This exists in M2, ahead of the person model and the chart, because it is where
 * charts go silently wrong. The whole design goal is that the app never presents a
 * resolved offset as more certain than it is: the offset, how it was derived, the
 * zone, and every caveat are on screen together, and the user can overrule us.
 *
 * The full birth-data form arrives in M3 once there is a store to hold people. This
 * panel is what that form will absorb.
 */
import { useEffect, useMemo, useState } from 'react';
import { decodeBirthMoment, encodeBirthMoment } from '../time/encode.js';
import { formatOffset, resolveMoment } from '../time/resolve.js';
import type { BirthMomentInput, Calendar, ResolvedMoment, TimeWarningCode } from '../time/types.js';

/** Provenance in the user's words, not ours. */
const PROVENANCE: Record<ResolvedMoment['provenance'], string> = {
  manual: 'the offset you entered',
  tzdb: 'the timezone database, for this date',
  lmt: 'Local Mean Time from the longitude',
};

/** Which warnings deserve a stronger presentation than the rest. */
const NEEDS_A_DECISION: readonly TimeWarningCode[] = ['ambiguous-local-time', 'nonexistent-local-time'];

const DEFAULT: BirthMomentInput = {
  // A deliberately awkward default: Vevay is the county whose zone lookup this
  // project measured getting wrong, so the panel opens showing its own limitation
  // rather than a case that flatters it.
  civil: { year: 1960, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
  coordinates: { latitude: 38.7478, longitude: -85.0672 },
};

/** Read the moment from the URL query, falling back to the default. */
function fromLocation(): { input: BirthMomentInput; error?: string } {
  const query = window.location.hash.split('?')[1] ?? '';
  if (query === '') return { input: DEFAULT };
  try {
    return { input: decodeBirthMoment(new URLSearchParams(query)) };
  } catch (error) {
    // A bad link must say so. Rendering a chart from a silently repaired link is
    // exactly the failure this project exists to avoid.
    return { input: DEFAULT, error: error instanceof Error ? error.message : String(error) };
  }
}

export function TimePlace(): React.JSX.Element {
  const initial = useMemo(fromLocation, []);
  const [input, setInput] = useState<BirthMomentInput>(initial.input);
  const [linkError, setLinkError] = useState(initial.error);

  // The URL is the shareable record of what is on screen, so it tracks the form.
  // `replaceState` rather than a hash assignment: every keystroke should not become
  // a back-button step.
  useEffect(() => {
    const query = encodeBirthMoment(input).toString();
    window.history.replaceState(null, '', `#/time?${query}`);
  }, [input]);

  const resolved = useMemo(() => resolveMoment(input), [input]);

  const setCoordinate = (field: 'latitude' | 'longitude', value: number): void => {
    setLinkError(undefined);
    setInput((previous) => ({ ...previous, coordinates: { ...previous.coordinates, [field]: value } }));
  };

  const overrideValue = input.offsetOverrideMinutes;
  const setOverride = (raw: string): void => {
    setLinkError(undefined);
    setInput((previous) => {
      // An empty field means "no override", which is not the same as an override of
      // zero — zero is UTC. So the property is rebuilt away rather than set to 0, and
      // rebuilt rather than `delete`d because the input type is readonly throughout.
      const { civil, coordinates, calendar, zoneOverride } = previous;
      const rest: BirthMomentInput = {
        civil,
        coordinates,
        ...(calendar === undefined ? {} : { calendar }),
        ...(zoneOverride === undefined ? {} : { zoneOverride }),
      };
      if (raw.trim() === '') return rest;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? { ...rest, offsetOverrideMinutes: parsed } : rest;
    });
  };

  const setCalendar = (value: Calendar): void => {
    setInput((previous) => ({ ...previous, calendar: value }));
  };

  return (
    <main className="shell">
      <p className="back">
        <a href="#/">&larr; Back</a>
      </p>
      <h1>When and where</h1>
      <p className="tagline">
        A one-hour error moves the Ascendant about 15&deg;. This panel shows how the offset was decided, so you can
        catch us being wrong.
      </p>

      {linkError !== undefined && (
        <p className="warning" role="alert">
          That link could not be read, so the form below is showing the default instead. {linkError}
        </p>
      )}

      <h2>Birth record</h2>
      <div className="field-grid">
        <label>
          Date
          <input
            type="date"
            value={`${String(input.civil.year).padStart(4, '0')}-${String(input.civil.month).padStart(2, '0')}-${String(input.civil.day).padStart(2, '0')}`}
            onChange={(event) => {
              const [y, m, d] = event.target.value.split('-').map(Number);
              if (y === undefined || m === undefined || d === undefined) return;
              setInput((previous) => ({ ...previous, civil: { ...previous.civil, year: y, month: m, day: d } }));
            }}
          />
        </label>
        <label>
          Time
          <input
            type="time"
            step={1}
            value={`${String(input.civil.hour).padStart(2, '0')}:${String(input.civil.minute).padStart(2, '0')}:${String(input.civil.second).padStart(2, '0')}`}
            onChange={(event) => {
              const [h, mi, s] = event.target.value.split(':').map(Number);
              if (h === undefined || mi === undefined) return;
              setInput((previous) => ({
                ...previous,
                civil: { ...previous.civil, hour: h, minute: mi, second: s ?? 0 },
              }));
            }}
          />
        </label>
        <label>
          Latitude
          <input
            type="number"
            step="any"
            min={-90}
            max={90}
            value={input.coordinates.latitude}
            onChange={(event) => {
              setCoordinate('latitude', event.target.valueAsNumber);
            }}
          />
        </label>
        <label>
          Longitude
          <input
            type="number"
            step="any"
            min={-180}
            max={180}
            value={input.coordinates.longitude}
            onChange={(event) => {
              setCoordinate('longitude', event.target.valueAsNumber);
            }}
          />
        </label>
        <label>
          Calendar
          <select
            value={input.calendar ?? 'auto'}
            onChange={(event) => {
              setCalendar(event.target.value as Calendar);
            }}
          >
            <option value="auto">Automatic</option>
            <option value="gregorian">Gregorian</option>
            <option value="julian">Julian</option>
          </select>
        </label>
        <label>
          UTC offset override
          <input
            type="number"
            step="any"
            placeholder="minutes, e.g. -300"
            value={overrideValue ?? ''}
            onChange={(event) => {
              setOverride(event.target.value);
            }}
          />
        </label>
      </div>
      <p className="hint">
        Leave the override empty to use the timezone database. Enter it in minutes east of UTC &mdash; a birth
        certificate that states the offset beats any lookup we can do, and 0 means UTC rather than &ldquo;no
        override&rdquo;.
      </p>

      <h2>Resolved</h2>
      <dl>
        <dt>UTC offset</dt>
        <dd>{formatOffset(resolved.offsetMinutes)}</dd>
        <dt>Derived from</dt>
        <dd>{PROVENANCE[resolved.provenance]}</dd>
        <dt>Timezone</dt>
        <dd>
          {resolved.zone ?? <span className="muted">none &mdash; the offset came from longitude or from you</span>}
        </dd>
        <dt>Calendar</dt>
        <dd>{resolved.calendar === 'julian' ? 'Julian' : 'Gregorian'}</dd>
        {resolved.alternativeOffsetMinutes.length > 0 && (
          <>
            <dt>Also valid</dt>
            <dd>{resolved.alternativeOffsetMinutes.map(formatOffset).join(', ')}</dd>
          </>
        )}
      </dl>

      {resolved.warnings.length > 0 && (
        <>
          <h2>Worth checking</h2>
          <ul className="warnings">
            {resolved.warnings.map((warning) => (
              <li
                key={warning.code}
                className={NEEDS_A_DECISION.includes(warning.code) ? 'warning' : undefined}
                role={NEEDS_A_DECISION.includes(warning.code) ? 'alert' : undefined}
              >
                {warning.message}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Provenance</h2>
      <p className="hint">
        Resolved against timezone data <code>{resolved.tzdbFingerprint}</code>. Recorded because historical offsets are
        data, and the data changes &mdash; a saved chart should not move because a timezone update shipped.
      </p>
      <p className="hint">This address holds the whole record, so copying it from the bar shares exactly this chart.</p>
    </main>
  );
}
