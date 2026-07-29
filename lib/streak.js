/**
 * Pure streak-calculation logic, kept separate from the DB/API layer so it
 * can be unit tested without a database.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(aIso, bIso) {
  const a = new Date(`${aIso}T00:00:00Z`);
  const b = new Date(`${bIso}T00:00:00Z`);
  return Math.round((a.getTime() - b.getTime()) / DAY_MS);
}

/**
 * activityDates: array of "YYYY-MM-DD" strings the user has an entry on, any
 * order, duplicates fine. today: "YYYY-MM-DD" for the caller's current local
 * date. Returns the current consecutive-day streak ending today or
 * yesterday - writing yesterday still counts as an active streak (you have
 * until the end of today to keep it alive), but two-or-more days of silence
 * breaks it to 0. Also reports whether today itself already has an entry,
 * since that determines whether a streak is "at risk" (nothing written yet,
 * getting late) vs. already secured for today.
 */
export function computeStreak(activityDates, today) {
  const dateSet = new Set(activityDates);
  const wroteToday = dateSet.has(today);

  // Anchor the walk at today if it has an entry, otherwise at yesterday -
  // this is what makes "haven't written yet today" not immediately read as
  // a broken streak while there's still time left in the day.
  let cursor = today;
  if (!wroteToday) {
    cursor = new Date(`${today}T00:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    cursor = cursor.toISOString().slice(0, 10);
  }

  if (!dateSet.has(cursor)) {
    return { current: 0, wroteToday };
  }

  let count = 0;
  let d = cursor;
  while (dateSet.has(d)) {
    count++;
    const prev = new Date(`${d}T00:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() - 1);
    d = prev.toISOString().slice(0, 10);
  }

  return { current: count, wroteToday };
}

export { daysBetween };
