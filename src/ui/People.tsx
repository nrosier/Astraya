/**
 * The person selector and creation flow (#82).
 *
 * A person is the primary entity: charts belong to people, not the other way round. So this
 * is the app's front door once there is anything stored, and the thing it must never do is
 * make a person's birth data look more complete than it is — a name with no birth moment is
 * listed as exactly that, because a chart cannot be cast from it.
 */
import { useState } from 'react';
import { newId } from '../domain/id.js';
import { useLocale } from './locale.js';
import { useMessages } from './messages.js';
import { caveated, ordered, summary } from './people-list.js';
import { peopleMessages } from './People.messages.js';
import { sharedMessages } from './shared.messages.js';
import { useStore, useStoreState } from './store-context.js';

export function People(): React.JSX.Element {
  const store = useStore();
  const state = useStoreState();
  const [locale] = useLocale();
  const t = useMessages(peopleMessages);
  const shared = useMessages(sharedMessages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const people = ordered(state.people);

  const create = (): void => {
    setBusy(true);
    setError(undefined);
    const id = newId('p');
    // Created with nothing but an id, then edited. The alternative — a modal that refuses to
    // create until every field is valid — loses whatever the user had typed if they close it,
    // and there is nothing wrong with a person whose birth data has not arrived yet.
    void store
      .mutate([{ entity: 'person', entityId: id, field: 'displayName', value: '' }])
      .then(() => {
        window.location.hash = `#/person/${id}`;
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const restore = (id: string): void => {
    void store.restore('person', id).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  const purge = (id: string, name: string): void => {
    // Confirmed here rather than left to a second screen: purge has no undo, unlike every
    // other action this page offers, so the warning has to land before the store call, not
    // instead of it.
    if (!window.confirm(t.confirmDelete(name))) return;
    void store.purge('person', id).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  return (
    <main className="shell">
      <p className="back">
        <a href="#/">&larr; {shared.back}</a>
      </p>
      <h1>{t.heading}</h1>
      <p className="tagline">{t.tagline}</p>

      {error !== undefined && (
        <p className="warning" role="alert">
          {t.saveFailed} {error}
        </p>
      )}

      <p>
        <button type="button" onClick={create} disabled={busy}>
          {t.addPerson}
        </button>
      </p>

      {people.length === 0 ? (
        <p className="empty">{t.empty}</p>
      ) : (
        <ul className="people">
          {people.map((person) => (
            <li key={person.id}>
              <a className="person" href={`#/person/${person.id}`}>
                <span className={person.displayName === '' ? 'name unnamed' : 'name'}>
                  {person.displayName === '' ? t.unnamed : person.displayName}
                </span>
                <span className={person.moment === undefined ? 'summary incomplete' : 'summary'}>
                  {summary(person, locale)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {people.some(caveated) && (
        <p className="hint">
          {t.hintPrefix} <code>?</code> {t.hintSuffix}
        </p>
      )}

      {state.deleted.people.size > 0 && (
        <section className="deleted">
          <h2>{t.deletedHeading}</h2>
          {/* Deletes are tombstones, so "deleted" is a state a person can come back from.
              Showing them is the whole benefit of not having actually removed anything —
              and the fold materialises them, so each row can say who it is. */}
          <ul className="people">
            {ordered(state.deleted.people).map((person) => (
              <li key={person.id}>
                <span className="person">
                  <span className="name">{person.displayName === '' ? t.unnamed : person.displayName}</span>
                  <span className="summary">{summary(person, locale)}</span>
                </span>
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    restore(person.id);
                  }}
                >
                  {t.restore}
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    purge(person.id, person.displayName === '' ? t.unnamedPersonPlaceholder : person.displayName);
                  }}
                >
                  {t.deletePermanently}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
