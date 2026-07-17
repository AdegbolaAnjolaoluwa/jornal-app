/**
 * POST /api/auth/picture
 * Upload the current user's profile picture (requires authentication)
 * Base64-in-JSON body, matching the same Vercel body-size constraint as audio upload.
 */

import { users } from "../../lib/db.js";
import { requireAuth } from "../../lib/auth.js";

const MAX_PICTURE_UPLOAD_BYTES = 1.5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = requireAuth(req);
    const { imageBase64, mimeType } = req.body;

    if (!imageBase64) {
      return res.status(422).json({
        success: false,
        error: { message: "No image data received" },
      });
    }

    if (mimeType && !ALLOWED_MIME_TYPES.includes(mimeType)) {
      return res.status(422).json({
        success: false,
        error: { message: "Unsupported image type", fields: { mimeType: "Must be JPEG, PNG, WebP, or GIF" } },
      });
    }

    const rawBuffer = Buffer.from(imageBase64, "base64");

    if (rawBuffer.length === 0) {
      return res.status(422).json({
        success: false,
        error: { message: "No image data received" },
      });
    }

    if (rawBuffer.length > MAX_PICTURE_UPLOAD_BYTES) {
      return res.status(413).json({
        success: false,
        error: { message: "Image is too large to save" },
      });
    }

    const saved = await users.savePicture(userId, {
      data: rawBuffer,
      mimeType: mimeType || "image/jpeg",
    });

    return res.status(200).json({
      success: true,
      data: { profilePictureMimeType: saved.profile_picture_mime_type },
    });
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({
        success: false,
        error: { message: err.message },
      });
    }

    console.error("Upload picture error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to upload picture" },
    });
  }
}
