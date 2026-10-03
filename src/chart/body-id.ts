/**
 * How a body on a wheel is identified when more than one ring can hold it (#418): its key and its
 * ring, written `sun@1`. A bi-wheel draws the Sun in both rings, so the key alone is ambiguous; a
 * single wheel has only ring 0. Shared by the wheel's markup consumers and by the interpretation
 * lookup that reads a selection back.
 */

export function bodyId(key: string, ring: number | string): string {
  return `${key}@${String(ring)}`;
}

/** Splits `sun@1` into its key and ring; a bare key means ring 0. */
export function parseBodyId(id: string): { readonly key: string; readonly ring: number } {
  const at = id.lastIndexOf('@');
  if (at === -1) return { key: id, ring: 0 };
  const ring = Number(id.slice(at + 1));
  return { key: id.slice(0, at), ring: Number.isInteger(ring) && ring >= 0 ? ring : 0 };
}
