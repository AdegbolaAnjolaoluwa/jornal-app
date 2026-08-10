/**
 * POST   /api/auth/login          - Authenticate a user and create a session
 * POST   /api/auth/logout         - Clear session cookie and end session
 * GET    /api/auth/me             - Get current user information (requires authentication)
 * POST   /api/auth/password-reset - Request a reset link ({ email }) or consume one ({ token, password })
 * POST   /api/auth/picture        - Upload the current user's profile picture (requires authentication)
 * PATCH  /api/auth/profile        - Update the current user's name/nickname, or mark onboarding complete (requires authentication)
 * POST   /api/auth/signup         - Create a new user account
 * DELETE /api/auth/delete-account - Permanently delete the current user's account and all their data (requires authentication)
 *
 * All auth routes are kept in this one file (dispatched by path below, via
 * the rewrites in vercel.json) rather than one file per route, to stay under
 * the Hobby-plan serverless function cap - the same pattern api/entries.js
 * already uses for its own sub-routes.
 */

import { users } from "../lib/db.js";
import {
  comparePassword,
  hashPassword,
  validatePassword,
  signToken,
  setCookieHeader,
  clearCookieHeader,
  requireAuth,
  generateResetToken,
  hashResetToken,
  invalidateTokenVersionCache,
} from "../lib/auth.js";
import { logSecurityEvent } from "../lib/securityLog.js";
import { sendPasswordResetEmail } from "../lib/email.js";
import { enforceRateLimit, enforceRateLimits, getClientIp } from "../lib/rateLimit.js";
import { isValidImage } from "../lib/fileSignature.js";
import url from "url";

// A fixed, pre-computed bcrypt hash of an arbitrary string that is not - and
// never was - any real user's password. Used only to give the "no such
// account" login path the same bcrypt-compare cost as the "wrong password"
// path, so response timing doesn't reveal whether an email is registered
// (SEC-001). Deliberately not derived from anything real, and never written
// to the database - it exists purely to burn CPU time equivalent to a real
// comparePassword() call.
const DUMMY_PASSWORD_HASH = "$2a$10$x3F4AAS7URso/ek.K6glXuk/BEv2U3kkGtk39crtopSMgObyAteHa";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_PICTURE_UPLOAD_BYTES = 1.5 * 1024 * 1024;
const ALLOWED_PICTURE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// Two limits per sensitive route: by IP (stops one attacker cycling through
// many target emails) and by the email/key being acted on (stops many IPs
// hammering one target - e.g. a botnet). Both must pass.
const LOGIN_IP_LIMIT = { maxAttempts: 20, windowMs: 15 * 60 * 1000 };
const LOGIN_EMAIL_LIMIT = { maxAttempts: 8, windowMs: 15 * 60 * 1000 };
const SIGNUP_IP_LIMIT = { maxAttempts: 10, windowMs: 60 * 60 * 1000 };
const RESET_IP_LIMIT = { maxAttempts: 10, windowMs: 60 * 60 * 1000 };
const RESET_EMAIL_LIMIT = { maxAttempts: 5, windowMs: 60 * 60 * 1000 };

export default async function handler(req, res) {
  const pathname = url.parse(req.url).pathname;
  const route = pathname.split("/").filter((p) => p)[2]; // /api/auth/:route

  switch (route) {
    case "login":
      return handleLogin(req, res);
    case "logout":
      return handleLogout(req, res);
    case "me":
      return handleMe(req, res);
    case "password-reset":
      return handlePasswordReset(req, res);
    case "picture":
      return handlePicture(req, res);
    case "profile":
      return handleProfile(req, res);
    case "signup":
      return handleSignup(req, res);
    case "delete-account":
      return handleDeleteAccount(req, res);
    default:
      return res.status(404).json({ success: false, error: { message: "Not found" } });
  }
}

async function handleLogin(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { password, rememberMe } = req.body;
    const email = req.body.email ? req.body.email.trim().toLowerCase() : req.body.email;

    if (!email || !password) {
      return res.status(422).json({
        success: false,
        error: {
          message: "Email and password are required",
          fields: {
            email: !email ? "Email is required" : null,
            password: !password ? "Password is required" : null,
          },
        },
      });
    }

    const clientIp = getClientIp(req);
    const rateLimited = await enforceRateLimits(req, res, [
      { bucket: "login-ip", key: clientIp, options: LOGIN_IP_LIMIT },
      { bucket: "login-email", key: email, options: LOGIN_EMAIL_LIMIT },
    ]);
    if (rateLimited) {
      logSecurityEvent("login_rate_limited", { email, ip: clientIp });
      return;
    }

    const user = await users.findByEmail(email);
    // Always run a bcrypt compare, real or dummy, before branching - doing
    // this only on the "user exists" path would let response timing reveal
    // whether an email is registered (SEC-001).
    const passwordMatch = await comparePassword(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);

    if (!user || !passwordMatch) {
      logSecurityEvent("login_failed", {
        email,
        ip: clientIp,
        userId: user?.id,
        reason: user ? "bad_password" : "no_such_account",
      });
      return res.status(401).json({
        success: false,
        error: { message: "Invalid email or password" },
      });
    }

    logSecurityEvent("login_success", { userId: user.id, email, ip: clientIp, rememberMe: rememberMe === true });
    const token = signToken(user.id, { rememberMe: rememberMe === true, tokenVersion: user.token_version || 0 });
    res.setHeader("Set-Cookie", setCookieHeader(token, { rememberMe: rememberMe === true }));

    return res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          onboardingCompletedAt: user.onboarding_completed_at,
        },
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({
      success: false,
      error: { message: "Login failed" },
    });
  }
}

async function handleLogout(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Set-Cookie", clearCookieHeader());

  return res.status(200).json({
    success: true,
    data: {
      message: "Logged out successfully",
    },
  });
}

async function handleDeleteAccount(req, res) {
  if (req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = await requireAuth(req);

    // Step-up confirmation: deleting an account is irreversible and
    // cascades everything, so it requires the current password regardless
    // of session type - a stolen long-lived "remember me" cookie alone
    // isn't enough to do this (SEC-004). Same generic failure message
    // whichever way it fails, so this can't be used to probe anything about
    // the account.
    const { password } = req.body || {};
    if (!password) {
      return res.status(422).json({
        success: false,
        error: { message: "Password is required to delete your account" },
      });
    }
    const record = await users.getPasswordHash(userId);
    const passwordMatch = record && (await comparePassword(password, record.password_hash));
    if (!passwordMatch) {
      logSecurityEvent("account_delete_failed", { userId, reason: "bad_password" });
      return res.status(401).json({
        success: false,
        error: { message: "Incorrect password" },
      });
    }

    const deleted = await users.delete(userId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: { message: "Account not found" } });
    }

    // Every user_id-owned table cascades from users at the DB level (see
    // initializeSchema in lib/db.js), so this single DELETE already removed
    // every entry, action point, fact, tag, recap, and ask thread. The cache
    // invalidation below just makes sure *this* warm container stops serving
    // a stale (now-nonexistent) token_version to a request that's already
    // in flight - requireAuth would reject it anyway once the cache expires,
    // this just closes that window immediately.
    invalidateTokenVersionCache(userId);

    logSecurityEvent("account_deleted", { userId });

    res.setHeader("Set-Cookie", clearCookieHeader());

    return res.status(200).json({
      success: true,
      data: { message: "Account deleted" },
    });
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({
        success: false,
        error: { message: err.message },
      });
    }

    console.error("Delete account error:", err);
    return res.status(500).json({
      success: false,
      error: { message: "Failed to delete account" },
    });
  }
}

async function handleMe(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = await requireAuth(req);

    const user = await users.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: "User not found" },
      });
    }

    let profilePictureDataUri = null;
    if (user.profile_picture_mime_type) {
      const picture = await users.getProfilePicture(userId);
      if (picture?.profile_picture_data) {
        profilePictureDataUri = `data:${picture.profile_picture_mime_type};base64,${picture.profile_picture_data.toString("base64")}`;
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          nickname: user.nickname,
          timezone: user.timezone,
          onboardingCompletedAt: user.onboarding_completed_at,
          profilePictureDataUri,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
        },
      },
    });
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({
        success: false,
        error: { message: err.message },
      });
    }

    console.error("Get user error:", err);
    return res.status(500).json({
      success: false,
      error: { message: "Failed to fetch user" },
    });
  }
}

async function handlePasswordReset(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (req.body && req.body.token !== undefined) {
    return handlePasswordResetConsume(req, res);
  }
  return handlePasswordResetRequest(req, res);
}

async function handlePasswordResetRequest(req, res) {
  try {
    const email = req.body.email ? req.body.email.trim().toLowerCase() : req.body.email;

    if (!email) {
      return res.status(422).json({
        success: false,
        error: { message: "Email is required", fields: { email: "Email is required" } },
      });
    }

    // Rate-limited by IP and by the target email equally regardless of
    // whether that email has an account, so a 429 here never itself becomes
    // an account-existence signal (same reasoning as the generic success
    // response below).
    const clientIp = getClientIp(req);
    const rateLimited = await enforceRateLimits(req, res, [
      { bucket: "reset-ip", key: clientIp, options: RESET_IP_LIMIT },
      { bucket: "reset-email", key: email, options: RESET_EMAIL_LIMIT },
    ]);
    if (rateLimited) {
      logSecurityEvent("password_reset_request_rate_limited", { email, ip: clientIp });
      return;
    }

    const user = await users.findByEmail(email);

    let devResetUrl = null;
    if (user) {
      const { rawToken, tokenHash } = generateResetToken();
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await users.setResetToken(user.id, tokenHash, expiresAt);

      const protocol = req.headers["x-forwarded-proto"] || (process.env.NODE_ENV === "production" ? "https" : "http");
      const origin = req.headers.origin || `${protocol}://${req.headers.host}`;
      const resetUrl = `${origin}/app?resetToken=${rawToken}`;

      await sendPasswordResetEmail({ to: user.email, resetUrl });
      // Never log resetUrl/rawToken here - it's a live credential (see
      // lib/email.js's own comment on the same point).
      logSecurityEvent("password_reset_requested", { userId: user.id, email, ip: clientIp });

      // No email provider is wired up yet, so surface the link outside production
      // so the flow is testable. Remove once a real provider sends this link.
      if (process.env.NODE_ENV !== "production") {
        devResetUrl = resetUrl;
      }
    } else {
      // Do the same shape of work (token generation + one DB round-trip) as
      // the "user exists" branch above, so response timing doesn't reveal
      // whether this email is registered (SEC-002). Creates no real token
      // and writes nothing.
      generateResetToken();
      await users.dummyResetTokenWork();
    }

    return res.status(200).json({
      success: true,
      data: {
        message: "If that email is registered, a reset link has been sent.",
        ...(devResetUrl ? { devResetUrl } : {}),
      },
    });
  } catch (err) {
    console.error("Request password reset error:", err);
    return res.status(500).json({
      success: false,
      error: { message: "Failed to request password reset" },
    });
  }
}

async function handlePasswordResetConsume(req, res) {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(422).json({
        success: false,
        error: {
          message: "Token and new password are required",
          fields: {
            token: !token ? "Reset token is required" : null,
            password: !password ? "Password is required" : null,
          },
        },
      });
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(422).json({
        success: false,
        error: {
          message: "Password does not meet requirements",
          fields: { password: passwordValidation.error },
        },
      });
    }

    const tokenHash = hashResetToken(token);
    const user = await users.findByResetTokenHash(tokenHash);

    if (!user || !user.reset_token_expires_at || new Date(user.reset_token_expires_at) < new Date()) {
      logSecurityEvent("password_reset_consume_failed", { ip: getClientIp(req), reason: "invalid_or_expired_token" });
      return res.status(400).json({
        success: false,
        error: { message: "This reset link is invalid or has expired" },
      });
    }

    const passwordHash = await hashPassword(password);
    const updated = await users.resetPassword(user.id, passwordHash);
    // Only helps this specific container's cache (see invalidateTokenVersionCache's
    // own doc comment) - other warm containers still catch up within the
    // short cache TTL, same as before.
    invalidateTokenVersionCache(user.id);
    logSecurityEvent("password_reset_completed", { userId: user.id, email: user.email, ip: getClientIp(req) });

    // Sign the user in immediately so the reset flow ends in a working
    // session - using the post-bump token_version so this new token is
    // itself valid (resetPassword just invalidated every earlier one).
    const sessionToken = signToken(user.id, { tokenVersion: updated.token_version });
    res.setHeader("Set-Cookie", setCookieHeader(sessionToken));

    return res.status(200).json({
      success: true,
      data: { message: "Password updated" },
    });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({
      success: false,
      error: { message: "Failed to reset password" },
    });
  }
}

async function handlePicture(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = await requireAuth(req);
    const { imageBase64, mimeType } = req.body;

    if (!imageBase64) {
      return res.status(422).json({
        success: false,
        error: { message: "No image data received" },
      });
    }

    // mimeType is required (not just checked when present) - an omitted
    // value used to skip this check entirely and fall back to a trusted
    // "image/jpeg" label regardless of what was actually uploaded.
    if (!mimeType || !ALLOWED_PICTURE_MIME_TYPES.includes(mimeType)) {
      return res.status(422).json({
        success: false,
        error: { message: "Unsupported image type", fields: { mimeType: "Must be JPEG, PNG, WebP, or GIF" } },
      });
    }

    const rawBuffer = Buffer.from(imageBase64, "base64");

    if (rawBuffer.length === 0) {
      return res.status(422).json({
        success: false,
        error: { message: "No image data received" },
      });
    }

    if (rawBuffer.length > MAX_PICTURE_UPLOAD_BYTES) {
      return res.status(413).json({
        success: false,
        error: { message: "Image is too large to save" },
      });
    }

    // The mimeType field is client-supplied and not on its own trustworthy -
    // confirm the actual bytes look like a real image before storing them.
    if (!isValidImage(rawBuffer)) {
      return res.status(422).json({
        success: false,
        error: { message: "File does not appear to be a valid image" },
      });
    }

    const saved = await users.savePicture(userId, {
      data: rawBuffer,
      mimeType,
    });

    return res.status(200).json({
      success: true,
      data: { profilePictureMimeType: saved.profile_picture_mime_type },
    });
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({
        success: false,
        error: { message: err.message },
      });
    }

    console.error("Upload picture error:", err);
    return res.status(500).json({
      success: false,
      error: { message: "Failed to upload picture" },
    });
  }
}

async function handleProfile(req, res) {
  if (req.method !== "PATCH") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = await requireAuth(req);
    const { name, nickname, onboardingCompleted } = req.body;

    if (onboardingCompleted === true) {
      const updated = await users.completeOnboarding(userId);
      return res.status(200).json({
        success: true,
        data: { onboardingCompletedAt: updated.onboarding_completed_at },
      });
    }

    const updates = {};
    const fieldErrors = {};

    if (name !== undefined) {
      const trimmed = typeof name === "string" ? name.trim() : "";
      if (trimmed.length > 100) {
        fieldErrors.name = "Name must be 100 characters or fewer";
      } else {
        updates.name = trimmed || null;
      }
    }

    if (nickname !== undefined) {
      const trimmed = typeof nickname === "string" ? nickname.trim() : "";
      if (trimmed.length > 50) {
        fieldErrors.nickname = "Nickname must be 50 characters or fewer";
      } else {
        updates.nickname = trimmed || null;
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return res.status(422).json({
        success: false,
        error: { message: "Invalid profile fields", fields: fieldErrors },
      });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(422).json({
        success: false,
        error: { message: "No fields to update" },
      });
    }

    const updated = await users.update(userId, updates);

    return res.status(200).json({
      success: true,
      data: {
        user: {
          id: updated.id,
          email: updated.email,
          name: updated.name,
          nickname: updated.nickname,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
        },
      },
    });
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({
        success: false,
        error: { message: err.message },
      });
    }

    console.error("Update profile error:", err);
    return res.status(500).json({
      success: false,
      error: { message: "Failed to update profile" },
    });
  }
}

async function handleSignup(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { password, timezone } = req.body;
    const email = req.body.email ? req.body.email.trim().toLowerCase() : req.body.email;
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";

    if (!email || !password) {
      return res.status(422).json({
        success: false,
        error: {
          message: "Email and password are required",
          fields: {
            email: !email ? "Email is required" : null,
            password: !password ? "Password is required" : null,
          },
        },
      });
    }

    if (name.length > 100) {
      return res.status(422).json({
        success: false,
        error: {
          message: "Invalid name",
          fields: { name: "Name must be 100 characters or fewer" },
        },
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(422).json({
        success: false,
        error: {
          message: "Invalid email format",
          fields: { email: "Please enter a valid email address" },
        },
      });
    }

    if (await enforceRateLimit(req, res, "signup-ip", getClientIp(req), SIGNUP_IP_LIMIT)) {
      logSecurityEvent("signup_rate_limited", { email, ip: getClientIp(req) });
      return;
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(422).json({
        success: false,
        error: {
          message: "Password does not meet requirements",
          fields: { password: passwordValidation.error },
        },
      });
    }

    const existingUser = await users.findByEmail(email);
    if (existingUser) {
      return res.status(422).json({
        success: false,
        error: {
          message: "User already exists",
          fields: { email: "This email is already registered" },
        },
      });
    }

    const passwordHash = await hashPassword(password);
    const user = await users.create(email, passwordHash, {
      name: name || null,
      timezone: typeof timezone === "string" && timezone.length <= 100 ? timezone : null,
    });
    logSecurityEvent("signup_success", { userId: user.id, email, ip: getClientIp(req) });

    const token = signToken(user.id);
    res.setHeader("Set-Cookie", setCookieHeader(token));

    return res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          timezone: user.timezone,
          onboardingCompletedAt: user.onboarding_completed_at,
          createdAt: user.created_at,
        },
      },
    });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({
      success: false,
      error: { message: "Signup failed" },
    });
  }
}
