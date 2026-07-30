/**
 * GET /api/recap?periodType=week|month&timezone=<IANA zone>&today=<YYYY-MM-DD>
 * A cached, on-demand AI-generated summary of the current week/month plus
 * hard stats (entries written, tasks completed, tags used). Regenerated
 * only when the period's contents have actually changed since the last
 * cached version (see lib/recap.js's computeFingerprint).
 * Requires authentication
 */

import { entries, actionPoints as apTable, tags as tagsTable, recaps } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { generateRecap } from "../lib/ai.js";
import { enforceRateLimit } from "../lib/rateLimit.js";
import { isValidTimezone, isValidIsoDate } from "../lib/validation.js";
import { computePeriodRange, computeFingerprint, computePreviousPeriodStart } from "../lib/recap.js";
import url from "url";

// Recap generation is a real AI call, same cost profile as extraction - but
// each period is cached, so under normal use this is rarely hit (viewing
// the same week/month repeatedly is free). The limit exists for the
// pathological case (scripted, or rapidly toggling between periods with
// genuinely changing data).
const RECAP_RATE_LIMIT = { maxAttempts: 20, windowMs: 15 * 60 * 1000 };

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = await requireAuth(req);
    const { periodType, timezone, today } = url.parse(req.url, true).query;

    if (periodType !== "week" && periodType !== "month") {
      return res.status(422).json({
        success: false,
        error: { message: 'periodType must be "week" or "month"' },
      });
    }
    if (!isValidTimezone(timezone)) {
      return res.status(422).json({
        success: false,
        error: { message: "timezone must be a valid IANA timezone name" },
      });
    }
    if (!isValidIsoDate(today)) {
      return res.status(422).json({
        success: false,
        error: { message: "today must be a valid YYYY-MM-DD date" },
      });
    }

    const { start, endExclusive } = computePeriodRange(periodType, today);

    const periodEntries = await entries.findByDateRange(userId, timezone, start, endExclusive);
    const entryIds = periodEntries.map((e) => e.id);
    const [periodActionPoints, entryTags] =
      entryIds.length > 0
        ? await Promise.all([apTable.findByEntryIds(entryIds, userId), tagsTable.findByEntryIds(entryIds, userId)])
        : [[], []];

    const fingerprint = computeFingerprint(periodEntries, periodActionPoints, entryTags);

    const cached = await recaps.findCached(userId, periodType, start);
    if (cached && cached.fingerprint === fingerprint) {
      return res.status(200).json({
        success: true,
        data: {
          periodType,
          periodStart: start,
          periodEndExclusive: endExclusive,
          summary: cached.summary,
          stats: cached.stats,
          cached: true,
        },
      });
    }

    if (periodEntries.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          periodType,
          periodStart: start,
          periodEndExclusive: endExclusive,
          summary: null,
          stats: { entryCount: 0, completedCount: 0, topTags: [] },
          cached: false,
        },
      });
    }

    if (await enforceRateLimit(req, res, "recap-user", userId, RECAP_RATE_LIMIT)) {
      return;
    }

    const completedInPeriod = periodActionPoints.filter((ap) => ap.completed);
    const entryTexts = periodEntries.map((e) => e.reflection ? `${e.input_text}\n(${e.reflection})` : e.input_text);
    const periodLabel = periodType === "week" ? "this week" : "this month";

    // Best-effort continuity: if the immediately preceding period already
    // has a cached recap, pass its summary along as optional context so
    // this one can note continuity when it's real. A cache miss (never
    // viewed, or generated fresh right now) just means no continuity
    // context this time - never worth an extra AI call or blocking on.
    const previousPeriodStart = computePreviousPeriodStart(periodType, start);
    const previousRecap = await recaps.findCached(userId, periodType, previousPeriodStart);

    const summary = await generateRecap(
      entryTexts,
      completedInPeriod.map((ap) => ap.text),
      periodLabel,
      previousRecap?.summary || null
    );

    const tagCounts = new Map();
    for (const t of entryTags) {
      tagCounts.set(t.name, (tagCounts.get(t.name) || 0) + 1);
    }
    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);

    const stats = {
      entryCount: periodEntries.length,
      completedCount: completedInPeriod.length,
      topTags,
    };

    await recaps.save(userId, periodType, start, fingerprint, summary || "", stats);

    return res.status(200).json({
      success: true,
      data: {
        periodType,
        periodStart: start,
        periodEndExclusive: endExclusive,
        summary,
        stats,
        cached: false,
      },
    });
  } catch (err) {
    if (err.status === 401) {
      return res.status(401).json({
        success: false,
        error: { message: err.message },
      });
    }

    console.error("Get recap error:", err);
    return res.status(500).json({
      success: false,
      error: { message: "Failed to generate recap" },
    });
  }
}
