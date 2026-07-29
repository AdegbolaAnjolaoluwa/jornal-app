 /**
 * POST /api/extract
 * Extract action points and insights from user input
 * Requires authentication
 */

import { entries, actionPoints as apTable, userFacts } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { extractInsights, validateExtraction } from "../lib/ai.js";
import { enforceRateLimit } from "../lib/rateLimit.js";
import { isValidUuid, isValidIsoDate } from "../lib/validation.js";
import { logSecurityEvent } from "../lib/securityLog.js";

// Bounds how much a single request can cost in AI tokens/time - both the
// abuse case (a script hammering this endpoint) and the accident case (a
// pasted document instead of a journal entry).
const MAX_USER_INPUT_LENGTH = 8000;
const EXTRACT_RATE_LIMIT = { maxAttempts: 30, windowMs: 15 * 60 * 1000 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = await requireAuth(req);

    // Keyed by userId, not IP - every caller here is already authenticated,
    // and the thing being bounded is per-account AI spend, not anonymous abuse.
    if (await enforceRateLimit(req, res, "extract-user", userId, EXTRACT_RATE_LIMIT)) {
      logSecurityEvent("extract_rate_limited", { userId });
      return;
    }

    const { entryId, userInput, clearIncompleteActionPoints, today: rawToday } = req.body;

    // Client-supplied "today" (the user's own local date) is used to resolve
    // relative due-date phrases like "tomorrow" - falls back to server UTC
    // date if missing or malformed, same default extractInsights() itself uses.
    const today = isValidIsoDate(rawToday) ? rawToday : undefined;

    // Validate input
    if (!userInput || typeof userInput !== "string") {
      return res.status(422).json({
        success: false,
        error: {
          message: "userInput is required",
          fields: { userInput: "User input cannot be empty" },
        },
      });
    }

    if (userInput.length > MAX_USER_INPUT_LENGTH) {
      return res.status(422).json({
        success: false,
        error: {
          message: "Entry text is too long",
          fields: { userInput: `Must be ${MAX_USER_INPUT_LENGTH} characters or fewer` },
        },
      });
    }

    // If entryId provided, verify ownership
    if (entryId) {
      if (!isValidUuid(entryId)) {
        return res.status(404).json({
          success: false,
          error: { message: "Entry not found" },
        });
      }
      const entry = await entries.findById(entryId, userId);
      if (!entry) {
        return res.status(404).json({
          success: false,
          error: { message: "Entry not found" },
        });
      }
    }

    // If entryId provided, fetch this user's known facts to inject as context
    let priorFacts = [];
    if (entryId) {
      const facts = await userFacts.findByUserId(userId);
      priorFacts = facts.map((f) => f.text);
    }

    // Extract insights from user input
    const extraction = await extractInsights(userInput, priorFacts, today);

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
        title: extraction.title,
        reflection: extraction.reflection,
        clarifyingQuestion: extraction.clarifyingQuestion,
      });

      if (clearIncompleteActionPoints) {
        // Re-extraction after an edit: match the freshly extracted action
        // points against existing incomplete ones by exact text instead of
        // blanket delete-and-recreate. A task whose wording is unchanged
        // (the common case - most edits touch other parts of the entry)
        // keeps its row untouched, so it doesn't visually "jump" to a new
        // position in the Due column or lose a due date/reminder someone
        // had already set on it. Only genuinely new or reworded action
        // points create new rows; only ones no longer present get deleted.
        // Completed action points are never touched here - they're real
        // finished work regardless of what the edited text says now.
        const existing = await apTable.findByEntryId(entryId, userId);
        const existingIncomplete = existing.filter((ap) => !ap.completed);
        const stillIncompleteTexts = new Set();

        createdActionPoints = [];
        for (const ap of extraction.actionPoints) {
          const match = existingIncomplete.find(
            (e) => !stillIncompleteTexts.has(e.id) && e.text === ap.text
          );
          if (match) {
            stillIncompleteTexts.add(match.id);
            createdActionPoints.push(match);
          } else {
            createdActionPoints.push(await apTable.create(entryId, userId, ap.text, ap.dueDate));
          }
        }

        const staleIds = existingIncomplete.filter((e) => !stillIncompleteTexts.has(e.id)).map((e) => e.id);
        if (staleIds.length > 0) {
          await Promise.all(staleIds.map((id) => apTable.delete(id, userId)));
        }
      } else {
        createdActionPoints = await Promise.all(
          extraction.actionPoints.map((ap) => apTable.create(entryId, userId, ap.text, ap.dueDate))
        );
      }

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
      error: { message: "Extraction failed" },
    });
  }
}
