/**
 * Retrieval logic for "ask your journal" - turns a natural-language
 * question into a small, bounded set of grounding context (facts, entries,
 * an optional recap summary) for lib/ai.js's answerQuestion(). Pure
 * scoring/union/truncation logic is kept as separate exported functions so
 * it's unit-testable without a database, same split as lib/recap.js and
 * lib/streak.js use for their period-math and fingerprint logic.
 */

import { entries, userFacts, tags, recaps } from "./db.js";
import { computePeriodRange } from "./recap.js";

const MAX_FACTS = 5;
const MAX_ENTRIES = 8;
const MAX_CHARS_PER_ENTRY = 500;
const MAX_FTS_RESULTS = 10;
const MAX_TAG_ENTRIES = 5;

/**
 * Combines fact-backlinked entries (higher precision - a fact match is a
 * curated, previously-extracted signal), tag-matched entries (the user
 * named an exact tag, an equally deliberate signal), and full-text-search
 * results (filling the remainder by rank), de-duplicated by entry id,
 * capped at MAX_ENTRIES. Pure function over already-fetched rows.
 */
export function mergeEntries(factBackedEntries, tagMatchedEntries, ftsEntries) {
  const seen = new Set();
  const merged = [];

  for (const entry of [...factBackedEntries, ...tagMatchedEntries, ...ftsEntries]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
    if (merged.length >= MAX_ENTRIES) break;
  }

  return merged;
}

/**
 * Finds which of the user's tags are named outright in the question (whole
 * word, case-insensitive - "gym" matches "...at the gym today" but not
 * "gymnastics"). A question naming an exact tag is as deliberate a signal
 * as a fact backlink, so entries under that tag are pulled in the same way.
 * Pure function - allTags is the array tags.findByUserId already returns.
 */
export function matchTags(allTags, question) {
  return allTags.filter((tag) => {
    const escaped = tag.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // \b only anchors correctly next to a \w character on the tag's own
    // edge - a tag ending in punctuation (e.g. "c++") has no trailing word
    // character for \b to bind to, so lookaround on whitespace/string-edges
    // is used instead of \b, on both sides, rather than assuming \w edges.
    return new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "i").test(question);
  });
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
  // Fact matching goes through Postgres's own stemmer/stopword handling
  // (same tsvector/ts_rank machinery entries search already uses) rather
  // than a hand-rolled JS word-overlap count, so "worked" in a fact matches
  // "work" in the question the same way entry search already does.
  const [matchedFacts, allTags] = await Promise.all([
    userFacts.searchByUserId(userId, question, MAX_FACTS),
    tags.findByUserId(userId),
  ]);
  const matchedTags = matchTags(allTags, question);

  const factEntryIds = matchedFacts.map((f) => f.entry_id).filter(Boolean);
  const [factBackedEntries, tagMatchedEntries, ftsEntries] = await Promise.all([
    entries.findByIds(factEntryIds, userId),
    // A question naming an exact tag ("what have I written under #gym?")
    // is a deliberate, high-precision signal - pull the most recent entries
    // under each matched tag directly rather than relying on keyword search
    // to happen to surface them.
    matchedTags.length > 0
      ? Promise.all(matchedTags.map((tag) => entries.findByUserId(userId, { tagId: tag.id, limit: MAX_TAG_ENTRIES }))).then(
          (results) => results.flat()
        )
      : Promise.resolve([]),
    // matchMode "or": question is a full natural-language sentence, not a
    // few deliberate keywords, so any one significant term matching is
    // enough (see lib/db.js's findByUserId comment for why plainto_tsquery's
    // default AND-of-every-term fails on sentence-shaped input).
    entries.findByUserId(userId, { q: question, limit: MAX_FTS_RESULTS, matchMode: "or" }),
  ]);

  const mergedEntries = mergeEntries(factBackedEntries, tagMatchedEntries, ftsEntries);

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
