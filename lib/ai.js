/**
 * AI utilities: Groq extraction, prompt management, response parsing
 */

import Groq from "groq-sdk";
import { getConfig } from "../config.js";

let client;

/**
 * Get or initialize the Groq client
 */
function getClient() {
  if (!client) {
    client = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
  }
  return client;
}

/**
 * Extract action points and insights from user input.
 * priorFacts: array of previously-remembered fact strings about this user, injected as context.
 */
export async function extractInsights(userInput, priorFacts = []) {
  const client = getClient();
  const aiConfig = getConfig("ai");
  const extractionConfig = getConfig("extraction");

  const factsBlock =
    priorFacts.length > 0
      ? `\n\nKnown facts about this user, from previous entries (use for context only, do not repeat these back or re-extract them as new facts unless something has materially changed):\n${priorFacts.map((f) => `- ${f}`).join("\n")}`
      : "";
  const systemPrompt = extractionConfig.systemPrompt + factsBlock;

  let retries = 0;
  let lastError;

  while (retries < aiConfig.retryAttempts) {
    try {
      const completion = await client.chat.completions.create({
        model: aiConfig.model,
        max_tokens: aiConfig.maxTokens,
        temperature: aiConfig.temperature,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userInput,
          },
        ],
      });

      const responseText = completion.choices[0]?.message?.content || "";

      // Parse JSON response
      const parsed = parseExtractionResponse(responseText);
      return parsed;
    } catch (error) {
      lastError = error;
      retries++;

      if (retries < aiConfig.retryAttempts) {
        // Exponential backoff
        const delay = aiConfig.retryDelayMs * Math.pow(2, retries - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`Extraction failed after ${aiConfig.retryAttempts} attempts:`, lastError);
  throw new Error(`Failed to extract insights: ${lastError?.message}`);
}

/**
 * Parse the model's JSON response into structured format
 */
function parseExtractionResponse(responseText) {
  try {
    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : null,
      actionPoints: Array.isArray(parsed.actionPoints)
        ? parsed.actionPoints.map((ap) => (typeof ap === "string" ? ap : ap.text || String(ap)))
        : [],
      reflection: parsed.reflection || null,
      clarifyingQuestion: parsed.clarifyingQuestion || null,
      memorableFacts: Array.isArray(parsed.memorableFacts)
        ? parsed.memorableFacts.filter((f) => typeof f === "string" && f.trim().length > 0)
        : [],
    };
  } catch (error) {
    console.error("Failed to parse extraction response:", { responseText, error });
    throw new Error(`Failed to parse AI response: ${error.message}`);
  }
}

/**
 * Continue a clarifying-question chat thread for an entry.
 * originalEntryText: the entry's input_text, for context.
 * messages: prior thread messages, [{ role: 'user'|'assistant', content }], oldest first.
 * Returns the assistant's reply as a plain string.
 */
export async function continueConversation(originalEntryText, messages) {
  const client = getClient();
  const aiConfig = getConfig("ai");

  const systemPrompt = `You are following up on a journal entry to help clarify the user's intent.
The original entry was: "${originalEntryText}"

Continue this conversation naturally and briefly. Ask further clarifying questions if needed, or acknowledge the user's answer. Keep replies short (1-3 sentences), conversational, and focused on helping the user think through their entry.

Write in plain prose only. Do not use numbered or bulleted lists, headers, or markdown formatting. Do not give generic advice or checklists unrelated to what the user actually wrote. Never end with an offer to "continue" or list more items, just respond and stop. Do not use em dashes; use a comma, period, or "and"/"but" instead.`;

  let retries = 0;
  let lastError;

  while (retries < aiConfig.retryAttempts) {
    try {
      const completion = await client.chat.completions.create({
        model: aiConfig.model,
        max_tokens: aiConfig.maxTokens,
        temperature: aiConfig.temperature,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      });

      return completion.choices[0]?.message?.content || "";
    } catch (error) {
      lastError = error;
      retries++;

      if (retries < aiConfig.retryAttempts) {
        const delay = aiConfig.retryDelayMs * Math.pow(2, retries - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`Conversation failed after ${aiConfig.retryAttempts} attempts:`, lastError);
  throw new Error(`Failed to continue conversation: ${lastError?.message}`);
}

/**
 * Generate just a short title for an entry, independent of the full
 * extraction pipeline. Used for one-off/backfill title generation on
 * existing entries, so it doesn't also re-run (and duplicate) reflection,
 * action points, or memorable facts extraction.
 */
export async function generateTitle(userInput) {
  const client = getClient();
  const aiConfig = getConfig("ai");

  const systemPrompt = `Read this personal journal entry and write a short title for it, like a chat app's conversation title (3-6 words, no ending punctuation, no quotes). Summarize the main topic or event, not a generic phrase like "Journal entry". Respond with the title only, nothing else.`;

  let retries = 0;
  let lastError;

  while (retries < aiConfig.retryAttempts) {
    try {
      const completion = await client.chat.completions.create({
        model: aiConfig.model,
        max_tokens: 32,
        temperature: aiConfig.temperature,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userInput },
        ],
      });

      const text = (completion.choices[0]?.message?.content || "").trim();
      // Strip surrounding quotes the model sometimes adds despite instructions.
      return text.replace(/^["']|["']$/g, "") || null;
    } catch (error) {
      lastError = error;
      retries++;

      if (retries < aiConfig.retryAttempts) {
        const delay = aiConfig.retryDelayMs * Math.pow(2, retries - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`Title generation failed after ${aiConfig.retryAttempts} attempts:`, lastError);
  throw new Error(`Failed to generate title: ${lastError?.message}`);
}

/**
 * Build a custom system prompt for different extraction types
 */
export function buildSystemPrompt(extractionType = "default", customInstructions = "") {
  const basePrompt = getConfig("extraction.systemPrompt");

  const prompts = {
    default: basePrompt,
    meeting: `You are an AI assistant that extracts action items and decisions from meeting notes.
Extract:
1. Action items with owners and deadlines if mentioned
2. Key decisions made
3. Questions that need follow-up

Format as JSON with keys: actionPoints (array of {text, owner, deadline}), decisions (array), followUpQuestions (array).`,
    bugReport: `You are an AI assistant that helps extract structured information from bug reports.
Extract:
1. The specific bug or issue
2. Steps to reproduce
3. Expected vs actual behavior
4. Suggested fixes or workarounds

Format as JSON with keys: bug (string), stepsToReproduce (array), expectedBehavior (string), actualBehavior (string), suggestedFix (string or null).`,
    standup: `You are an AI assistant that extracts standup update information.
Extract:
1. What was done yesterday
2. What will be done today
3. Blockers or impediments

Format as JSON with keys: yesterdayDone (array), todayPlanning (array), blockers (array).`,
  };

  let selectedPrompt = prompts[extractionType] || basePrompt;

  if (customInstructions) {
    selectedPrompt += `\n\nAdditional instructions: ${customInstructions}`;
  }

  return selectedPrompt;
}

/**
 * Validate extraction response has required fields
 */
export function validateExtraction(extraction) {
  const errors = [];

  if (
    extraction.title !== null &&
    extraction.title !== undefined &&
    typeof extraction.title !== "string"
  ) {
    errors.push("title must be a string or null");
  }

  if (!Array.isArray(extraction.actionPoints)) {
    errors.push("actionPoints must be an array");
  }

  if (
    extraction.reflection !== null &&
    extraction.reflection !== undefined &&
    typeof extraction.reflection !== "string"
  ) {
    errors.push("reflection must be a string or null");
  }

  if (
    extraction.clarifyingQuestion !== null &&
    extraction.clarifyingQuestion !== undefined &&
    typeof extraction.clarifyingQuestion !== "string"
  ) {
    errors.push("clarifyingQuestion must be a string or null");
  }

  if (!Array.isArray(extraction.memorableFacts)) {
    errors.push("memorableFacts must be an array");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get model information (for debugging/info endpoints)
 */
export function getModelInfo() {
  return {
    model: getConfig("ai.model"),
    maxTokens: getConfig("ai.maxTokens"),
    temperature: getConfig("ai.temperature"),
  };
}
