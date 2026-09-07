/**
 * Record identifiers.
 *
 * Ids are generated on the device, never assigned by a server. That is forced by
 * local-first: a person created offline needs an id immediately, and it must not
 * change when it later syncs, because operations already reference it. So the id has
 * to be unique across devices that have never spoken to each other — which rules out
 * a counter and makes randomness the only option.
 *
 * 80 bits from the CSPRNG. Two devices would need on the order of 10^12 records before
 * a collision became likely, which is not a number this application will reach, and
 * the alternative — coordinating id assignment — would need a network.
 *
 * These are not secrets and must not be treated as unguessable capabilities: the
 * server authorises by user, not by id (#80).
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** A prefix, so an id is legible in a log line and a mistyped reference is obvious. */
export type IdPrefix = 'p' | 'c';

export function newId(prefix: IdPrefix): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  // Base32 over 5-bit groups. 80 bits divides evenly into 16 characters, which is why
  // the byte count is what it is: any size that did not divide by 5 would leave a
  // final character carrying fewer than 5 random bits, or need padding to hide it.
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 31] ?? '';
    }
  }
  return `${prefix}-${out}`;
}

const ID_PATTERN = /^[pc]-[a-z2-7]{16}$/;

/**
 * Is this one of our ids?
 *
 * Used to validate a reference read from the log, not to authorise anything. An id
 * from a newer client may use a prefix this build does not know, so the check is
 * deliberately about shape and not about the prefix meaning something here.
 */
export function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/**
 * Is this a reference to a person? To a chart?
 *
 * Shape and prefix only — whether the record exists is the fold's business, and a
 * reference to a person this device has not synced yet is normal rather than wrong.
 * They live here beside the prefixes they check, so there is one place that knows what
 * a person id looks like.
 */
export function isPersonId(value: unknown): value is string {
  return isId(value) && value.startsWith('p-');
}

export function isChartId(value: unknown): value is string {
  return isId(value) && value.startsWith('c-');
}
