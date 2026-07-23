 /**
 * POST /api/extract
 * Extract action points and insights from user input
 * Requires authentication
 */

import { entries, actionPoints as apTable, userFacts } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { extractInsights, validateExtraction } from "../lib/ai.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = requireAuth(req);
    const { entryId, userInput, clearIncompleteActionPoints } = req.body;

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

    // Re-extraction after an entry's text was edited: clear stale incomplete
    // action points from the old text before adding fresh ones below, but
    // never on ordinary creation (this flag is never sent there), and never
    // touch already-completed action points - those are real finished work.
    if (entryId && clearIncompleteActionPoints) {
      await apTable.deleteIncompleteByEntryId(entryId, userId);
    }

    // If entryId provided, fetch this user's known facts to inject as context
    let priorFacts = [];
    if (entryId) {
      const facts = await userFacts.findByUserId(userId);
      priorFacts = facts.map((f) => f.text);
    }

    // Extract insights from user input
    const extraction = await extractInsights(userInput, priorFacts);

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

    // If entryId provided, persist the reflection/clarifying question and create real action point rows
    let updatedEntry = null;
    let createdActionPoints = extraction.actionPoints;
    let createdFacts = extraction.memorableFacts;
    if (entryId) {
      updatedEntry = await entries.updateReflection(entryId, userId, {
        reflection: extraction.reflection,
        clarifyingQuestion: extraction.clarifyingQuestion,
      });

      createdActionPoints = await Promise.all(
        extraction.actionPoints.map((text) => apTable.create(entryId, userId, text))
      );

      createdFacts = await Promise.all(
        extraction.memorableFacts.map((text) => userFacts.create(userId, text, entryId))
      );
    }

    return res.status(200).json({
      success: true,
      data: {
        extraction: { ...extraction, actionPoints: createdActionPoints, memorableFacts: createdFacts },
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
