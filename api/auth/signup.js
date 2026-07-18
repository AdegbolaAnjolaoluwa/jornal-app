/**
 * POST /api/auth/signup
 * Create a new user account
 */

import { users } from "../../lib/db.js";
import { hashPassword, validatePassword, signToken, setCookieHeader } from "../../lib/auth.js";
import { success, error, validationError } from "../../lib/response.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { password, timezone } = req.body;
    const email = req.body.email ? req.body.email.trim().toLowerCase() : req.body.email;
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";

    // Validate input
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

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(422).json({
        success: false,
        error: {
          message: "Invalid email format",
          fields: { email: "Please enter a valid email address" },
        },
      });
    }

    // Validate password strength
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

    // Check if user already exists
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

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const user = await users.create(email, passwordHash, {
      name: name || null,
      timezone: typeof timezone === "string" && timezone.length <= 100 ? timezone : null,
    });

    // Create JWT token
    const token = signToken(user.id);

    // Set httpOnly cookie
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
      error: { message: err.message || "Signup failed" },
    });
  }
}
