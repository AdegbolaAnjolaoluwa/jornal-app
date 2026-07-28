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
