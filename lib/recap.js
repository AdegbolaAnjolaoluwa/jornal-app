/**
 * Pure period-boundary and stats logic for recaps, kept separate from the
 * DB/API layer so it can be unit tested without a database.
 */

/**
 * The [start, endExclusive) local-date range (both "YYYY-MM-DD") for the
 * current week or month containing `today` ("YYYY-MM-DD"). Week starts on
 * Monday (ISO convention). endExclusive is one day past the period's last
 * day, matching how findByDateRange's `< endExclusive` comparison expects it.
 */
export function computePeriodRange(periodType, today) {
  const date = new Date(`${today}T00:00:00Z`);

  if (periodType === "week") {
    // getUTCDay(): 0=Sunday..6=Saturday. Days since the most recent Monday.
    const dayOfWeek = date.getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const start = new Date(date);
    start.setUTCDate(start.getUTCDate() - daysSinceMonday);
    const endExclusive = new Date(start);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 7);
    return { start: toDateStr(start), endExclusive: toDateStr(endExclusive) };
  }

  if (periodType === "month") {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const endExclusive = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    return { start: toDateStr(start), endExclusive: toDateStr(endExclusive) };
  }

  throw new Error(`Unknown periodType: ${periodType}`);
}

function toDateStr(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * The period_start of the period immediately before the one starting at
 * `periodStart` - reuses computePeriodRange rather than duplicating
 * month/week arithmetic, by asking for the period containing the day just
 * before this one starts.
 */
export function computePreviousPeriodStart(periodType, periodStart) {
  const dayBefore = new Date(`${periodStart}T00:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  return computePeriodRange(periodType, toDateStr(dayBefore)).start;
}

/**
 * A cheap, order-independent signature of "what's in this period" - changes
 * whenever an entry is added/removed/edited (text or reflection - keyed on
 * updated_at, not created_at, so an edit after the fact is caught even
 * though it doesn't change which period the entry belongs to), an action
 * point's completion state changes, or an entry's tags change. Used to
 * decide whether a cached recap is still valid.
 *
 * entryTags: flat array of { entry_id, id } pairs (as returned by
 * tags.findByEntryIds) covering the same entries - not entries[].tags,
 * since findByDateRange doesn't attach tags itself.
 */
export function computeFingerprint(entries, actionPoints, entryTags = []) {
  const entryPart = entries
    .map((e) => `${e.id}:${e.updated_at}`)
    .sort()
    .join(",");
  const apPart = actionPoints
    .map((ap) => `${ap.id}:${ap.completed}:${ap.completed_at || ""}`)
    .sort()
    .join(",");
  const tagPart = entryTags
    .map((t) => `${t.entry_id}:${t.id}`)
    .sort()
    .join(",");
  return `${entries.length}|${entryPart}|${apPart}|${tagPart}`;
}
