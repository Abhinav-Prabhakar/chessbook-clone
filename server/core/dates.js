/**
 * Date helpers.
 *
 * Every timestamp is stored as an ISO-8601 UTC string
 * (`YYYY-MM-DDTHH:mm:ss.sssZ`). Never store local time, never compare raw
 * strings: use `Date.parse`/`julianday()` so offsets and formats cannot break
 * scheduling (audit D206).
 */

export const nowIso = () => new Date().toISOString();

/** Parse anything Date understands and normalise it, or return null. */
export function toIso(value) {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function plusDays(n, from = Date.now()) {
  return new Date(from + n * 86_400_000).toISOString();
}

export function plusMinutes(n, from = Date.now()) {
  return new Date(from + n * 60_000).toISOString();
}

export function isDue(iso, reference = nowIso()) {
  if (!iso) return false;
  const due = Date.parse(iso);
  const ref = Date.parse(reference);
  return Number.isFinite(due) && Number.isFinite(ref) && due <= ref;
}

/**
 * JS `getTimezoneOffset()` convention: minutes UTC - local.
 * (IST = -330.) Accepts `tzOffset` query/body values so a browser in any
 * timezone gets the same streak the user sees.
 */
export const systemOffset = () => new Date().getTimezoneOffset();

export function parseOffset(value) {
  if (value == null || value === "") return systemOffset();
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= 14 * 60 ? Math.trunc(n) : systemOffset();
}

/** Local calendar day (`YYYY-MM-DD`) for an instant in the given offset. */
export function localDay(iso, offset = systemOffset()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t - offset * 60_000).toISOString().slice(0, 10);
}

export function todayLocal(offset = systemOffset()) {
  return localDay(nowIso(), offset);
}

export function shiftDay(day, delta) {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Current/highest streak and the last day practised.
 *
 * A streak that ended yesterday is still alive: it is only broken after a
 * full missed day. This is the fix for D028, where any day without practice
 * reset the counter to zero.
 */
export function computeStreak(days, offset = systemOffset(), today = todayLocal(offset)) {
  const unique = [...new Set(days.filter(Boolean))].sort();
  const set = new Set(unique);

  let current = 0;
  const anchor = set.has(today)
    ? today
    : set.has(shiftDay(today, -1))
      ? shiftDay(today, -1)
      : null;
  if (anchor) {
    let day = anchor;
    while (set.has(day)) {
      current += 1;
      day = shiftDay(day, -1);
    }
  }

  let highest = 0;
  let run = 0;
  let previous = null;
  for (const day of unique) {
    run = previous && shiftDay(previous, 1) === day ? run + 1 : 1;
    highest = Math.max(highest, run);
    previous = day;
  }

  return {
    current,
    highest,
    lastStreakDate: unique.length ? unique[unique.length - 1] : null,
    today,
  };
}
