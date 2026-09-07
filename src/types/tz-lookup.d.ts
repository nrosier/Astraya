/**
 * `tz-lookup` ships no type declarations. It is a single CC0 function mapping a
 * coordinate to an IANA zone name using a compiled polygon table.
 */
declare module 'tz-lookup' {
  /**
   * IANA timezone name for a coordinate. Never throws: it snaps to the nearest
   * zone polygon rather than failing, so far-offshore points usually come back as
   * `Etc/GMT±N` but not always — measured, mid-Pacific (0, -150) returns
   * `Pacific/Kiritimati`, and coastal water returns the neighbouring country.
   */
  export default function tzlookup(latitude: number, longitude: number): string;
}
