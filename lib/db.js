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
      "SELECT id, email, name, nickname, profile_picture_mime_type, timezone, onboarding_completed_at, created_at, updated_at FROM users WHERE id = $1",
      [id]
    );
  },

  async findByEmail(email) {
    return queryOne(
      "SELECT id, email, password_hash, name, nickname, timezone, onboarding_completed_at, created_at, updated_at FROM users WHERE email = $1",
      [email]
    );
  },

  async create(email, passwordHash, { name, timezone } = {}) {
    const result = await queryOne(
      `INSERT INTO users (id, email, password_hash, name, timezone, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now())
       RETURNING id, email, name, timezone, onboarding_completed_at, created_at`,
      [email, passwordHash, name || null, timezone || null]
    );
    return result;
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
   * Set a new password and invalidate the reset token (single-use)
   */
  async resetPassword(id, passwordHash) {
    return queryOne(
      `UPDATE users
       SET password_hash = $1, reset_token_hash = NULL, reset_token_expires_at = NULL, updated_at = now()
       WHERE id = $2
       RETURNING id`,
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
   * Save a user's profile picture (raw bytes, not compressed — images are already compressed formats)
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
   * Get entries for a specific user
   */
  async findByUserId(userId, limit = 50, offset = 0) {
    return query(
      `SELECT id, user_id, input_type, input_text, reflection, clarifying_question, has_audio, is_archived, is_deleted, created_at, updated_at
       FROM entries
       WHERE user_id = $1 AND is_archived = false AND is_deleted = false
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
  },

  /**
   * Get archived entries for a user
   */
  async findArchivedByUserId(userId, limit = 50, offset = 0) {
    return query(
      `SELECT id, user_id, input_type, input_text, reflection, clarifying_question, has_audio, is_archived, archived_at, is_deleted, created_at, updated_at
       FROM entries
       WHERE user_id = $1 AND is_archived = true AND is_deleted = false
       ORDER BY archived_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
  },

  /**
   * Get trashed (soft-deleted) entries for a user
   */
  async findTrashedByUserId(userId, limit = 50, offset = 0) {
    return query(
      `SELECT id, user_id, input_type, input_text, reflection, clarifying_question, has_audio, is_archived, is_deleted, deleted_at, created_at, updated_at
       FROM entries
       WHERE user_id = $1 AND is_deleted = true
       ORDER BY deleted_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
  },

  /**
   * Get a single entry (with user_id check)
   */
  async findById(id, userId) {
    return queryOne(
      `SELECT id, user_id, input_type, input_text, reflection, clarifying_question, has_audio, created_at, updated_at
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
       RETURNING id, user_id, input_type, input_text, reflection, clarifying_question, created_at, updated_at`,
      [userId, inputType, inputText]
    );
  },

  /**
   * Update entry's reflection and clarifying question (action points now live in the action_points table)
   */
  async updateReflection(id, userId, { reflection = null, clarifyingQuestion = null }) {
    return queryOne(
      `UPDATE entries
       SET reflection = $1, clarifying_question = $2, updated_at = now()
       WHERE id = $3 AND user_id = $4
       RETURNING id, user_id, input_type, input_text, reflection, clarifying_question, created_at, updated_at`,
      [reflection, clarifyingQuestion, id, userId]
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
   * Archive/unarchive an entry (user-scoped). Reversible, unlike delete.
   */
  async archive(id, userId) {
    return queryOne(
      `UPDATE entries
       SET is_archived = true, archived_at = now(), updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, input_type, input_text, reflection, clarifying_question, has_audio, is_archived, archived_at, created_at, updated_at`,
      [id, userId]
    );
  },

  async unarchive(id, userId) {
    return queryOne(
      `UPDATE entries
       SET is_archived = false, archived_at = NULL, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, input_type, input_text, reflection, clarifying_question, has_audio, is_archived, archived_at, created_at, updated_at`,
      [id, userId]
    );
  },

  /**
   * Move to trash / restore an entry (user-scoped). Reversible, unlike delete.
   */
  async softDelete(id, userId) {
    return queryOne(
      `UPDATE entries
       SET is_deleted = true, deleted_at = now(), updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, input_type, input_text, reflection, clarifying_question, has_audio, is_archived, is_deleted, deleted_at, created_at, updated_at`,
      [id, userId]
    );
  },

  async restore(id, userId) {
    return queryOne(
      `UPDATE entries
       SET is_deleted = false, deleted_at = NULL, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, input_type, input_text, reflection, clarifying_question, has_audio, is_archived, is_deleted, deleted_at, created_at, updated_at`,
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
};

const ACTION_POINT_COLUMNS = "ap.id, ap.entry_id, ap.text, ap.completed, ap.remind_at, ap.reminder_sent_at, ap.created_at, ap.updated_at";

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
   * Create an action point for an entry
   */
  async create(entryId, userId, text) {
    // Verify entry ownership before creating action point
    const entry = await entries.findById(entryId, userId);
    if (!entry) throw new Error("Entry not found");

    return queryOne(
      `INSERT INTO action_points (id, entry_id, text, completed, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, false, now(), now())
       RETURNING id, entry_id, text, completed, remind_at, reminder_sent_at, created_at, updated_at`,
      [entryId, text]
    );
  },

  /**
   * Update an action point's completed and/or remindAt fields (user-scoped)
   */
  async update(apId, userId, { completed, remindAt } = {}) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (completed !== undefined) {
      fields.push(`completed = $${paramCount}`);
      values.push(completed);
      paramCount++;
    }

    if (remindAt !== undefined) {
      fields.push(`remind_at = $${paramCount}`);
      values.push(remindAt);
      paramCount++;
      // Setting a new reminder time clears any prior "sent" mark so it can fire again
      fields.push(`reminder_sent_at = NULL`);
    }

    if (fields.length === 0) return null;

    values.push(apId, userId);

    const result = await queryOne(
      `UPDATE action_points ap
       SET ${fields.join(", ")}, updated_at = now()
       FROM entries e
       WHERE ap.id = $${paramCount} AND ap.entry_id = e.id AND e.user_id = $${paramCount + 1}
       RETURNING ap.id, ap.entry_id, ap.text, ap.completed, ap.remind_at, ap.reminder_sent_at, ap.created_at, ap.updated_at`,
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
   * Not user-scoped by design — this runs cross-user from the cron job, not a session.
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
   * Mark a reminder as attempted/sent. Not user-scoped — called from the cron job.
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

    // Add audio columns to entries (compressed voice-note bytes)
    await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS audio_data BYTEA;`;
    await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS audio_mime_type TEXT;`;
    await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS audio_original_bytes INTEGER;`;
    await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS audio_compressed_bytes INTEGER;`;
    await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS has_audio BOOLEAN NOT NULL DEFAULT false;`;

    // Add archive columns to entries (reversible soft-delete)
    await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;`;
    await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;`;

    // Add trash columns to entries (separate axis from archive; reversible soft-delete)
    await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;`;
    await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;`;

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

    // Create indexes for performance
    await sql`CREATE INDEX IF NOT EXISTS idx_entries_user_id ON entries(user_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at DESC);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_action_points_entry_id ON action_points(entry_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_action_points_remind_at ON action_points(remind_at) WHERE remind_at IS NOT NULL;`;
    await sql`CREATE INDEX IF NOT EXISTS idx_entry_messages_entry_id ON entry_messages(entry_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_user_facts_user_id ON user_facts(user_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_users_reset_token_hash ON users(reset_token_hash) WHERE reset_token_hash IS NOT NULL;`;

    console.log("Database schema initialized successfully");
  } catch (error) {
    console.error("Failed to initialize database schema:", error);
    throw error;
  }
}
