/**
 * One-off backfill: generate a short AI title for every existing entry that
 * doesn't have one yet (title IS NULL), without touching reflection, action
 * points, or facts. Safe to re-run - it only ever selects rows still missing
 * a title, so already-backfilled or newly-created entries are skipped.
 *
 * Usage: node scripts/backfill-titles.mjs
 */

import { query, entries } from "../lib/db.js";
import { generateTitle } from "../lib/ai.js";

const BATCH_SIZE = 20;
const DELAY_BETWEEN_CALLS_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let totalProcessed = 0;
  let totalFailed = 0;

  while (true) {
    const rows = await query(
      `SELECT id, user_id, input_text FROM entries
       WHERE title IS NULL AND input_text IS NOT NULL AND input_text <> ''
       ORDER BY created_at ASC
       LIMIT $1`,
      [BATCH_SIZE]
    );

    if (rows.length === 0) break;

    for (const row of rows) {
      try {
        const title = await generateTitle(row.input_text);
        await entries.updateReflection(row.id, row.user_id, { title });
        totalProcessed++;
        console.log(`[ok] ${row.id}: "${title}"`);
      } catch (error) {
        totalFailed++;
        console.error(`[fail] ${row.id}: ${error.message}`);
      }
      await sleep(DELAY_BETWEEN_CALLS_MS);
    }
  }

  console.log(`\nDone. Backfilled: ${totalProcessed}, failed: ${totalFailed}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Backfill script crashed:", error);
    process.exit(1);
  });
