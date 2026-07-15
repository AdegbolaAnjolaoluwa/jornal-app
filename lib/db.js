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
    return queryOne("SELECT id, email, created_at, updated_at FROM users WHERE id = $1", [id]);
  },

  async findByEmail(email) {
    return queryOne("SELECT id, email, password_hash, created_at, updated_at FROM users WHERE email = $1", [
      email,
    ]);
  },

  async create(email, passwordHash) {
    const result = await queryOne(
      "INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, now(), now()) RETURNING id, email, created_at",
      [email, passwordHash]
    );
    return result;
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
    const updateQuery = `UPDATE users SET ${fields.join(", ")}, updated_at = now() WHERE id = $${paramCount} RETURNING id, email, created_at, updated_at`;

    return queryOne(updateQuery, values);
  },
};

export const entries = {
  /**
   * Get entries for a specific user
   */
  async findByUserId(userId, limit = 50, offset = 0) {
    return query(
      `SELECT id, user_id, input_type, input_text, action_points, reflection, clarifying_question, created_at, updated_at
       FROM entries
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
  },

  /**
   * Get a single entry (with user_id check)
   */
  async findById(id, userId) {
    return queryOne(
      `SELECT id, user_id, input_type, input_text, action_points, reflection, clarifying_question, created_at, updated_at
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
       RETURNING id, user_id, input_type, input_text, action_points, reflection, clarifying_question, created_at, updated_at`,
      [userId, inputType, inputText]
    );
  },

  /**
   * Update entry with extraction results
   */
  async updateExtraction(id, userId, extraction) {
    const { actionPoints = [], reflection = null, clarifyingQuestion = null } = extraction;

    return queryOne(
      `UPDATE entries
       SET action_points = $1, reflection = $2, clarifying_question = $3, updated_at = now()
       WHERE id = $4 AND user_id = $5
       RETURNING id, user_id, input_type, input_text, action_points, reflection, clarifying_question, created_at, updated_at`,
      [JSON.stringify(actionPoints), reflection, clarifyingQuestion, id, userId]
    );
  },

  /**
   * Delete an entry (user-scoped)
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

export const actionPoints = {
  /**
   * Get all action points for an entry (with user ownership check)
   */
  async findByEntryId(entryId, userId) {
    return query(
      `SELECT ap.id, ap.entry_id, ap.text, ap.completed, ap.created_at, ap.updated_at
       FROM action_points ap
       JOIN entries e ON ap.entry_id = e.id
       WHERE ap.entry_id = $1 AND e.user_id = $2
       ORDER BY ap.created_at ASC`,
      [entryId, userId]
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
       RETURNING id, entry_id, text, completed, created_at, updated_at`,
      [entryId, text]
    );
  },

  /**
   * Update action point completion status
   */
  async updateCompleted(apId, userId, completed) {
    // Verify ownership through entry relationship
    const result = await queryOne(
      `UPDATE action_points ap
       SET completed = $1, updated_at = now()
       FROM entries e
       WHERE ap.id = $2 AND ap.entry_id = e.id AND e.user_id = $3
       RETURNING ap.id, ap.entry_id, ap.text, ap.completed, ap.created_at, ap.updated_at`,
      [completed, apId, userId]
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

    // Create indexes for performance
    await sql`CREATE INDEX IF NOT EXISTS idx_entries_user_id ON entries(user_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at DESC);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_action_points_entry_id ON action_points(entry_id);`;

    console.log("Database schema initialized successfully");
  } catch (error) {
    console.error("Failed to initialize database schema:", error);
    throw error;
  }
}
