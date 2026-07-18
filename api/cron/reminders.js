/**
 * POST /api/cron/reminders
 * Triggered by Vercel Cron (see vercel.json). Finds action points with a due,
 * unsent reminder and sends an email for each. Not session-authenticated,
 * but authenticated via the Authorization header Vercel Cron attaches when
 * CRON_SECRET is set.
 */

import { actionPoints as apTable } from "../../lib/db.js";
import { sendReminderEmail } from "../../lib/email.js";

export default async function handler(req, res) {
  const authHeader = req.headers.authorization || "";
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({
      success: false,
      error: { message: "Unauthorized" },
    });
  }

  try {
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
