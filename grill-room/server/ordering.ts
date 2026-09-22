/**
 * Shared helpers for turning a wall-clock timestamp into a total order.
 *
 * Timestamps in this app are ISO-8601 strings with millisecond precision,
 * written by application code (`new Date().toISOString()`). Two rows written
 * within the same millisecond tie, and an `ORDER BY` on that column alone
 * then returns them in whatever order the database feels like handing back —
 * which can differ between runs, and can reorder a list the user is already
 * looking at. `laterTimestamp` and `increasingTimestamps` are for the write
 * side: an operation that inserts or updates several rows whose relative
 * order is itself the fact being recorded (insertion order, "the most recent
 * one"), so the timestamps it writes should never tie in the first place.
 */

/**
 * A timestamp strictly later than every one of `previous` (nullish entries
 * ignored) and no earlier than `Date.now()`.
 */
export function laterTimestamp(
  ...previous: readonly (string | null | undefined)[]
): string {
  const previousMs = previous
    .map((iso) => (iso ? Date.parse(iso) : Number.NaN))
    .filter((ms) => Number.isFinite(ms));
  const latest = previousMs.length > 0 ? Math.max(...previousMs) : -Infinity;

  return new Date(Math.max(Date.now(), latest + 1)).toISOString();
}

/**
 * `count` strictly increasing timestamps starting no earlier than `seed`
 * (typically the operation's own "now"). For rows inserted together in one
 * operation where insertion order is the order that matters and no explicit
 * ordering column exists for it.
 */
export function increasingTimestamps(
  seed: string,
  count: number,
): string[] {
  const start = Date.parse(seed);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index).toISOString(),
  );
}
