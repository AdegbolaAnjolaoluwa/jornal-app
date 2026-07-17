/**
 * GET /api/auth/me
 * Get current user information (requires authentication)
 */

import { users } from "../../lib/db.js";
import { requireAuth } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = requireAuth(req);

    const user = await users.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: "User not found" },
      });
    }

    let profilePictureDataUri = null;
    if (user.profile_picture_mime_type) {
      const picture = await users.getProfilePicture(userId);
      if (picture?.profile_picture_data) {
        profilePictureDataUri = `data:${picture.profile_picture_mime_type};base64,${picture.profile_picture_data.toString("base64")}`;
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          nickname: user.nickname,
          profilePictureDataUri,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
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

    console.error("Get user error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to fetch user" },
    });
  }
}
