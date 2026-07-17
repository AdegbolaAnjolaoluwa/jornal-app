/**
 * GET /api/facts
 * List the durable facts Say So has remembered about the current user
 * Requires authentication
 */

import { userFacts } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = requireAuth(req);
    const facts = await userFacts.findByUserId(userId);

    return res.status(200).json({
      success: true,
      data: { facts },
    });
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({
        success: false,
        error: { message: err.message },
      });
    }

    console.error("Get facts error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to fetch facts" },
    });
  }
}
