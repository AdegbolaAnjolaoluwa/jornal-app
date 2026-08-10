/**
 * GET  /api/chat          - Get (or create) the user's one ongoing home-page
 *                            chat thread and its full message history.
 * POST /api/chat/messages - Post a user message, get the AI's reply. If the
 *                            message turns out to be journal-worthy (judged
 *                            by the same extraction pipeline a composer
 *                            entry goes through), it's also saved as a real
 *                            journal entry with its own reflection/action
 *                            points/facts - the chat message links to it.
 * Requires authentication
 */

import { chatThreads, chatMessages, entries, actionPoints as apTable, userFacts } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { continueChat, extractInsights } from "../lib/ai.js";
import { enforceRateLimit } from "../lib/rateLimit.js";
import { logSecurityEvent } from "../lib/securityLog.js";
import url from "url";

const MAX_CHAT_MESSAGE_LENGTH = 4000;
// Same order of magnitude as entry-chat's 30/15min - this is ongoing,
// conversational back-and-forth, not a single expensive lookup like Ask.
const CHAT_RATE_LIMIT = { maxAttempts: 40, windowMs: 15 * 60 * 1000 };
const DUE_SOON_DAYS = 3;

export default async function handler(req, res) {
  try {
    const userId = await requireAuth(req);
    const parsedUrl = url.parse(req.url, true);
    const pathParts = parsedUrl.pathname.split("/").filter((p) => p);
    const subResource = pathParts[2]; // /api/chat/:subResource

    if (subResource === "messages") {
      if (req.method === "POST") {
        return handlePostMessage(userId, req, res);
      }
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (req.method === "GET") {
      return handleGetThread(userId, res);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({
        success: false,
        error: { message: err.message },
      });
    }

    console.error("Chat handler error:", err);
    return res.status(500).json({
      success: false,
      error: { message: "Failed to process request" },
    });
  }
}

async function handleGetThread(userId, res) {
  const thread = await chatThreads.findOrCreateForUser(userId);
  const messages = await chatMessages.findByThreadId(thread.id, userId);

  return res.status(200).json({
    success: true,
    data: { thread, messages },
  });
}

async function handlePostMessage(userId, req, res) {
  if (await enforceRateLimit(req, res, "chat-user", userId, CHAT_RATE_LIMIT)) {
    logSecurityEvent("chat_rate_limited", { userId });
    return;
  }

  const { content } = req.body;

  if (!content || typeof content !== "string" || !content.trim()) {
    return res.status(422).json({
      success: false,
      error: {
        message: "content is required",
        fields: { content: "Message cannot be empty" },
      },
    });
  }

  const trimmed = content.trim();
  if (trimmed.length > MAX_CHAT_MESSAGE_LENGTH) {
    return res.status(422).json({
      success: false,
      error: {
        message: "Message is too long",
        fields: { content: `Must be ${MAX_CHAT_MESSAGE_LENGTH} characters or fewer` },
      },
    });
  }

  const thread = await chatThreads.findOrCreateForUser(userId);

  // Journal-worthiness: reuse the exact same extraction pipeline a composer
  // entry goes through, rather than a separate/parallel judgment call. If
  // the model finds a concrete action point or a durable fact worth
  // remembering, this message becomes a real entry too. Deliberately NOT
  // triggered by reflection alone: unlike a composer entry (which a user
  // deliberately chose to write), extraction reliably produces some
  // reflection text even for pure filler like "hey, how's it going" or
  // "lol nice" - reflection presence isn't a meaningful worthiness signal
  // in a casual-chat context the way it is for a deliberate journal entry.
  let createdEntryId = null;
  try {
    const priorFacts = (await userFacts.findByUserId(userId)).map((f) => f.text);
    const extraction = await extractInsights(trimmed, priorFacts);
    const isJournalWorthy = extraction.actionPoints.length > 0 || extraction.memorableFacts.length > 0;

    if (isJournalWorthy) {
      const entry = await entries.create(userId, "text", trimmed);
      await entries.updateReflection(entry.id, userId, {
        title: extraction.title,
        reflection: extraction.reflection,
        clarifyingQuestion: extraction.clarifyingQuestion,
      });
      await Promise.all(extraction.actionPoints.map((ap) => apTable.create(entry.id, userId, ap.text, ap.dueDate)));
      await Promise.all(extraction.memorableFacts.map((text) => userFacts.create(userId, text, entry.id)));
      createdEntryId = entry.id;
    }
  } catch (error) {
    // Journal-worthiness is a bonus on top of chat, not a precondition for
    // it - if extraction fails for any reason, the conversation itself
    // still proceeds uninterrupted below.
    console.error("Chat journal-worthiness check failed (non-fatal):", error.message);
  }

  const userMessage = await chatMessages.create(thread.id, userId, "user", trimmed, createdEntryId);

  const priorMessages = await chatMessages.findByThreadId(thread.id, userId);
  const history = priorMessages.map((m) => ({ role: m.role, content: m.content }));

  const dueSoon = await apTable.findDueSoon(userId, DUE_SOON_DAYS);
  const replyText = await continueChat(history, dueSoon);

  const assistantMessage = await chatMessages.create(thread.id, userId, "assistant", replyText);
  await chatThreads.touch(thread.id);

  return res.status(201).json({
    success: true,
    data: { userMessage, assistantMessage, createdEntryId },
  });
}
