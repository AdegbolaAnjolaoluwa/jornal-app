/**
 * POST /api/auth/login
 * Authenticate a user and create a session
 */

import { users } from "../../lib/db.js";
import { comparePassword, signToken, setCookieHeader } from "../../lib/auth.js";

export default async function handler(req, res) {
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

    // Find user by email
    const user = await users.findByEmail(email);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: { message: "Invalid email or password" },
      });
    }

    // Compare passwords
    const passwordMatch = await comparePassword(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: { message: "Invalid email or password" },
      });
    }

    // Create JWT token
    const token = signToken(user.id, { rememberMe: rememberMe === true });

    // Set httpOnly cookie
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
      error: { message: err.message || "Login failed" },
    });
  }
}
