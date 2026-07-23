/**
 * GET /api/tags - List all of the current user's tags
 * GET /api/tags?prefix=xyz - Autocomplete: tags matching a name prefix
 * Requires authentication
 */

import { tags as tagsTable } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import url from "url";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = requireAuth(req);
    const { prefix } = url.parse(req.url, true).query;

    const results = prefix ? await tagsTable.findByPrefix(userId, prefix) : await tagsTable.findByUserId(userId);

    return res.status(200).json({
      success: true,
      data: { tags: results },
    });
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({
        success: false,
        error: { message: err.message },
      });
    }

    console.error("Get tags error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to fetch tags" },
    });
  }
}
