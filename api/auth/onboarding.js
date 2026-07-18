/**
 * PATCH /api/auth/onboarding
 * Mark the current user's onboarding as complete (requires authentication)
 */

import { users } from "../../lib/db.js";
import { requireAuth } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "PATCH") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = requireAuth(req);
    const updated = await users.completeOnboarding(userId);

    return res.status(200).json({
      success: true,
      data: { onboardingCompletedAt: updated.onboarding_completed_at },
    });
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({
        success: false,
        error: { message: err.message },
      });
    }

    console.error("Complete onboarding error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to update onboarding status" },
    });
  }
}
