/**
 * Authentication utilities: JWT signing/verification, cookie management, session enforcement
 */

import jwt from "jsonwebtoken";
import { parse } from "cookie";
import { randomBytes, createHash } from "crypto";
import { getConfig, validateConfig } from "../config.js";

/**
 * Create a JWT token for a user
 */
export function signToken(userId) {
  const secret = getConfig("auth.jwtSecret");
  const expiresIn = getConfig("auth.jwtExpiresIn");

  return jwt.sign({ userId }, secret, { expiresIn });
}

/**
 * Verify a JWT token and extract the userId
 */
export function verifyToken(token) {
  const secret = getConfig("auth.jwtSecret");

  try {
    return jwt.verify(token, secret);
  } catch (error) {
    return null;
  }
}

/**
 * Extract JWT from httpOnly cookie in request headers
 */
export function getTokenFromRequest(req) {
  const cookieName = getConfig("auth.cookieName");
  const cookies = parse(req.headers.cookie || "");
  return cookies[cookieName];
}

/**
 * Extract userId from request (requires valid token)
 */
export function getUserIdFromRequest(req) {
  const token = getTokenFromRequest(req);
  if (!token) return null;

  const decoded = verifyToken(token);
  return decoded?.userId || null;
}

/**
 * Middleware: require authentication on a request
 * Returns userId if valid, throws 401 if not
 */
export function requireAuth(req) {
  const userId = getUserIdFromRequest(req);

  if (!userId) {
    const error = new Error("Unauthorized");
    error.status = 401;
    throw error;
  }

  return userId;
}

/**
 * Format a Set-Cookie header for setting JWT in httpOnly cookie
 */
export function setCookieHeader(token) {
  const cookieName = getConfig("auth.cookieName");
  const options = getConfig("auth.cookieOptions");

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

/**
 * Validate password meets requirements
 */
export function validatePassword(password) {
  const minLength = getConfig("auth.passwordMinLength");

  if (password.length < minLength) {
    return {
      valid: false,
      error: `Password must be at least ${minLength} characters`,
    };
  }

  return { valid: true };
}
