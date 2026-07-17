/**
 * PATCH /api/auth/profile
 * Update the current user's name/nickname (requires authentication)
 */

import { users } from "../../lib/db.js";
import { requireAuth } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "PATCH") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = requireAuth(req);
    const { name, nickname } = req.body;

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
      error: { message: err.message || "Failed to update profile" },
    });
  }
}
