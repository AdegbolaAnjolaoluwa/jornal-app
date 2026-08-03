/**
 * Retrieval logic for "ask your journal" - turns a natural-language
 * question into a small, bounded set of grounding context (facts, entries,
 * an optional recap summary) for lib/ai.js's answerQuestion(). Pure
 * scoring/union/truncation logic is kept as separate exported functions so
 * it's unit-testable without a database, same split as lib/recap.js and
 * lib/streak.js use for their period-math and fingerprint logic.
 */

import { entries, userFacts, recaps } from "./db.js";
import { computePeriodRange } from "./recap.js";

const MAX_FACTS = 5;
const MAX_ENTRIES = 8;
const MAX_CHARS_PER_ENTRY = 500;
const MAX_FTS_RESULTS = 10;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "been",
  "to", "of", "in", "on", "at", "for", "with", "about", "did", "does", "do",
  "i", "my", "me", "you", "your", "when", "what", "who", "where", "how", "why",
  "last", "this", "that", "have", "has", "had", "it", "its",
]);

function significantWords(text) {
  return (text.toLowerCase().match(/[a-z0-9']+/g) || []).filter(
    (w) => w.length > 2 && !STOPWORDS.has(w)
  );
}

/**
 * Scores each fact by how many significant words it shares with the
 * question, keeps only facts that share at least one, sorted
 * highest-score-first (ties broken by whichever came first in the input,
 * which callers pass in most-recent-first order already). Caps at
 * MAX_FACTS. Pure function - facts is the array userFacts.findByUserId
 * already returns.
 */
export function scoreFacts(facts, question) {
  const questionWords = new Set(significantWords(question));
  if (questionWords.size === 0) return [];

  return facts
    .map((fact) => {
      const factWords = significantWords(fact.text);
      const score = factWords.reduce((sum, w) => sum + (questionWords.has(w) ? 1 : 0), 0);
      return { fact, score };
    })
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FACTS)
    .map((scored) => scored.fact);
}

/**
 * Combines fact-backlinked entries (higher precision - a fact match is a
 * curated, previously-extracted signal) with full-text-search results
 * (filling the remainder by rank), de-duplicated by entry id, capped at
 * MAX_ENTRIES. Pure function over already-fetched rows.
 */
export function mergeEntries(factBackedEntries, ftsEntries) {
  const seen = new Set();
  const merged = [];

  for (const entry of [...factBackedEntries, ...ftsEntries]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
    if (merged.length >= MAX_ENTRIES) break;
  }

  return merged;
}

/**
 * Truncates an entry's text (input_text + reflection, same concatenation
 * api/recap.js uses) to MAX_CHARS_PER_ENTRY. Pure function.
 */
export function entryToGroundingText(entry) {
  const text = entry.reflection ? `${entry.input_text}\n(${entry.reflection})` : entry.input_text;
  return text.slice(0, MAX_CHARS_PER_ENTRY);
}

// Cheap, no-AI heuristic for "does this question care about a recent
// period" - a real NLU pass would be more accurate but costs a second AI
// round-trip before the real answer-generation call even starts, for a
// soft, non-critical assist step. Good enough: false positives just mean
// an unused extra context message; false negatives just mean this optional
// signal is skipped, same as if no recap were cached yet.
function mentionsRecentPeriod(question) {
  return /\bweek\b|\bmonth\b/i.test(question);
}

/**
 * Orchestrates the full retrieval: fact lookup, full-text search, merge,
 * truncate, and an optional cached-recap assist. Returns
 * { entries: [{inputText, reflection, createdAt}], facts: [string],
 * recapSummary: string|null } - already shaped for answerQuestion(), and
 * already bounded/truncated, so the caller never needs to re-cap anything.
 */
export async function gatherGroundingContext(userId, question) {
  const allFacts = await userFacts.findByUserId(userId, 100);
  const matchedFacts = scoreFacts(allFacts, question);

  const factEntryIds = matchedFacts.map((f) => f.entry_id).filter(Boolean);
  const [factBackedEntries, ftsEntries] = await Promise.all([
    entries.findByIds(factEntryIds, userId),
    // matchMode "or": question is a full natural-language sentence, not a
    // few deliberate keywords, so any one significant term matching is
    // enough (see lib/db.js's findByUserId comment for why plainto_tsquery's
    // default AND-of-every-term fails on sentence-shaped input).
    entries.findByUserId(userId, { q: question, limit: MAX_FTS_RESULTS, matchMode: "or" }),
  ]);

  const mergedEntries = mergeEntries(factBackedEntries, ftsEntries);

  let recapSummary = null;
  if (mentionsRecentPeriod(question)) {
    const today = new Date().toISOString().slice(0, 10);
    const periodType = /\bweek\b/i.test(question) ? "week" : "month";
    const { start } = computePeriodRange(periodType, today);
    const cached = await recaps.findCached(userId, periodType, start);
    recapSummary = cached?.summary || null;
  }

  return {
    entries: mergedEntries.map((e) => ({
      inputText: entryToGroundingText(e),
      createdAt: e.created_at,
    })),
    facts: matchedFacts.map((f) => f.text),
    recapSummary,
  };
}
