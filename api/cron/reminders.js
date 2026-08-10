/**
 * POST /api/cron/reminders
 * Triggered by Vercel Cron (see vercel.json). Finds action points with a due,
 * unsent reminder and sends an email for each. Not session-authenticated,
 * but authenticated via the Authorization header Vercel Cron attaches when
 * CRON_SECRET is set.
 */

import { actionPoints as apTable } from "../../lib/db.js";
import { sendReminderEmail } from "../../lib/email.js";
import { pruneRateLimits } from "../../lib/rateLimit.js";
import { timingSafeEqualStrings } from "../../lib/timingSafeEqual.js";

export default async function handler(req, res) {
  // Fail closed if CRON_SECRET isn't configured, rather than letting the
  // comparison below silently become `Bearer undefined` (guessable by
  // anyone) - this route deliberately doesn't import lib/auth.js (it needs
  // no session/JWT logic and shouldn't pay that module's validateConfig()
  // cold-start cost for secrets it doesn't use), so it isn't covered by
  // that module's fail-fast check.
  if (!process.env.CRON_SECRET) {
    console.error("CRON_SECRET is not configured");
    return res.status(500).json({
      success: false,
      error: { message: "Misconfigured" },
    });
  }

  const authHeader = req.headers.authorization || "";
  if (!timingSafeEqualStrings(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return res.status(401).json({
      success: false,
      error: { message: "Unauthorized" },
    });
  }

  try {
    // Best-effort; a failed prune shouldn't stop reminders from sending.
    pruneRateLimits().catch((err) => console.error("Rate limit prune failed (non-fatal):", err.message));

    const due = await apTable.findDueReminders();

    const results = [];
    for (const item of due) {
      const outcome = await sendReminderEmail({
        to: item.email,
        subject: "Reminder: " + item.text,
        body: item.text,
      });
      if (outcome.sent) {
        await apTable.markReminderSent(item.id);
      }
      results.push({ id: item.id, ...outcome });
    }

    return res.status(200).json({
      success: true,
      data: { processed: results.length, results },
    });
  } catch (err) {
    console.error("Reminder cron error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to process reminders" },
    });
  }
}
