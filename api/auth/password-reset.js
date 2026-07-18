/**
 * POST /api/auth/password-reset
 * Two steps of the same flow, dispatched by request shape (kept in one file to
 * stay under the Hobby-plan serverless function cap):
 *
 * 1. { email } — issue a single-use, time-limited reset token and email it.
 *    Always responds with success (whether or not the email exists) to avoid
 *    leaking which addresses are registered.
 * 2. { token, password } — consume the token and set a new password.
 */

import { users } from "../../lib/db.js";
import { generateResetToken, hashResetToken, hashPassword, validatePassword, signToken, setCookieHeader } from "../../lib/auth.js";
import { sendPasswordResetEmail } from "../../lib/email.js";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (req.body && req.body.token !== undefined) {
    return handleReset(req, res);
  }
  return handleRequest(req, res);
}

async function handleRequest(req, res) {
  try {
    const email = req.body.email ? req.body.email.trim().toLowerCase() : req.body.email;

    if (!email) {
      return res.status(422).json({
        success: false,
        error: { message: "Email is required", fields: { email: "Email is required" } },
      });
    }

    const user = await users.findByEmail(email);

    let devResetUrl = null;
    if (user) {
      const { rawToken, tokenHash } = generateResetToken();
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await users.setResetToken(user.id, tokenHash, expiresAt);

      const protocol = req.headers["x-forwarded-proto"] || (process.env.NODE_ENV === "production" ? "https" : "http");
      const origin = req.headers.origin || `${protocol}://${req.headers.host}`;
      const resetUrl = `${origin}/?resetToken=${rawToken}`;

      await sendPasswordResetEmail({ to: user.email, resetUrl });

      // No email provider is wired up yet — surface the link outside production
      // so the flow is testable. Remove once a real provider sends this link.
      if (process.env.NODE_ENV !== "production") {
        devResetUrl = resetUrl;
      }
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
      error: { message: err.message || "Failed to request password reset" },
    });
  }
}

async function handleReset(req, res) {
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
      return res.status(400).json({
        success: false,
        error: { message: "This reset link is invalid or has expired" },
      });
    }

    const passwordHash = await hashPassword(password);
    await users.resetPassword(user.id, passwordHash);

    // Sign the user in immediately so the reset flow ends in a working session
    const sessionToken = signToken(user.id);
    res.setHeader("Set-Cookie", setCookieHeader(sessionToken));

    return res.status(200).json({
      success: true,
      data: { message: "Password updated" },
    });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to reset password" },
    });
  }
}
