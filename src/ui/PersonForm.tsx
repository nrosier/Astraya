/**
 * The birth-data form (#45).
 *
 * It absorbs M2's time-and-place panel rather than sitting beside it: the resolved offset,
 * where it came from, and every caveat are shown next to the fields that produced them, and
 * the user can overrule us. That was the point of building that panel first.
 *
 * All the rules live in `domain/person-form.ts`, so this component is only wiring: hold the
 * draft, show the errors, save the fields that changed. Nothing here decides what is valid.
 */
import { useState } from 'react';
import { draftFrom, draftToMutations, validateDraft, type Draft } from '../domain/person-form.js';
import { formatOffset, resolveMoment } from '../time/resolve.js';
import { NEEDS_A_DECISION, PROVENANCE } from './moment-labels.js';
import { useStore, useStoreState } from './store-context.js';
import type { Calendar } from '../time/types.js';
import type { TimeAccuracy } from '../domain/person.js';

const ACCURACY: Record<TimeAccuracy, string> = {
  recorded: 'Recorded — from a certificate or record',
  remembered: 'Remembered — someone’s recollection',
  approximate: 'Approximate — “around teatime”',
  unknown: 'Unknown — no time on record',
};

export function PersonForm({ personId }: { personId: string }): React.JSX.Element {
  const store = useStore();
  const state = useStoreState();
  const person = state.people.get(personId);

  // The stored person, as a draft, recomputed every render rather than memoized: until the user
  // edits a field, the form must keep tracking the store, so a sync pull that merges in a remote
  // edit while this form is open is not silently hidden behind a mount-time snapshot.
  const opened = person === undefined ? undefined : draftFrom(person);
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [saved, setSaved] = useState(false);

  if (person === undefined) {
    return (
      <main className="shell">
        <p className="back">
          <a href="#/people">&larr; People</a>
        </p>
        <h1>Not found</h1>
        <p>
          {/* Deleted or never here — and the store cannot tell the difference for an id it has
              no records for, so the message does not pretend to. */}
          There is no person with that id on this device. If they were deleted, they can be restored from the{' '}
          <a href="#/people">people list</a>.
        </p>
      </main>
    );
  }

  const current = draft ?? opened ?? draftFrom(person);
  const { errors, moment } = validateDraft(current);
  const resolved = moment === undefined ? undefined : resolveMoment(moment);

  const set = <K extends keyof Draft>(field: K, value: Draft[K]): void => {
    setSaved(false);
    setDraft({ ...current, [field]: value });
  };

  const save = (): void => {
    if (opened === undefined || moment === undefined) return;
    const mutations = draftToMutations(personId, current, opened);
    if (mutations.length === 0) {
      setSaved(true);
      return;
    }
    setSaving(true);
    setSaveError(undefined);
    void store
      .mutate(mutations)
      .then(() => {
        setSaved(true);
        // The draft is deliberately not reset to the stored person here. The store's state is
        // already the authority, and re-deriving the draft would fight the user's cursor.
      })
      .catch((cause: unknown) => {
        setSaveError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const remove = (): void => {
    void store.remove('person', personId).then(
      () => {
        window.location.hash = '#/people';
      },
      (cause: unknown) => {
        setSaveError(cause instanceof Error ? cause.message : String(cause));
      },
    );
  };

  const field = (name: keyof Draft): { 'aria-invalid'?: true; 'aria-describedby'?: string } =>
    errors[name] === undefined ? {} : { 'aria-invalid': true, 'aria-describedby': `${name}-error` };

  const Error_ = ({ name }: { name: keyof Draft }): React.JSX.Element | null =>
    errors[name] === undefined ? null : (
      <span className="field-error" id={`${name}-error`}>
        {errors[name]}
      </span>
    );

  return (
    <main className="shell">
      <p className="back">
        <a href="#/people">&larr; People</a>
      </p>
      <h1>{current.displayName.trim() === '' ? 'New person' : current.displayName}</h1>
      <p className="tagline">
        A one-hour error moves the Ascendant about 15&deg;, so the resolved offset and how it was decided are shown
        below the fields that produced them.
      </p>

      {person.moment !== undefined && (
        <p>
          <a href={`#/chart/${personId}`}>View chart</a>
        </p>
      )}

      {saveError !== undefined && (
        <p className="warning" role="alert">
          That did not save, so nothing was changed. {saveError}
        </p>
      )}

      <h2>Birth record</h2>

      <fieldset className="field-group">
        <legend>Who</legend>
        <div className="field-grid">
          <label>
            Name
            <input
              type="text"
              value={current.displayName}
              {...field('displayName')}
              onChange={(event) => {
                set('displayName', event.target.value);
              }}
            />
            <Error_ name="displayName" />
          </label>
          <label>
            Place of birth
            <input
              type="text"
              placeholder="Vevay, Indiana"
              value={current.placeLabel}
              onChange={(event) => {
                set('placeLabel', event.target.value);
              }}
            />
            {/* A label, not a lookup: there is no geocoding, so the coordinates below are what
                the calculation uses and this text is only for the reader. */}
          </label>
        </div>
      </fieldset>

      <fieldset className="field-group">
        <legend>When</legend>
        <div className="field-grid">
          <label>
            Date
            <input
              type="date"
              value={current.date}
              {...field('date')}
              onChange={(event) => {
                set('date', event.target.value);
              }}
            />
            <Error_ name="date" />
          </label>
          <label>
            Time
            <input
              type="time"
              step={1}
              value={current.time}
              disabled={current.timeAccuracy === 'unknown'}
              {...field('time')}
              onChange={(event) => {
                set('time', event.target.value);
              }}
            />
            <Error_ name="time" />
          </label>
          <label>
            How the time is known
            <select
              value={current.timeAccuracy}
              onChange={(event) => {
                set('timeAccuracy', event.target.value as TimeAccuracy);
              }}
            >
              {Object.entries(ACCURACY).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="field-group">
        <legend>Coordinates</legend>
        <div className="field-grid">
          <label>
            Latitude
            <input
              type="number"
              step="any"
              inputMode="decimal"
              placeholder="38.7478"
              value={current.latitude}
              {...field('latitude')}
              onChange={(event) => {
                // The raw text, not `valueAsNumber`: a half-typed "-" is a work in progress, and
                // reading it as a number would turn it into a coordinate of zero.
                set('latitude', event.target.value);
              }}
            />
            <Error_ name="latitude" />
          </label>
          <label>
            Longitude
            <input
              type="number"
              step="any"
              inputMode="decimal"
              placeholder="-85.0672"
              value={current.longitude}
              {...field('longitude')}
              onChange={(event) => {
                set('longitude', event.target.value);
              }}
            />
            <Error_ name="longitude" />
          </label>
        </div>
      </fieldset>

      <fieldset className="field-group">
        <legend>Calendar &amp; time zone</legend>
        <div className="field-grid">
          <label>
            Calendar
            <select
              value={current.calendar}
              onChange={(event) => {
                set('calendar', event.target.value as Calendar);
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
              value={current.offsetOverride}
              {...field('offsetOverride')}
              onChange={(event) => {
                set('offsetOverride', event.target.value);
              }}
            />
            <Error_ name="offsetOverride" />
          </label>
          <label>
            Timezone override
            <input
              type="text"
              placeholder="America/Indiana/Vevay"
              value={current.zoneOverride}
              onChange={(event) => {
                set('zoneOverride', event.target.value);
              }}
            />
          </label>
        </div>
        <p className="hint">
          Leave the override empty to use the timezone database. Enter it in minutes east of UTC &mdash; a birth
          certificate that states the offset beats any lookup we can do, and 0 means UTC rather than &ldquo;no
          override&rdquo;.
        </p>
      </fieldset>

      <fieldset className="field-group">
        <legend>Notes</legend>
        <label className="stacked">
          <span className="sr-only">Notes</span>
          <textarea
            rows={3}
            value={current.notes}
            onChange={(event) => {
              set('notes', event.target.value);
            }}
          />
        </label>
      </fieldset>

      {resolved !== undefined && (
        <>
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

          <p className="hint">
            Resolved against timezone data <code>{resolved.tzdbFingerprint}</code>, which is stored with the record so a
            saved chart does not move when a timezone update ships.
          </p>
        </>
      )}

      {current.timeAccuracy === 'unknown' && (
        <p className="hint">
          With no birth time, houses, the Ascendant and the Midheaven cannot be calculated at all &mdash; they are not
          approximate, they are undefined. Planetary positions are still meaningful, and the Moon moves about 13&deg; a
          day, so its sign may be uncertain.
        </p>
      )}

      <p className="actions">
        <button type="button" onClick={save} disabled={saving || moment === undefined}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && !saving && (
          <span className="status" role="status">
            Saved on this device.
          </span>
        )}
        {moment === undefined && (
          <span className="muted">
            {/* Why the button is disabled, next to the button. A disabled control with no
                explanation is the most common way a form wastes someone's afternoon. */}
            Fill in the fields marked above to save.
          </span>
        )}
      </p>

      <h2>Delete</h2>
      <p className="hint">
        Deleting hides this person and their charts. Nothing is really removed, so it can be undone from the people
        list.
      </p>
      <p>
        <button type="button" className="danger" onClick={remove}>
          Delete {current.displayName.trim() === '' ? 'this person' : current.displayName}
        </button>
      </p>
    </main>
  );
}
