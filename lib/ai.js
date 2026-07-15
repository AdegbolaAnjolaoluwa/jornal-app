/**
 * AI utilities: Claude extraction, prompt management, response parsing
 */

import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "../config.js";

let client;

/**
 * Get or initialize the Anthropic client
 */
function getClient() {
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return client;
}

/**
 * Extract action points and insights from user input
 */
export async function extractInsights(userInput) {
  const client = getClient();
  const aiConfig = getConfig("ai");
  const extractionConfig = getConfig("extraction");

  let retries = 0;
  let lastError;

  while (retries < aiConfig.retryAttempts) {
    try {
      const message = await client.messages.create({
        model: aiConfig.model,
        max_tokens: aiConfig.maxTokens,
        temperature: aiConfig.temperature,
        system: extractionConfig.systemPrompt,
        messages: [
          {
            role: "user",
            content: userInput,
          },
        ],
      });

      // Extract text content from response
      const responseText = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");

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
 * Parse Claude's JSON response into structured format
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
      actionPoints: Array.isArray(parsed.actionPoints)
        ? parsed.actionPoints.map((ap) => (typeof ap === "string" ? ap : ap.text || String(ap)))
        : [],
      reflection: parsed.reflection || null,
      clarifyingQuestion: parsed.clarifyingQuestion || null,
    };
  } catch (error) {
    console.error("Failed to parse extraction response:", { responseText, error });
    throw new Error(`Failed to parse AI response: ${error.message}`);
  }
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
