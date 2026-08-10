/**
 * Constant-time string comparison for secrets (e.g. the cron bearer token) -
 * a plain !== leaks timing information byte-by-byte. Kept as its own tiny,
 * dependency-free module (rather than living in lib/auth.js) so routes that
 * only need this one check don't also pull in lib/auth.js's JWT/session
 * machinery and its validateConfig() cold-start requirements.
 */
import { timingSafeEqual } from "crypto";

export function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on unequal-length buffers, so length is checked
  // first; a length mismatch is safe to short-circuit on since it doesn't
  // reveal anything about the bytes of the real secret.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
