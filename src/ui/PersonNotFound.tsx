/**
 * The "no person with that id" screen shown when a route's personId doesn't resolve — the
 * same heading, paragraph and layout duplicated verbatim across every per-person view (#158).
 */
import { useMessages } from './messages.js';
import { sharedMessages } from './shared.messages.js';

export function PersonNotFound(): React.JSX.Element {
  const shared = useMessages(sharedMessages);
  return (
    <main className="shell">
      <p className="back">
        <a href="#/people">&larr; {shared.people}</a>
      </p>
      <h1>{shared.notFoundHeading}</h1>
      <p>
        {shared.notFoundBody} <a href="#/people">{shared.peopleList}</a>.
      </p>
    </main>
  );
}
