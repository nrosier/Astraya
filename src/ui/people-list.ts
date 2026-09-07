/**
 * How a person reads in a list.
 *
 * Kept out of the component so it can be tested directly: the one thing this must never do
 * is make a record look more complete than it is. A row that shows a name and a date, when
 * the coordinates are missing, invites the user to expect a chart that cannot be cast.
 */
import { formatOffset, resolveMoment } from '../time/resolve.js';
import type { Person } from '../domain/person.js';

/** Sorted by name, with the unnamed last: an empty name sorts before everything otherwise. */
export function ordered(people: ReadonlyMap<string, Person>): readonly Person[] {
  return [...people.values()].sort((a, b) => {
    if (a.displayName === '') return b.displayName === '' ? 0 : 1;
    if (b.displayName === '') return -1;
    // `localeCompare`, not `<`: a list of names sorted by code point puts every accented
    // name after Z, which is wrong in every language that has them.
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * Did resolving this person's moment raise anything?
 *
 * Exported so the list can explain its own flag: a bare `?` next to an offset is a
 * decoration until something on the page says what it means.
 */
export function caveated(person: Person): boolean {
  return person.moment !== undefined && resolveMoment(person.moment).warnings.length > 0;
}

/** One line saying what is on record, or what is not. */
export function summary(person: Person): string {
  if (person.moment === undefined) {
    // Naming the missing fields rather than saying "incomplete": the user is the only one who
    // can supply them, and they cannot do that without knowing which.
    const missing = person.missing.length > 0 ? person.missing.join(', ') : 'birth data';
    return `No chart yet — still needed: ${missing}`;
  }
  const { civil } = person.moment;
  const date = `${String(civil.year).padStart(4, '0')}-${String(civil.month).padStart(2, '0')}-${String(civil.day).padStart(2, '0')}`;
  // An unknown time is said, not shown as 00:00. Midnight is a real birth time, and
  // printing it for a record that has none would be inventing data.
  const time =
    person.timeAccuracy === 'unknown'
      ? 'time unknown'
      : `${String(civil.hour).padStart(2, '0')}:${String(civil.minute).padStart(2, '0')}`;
  const resolved = resolveMoment(person.moment);
  const place = person.placeLabel === '' ? 'place not recorded' : person.placeLabel;
  // A row that prints an offset flatly presents it as settled. For a coordinate near a zone
  // boundary, an ambiguous hour or a pre-standard-time date it is not, and the list is where
  // the user decides which record to open. So the offset carries a flag when the resolution
  // had anything to say about it; the reasons themselves are on the form.
  const contested = resolved.warnings.length > 0 ? '?' : '';
  return `${date}, ${time} (${formatOffset(resolved.offsetMinutes)}${contested}) · ${place}`;
}
