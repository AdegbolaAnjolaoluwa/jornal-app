/**
 * GET /api/streak?timezone=<IANA zone>&today=<YYYY-MM-DD>
 * Current consecutive-day journaling streak for the user, computed in their
 * local timezone (not the server's UTC) so the day boundary matches what
 * they actually see on their clock.
 * Requires authentication
 */

import { entries } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { isValidTimezone, isValidIsoDate } from "../lib/validation.js";
import { computeStreak } from "../lib/streak.js";
import url from "url";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = await requireAuth(req);
    const { timezone, today } = url.parse(req.url, true).query;

    if (!isValidTimezone(timezone)) {
      return res.status(422).json({
        success: false,
        error: { message: "timezone must be a valid IANA timezone name" },
      });
    }
    if (!isValidIsoDate(today)) {
      return res.status(422).json({
        success: false,
        error: { message: "today must be a valid YYYY-MM-DD date" },
      });
    }

    const activityDates = await entries.findActivityDates(userId, timezone);
    const streak = computeStreak(activityDates, today);

    return res.status(200).json({
      success: true,
      data: streak,
    });
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({
        success: false,
        error: { message: err.message },
      });
    }

    console.error("Get streak error:", err);
    return res.status(500).json({
      success: false,
      error: { message: "Failed to compute streak" },
    });
  }
}
