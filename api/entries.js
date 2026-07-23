/**
 * GET /api/entries - List entries for current user (each with its action points)
 * GET /api/entries/archived - List the current user's archived entries
 * GET /api/entries/trash - List the current user's trashed entries
 * POST /api/entries - Create a new entry
 * PATCH /api/entries/:id - Update an entry's text, reflection, or clarifying question
 * DELETE /api/entries/:id - Permanently delete an entry (used from Trash only)
 * GET /api/entries/:id/messages - List the clarifying-question chat thread for an entry
 * POST /api/entries/:id/messages - Post a user reply and get the AI's response
 * PATCH /api/entries/:id/action-points/:apId - Update an action point's completed/remindAt
 * DELETE /api/entries/:id/action-points/:apId - Delete an action point
 * POST /api/entries/:id/audio - Upload compressed voice-note audio for an entry (base64 JSON body)
 * GET /api/entries/:id/audio - Fetch an entry's compressed voice-note audio (base64 JSON body)
 * PATCH /api/entries/:id/archive - Archive or unarchive an entry
 * PATCH /api/entries/:id/trash - Move an entry to trash or restore it
 */

import zlib from "zlib";
import { entries, actionPoints as apTable, entryMessages, tags as tagsTable } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { continueConversation } from "../lib/ai.js";
import url from "url";

// Base64 adds ~33% overhead, so the raw-audio ceiling is lower than the
// underlying ~4.5MB Vercel body limit that constrains the base64 string itself.
const MAX_AUDIO_UPLOAD_BYTES = 3.2 * 1024 * 1024;

export default async function handler(req, res) {
  try {
    const userId = requireAuth(req);
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const pathParts = pathname.split("/").filter((p) => p);
    const entryId = pathParts[2]; // /api/entries/:id
    const subResource = pathParts[3]; // /api/entries/:id/:subResource
    const apId = pathParts[4]; // /api/entries/:id/action-points/:apId

    if (pathParts[2] === "archived" && req.method === "GET") {
      return handleGetArchivedEntries(userId, res);
    }

    if (pathParts[2] === "trash" && req.method === "GET") {
      return handleGetTrashedEntries(userId, res);
    }

    if (subResource === "messages" && entryId) {
      if (req.method === "GET") {
        return handleGetMessages(entryId, userId, res);
      }
      if (req.method === "POST") {
        return handlePostMessage(entryId, userId, req, res);
      }
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (subResource === "action-points" && entryId && apId) {
      if (req.method === "PATCH") {
        return handleUpdateActionPoint(entryId, apId, userId, req, res);
      }
      if (req.method === "DELETE") {
        return handleDeleteActionPoint(entryId, apId, userId, res);
      }
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (subResource === "audio" && entryId) {
      if (req.method === "POST") {
        return handleUploadAudio(entryId, userId, req, res);
      }
      if (req.method === "GET") {
        return handleGetAudio(entryId, userId, res);
      }
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (subResource === "archive" && entryId) {
      if (req.method === "PATCH") {
        return handleArchiveEntry(entryId, userId, req, res);
      }
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (subResource === "trash" && entryId) {
      if (req.method === "PATCH") {
        return handleTrashEntry(entryId, userId, req, res);
      }
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (subResource === "tags" && entryId) {
      if (req.method === "PATCH") {
        return handleUpdateEntryTags(entryId, userId, req, res);
      }
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (req.method === "GET") {
      return handleGetEntries(userId, req, res);
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

async function attachActionPoints(userEntries, userId) {
  const entryIds = userEntries.map((e) => e.id);
  const points = await apTable.findByEntryIds(entryIds, userId);
  const pointsByEntry = new Map();
  for (const point of points) {
    if (!pointsByEntry.has(point.entry_id)) pointsByEntry.set(point.entry_id, []);
    pointsByEntry.get(point.entry_id).push(point);
  }
  for (const entry of userEntries) {
    entry.action_points = pointsByEntry.get(entry.id) || [];
  }
  return userEntries;
}

async function attachTags(userEntries, userId) {
  const entryIds = userEntries.map((e) => e.id);
  const entryTags = await tagsTable.findByEntryIds(entryIds, userId);
  const tagsByEntry = new Map();
  for (const t of entryTags) {
    if (!tagsByEntry.has(t.entry_id)) tagsByEntry.set(t.entry_id, []);
    tagsByEntry.get(t.entry_id).push({ id: t.id, name: t.name });
  }
  for (const entry of userEntries) {
    entry.tags = tagsByEntry.get(entry.id) || [];
  }
  return userEntries;
}

async function handleGetEntries(userId, req, res) {
  try {
    const { q, tag } = url.parse(req.url, true).query;
    const limit = 50;
    const offset = 0;

    const userEntries = await entries.findByUserId(userId, { limit, offset, q: q || null, tagId: tag || null });
    const total = await entries.countByUserId(userId);

    await attachActionPoints(userEntries, userId);
    await attachTags(userEntries, userId);

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

async function handleGetArchivedEntries(userId, res) {
  try {
    const userEntries = await entries.findArchivedByUserId(userId);
    await attachActionPoints(userEntries, userId);
    await attachTags(userEntries, userId);

    return res.status(200).json({
      success: true,
      data: { entries: userEntries },
    });
  } catch (err) {
    console.error("Get archived entries error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to fetch archived entries" },
    });
  }
}

async function handleGetTrashedEntries(userId, res) {
  try {
    const userEntries = await entries.findTrashedByUserId(userId);
    await attachActionPoints(userEntries, userId);
    await attachTags(userEntries, userId);

    return res.status(200).json({
      success: true,
      data: { entries: userEntries },
    });
  } catch (err) {
    console.error("Get trashed entries error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to fetch trashed entries" },
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

    const { tags: tagNames } = req.body;
    if (Array.isArray(tagNames) && tagNames.length > 0) {
      const cleaned = [...new Set(tagNames.map((t) => String(t).trim()).filter(Boolean))].slice(0, 20);
      entry.tags = cleaned.length > 0 ? await tagsTable.setForEntry(entry.id, userId, cleaned) : [];
    } else {
      entry.tags = [];
    }

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
    const { reflection, clarifyingQuestion, inputText } = req.body;

    // Verify entry exists and belongs to user
    const entry = await entries.findById(entryId, userId);
    if (!entry) {
      return res.status(404).json({
        success: false,
        error: { message: "Entry not found" },
      });
    }

    let trimmedInputText;
    if (inputText !== undefined) {
      trimmedInputText = inputText.trim();
      if (!trimmedInputText) {
        return res.status(422).json({
          success: false,
          error: {
            message: "inputText cannot be empty",
            fields: { inputText: "Entry text cannot be empty" },
          },
        });
      }
    }

    const updated = await entries.updateReflection(entryId, userId, {
      reflection: reflection || null,
      clarifyingQuestion: clarifyingQuestion || null,
      ...(trimmedInputText !== undefined ? { inputText: trimmedInputText } : {}),
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

async function handleUploadAudio(entryId, userId, req, res) {
  try {
    const { audioBase64, mimeType } = req.body;

    if (!audioBase64) {
      return res.status(422).json({
        success: false,
        error: { message: "No audio data received" },
      });
    }

    const entry = await entries.findById(entryId, userId);
    if (!entry) {
      return res.status(404).json({
        success: false,
        error: { message: "Entry not found" },
      });
    }

    const rawBuffer = Buffer.from(audioBase64, "base64");

    if (rawBuffer.length === 0) {
      return res.status(422).json({
        success: false,
        error: { message: "No audio data received" },
      });
    }

    if (rawBuffer.length > MAX_AUDIO_UPLOAD_BYTES) {
      return res.status(413).json({
        success: false,
        error: { message: "Audio recording is too large to save" },
      });
    }

    const compressed = zlib.gzipSync(rawBuffer);

    const saved = await entries.saveAudio(entryId, userId, {
      audioData: compressed,
      mimeType: mimeType || "audio/webm",
      originalBytes: rawBuffer.length,
      compressedBytes: compressed.length,
    });

    return res.status(200).json({
      success: true,
      data: {
        hasAudio: saved.has_audio,
        originalBytes: saved.audio_original_bytes,
        compressedBytes: saved.audio_compressed_bytes,
      },
    });
  } catch (err) {
    console.error("Upload audio error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to upload audio" },
    });
  }
}

async function handleGetAudio(entryId, userId, res) {
  try {
    const row = await entries.getAudio(entryId, userId);
    if (!row) {
      return res.status(404).json({
        success: false,
        error: { message: "Audio not found" },
      });
    }

    const decompressed = zlib.gunzipSync(row.audio_data);

    return res.status(200).json({
      success: true,
      data: {
        audioBase64: decompressed.toString("base64"),
        mimeType: row.audio_mime_type,
      },
    });
  } catch (err) {
    console.error("Get audio error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to fetch audio" },
    });
  }
}

async function handleArchiveEntry(entryId, userId, req, res) {
  try {
    const { archived } = req.body;

    if (typeof archived !== "boolean") {
      return res.status(422).json({
        success: false,
        error: { message: "archived (boolean) is required" },
      });
    }

    const entry = await entries.findById(entryId, userId);
    if (!entry) {
      return res.status(404).json({
        success: false,
        error: { message: "Entry not found" },
      });
    }

    const updated = archived ? await entries.archive(entryId, userId) : await entries.unarchive(entryId, userId);

    return res.status(200).json({
      success: true,
      data: { entry: updated },
    });
  } catch (err) {
    console.error("Archive entry error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to update archive state" },
    });
  }
}

async function handleTrashEntry(entryId, userId, req, res) {
  try {
    const { deleted } = req.body;

    if (typeof deleted !== "boolean") {
      return res.status(422).json({
        success: false,
        error: { message: "deleted (boolean) is required" },
      });
    }

    const entry = await entries.findById(entryId, userId);
    if (!entry) {
      return res.status(404).json({
        success: false,
        error: { message: "Entry not found" },
      });
    }

    const updated = deleted ? await entries.softDelete(entryId, userId) : await entries.restore(entryId, userId);

    return res.status(200).json({
      success: true,
      data: { entry: updated },
    });
  } catch (err) {
    console.error("Trash entry error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to update trash state" },
    });
  }
}

async function handleUpdateEntryTags(entryId, userId, req, res) {
  try {
    const { tags: tagNames } = req.body;

    if (!Array.isArray(tagNames)) {
      return res.status(422).json({
        success: false,
        error: { message: "tags (array of strings) is required" },
      });
    }

    const entry = await entries.findById(entryId, userId);
    if (!entry) {
      return res.status(404).json({
        success: false,
        error: { message: "Entry not found" },
      });
    }

    const cleaned = [...new Set(tagNames.map((t) => String(t).trim()).filter(Boolean))].slice(0, 20);
    const updatedTags = await tagsTable.setForEntry(entryId, userId, cleaned);

    return res.status(200).json({
      success: true,
      data: { tags: updatedTags },
    });
  } catch (err) {
    console.error("Update entry tags error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to update tags" },
    });
  }
}

async function handleUpdateActionPoint(entryId, apId, userId, req, res) {
  try {
    const { completed, remindAt } = req.body;

    const entryPoints = await apTable.findByEntryId(entryId, userId);
    if (!entryPoints.some((ap) => ap.id === apId)) {
      return res.status(404).json({
        success: false,
        error: { message: "Action point not found" },
      });
    }

    const fields = {};
    if (completed !== undefined) fields.completed = completed;
    if (remindAt !== undefined) fields.remindAt = remindAt;

    const updated = await apTable.update(apId, userId, fields);
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: { message: "Action point not found" },
      });
    }

    return res.status(200).json({
      success: true,
      data: { actionPoint: updated },
    });
  } catch (err) {
    console.error("Update action point error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to update action point" },
    });
  }
}

async function handleDeleteActionPoint(entryId, apId, userId, res) {
  try {
    const entryPoints = await apTable.findByEntryId(entryId, userId);
    if (!entryPoints.some((ap) => ap.id === apId)) {
      return res.status(404).json({
        success: false,
        error: { message: "Action point not found" },
      });
    }

    const deleted = await apTable.delete(apId, userId);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: { message: "Action point not found" },
      });
    }

    return res.status(200).json({
      success: true,
      data: { message: "Action point deleted" },
    });
  } catch (err) {
    console.error("Delete action point error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to delete action point" },
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

async function handleGetMessages(entryId, userId, res) {
  try {
    const entry = await entries.findById(entryId, userId);
    if (!entry) {
      return res.status(404).json({
        success: false,
        error: { message: "Entry not found" },
      });
    }

    const messages = await entryMessages.findByEntryId(entryId, userId);

    return res.status(200).json({
      success: true,
      data: { messages },
    });
  } catch (err) {
    console.error("Get messages error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to fetch messages" },
    });
  }
}

async function handlePostMessage(entryId, userId, req, res) {
  try {
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(422).json({
        success: false,
        error: {
          message: "content is required",
          fields: { content: "Message cannot be empty" },
        },
      });
    }

    const entry = await entries.findById(entryId, userId);
    if (!entry) {
      return res.status(404).json({
        success: false,
        error: { message: "Entry not found" },
      });
    }

    // Save the user's message
    const userMessage = await entryMessages.create(entryId, userId, "user", content.trim());

    // Build conversation history: seed with the clarifying question if this is the first reply
    const priorMessages = await entryMessages.findByEntryId(entryId, userId);
    const history = priorMessages.map((m) => ({ role: m.role, content: m.content }));

    if (history.length === 1 && entry.clarifying_question) {
      history.unshift({ role: "assistant", content: entry.clarifying_question });
    }

    const replyText = await continueConversation(entry.input_text, history);

    // Save the assistant's reply
    const assistantMessage = await entryMessages.create(entryId, userId, "assistant", replyText);

    return res.status(201).json({
      success: true,
      data: { userMessage, assistantMessage },
    });
  } catch (err) {
    console.error("Post message error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to send message" },
    });
  }
}
