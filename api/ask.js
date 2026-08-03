/**
 * POST /api/ask - ask a new question about your own journal history.
 *   Body: { question: string }
 * GET /api/ask - list past ask-threads, most recent first. (v2: not yet
 *   wired to the frontend, but built now since threads are persisted from
 *   day one.)
 * GET /api/ask/:id/messages - fetch a thread's full message history. (v2)
 * POST /api/ask/:id/messages - post a follow-up within an existing thread.
 *   (v2: retrieval would need to re-run against the follow-up text and pass
 *   accumulated prior messages into answerQuestion(); not implemented yet.)
 * Requires authentication
 */

import { askThreads, askMessages } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { answerQuestion } from "../lib/ai.js";
import { gatherGroundingContext } from "../lib/retrieval.js";
import { enforceRateLimit } from "../lib/rateLimit.js";
import { isValidUuid } from "../lib/validation.js";
import url from "url";

const MAX_QUESTION_LENGTH = 500;

// Tighter than recap-user (20/15min): recap has a cache layer in front of
// it, so most views never reach the rate-limited path at all. Every ask is
// a full uncached retrieval + AI call - the most expensive-per-request
// endpoint in the app, so the tightest limit is the honest reflection of
// that, not an arbitrary pick.
const ASK_RATE_LIMIT = { maxAttempts: 15, windowMs: 15 * 60 * 1000 };

const NOTHING_FOUND_ANSWER = "I don't see anything in your journal about that yet.";

export default async function handler(req, res) {
  try {
    const userId = await requireAuth(req);
    const parsedUrl = url.parse(req.url, true);
    const pathParts = parsedUrl.pathname.split("/").filter((p) => p);
    const threadId = pathParts[2]; // /api/ask/:id
    const subResource = pathParts[3]; // /api/ask/:id/messages

    if (threadId && !isValidUuid(threadId)) {
      return res.status(404).json({ success: false, error: { message: "Thread not found" } });
    }

    if (subResource === "messages" && threadId) {
      if (req.method === "GET") {
        return handleGetThreadMessages(threadId, userId, res);
      }
      if (req.method === "POST") {
        return res.status(501).json({ success: false, error: { message: "Follow-up questions aren't supported yet" } });
      }
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (req.method === "GET") {
      return handleListThreads(userId, res);
    }

    if (req.method === "POST") {
      return handleAskQuestion(userId, req, res);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({
        success: false,
        error: { message: err.message },
      });
    }

    console.error("Ask handler error:", err);
    return res.status(500).json({
      success: false,
      error: { message: "Failed to process request" },
    });
  }
}

async function handleAskQuestion(userId, req, res) {
  const { question } = req.body;

  if (!question || typeof question !== "string" || !question.trim()) {
    return res.status(422).json({
      success: false,
      error: { message: "question is required", fields: { question: "Question cannot be empty" } },
    });
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    return res.status(422).json({
      success: false,
      error: {
        message: "Question is too long",
        fields: { question: `Must be ${MAX_QUESTION_LENGTH} characters or fewer` },
      },
    });
  }

  // Checked before any retrieval work, unlike recap's rate limit (which
  // sits after its cache-hit early-return) - ask has no cache layer to
  // early-return through, so every request does real work and the check
  // belongs at the very top.
  if (await enforceRateLimit(req, res, "ask-user", userId, ASK_RATE_LIMIT)) {
    return;
  }

  try {
    const { entries: groundingEntries, facts: groundingFacts, recapSummary } = await gatherGroundingContext(
      userId,
      question
    );

    const thread = await askThreads.create(userId, question);
    await askMessages.create(thread.id, userId, "user", question);

    let answer;
    if (groundingEntries.length === 0 && groundingFacts.length === 0 && !recapSummary) {
      // Strongest anti-hallucination guarantee available: a hard-coded
      // empty-state response can never fabricate an answer. The AI's own
      // refusal instructions are the fallback for the thin-but-nonzero
      // case, which needs judgment a hard-coded rule can't provide.
      answer = NOTHING_FOUND_ANSWER;
    } else {
      answer = await answerQuestion(question, groundingEntries, groundingFacts, recapSummary, []);
      if (!answer) answer = NOTHING_FOUND_ANSWER;
    }

    await askMessages.create(thread.id, userId, "assistant", answer);

    return res.status(200).json({
      success: true,
      data: {
        thread: { id: thread.id, question: thread.question, createdAt: thread.created_at },
        answer,
      },
    });
  } catch (err) {
    console.error("Ask question error:", err);
    return res.status(500).json({
      success: false,
      error: { message: "Failed to answer question" },
    });
  }
}

async function handleListThreads(userId, res) {
  try {
    const threads = await askThreads.findByUserId(userId);
    return res.status(200).json({ success: true, data: { threads } });
  } catch (err) {
    console.error("List ask threads error:", err);
    return res.status(500).json({
      success: false,
      error: { message: "Failed to fetch threads" },
    });
  }
}

async function handleGetThreadMessages(threadId, userId, res) {
  try {
    const thread = await askThreads.findById(threadId, userId);
    if (!thread) {
      return res.status(404).json({ success: false, error: { message: "Thread not found" } });
    }

    const messages = await askMessages.findByThreadId(threadId, userId);
    return res.status(200).json({ success: true, data: { thread, messages } });
  } catch (err) {
    console.error("Get ask thread messages error:", err);
    return res.status(500).json({
      success: false,
      error: { message: "Failed to fetch thread messages" },
    });
  }
}
