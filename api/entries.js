/**
 * GET /api/entries - List entries for current user
 * POST /api/entries - Create a new entry
 * PATCH /api/entries/:id - Update an entry (e.g., extraction results)
 * DELETE /api/entries/:id - Delete an entry
 */

import { entries, actionPoints as apTable } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import url from "url";

export default async function handler(req, res) {
  try {
    const userId = requireAuth(req);
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const pathParts = pathname.split("/").filter((p) => p);
    const entryId = pathParts[2]; // /api/entries/:id

    if (req.method === "GET") {
      return handleGetEntries(userId, res);
    }

    if (req.method === "POST") {
      return handleCreateEntry(userId, req, res);
    }

    if (req.method === "PATCH" && entryId) {
      return handleUpdateEntry(entryId, userId, req, res);
    }

    if (req.method === "DELETE" && entryId) {
      return handleDeleteEntry(entryId, userId, res);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({
        success: false,
        error: { message: err.message },
      });
    }

    console.error("Entries handler error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to process request" },
    });
  }
}

async function handleGetEntries(userId, res) {
  try {
    const limit = 50;
    const offset = 0;

    const userEntries = await entries.findByUserId(userId, limit, offset);
    const total = await entries.countByUserId(userId);

    return res.status(200).json({
      success: true,
      data: {
        entries: userEntries,
        pagination: {
          total,
          limit,
          offset,
        },
      },
    });
  } catch (err) {
    console.error("Get entries error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to fetch entries" },
    });
  }
}

async function handleCreateEntry(userId, req, res) {
  try {
    const { inputType, inputText } = req.body;

    if (!inputType || !inputText) {
      return res.status(422).json({
        success: false,
        error: {
          message: "inputType and inputText are required",
          fields: {
            inputType: !inputType ? "Input type is required" : null,
            inputText: !inputText ? "Input text is required" : null,
          },
        },
      });
    }

    if (!["voice", "text"].includes(inputType)) {
      return res.status(422).json({
        success: false,
        error: {
          message: "Invalid inputType",
          fields: { inputType: "Must be 'voice' or 'text'" },
        },
      });
    }

    const entry = await entries.create(userId, inputType, inputText);

    return res.status(201).json({
      success: true,
      data: { entry },
    });
  } catch (err) {
    console.error("Create entry error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to create entry" },
    });
  }
}

async function handleUpdateEntry(entryId, userId, req, res) {
  try {
    const { actionPoints, reflection, clarifyingQuestion } = req.body;

    // Verify entry exists and belongs to user
    const entry = await entries.findById(entryId, userId);
    if (!entry) {
      return res.status(404).json({
        success: false,
        error: { message: "Entry not found" },
      });
    }

    // Update extraction results
    const updated = await entries.updateExtraction(entryId, userId, {
      actionPoints: actionPoints || [],
      reflection: reflection || null,
      clarifyingQuestion: clarifyingQuestion || null,
    });

    return res.status(200).json({
      success: true,
      data: { entry: updated },
    });
  } catch (err) {
    console.error("Update entry error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to update entry" },
    });
  }
}

async function handleDeleteEntry(entryId, userId, res) {
  try {
    // Verify entry exists and belongs to user
    const entry = await entries.findById(entryId, userId);
    if (!entry) {
      return res.status(404).json({
        success: false,
        error: { message: "Entry not found" },
      });
    }

    await entries.delete(entryId, userId);

    return res.status(200).json({
      success: true,
      data: { message: "Entry deleted" },
    });
  } catch (err) {
    console.error("Delete entry error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to delete entry" },
    });
  }
}
