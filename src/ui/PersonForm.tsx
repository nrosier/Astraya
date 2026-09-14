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
import { BirthPlaceMap } from './BirthPlaceMap.js';
import { useMessages } from './messages.js';
import { NEEDS_A_DECISION, PROVENANCE } from './moment-labels.js';
import { personFormMessages } from './PersonForm.messages.js';
import { PersonNotFound } from './PersonNotFound.js';
import { sharedMessages } from './shared.messages.js';
import { useStore, useStoreState } from './store-context.js';
import type { Calendar } from '../time/types.js';
import type { TimeAccuracy } from '../domain/person.js';

function accuracyOptions(t: typeof personFormMessages.en): Record<TimeAccuracy, string> {
  return {
    recorded: t.accuracyRecorded,
    remembered: t.accuracyRemembered,
    approximate: t.accuracyApproximate,
    unknown: t.accuracyUnknown,
  };
}

export function PersonForm({ personId }: { personId: string }): React.JSX.Element {
  const store = useStore();
  const state = useStoreState();
  const person = state.people.get(personId);
  const t = useMessages(personFormMessages);
  const shared = useMessages(sharedMessages);

  // The stored person, as a draft, recomputed every render rather than memoized: until the user
  // edits a field, the form must keep tracking the store, so a sync pull that merges in a remote
  // edit while this form is open is not silently hidden behind a mount-time snapshot.
  const opened = person === undefined ? undefined : draftFrom(person);
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [saved, setSaved] = useState(false);

  if (person === undefined) {
    return <PersonNotFound />;
  }

  const current = draft ?? opened ?? draftFrom(person);
  const { errors, moment } = validateDraft(current);
  const resolved = moment === undefined ? undefined : resolveMoment(moment);

  // `onPick` below needs to update latitude and longitude together: two separate `set` calls in
  // the same handler would both close over this render's `current` and the second would clobber
  // the first's update with its own stale copy of the other field.
  const setFields = (patch: Partial<Draft>): void => {
    setSaved(false);
    setDraft({ ...current, ...patch });
  };

  const set = <K extends keyof Draft>(field: K, value: Draft[K]): void => {
    setFields({ [field]: value });
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
        <a href="#/people">&larr; {shared.people}</a>
      </p>
      <h1>{current.displayName.trim() === '' ? t.newPerson : current.displayName}</h1>
      <p className="tagline">{t.tagline}</p>

      {saveError !== undefined && (
        <p className="warning" role="alert">
          {t.saveFailed(saveError)}
        </p>
      )}

      <h2>{t.birthRecordHeading}</h2>

      <fieldset className="field-group">
        <legend>{t.whoLegend}</legend>
        <div className="field-grid">
          <label>
            {t.nameLabel}
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
            {t.placeOfBirthLabel}
            <input
              type="text"
              placeholder={t.placeOfBirthPlaceholder}
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
        <legend>{t.whenLegend}</legend>
        <div className="field-grid">
          <label>
            {t.dateLabel}
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
            {t.timeLabel}
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
            {t.timeKnownLabel}
            <select
              value={current.timeAccuracy}
              onChange={(event) => {
                set('timeAccuracy', event.target.value as TimeAccuracy);
              }}
            >
              {Object.entries(accuracyOptions(t)).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="field-group">
        <legend>{t.coordinatesLegend}</legend>
        <div className="field-grid">
          <label>
            {t.latitudeLabel}
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
            {t.longitudeLabel}
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
        <BirthPlaceMap
          latitude={moment?.coordinates.latitude}
          longitude={moment?.coordinates.longitude}
          onPick={(lat, lng) => {
            setFields({ latitude: String(lat), longitude: String(lng) });
          }}
        />
      </fieldset>

      <fieldset className="field-group">
        <legend>{t.calendarZoneLegend}</legend>
        <div className="field-grid">
          <label>
            {t.calendarLabel}
            <select
              value={current.calendar}
              onChange={(event) => {
                set('calendar', event.target.value as Calendar);
              }}
            >
              <option value="auto">{t.calendarAutomatic}</option>
              <option value="gregorian">{t.calendarGregorian}</option>
              <option value="julian">{t.calendarJulian}</option>
            </select>
          </label>
          <label>
            {t.utcOffsetOverrideLabel}
            <input
              type="number"
              step="any"
              placeholder={t.offsetOverridePlaceholder}
              value={current.offsetOverride}
              {...field('offsetOverride')}
              onChange={(event) => {
                set('offsetOverride', event.target.value);
              }}
            />
            <Error_ name="offsetOverride" />
          </label>
          <label>
            {t.timezoneOverrideLabel}
            <input
              type="text"
              placeholder={t.timezoneOverridePlaceholder}
              value={current.zoneOverride}
              onChange={(event) => {
                set('zoneOverride', event.target.value);
              }}
            />
          </label>
        </div>
        <p className="hint">{t.timezoneHint}</p>
      </fieldset>

      <fieldset className="field-group">
        <legend>{t.notesLegend}</legend>
        <label className="stacked">
          <span className="sr-only">{t.notesLabel}</span>
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
          <h2>{t.resolvedHeading}</h2>
          <dl>
            <dt>{t.utcOffsetLabel}</dt>
            <dd>{formatOffset(resolved.offsetMinutes)}</dd>
            <dt>{t.derivedFromLabel}</dt>
            <dd>{PROVENANCE[resolved.provenance]}</dd>
            <dt>{t.timezoneLabel}</dt>
            <dd>{resolved.zone ?? <span className="muted">{t.noneOffsetFromLongitude}</span>}</dd>
            <dt>{t.calendarResolvedLabel}</dt>
            <dd>{resolved.calendar === 'julian' ? t.calendarJulian : t.calendarGregorian}</dd>
            {resolved.alternativeOffsetMinutes.length > 0 && (
              <>
                <dt>{t.alsoValidLabel}</dt>
                <dd>{resolved.alternativeOffsetMinutes.map(formatOffset).join(', ')}</dd>
              </>
            )}
          </dl>

          {resolved.warnings.length > 0 && (
            <>
              <h2>{t.worthCheckingHeading}</h2>
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

          <p className="hint">{t.tzdbHint(resolved.tzdbFingerprint)}</p>
        </>
      )}

      {current.timeAccuracy === 'unknown' && <p className="hint">{t.unknownTimeHint}</p>}

      <p className="actions">
        <button type="button" onClick={save} disabled={saving || moment === undefined}>
          {saving ? t.saving : t.saveButton}
        </button>
        {saved && !saving && (
          <span className="status" role="status">
            {t.savedStatus}
          </span>
        )}
        {moment === undefined && (
          <span className="muted">
            {/* Why the button is disabled, next to the button. A disabled control with no
                explanation is the most common way a form wastes someone's afternoon. */}
            {t.fillFieldsHint}
          </span>
        )}
      </p>

      <h2>{t.deleteHeading}</h2>
      <p className="hint">{t.deleteHint}</p>
      <p>
        <button type="button" className="danger" onClick={remove}>
          {t.deleteButton(current.displayName.trim() === '' ? t.thisPerson : current.displayName)}
        </button>
      </p>
    </main>
  );
}
