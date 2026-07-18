/**
 * POST /api/auth/request-password-reset
 * Issue a single-use, time-limited password reset token and email it to the user.
 * Always responds with success (whether or not the email exists) to avoid leaking
 * which addresses are registered.
 */

import { users } from "../../lib/db.js";
import { generateResetToken } from "../../lib/auth.js";
import { sendPasswordResetEmail } from "../../lib/email.js";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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
