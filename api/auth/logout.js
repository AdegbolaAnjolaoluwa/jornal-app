/**
 * POST /api/auth/logout
 * Clear session cookie and end session
 */

import { clearCookieHeader } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Clear session cookie
  res.setHeader("Set-Cookie", clearCookieHeader());

  return res.status(200).json({
    success: true,
    data: {
      message: "Logged out successfully",
    },
  });
}
