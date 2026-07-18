/**
 * POST /api/auth/reset-password
 * Consume a password-reset token and set a new password.
 */

import { users } from "../../lib/db.js";
import { hashResetToken, hashPassword, validatePassword, signToken, setCookieHeader } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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
