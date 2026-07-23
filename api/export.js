/**
 * GET /api/export
 * Dump all of the current user's entries (bypassing the normal 50-item cap;
 * excludes trashed entries) as downloadable JSON, including each entry's
 * action points and tags. Never includes raw audio bytes - a hasAudio boolean
 * is included instead so the export stays small and text-only.
 * Requires authentication
 */

import { entries, actionPoints as apTable, tags as tagsTable } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = requireAuth(req);

    const userEntries = await entries.findAllForExport(userId);
    const entryIds = userEntries.map((e) => e.id);
    const [actionPoints, entryTags] = await Promise.all([
      apTable.findByEntryIds(entryIds, userId),
      tagsTable.findByEntryIds(entryIds, userId),
    ]);

    const apByEntry = new Map();
    for (const ap of actionPoints) {
      if (!apByEntry.has(ap.entry_id)) apByEntry.set(ap.entry_id, []);
      apByEntry.get(ap.entry_id).push({ text: ap.text, completed: ap.completed, remindAt: ap.remind_at });
    }

    const tagsByEntry = new Map();
    for (const t of entryTags) {
      if (!tagsByEntry.has(t.entry_id)) tagsByEntry.set(t.entry_id, []);
      tagsByEntry.get(t.entry_id).push(t.name);
    }

    const exportedEntries = userEntries.map((e) => ({
      id: e.id,
      inputType: e.input_type,
      inputText: e.input_text,
      reflection: e.reflection,
      clarifyingQuestion: e.clarifying_question,
      hasAudio: e.has_audio,
      isArchived: e.is_archived,
      createdAt: e.created_at,
      updatedAt: e.updated_at,
      actionPoints: apByEntry.get(e.id) || [],
      tags: tagsByEntry.get(e.id) || [],
    }));

    return res.status(200).json({
      success: true,
      data: {
        exportedAt: new Date().toISOString(),
        entryCount: exportedEntries.length,
        entries: exportedEntries,
      },
    });
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({
        success: false,
        error: { message: err.message },
      });
    }

    console.error("Export error:", err);
    return res.status(500).json({
      success: false,
      error: { message: err.message || "Failed to export entries" },
    });
  }
}
