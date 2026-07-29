/**
 * Small, dependency-free input validation helpers shared across API routes.
 * Rejecting malformed input here (before it reaches a DB query) avoids
 * leaking driver/DB-specific error messages to the client and avoids a
 * wasted round-trip for input that could never have matched anything.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Writes a 404 (not the more specific "invalid ID format") if the id isn't a
 * well-formed UUID, so callers can't distinguish "malformed ID" from "well-
 * formed ID that doesn't exist" - both look identical to the client, exactly
 * like a real not-found result would.
 */
export function requireValidUuidOr404(id, res, resourceName = "Resource") {
  if (!isValidUuid(id)) {
    res.status(404).json({ success: false, error: { message: `${resourceName} not found` } });
    return false;
  }
  return true;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a real calendar date in YYYY-MM-DD form, not just a string
 * matching the shape (e.g. "2026-02-30" fails - Date normalizes it to
 * March 2nd, which won't roundtrip back to the same string).
 */
export function isValidIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

let cachedTimezoneSet = null;

/**
 * True for a real IANA timezone name ("America/Los_Angeles"), not just any
 * string - this value is interpolated into a parameterized `AT TIME ZONE $n`
 * SQL clause, so while it can't inject SQL (it's a bound parameter, not
 * concatenated), an invalid zone name would still throw a Postgres error
 * that shouldn't reach the client. Cached after first call since
 * Intl.supportedValuesOf("timeZone") is a fixed list per Node process.
 */
export function isValidTimezone(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) return false;
  // "UTC" is a valid identifier Postgres's AT TIME ZONE accepts (and a
  // browser can legitimately report as its resolved zone), but it's not
  // part of Intl.supportedValuesOf("timeZone")'s IANA-only list - special-
  // cased rather than silently rejecting a value that would actually work.
  if (value === "UTC") return true;
  if (!cachedTimezoneSet) {
    cachedTimezoneSet = new Set(Intl.supportedValuesOf("timeZone"));
  }
  return cachedTimezoneSet.has(value);
}
