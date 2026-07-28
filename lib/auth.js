/**
 * Authentication utilities: JWT signing/verification, cookie management, session enforcement
 */

import jwt from "jsonwebtoken";
// cookie@2.x renamed this export from `parse` to `parseCookie`.
import { parseCookie } from "cookie";
import { randomBytes, createHash } from "crypto";
import { getConfig, validateConfig } from "../config.js";
import { users } from "./db.js";

// Fails fast at serverless cold-start if a required secret (JWT_SECRET,
// DATABASE_URL, GROQ_API_KEY) is missing, instead of surfacing as an opaque
// error deep inside jwt.sign()/jwt.verify() on the first real request. Every
// API route imports this module (directly or via requireAuth), so this runs
// once per cold start regardless of which endpoint is hit first.
validateConfig();

// Short-TTL in-memory cache for requireAuth's token_version check, so a
// burst of authenticated calls from one user action (e.g. creating an entry
// immediately triggers a second call to extract insights from it) doesn't
// pay a full DB round-trip on every single call. Module-level state persists
// across invocations on the same warm serverless container (see
// validateConfig() above for the same pattern already in use here), so this
// is a best-effort win, not a guarantee - a cold start or a request landing
// on a different warm container always falls through to the DB, which stays
// the source of truth.
//
// TTL is intentionally short (20s): the only thing this delays is how fast a
// password reset revokes OTHER already-issued tokens, and tokens here already
// live up to 30 days with no revocation at all if this whole check didn't
// exist - 20s of extra staleness on top of that is a rounding error, not a
// meaningful security regression, for this app's threat model.
const TOKEN_VERSION_CACHE_TTL_MS = 20 * 1000;
const tokenVersionCache = new Map(); // userId -> { version, expiresAt }

async function getCachedTokenVersion(userId) {
  const cached = tokenVersionCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.version;
  }

  const version = await users.getTokenVersion(userId);
  if (version !== null) {
    tokenVersionCache.set(userId, { version, expiresAt: Date.now() + TOKEN_VERSION_CACHE_TTL_MS });
  } else {
    tokenVersionCache.delete(userId);
  }
  return version;
}

/**
 * Drops this container's cached token_version for a user immediately after
 * it changes (currently only password reset bumps it). Purely an
 * optimization for whichever container happens to handle the reset itself -
 * every OTHER warm container still only learns of the change once its own
 * cache entry expires (within TOKEN_VERSION_CACHE_TTL_MS), same as before.
 */
export function invalidateTokenVersionCache(userId) {
  tokenVersionCache.delete(userId);
}

/**
 * Create a JWT token for a user. Pass rememberMe to issue a long-lived (30d)
 * token instead of the default short-lived one backing the session cookie.
 * tokenVersion is embedded so a later password reset (which bumps the user's
 * stored token_version) invalidates this token immediately, rather than
 * leaving it valid until its own natural expiry. Every new token also gets
 * an explicit alg/iss/aud - see verifyToken() for how those are checked.
 */
export function signToken(userId, { rememberMe = false, tokenVersion = 0 } = {}) {
  const secret = getConfig("auth.jwtSecret");
  const expiresIn = getConfig(rememberMe ? "auth.jwtExpiresInRememberMe" : "auth.jwtExpiresIn");

  return jwt.sign({ userId, tokenVersion }, secret, {
    expiresIn,
    algorithm: getConfig("auth.jwtAlgorithm"),
    issuer: getConfig("auth.jwtIssuer"),
    audience: getConfig("auth.jwtAudience"),
  });
}

/**
 * Verify a JWT token and extract the payload (userId, tokenVersion).
 *
 * `algorithms` is passed explicitly (not left to the library default) to
 * close the classic "algorithm confusion" hole: without an allowlist, a
 * verifier can be tricked into accepting a token signed with a different or
 * weaker algorithm than the one the app actually uses. Locking verify() to
 * exactly the algorithm sign() uses means a token can only ever be valid if
 * it was produced the one intended way.
 *
 * issuer/audience are checked leniently, not required, so tokens issued
 * before these claims existed (up to 30 days old, for "remember me"
 * sessions) keep working until they naturally expire or get reissued,
 * instead of forcing every logged-in user out immediately. Once a token DOES
 * carry iss/aud (all newly signed ones do), it's validated strictly - a
 * token claiming the wrong issuer/audience is rejected even if the
 * signature itself is valid.
 */
export function verifyToken(token) {
  const secret = getConfig("auth.jwtSecret");

  try {
    const decoded = jwt.decode(token, { complete: true });
    const verifyOptions = { algorithms: [getConfig("auth.jwtAlgorithm")] };
    if (decoded?.payload?.iss !== undefined) verifyOptions.issuer = getConfig("auth.jwtIssuer");
    if (decoded?.payload?.aud !== undefined) verifyOptions.audience = getConfig("auth.jwtAudience");

    return jwt.verify(token, secret, verifyOptions);
  } catch (error) {
    return null;
  }
}

/**
 * Extract JWT from httpOnly cookie in request headers
 */
export function getTokenFromRequest(req) {
  const cookieName = getConfig("auth.cookieName");
  const cookies = parseCookie(req.headers.cookie || "");
  return cookies[cookieName];
}

/**
 * Extract the decoded token payload from a request (requires valid,
 * unexpired token), or null. Does NOT check tokenVersion against the DB -
 * callers that need revocation enforcement should use requireAuth, which does.
 */
export function getTokenPayloadFromRequest(req) {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  return verifyToken(token);
}

/**
 * Extract userId from request (requires valid token). Does not check
 * tokenVersion - see requireAuth for the revocation-aware version used by
 * every authenticated API route.
 */
export function getUserIdFromRequest(req) {
  return getTokenPayloadFromRequest(req)?.userId || null;
}

/**
 * Middleware: require authentication on a request. Verifies the JWT itself,
 * then checks its embedded tokenVersion against the user's current
 * token_version (via the short-TTL cache above) - a password reset bumps
 * that column, which invalidates every other token in circulation for that
 * user within TOKEN_VERSION_CACHE_TTL_MS, even though they haven't naturally
 * expired yet. Returns userId if valid, throws 401 if not.
 */
export async function requireAuth(req) {
  const payload = getTokenPayloadFromRequest(req);
  const userId = payload?.userId;

  if (!userId) {
    const error = new Error("Unauthorized");
    error.status = 401;
    throw error;
  }

  const currentVersion = await getCachedTokenVersion(userId);
  if (currentVersion === null || (payload.tokenVersion || 0) !== currentVersion) {
    const error = new Error("Session expired, please sign in again");
    error.status = 401;
    throw error;
  }

  return userId;
}

/**
 * Format a Set-Cookie header for setting JWT in httpOnly cookie. Pass rememberMe
 * to issue a persistent 30-day cookie instead of the default session-only one
 * (no Max-Age, cleared when the browser closes).
 */
export function setCookieHeader(token, { rememberMe = false } = {}) {
  const cookieName = getConfig("auth.cookieName");
  const options = getConfig(rememberMe ? "auth.cookieOptionsRememberMe" : "auth.cookieOptions");

  let cookieStr = `${cookieName}=${token}`;
  if (options.httpOnly) cookieStr += "; HttpOnly";
  if (options.secure) cookieStr += "; Secure";
  if (options.sameSite) cookieStr += `; SameSite=${options.sameSite}`;
  if (options.maxAge) cookieStr += `; Max-Age=${Math.floor(options.maxAge / 1000)}`;
  cookieStr += "; Path=/";

  return cookieStr;
}

/**
 * Format a Set-Cookie header to clear the session cookie
 */
export function clearCookieHeader() {
  const cookieName = getConfig("auth.cookieName");
  return `${cookieName}=; HttpOnly; Max-Age=0; Path=/`;
}

/**
 * Hash a password using bcryptjs (server-side only, never in browser)
 */
export async function hashPassword(password) {
  try {
    // Dynamic import to handle Node.js environment
    const bcrypt = (await import("bcryptjs")).default;
    return await bcrypt.hash(password, 10);
  } catch (error) {
    throw new Error(`Password hashing failed: ${error.message}`);
  }
}

/**
 * Compare a plain password with a hash
 */
export async function comparePassword(password, hash) {
  try {
    const bcrypt = (await import("bcryptjs")).default;
    return await bcrypt.compare(password, hash);
  } catch (error) {
    throw new Error(`Password comparison failed: ${error.message}`);
  }
}

/**
 * Generate a password-reset token. The raw token goes in the emailed link;
 * only its hash is stored, so a leaked database never exposes usable tokens.
 */
export function generateResetToken() {
  const rawToken = randomBytes(32).toString("hex");
  return { rawToken, tokenHash: hashResetToken(rawToken) };
}

export function hashResetToken(rawToken) {
  return createHash("sha256").update(rawToken).digest("hex");
}

// A small denylist of the most common/breached passwords that would
// otherwise pass a length-only check. Deliberately NOT enforcing composition
// rules (uppercase/digit/symbol) - current NIST guidance (SP 800-63B) is
// that mandatory complexity rules push users toward predictable patterns
// ("Password1!") without meaningfully improving security, and recommends
// length + a breached/common-password check instead.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwertyuiop", "letmein123", "welcome123", "iloveyou1", "admin1234", "changeme",
  "trustno1", "abc12345", "qwerty123",
]);

/**
 * Validate password meets requirements
 */
export function validatePassword(password) {
  const minLength = getConfig("auth.passwordMinLength");

  if (typeof password !== "string" || password.length < minLength) {
    return {
      valid: false,
      error: `Password must be at least ${minLength} characters`,
    };
  }

  // Deliberately not length-limited beyond a sanity ceiling - bcrypt itself
  // silently truncates at 72 bytes, so anything longer is accepted but
  // wasted; reject clearly-absurd input instead of quietly ignoring it.
  if (password.length > 256) {
    return { valid: false, error: "Password must be 256 characters or fewer" };
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { valid: false, error: "This password is too common, please choose another" };
  }

  return { valid: true };
}
