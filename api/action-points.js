/**
 * GET /api/action-points
 * List every action point across all of the current user's entries
 * Requires authentication
 */

import { actionPoints as apTable } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = requireAuth(req);
    const actionPoints = await apTable.findByUserId(userId);

    return res.status(200).json({
      success: true,
      data: { actionPoints },
    });
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({
        success: false,
        error: { message: err.message },
      });
    }

    console.error("Get action points error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to fetch action points" },
    });
  }
}
