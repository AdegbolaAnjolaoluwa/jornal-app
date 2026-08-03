/**
 * Database utilities: connection, queries, user-scoped data access
 */

import { sql } from "@vercel/postgres";
import { getConfig } from "../config.js";

/**
 * Execute a database query with error handling
 */
export async function query(queryText, values = []) {
  try {
    const result = await sql.query(queryText, values);
    return result.rows;
  } catch (error) {
    console.error(`Database query failed: ${error.message}`, { queryText, error });
    throw new Error(`Database query failed: ${error.message}`);
  }
}

/**
 * Get a single row from a query
 */
export async function queryOne(queryText, values = []) {
  const rows = await query(queryText, values);
  return rows[0] || null;
}

/**
 * User-scoped queries: ensure user_id is always enforced
 */
export const users = {
  async findById(id) {
    return queryOne(
      "SELECT id, email, name, nickname, profile_picture_mime_type, timezone, age, onboarding_completed_at, created_at, updated_at FROM users WHERE id = $1",
      [id]
    );
  },

  async findByEmail(email) {
    return queryOne(
      "SELECT id, email, password_hash, name, nickname, timezone, age, onboarding_completed_at, token_version, created_at, updated_at FROM users WHERE email = $1",
      [email]
    );
  },

  async create(email, passwordHash, { name, timezone, age } = {}) {
    const result = await queryOne(
      `INSERT INTO users (id, email, password_hash, name, timezone, age, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now(), now())
       RETURNING id, email, name, timezone, age, onboarding_completed_at, token_version, created_at`,
      [email, passwordHash, name || null, timezone || null, age ?? null]
    );
    return result;
  },

  /**
   * The current token_version for a user, checked against every request's
   * JWT payload by requireAuth() to enforce revocation. Returns null if the
   * user no longer exists (e.g. deleted), which requireAuth treats as
   * unauthenticated rather than throwing.
   */
  async getTokenVersion(id) {
    const row = await queryOne("SELECT token_version FROM users WHERE id = $1", [id]);
    return row ? row.token_version : null;
  },

  /**
   * Mark onboarding as complete (persisted so a refresh mid-flow doesn't re-show the guide)
   */
  async completeOnboarding(id) {
    return queryOne(
      "UPDATE users SET onboarding_completed_at = now(), updated_at = now() WHERE id = $1 RETURNING id, onboarding_completed_at",
      [id]
    );
  },

  /**
   * Store a hashed password-reset token with an expiry (raw token is only ever sent to the user, never stored)
   */
  async setResetToken(id, tokenHash, expiresAt) {
    return queryOne(
      "UPDATE users SET reset_token_hash = $1, reset_token_expires_at = $2, updated_at = now() WHERE id = $3 RETURNING id",
      [tokenHash, expiresAt, id]
    );
  },

  async findByResetTokenHash(tokenHash) {
    return queryOne(
      "SELECT id, email, reset_token_expires_at FROM users WHERE reset_token_hash = $1",
      [tokenHash]
    );
  },

  /**
   * Set a new password, invalidate the reset token (single-use), and bump
   * token_version so every other session/token for this user - e.g. one an
   * attacker already holds, which is often exactly why a reset was triggered
   * - stops working immediately instead of surviving until its own expiry.
   */
  async resetPassword(id, passwordHash) {
    return queryOne(
      `UPDATE users
       SET password_hash = $1, reset_token_hash = NULL, reset_token_expires_at = NULL,
           token_version = token_version + 1, updated_at = now()
       WHERE id = $2
       RETURNING id, token_version`,
      [passwordHash, id]
    );
  },

  async update(id, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }

    values.push(id);
    const updateQuery = `UPDATE users SET ${fields.join(", ")}, updated_at = now() WHERE id = $${paramCount} RETURNING id, email, name, nickname, created_at, updated_at`;

    return queryOne(updateQuery, values);
  },

  /**
   * Get the raw profile picture bytes for a user (kept out of findById's default select)
   */
  async getProfilePicture(id) {
    return queryOne("SELECT profile_picture_data, profile_picture_mime_type FROM users WHERE id = $1", [id]);
  },

  /**
   * Save a user's profile picture (raw bytes, not compressed: images are already compressed formats)
   */
  async savePicture(id, { data, mimeType }) {
    return queryOne(
      `UPDATE users
       SET profile_picture_data = $1, profile_picture_mime_type = $2, updated_at = now()
       WHERE id = $3
       RETURNING id, profile_picture_mime_type`,
      [data, mimeType, id]
    );
  },
};

export const entries = {
  /**
   * Get entries for a specific user. Optionally full-text search (q) and/or
   * filter by tag (tagId); both narrow the WHERE clause and compose together.
   */
  // matchMode "and" (default) is plainto_tsquery's normal behavior - every
  // term in q must match, appropriate for short, deliberate keyword search.
  // matchMode "or" turns q's words into an OR'd tsquery instead (any one
  // term matching is enough) - needed when q is a full natural-language
  // question (lib/retrieval.js's "ask your journal" feature) rather than a
  // few chosen keywords, since plainto_tsquery ANDing every word in a whole
  // sentence together means one word absent from an otherwise-perfect match
  // (e.g. the entry says "today", the question says "recently") makes the
  // match fail entirely.
  async findByUserId(userId, { limit = 50, offset = 0, q = null, tagId = null, matchMode = "and" } = {}) {
    const conditions = ["e.user_id = $1"];
    const values = [userId];
    let paramCount = 1;

    let joinClause = "";
    if (tagId) {
      joinClause = "JOIN entry_tags et ON et.entry_id = e.id";
      paramCount++;
      conditions.push(`et.tag_id = $${paramCount}`);
      values.push(tagId);
    }

    let rankSelect = "";
    let orderClause = "e.created_at DESC";
    if (q) {
      paramCount++;
      // to_tsquery(regexp_replace(plainto_tsquery(...)::text, ' & ', ' | ', 'g'))
      // takes plainto_tsquery's normal stemmed/stopword-stripped AND-query and
      // rewrites its & operators to | before re-parsing it as a tsquery - the
      // simplest way to get OR-of-terms without hand-building tsquery syntax
      // (which would need careful escaping of arbitrary user input).
      const tsqueryExpr =
        matchMode === "or"
          ? `to_tsquery('english', regexp_replace(plainto_tsquery('english', $${paramCount})::text, ' & ', ' | ', 'g'))`
          : `plainto_tsquery('english', $${paramCount})`;
      conditions.push(`e.search_vector @@ ${tsqueryExpr}`);
      values.push(q);
      rankSelect = `, ts_rank(e.search_vector, ${tsqueryExpr}) AS rank`;
      orderClause = "rank DESC, e.created_at DESC";
    }

    paramCount++;
    const limitParam = paramCount;
    values.push(limit);
    paramCount++;
    const offsetParam = paramCount;
    values.push(offset);

    return query(
      `SELECT DISTINCT e.id, e.user_id, e.input_type, e.input_text, e.title, e.reflection, e.clarifying_question,
              e.has_audio, e.created_at, e.updated_at ${rankSelect}
       FROM entries e ${joinClause}
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${orderClause}
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      values
    );
  },

  /**
   * Get all of a user's entries for export, bypassing the normal page-size cap.
   * Never selects audio bytes.
   */
  async findAllForExport(userId) {
    return query(
      `SELECT id, input_type, input_text, title, reflection, clarifying_question,
              has_audio, created_at, updated_at
       FROM entries
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );
  },

  /**
   * Get a single entry (with user_id check)
   */
  async findById(id, userId) {
    return queryOne(
      `SELECT id, user_id, input_type, input_text, title, reflection, clarifying_question, has_audio, created_at, updated_at
       FROM entries
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
  },

  /**
   * Create a new entry for a user
   */
  async create(userId, inputType, inputText) {
    return queryOne(
      `INSERT INTO entries (id, user_id, input_type, input_text, action_points, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, '[]', now(), now())
       RETURNING id, user_id, input_type, input_text, title, reflection, clarifying_question, created_at, updated_at`,
      [userId, inputType, inputText]
    );
  },

  /**
   * Update an entry's title, reflection, clarifying question, and/or its own
   * text (input_text). Only fields explicitly passed are written, so callers
   * that only touch reflection (e.g. extract.js) never disturb input_text and
   * vice versa (e.g. a text edit from the detail view never disturbs reflection).
   */
  async updateReflection(id, userId, { title, reflection, clarifyingQuestion, inputText } = {}) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (title !== undefined) {
      fields.push(`title = $${paramCount}`);
      values.push(title);
      paramCount++;
    }

    if (reflection !== undefined) {
      fields.push(`reflection = $${paramCount}`);
      values.push(reflection);
      paramCount++;
    }

    if (clarifyingQuestion !== undefined) {
      fields.push(`clarifying_question = $${paramCount}`);
      values.push(clarifyingQuestion);
      paramCount++;
    }

    if (inputText !== undefined) {
      fields.push(`input_text = $${paramCount}`);
      values.push(inputText);
      paramCount++;
    }

    if (fields.length === 0) return entries.findById(id, userId);

    values.push(id, userId);

    return queryOne(
      `UPDATE entries
       SET ${fields.join(", ")}, updated_at = now()
       WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
       RETURNING id, user_id, input_type, input_text, title, reflection, clarifying_question, created_at, updated_at`,
      values
    );
  },

  /**
   * Save compressed audio bytes for an entry (user-scoped)
   */
  async saveAudio(id, userId, { audioData, mimeType, originalBytes, compressedBytes }) {
    return queryOne(
      `UPDATE entries
       SET audio_data = $1, audio_mime_type = $2, audio_original_bytes = $3, audio_compressed_bytes = $4,
           has_audio = true, updated_at = now()
       WHERE id = $5 AND user_id = $6
       RETURNING id, has_audio, audio_original_bytes, audio_compressed_bytes`,
      [audioData, mimeType, originalBytes, compressedBytes, id, userId]
    );
  },

  /**
   * Get compressed audio bytes for an entry (user-scoped)
   */
  async getAudio(id, userId) {
    return queryOne(
      `SELECT audio_data, audio_mime_type FROM entries WHERE id = $1 AND user_id = $2 AND has_audio = true`,
      [id, userId]
    );
  },

  /**
   * Delete an entry permanently (user-scoped)
   */
  async delete(id, userId) {
    return queryOne("DELETE FROM entries WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId]);
  },

  /**
   * Get count of entries for pagination
   */
  async countByUserId(userId) {
    const result = await queryOne("SELECT COUNT(*) as count FROM entries WHERE user_id = $1", [userId]);
    return result?.count || 0;
  },

  /**
   * Every distinct local-calendar date (as YYYY-MM-DD, in the given IANA
   * timezone) the user has at least one entry on. Not paginated - streaks
   * need full history, not just the most-recent-50 window the main list
   * uses, so this is a separate, cheap query (just created_at, grouped).
   * timezone is caller-supplied (the browser's current zone) rather than
   * read from the stored user.timezone column, so it's always correct even
   * if the user is traveling or that column was never set.
   */
  async findActivityDates(userId, timezone) {
    // created_at is TIMESTAMP (no tz) holding a UTC instant (it's written via
    // now()) - a single AT TIME ZONE on a naive column reinterprets the
    // stored value as already being in that zone rather than converting it,
    // which is backwards. It has to be told it's UTC first, then converted.
    const rows = await query(
      `SELECT DISTINCT (created_at AT TIME ZONE 'UTC' AT TIME ZONE $2)::date::text AS local_date
       FROM entries
       WHERE user_id = $1
       ORDER BY local_date DESC`,
      [userId, timezone]
    );
    return rows.map((r) => r.local_date);
  },

  /**
   * Entries created within [startLocalDate, endLocalDateExclusive) in the
   * given timezone - used to build a week/month recap. Bounds are plain
   * YYYY-MM-DD dates (caller already computed the period), converted to a
   * UTC instant range for the actual comparison against created_at.
   */
  async findByDateRange(userId, timezone, startLocalDate, endLocalDateExclusive) {
    // updated_at is selected (not just created_at) so a recap's cache
    // fingerprint can detect an entry being edited after the fact - text or
    // reflection changes bump updated_at but never created_at, and the
    // period membership check below intentionally still uses created_at
    // (an edit shouldn't move an entry into a different period).
    return query(
      `SELECT id, input_type, input_text, title, reflection, created_at, updated_at
       FROM entries
       WHERE user_id = $1
         AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE $2) >= $3::date
         AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE $2) < $4::date
       ORDER BY created_at ASC`,
      [userId, timezone, startLocalDate, endLocalDateExclusive]
    );
  },

  /**
   * Fetch a specific set of entries by id (ownership-scoped) - for
   * "ask your journal" retrieval, pulling the entries backlinked from a
   * matched fact (lib/retrieval.js), regardless of how old they are (unlike
   * findByUserId's recency-ordered pagination, a fact could point at an
   * entry from months ago).
   */
  async findByIds(entryIds, userId) {
    if (entryIds.length === 0) return [];
    return query(
      `SELECT id, input_type, input_text, title, reflection, created_at
       FROM entries
       WHERE id = ANY($1) AND user_id = $2`,
      [entryIds, userId]
    );
  },
};

export const recaps = {
  async findCached(userId, periodType, periodStart) {
    return queryOne(
      `SELECT id, user_id, period_type, period_start::text AS period_start, fingerprint, summary, stats, created_at, updated_at
       FROM recaps
       WHERE user_id = $1 AND period_type = $2 AND period_start = $3`,
      [userId, periodType, periodStart]
    );
  },

  /**
   * Upsert on (user_id, period_type, period_start): re-viewing the same
   * period after its fingerprint changes replaces the stored recap rather
   * than accumulating stale rows.
   */
  async save(userId, periodType, periodStart, fingerprint, summary, stats) {
    return queryOne(
      `INSERT INTO recaps (id, user_id, period_type, period_start, fingerprint, summary, stats, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now(), now())
       ON CONFLICT (user_id, period_type, period_start)
       DO UPDATE SET fingerprint = $4, summary = $5, stats = $6, updated_at = now()
       RETURNING id, user_id, period_type, period_start::text AS period_start, fingerprint, summary, stats, created_at, updated_at`,
      [userId, periodType, periodStart, fingerprint, summary, JSON.stringify(stats)]
    );
  },
};

// due_date is cast to text in SQL (rather than left as a DATE) so the
// driver hands back a plain "YYYY-MM-DD" string instead of parsing it into
// a JS Date object - the pg driver parses a DATE as UTC midnight, and
// Date's own JSON serialization (toISOString(), used implicitly by
// JSON.stringify in every API response) always renders in UTC, which
// shifts the date backwards by a day for any timezone ahead of UTC. Casting
// to text in the query sidesteps that Date round-trip entirely.
const ACTION_POINT_COLUMNS =
  "ap.id, ap.entry_id, ap.text, ap.completed, ap.remind_at, ap.reminder_sent_at, ap.due_date::text AS due_date, ap.completed_at, ap.created_at, ap.updated_at";

export const actionPoints = {
  /**
   * Get all action points for an entry (with user ownership check)
   */
  async findByEntryId(entryId, userId) {
    return query(
      `SELECT ${ACTION_POINT_COLUMNS}
       FROM action_points ap
       JOIN entries e ON ap.entry_id = e.id
       WHERE ap.entry_id = $1 AND e.user_id = $2
       ORDER BY ap.created_at ASC`,
      [entryId, userId]
    );
  },

  /**
   * Get action points for multiple entries at once (avoids N+1 when listing entries)
   */
  async findByEntryIds(entryIds, userId) {
    if (entryIds.length === 0) return [];
    return query(
      `SELECT ${ACTION_POINT_COLUMNS}
       FROM action_points ap
       JOIN entries e ON ap.entry_id = e.id
       WHERE ap.entry_id = ANY($1) AND e.user_id = $2
       ORDER BY ap.created_at ASC`,
      [entryIds, userId]
    );
  },

  /**
   * Get all action points for a user across every entry, with a snippet of the source entry's text.
   */
  async findByUserId(userId) {
    return query(
      `SELECT ${ACTION_POINT_COLUMNS}, e.input_text AS entry_input_text
       FROM action_points ap
       JOIN entries e ON ap.entry_id = e.id
       WHERE e.user_id = $1
       ORDER BY ap.created_at ASC`,
      [userId]
    );
  },

  /**
   * Create an action point for an entry. dueDate (optional) is a
   * YYYY-MM-DD string the AI parsed from a relative phrase in the entry
   * text ("by tomorrow", "due Friday") at extraction time.
   */
  async create(entryId, userId, text, dueDate = null) {
    // Verify entry ownership before creating action point
    const entry = await entries.findById(entryId, userId);
    if (!entry) throw new Error("Entry not found");

    return queryOne(
      `INSERT INTO action_points (id, entry_id, text, completed, due_date, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, false, $3, now(), now())
       RETURNING id, entry_id, text, completed, remind_at, reminder_sent_at, due_date::text AS due_date, completed_at, created_at, updated_at`,
      [entryId, text, dueDate]
    );
  },

  /**
   * Update an action point's completed, remindAt, and/or dueDate fields (user-scoped)
   */
  async update(apId, userId, { completed, remindAt, dueDate } = {}) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (completed !== undefined) {
      fields.push(`completed = $${paramCount}`);
      values.push(completed);
      paramCount++;
      // Stamp (or clear) completed_at alongside completed itself, so it
      // reflects only the most recent completion toggle - unchecking then
      // rechecking a task should reset its "completed this month" clock,
      // same as if it were completed fresh.
      fields.push(`completed_at = ${completed ? "now()" : "NULL"}`);
    }

    if (remindAt !== undefined) {
      fields.push(`remind_at = $${paramCount}`);
      values.push(remindAt);
      paramCount++;
      // Setting a new reminder time clears any prior "sent" mark so it can fire again
      fields.push(`reminder_sent_at = NULL`);
    }

    if (dueDate !== undefined) {
      fields.push(`due_date = $${paramCount}`);
      values.push(dueDate);
      paramCount++;
    }

    if (fields.length === 0) return null;

    values.push(apId, userId);

    const result = await queryOne(
      `UPDATE action_points ap
       SET ${fields.join(", ")}, updated_at = now()
       FROM entries e
       WHERE ap.id = $${paramCount} AND ap.entry_id = e.id AND e.user_id = $${paramCount + 1}
       RETURNING ap.id, ap.entry_id, ap.text, ap.completed, ap.remind_at, ap.reminder_sent_at, ap.due_date::text AS due_date, ap.completed_at, ap.created_at, ap.updated_at`,
      values
    );
    return result;
  },

  /**
   * Delete an action point
   */
  async delete(apId, userId) {
    return queryOne(
      `DELETE FROM action_points ap
       USING entries e
       WHERE ap.id = $1 AND ap.entry_id = e.id AND e.user_id = $2
       RETURNING ap.id`,
      [apId, userId]
    );
  },

  /**
   * Find reminders that are due and haven't been sent yet.
   * Not user-scoped by design: this runs cross-user from the cron job, not a session.
   */
  async findDueReminders() {
    return query(
      `SELECT ap.id, ap.text, ap.remind_at, e.user_id, u.email
       FROM action_points ap
       JOIN entries e ON ap.entry_id = e.id
       JOIN users u ON e.user_id = u.id
       WHERE ap.remind_at IS NOT NULL
         AND ap.remind_at <= now()
         AND ap.reminder_sent_at IS NULL
       ORDER BY ap.remind_at ASC
       LIMIT 100`
    );
  },

  /**
   * Mark a reminder as attempted/sent. Not user-scoped, called from the cron job.
   */
  async markReminderSent(apId) {
    return queryOne(`UPDATE action_points SET reminder_sent_at = now() WHERE id = $1 RETURNING id`, [apId]);
  },
};

export const entryMessages = {
  /**
   * Get all chat messages for an entry (with user ownership check)
   */
  async findByEntryId(entryId, userId) {
    return query(
      `SELECT m.id, m.entry_id, m.role, m.content, m.created_at
       FROM entry_messages m
       JOIN entries e ON m.entry_id = e.id
       WHERE m.entry_id = $1 AND e.user_id = $2
       ORDER BY m.created_at ASC`,
      [entryId, userId]
    );
  },

  /**
   * Append a message to an entry's chat thread
   */
  async create(entryId, userId, role, content) {
    // Verify entry ownership before creating a message
    const entry = await entries.findById(entryId, userId);
    if (!entry) throw new Error("Entry not found");

    return queryOne(
      `INSERT INTO entry_messages (id, entry_id, role, content, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, now())
       RETURNING id, entry_id, role, content, created_at`,
      [entryId, role, content]
    );
  },
};

export const userFacts = {
  /**
   * Get a user's stored facts, most recent first, capped to avoid unbounded prompt growth.
   */
  async findByUserId(userId, limit = 100) {
    return query(
      `SELECT id, user_id, text, entry_id, created_at
       FROM user_facts
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
  },

  /**
   * Store a new fact for a user, optionally tagged with the entry it was extracted from.
   */
  async create(userId, text, entryId = null) {
    return queryOne(
      `INSERT INTO user_facts (id, user_id, text, entry_id, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, now())
       RETURNING id, user_id, text, entry_id, created_at`,
      [userId, text, entryId]
    );
  },
};

export const askThreads = {
  /**
   * A user's past "ask your journal" threads, most recent first. Not yet
   * surfaced in the UI (v1 only shows the most recent thread), but built
   * now since threads are persisted from day one - matches every other AI
   * feature in this app (entries, recaps, entry-chat all persist).
   */
  async findByUserId(userId, limit = 50) {
    return query(
      `SELECT id, user_id, question, created_at, updated_at
       FROM ask_threads
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
  },

  async findById(id, userId) {
    return queryOne(
      `SELECT id, user_id, question, created_at, updated_at
       FROM ask_threads
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
  },

  async create(userId, question) {
    return queryOne(
      `INSERT INTO ask_threads (id, user_id, question, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, now(), now())
       RETURNING id, user_id, question, created_at, updated_at`,
      [userId, question]
    );
  },
};

export const askMessages = {
  /**
   * Get all messages in an ask-thread (with user ownership check, joined
   * through ask_threads.user_id - unlike entry_messages, there's no owning
   * entry to join through, since the whole point is spanning entries).
   */
  async findByThreadId(threadId, userId) {
    return query(
      `SELECT m.id, m.thread_id, m.role, m.content, m.created_at
       FROM ask_messages m
       JOIN ask_threads t ON m.thread_id = t.id
       WHERE m.thread_id = $1 AND t.user_id = $2
       ORDER BY m.created_at ASC`,
      [threadId, userId]
    );
  },

  async create(threadId, userId, role, content) {
    const thread = await askThreads.findById(threadId, userId);
    if (!thread) throw new Error("Thread not found");

    return queryOne(
      `INSERT INTO ask_messages (id, thread_id, role, content, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, now())
       RETURNING id, thread_id, role, content, created_at`,
      [threadId, role, content]
    );
  },
};

export const tags = {
  /**
   * All of a user's tags, alphabetical.
   */
  async findByUserId(userId) {
    return query("SELECT id, name FROM tags WHERE user_id = $1 ORDER BY lower(name) ASC", [userId]);
  },

  /**
   * Prefix-match a user's own tags, case-insensitive, for autocomplete.
   */
  async findByPrefix(userId, prefix, limit = 10) {
    return query(
      "SELECT id, name FROM tags WHERE user_id = $1 AND name ILIKE $2 ORDER BY lower(name) ASC LIMIT $3",
      [userId, `${prefix}%`, limit]
    );
  },

  /**
   * Get a tag by name, creating it if it doesn't exist yet (case-insensitive
   * dedupe via the unique index on (user_id, lower(name))).
   */
  async findOrCreate(userId, name) {
    const created = await queryOne(
      `INSERT INTO tags (id, user_id, name, created_at)
       VALUES (gen_random_uuid(), $1, $2, now())
       ON CONFLICT (user_id, lower(name)) DO NOTHING
       RETURNING id, name`,
      [userId, name]
    );
    if (created) return created;
    return queryOne("SELECT id, name FROM tags WHERE user_id = $1 AND lower(name) = lower($2)", [userId, name]);
  },

  /**
   * Get the tags on a single entry (with user ownership check).
   */
  async findByEntryId(entryId, userId) {
    return query(
      `SELECT t.id, t.name
       FROM tags t
       JOIN entry_tags et ON et.tag_id = t.id
       JOIN entries e ON e.id = et.entry_id
       WHERE et.entry_id = $1 AND e.user_id = $2
       ORDER BY lower(t.name) ASC`,
      [entryId, userId]
    );
  },

  /**
   * Get tags for multiple entries at once (avoids N+1 when listing entries).
   */
  async findByEntryIds(entryIds, userId) {
    if (entryIds.length === 0) return [];
    return query(
      `SELECT et.entry_id, t.id, t.name
       FROM entry_tags et
       JOIN tags t ON t.id = et.tag_id
       JOIN entries e ON e.id = et.entry_id
       WHERE et.entry_id = ANY($1) AND e.user_id = $2
       ORDER BY lower(t.name) ASC`,
      [entryIds, userId]
    );
  },

  /**
   * Replace the full tag set on an entry (used both when creating an entry
   * with tags and when editing an existing entry's tags).
   */
  async setForEntry(entryId, userId, tagNames) {
    const entry = await entries.findById(entryId, userId);
    if (!entry) throw new Error("Entry not found");

    const tagRows = [];
    for (const name of tagNames) {
      tagRows.push(await tags.findOrCreate(userId, name));
    }

    await query("DELETE FROM entry_tags WHERE entry_id = $1", [entryId]);

    for (const tag of tagRows) {
      await query(
        "INSERT INTO entry_tags (entry_id, tag_id, created_at) VALUES ($1, $2, now()) ON CONFLICT DO NOTHING",
        [entryId, tag.id]
      );
    }

    return tags.findByEntryId(entryId, userId);
  },
};

/**
 * Initialize database schema (run once at setup)
 */
export async function initializeSchema() {
  try {
    // Create users table
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      );
    `;

    // Create entries table
    await sql`
      CREATE TABLE IF NOT EXISTS entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        input_type TEXT CHECK (input_type IN ('voice', 'text')),
        input_text TEXT,
        action_points JSONB DEFAULT '[]',
        reflection TEXT,
        clarifying_question TEXT,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      );
    `;

    // Create action_points table
    await sql`
      CREATE TABLE IF NOT EXISTS action_points (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        completed BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      );
    `;

    // Add reminder columns (ALTER since CREATE IF NOT EXISTS won't touch an existing table)
    await sql`ALTER TABLE action_points ADD COLUMN IF NOT EXISTS remind_at TIMESTAMP;`;
    await sql`ALTER TABLE action_points ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP;`;

    // Due date: a day-granular deadline the AI parses from phrases like "by
    // Friday" or "due tomorrow" in the entry text. DATE (not TIMESTAMP) since
    // due dates are day-level by nature, distinct from remind_at above which
    // is a precise moment for a notification.
    await sql`ALTER TABLE action_points ADD COLUMN IF NOT EXISTS due_date DATE;`;

    // When an action point was marked completed - distinct from updated_at,
    // which also bumps on unrelated edits (setting a reminder, changing the
    // due date) and would otherwise make a task look freshly completed every
    // time it's touched. The to-do list's Completed column filters to the
    // current calendar month using this column specifically.
    await sql`ALTER TABLE action_points ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;`;

    // Add audio columns to entries (compressed voice-note bytes)
    await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS audio_data BYTEA;`;
    await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS audio_mime_type TEXT;`;
    await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS audio_original_bytes INTEGER;`;
    await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS audio_compressed_bytes INTEGER;`;
    await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS has_audio BOOLEAN NOT NULL DEFAULT false;`;

    // Archive and Trash were removed as features - drop their columns.
    // Dropping (rather than just ignoring) restores anything that was
    // archived/trashed back to a normal, fully visible entry, since the
    // queries above no longer filter on these flags either way.
    await sql`ALTER TABLE entries DROP COLUMN IF EXISTS is_archived;`;
    await sql`ALTER TABLE entries DROP COLUMN IF EXISTS archived_at;`;
    await sql`ALTER TABLE entries DROP COLUMN IF EXISTS is_deleted;`;
    await sql`ALTER TABLE entries DROP COLUMN IF EXISTS deleted_at;`;

    // Add a short AI-generated title to entries (sidebar history label, like a
    // chat app's conversation title). NULL on entries created before this
    // column existed and on any entry whose extraction hasn't completed yet -
    // callers fall back to a truncated input_text snippet in that case.
    await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS title TEXT;`;

    // Add profile columns to users (editable Name/Nickname/Profile Picture)
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT;`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture_data BYTEA;`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture_mime_type TEXT;`;

    // Add onboarding columns to users (guided first-entry flow, persisted so it survives a refresh)
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP;`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT;`;

    // Add password reset columns to users (single-use token + expiry)
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash TEXT;`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMP;`;

    // Add age to users (optional, collected during signup step 4; no validation/enforcement)
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS age INTEGER;`;

    // Session-revocation counter: embedded in every JWT at sign-time and
    // checked on every request. Bumping this on password reset invalidates
    // all previously issued tokens for that user immediately, without needing
    // a token blacklist or server-side session store.
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;`;

    // Create entry_messages table (clarifying-question chat thread per entry)
    await sql`
      CREATE TABLE IF NOT EXISTS entry_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT now()
      );
    `;

    // Create user_facts table (durable cross-entry facts about the user)
    await sql`
      CREATE TABLE IF NOT EXISTS user_facts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        entry_id UUID REFERENCES entries(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT now()
      );
    `;

    // Originally ON DELETE SET NULL (a fact could outlive the entry it was
    // learned from). Deleting an entry from the sidebar now deletes
    // everything tied to it - reminders, action points, chat thread, and
    // facts - so this needs to be CASCADE too. CREATE TABLE IF NOT EXISTS
    // above won't touch an already-existing table/constraint, hence the
    // explicit drop-and-recreate here; conditional on the old constraint
    // still being SET NULL so this is a no-op once already migrated.
    await sql`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'user_facts_entry_id_fkey' AND confdeltype = 'n'
        ) THEN
          ALTER TABLE user_facts DROP CONSTRAINT user_facts_entry_id_fkey;
          ALTER TABLE user_facts
            ADD CONSTRAINT user_facts_entry_id_fkey
            FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `;

    // Create tags table (per-user free-form vocabulary, case-insensitive unique per user)
    await sql`
      CREATE TABLE IF NOT EXISTS tags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT now()
      );
    `;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_user_id_name ON tags(user_id, lower(name));`;

    // Create entry_tags join table (many-to-many)
    await sql`
      CREATE TABLE IF NOT EXISTS entry_tags (
        entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT now(),
        PRIMARY KEY (entry_id, tag_id)
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_entry_tags_tag_id ON entry_tags(tag_id);`;

    // Full-text search over input_text + reflection. A STORED generated column
    // (not a trigger, not query-time to_tsvector) so a GIN index can be used on
    // every search, and existing rows backfill automatically the moment this
    // ALTER runs - no separate migration/backfill script needed.
    await sql`
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS search_vector tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(input_text, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(reflection, '')), 'B')
      ) STORED;
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_entries_search_vector ON entries USING GIN(search_vector);`;

    // Rate limiting: one row per (bucket, key) sliding window, e.g.
    // bucket="login", key="<ip>" or bucket="signup", key="<email>". Rows are
    // opportunistically pruned by handleRateLimit() below rather than a
    // separate cleanup job, since this table stays small (failed attempts
    // only, short window) at this app's scale.
    await sql`
      CREATE TABLE IF NOT EXISTS rate_limits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket TEXT NOT NULL,
        rate_key TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT now()
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_rate_limits_bucket_key_created ON rate_limits(bucket, rate_key, created_at);`;

    // Cached AI-generated week/month recaps. One row per (user, period_type,
    // period_start) - regenerated on demand when viewed, but only if
    // fingerprint (entry count + latest updated_at in that period,
    // concatenated) no longer matches what's stored, so re-viewing an
    // unchanged period is instant and free instead of re-calling the AI.
    await sql`
      CREATE TABLE IF NOT EXISTS recaps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        period_type TEXT NOT NULL CHECK (period_type IN ('week', 'month')),
        period_start DATE NOT NULL,
        fingerprint TEXT NOT NULL,
        summary TEXT NOT NULL,
        stats JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now(),
        UNIQUE (user_id, period_type, period_start)
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_recaps_user_period ON recaps(user_id, period_type, period_start);`;

    // "Ask your journal" - a persisted Q&A thread grounded in retrieved
    // entries/facts (see lib/retrieval.js), not scoped to a single entry the
    // way entry_messages is. user_id lives directly on the thread (unlike
    // entry_messages, which has no owning user - ownership there is
    // transitive through entry_id -> entries.user_id - a journal-wide
    // thread has no single owning entry).
    await sql`
      CREATE TABLE IF NOT EXISTS ask_threads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS ask_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        thread_id UUID NOT NULL REFERENCES ask_threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT now()
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_ask_threads_user_id ON ask_threads(user_id, created_at DESC);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ask_messages_thread_id ON ask_messages(thread_id);`;

    // Create indexes for performance
    await sql`CREATE INDEX IF NOT EXISTS idx_entries_user_id ON entries(user_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at DESC);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_action_points_entry_id ON action_points(entry_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_action_points_remind_at ON action_points(remind_at) WHERE remind_at IS NOT NULL;`;
    await sql`CREATE INDEX IF NOT EXISTS idx_entry_messages_entry_id ON entry_messages(entry_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_user_facts_user_id ON user_facts(user_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_users_reset_token_hash ON users(reset_token_hash) WHERE reset_token_hash IS NOT NULL;`;
    await sql`CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);`;

    console.log("Database schema initialized successfully");
  } catch (error) {
    console.error("Failed to initialize database schema:", error);
    throw error;
  }
}
