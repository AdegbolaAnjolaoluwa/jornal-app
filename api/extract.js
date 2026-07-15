/**
 * POST /api/extract
 * Extract action points and insights from user input
 * Requires authentication
 */

import { entries } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { extractInsights, validateExtraction } from "../lib/ai.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = requireAuth(req);
    const { entryId, userInput, extractionType, customInstructions } = req.body;

    // Validate input
    if (!userInput) {
      return res.status(422).json({
        success: false,
        error: {
          message: "userInput is required",
          fields: { userInput: "User input cannot be empty" },
        },
      });
    }

    // If entryId provided, verify ownership
    if (entryId) {
      const entry = await entries.findById(entryId, userId);
      if (!entry) {
        return res.status(404).json({
          success: false,
          error: { message: "Entry not found" },
        });
      }
    }

    // Extract insights from user input
    const extraction = await extractInsights(userInput, extractionType, customInstructions);

    // Validate extraction format
    const validation = validateExtraction(extraction);
    if (!validation.valid) {
      return res.status(500).json({
        success: false,
        error: {
          message: "Invalid extraction format",
          details: validation.errors,
        },
      });
    }

    // If entryId provided, update the entry with extraction results
    let updatedEntry = null;
    if (entryId) {
      updatedEntry = await entries.updateExtraction(entryId, userId, extraction);
    }

    return res.status(200).json({
      success: true,
      data: {
        extraction,
        entry: updatedEntry,
      },
    });
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({
        success: false,
        error: { message: err.message },
      });
    }

    console.error("Extract error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Extraction failed" },
    });
  }
}
