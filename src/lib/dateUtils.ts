/**
 * Returns the LOCAL calendar date (YYYY-MM-DD) for the given Date.
 *
 * `new Date().toISOString().split('T')[0]` returns the UTC date, not the
 * device's local date. In timezones ahead of UTC (e.g. Addis Ababa, UTC+3),
 * anything done in the last few hours of the local day gets stamped with
 * tomorrow's date instead of today's. This helper fixes that by shifting
 * the timestamp by the device's timezone offset before formatting.
 */
export function getLocalDateString(d: Date = new Date()): string {
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().split('T')[0];
}
