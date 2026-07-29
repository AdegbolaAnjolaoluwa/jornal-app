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
 * A cheap, order-independent signature of "what's in this period" - changes
 * whenever an entry is added/edited/deleted or an action point's completion
 * state changes within the period, without needing to store/diff the full
 * dataset. Used to decide whether a cached recap is still valid.
 */
export function computeFingerprint(entries, actionPoints) {
  const entryPart = entries
    .map((e) => `${e.id}:${e.created_at}`)
    .sort()
    .join(",");
  const apPart = actionPoints
    .map((ap) => `${ap.id}:${ap.completed}:${ap.completed_at || ""}`)
    .sort()
    .join(",");
  return `${entries.length}|${entryPart}|${apPart}`;
}
