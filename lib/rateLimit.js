/**
 * Postgres-backed rate limiting for auth endpoints (login, signup,
 * password-reset requests). Serverless functions have no shared memory
 * across invocations, so counters live in the rate_limits table instead of
 * process memory - one row per attempt, pruned as they age out of the window.
 */

import { query } from "./db.js";

/**
 * Record an attempt and check whether the caller is over the limit for this
 * bucket+key within the given window. Call this BEFORE doing the expensive/
 * sensitive work (password comparison, sending email, etc) so a request
 * that's already over the limit short-circuits early.
 *
 * Two implementation details that both turned out to matter:
 *
 * 1. Two statements, not a single INSERT-CTE-then-SELECT: all CTEs in one
 *    Postgres statement share the same snapshot, so a `WITH inserted AS
 *    (INSERT ...) SELECT count(*) FROM ...` does NOT see the row it just
 *    inserted - the count silently never included the current attempt.
 *
 * 2. created_at is bound as an explicit client-computed timestamp, not the
 *    server-side now() default. rate_limits.created_at is TIMESTAMP WITHOUT
 *    TIME ZONE, and now() (timestamptz) gets cast down to it using the
 *    session's timezone - on this DB that produced values a full hour off
 *    from true UTC, which made the window comparison never match. Passing
 *    a JS Date bypasses that cast entirely (node-postgres sends it as UTC).
 *
 * Returns { limited: boolean, retryAfterSeconds: number }.
 */
export async function checkRateLimit(bucket, key, { maxAttempts, windowMs }) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);

  await query(`INSERT INTO rate_limits (id, bucket, rate_key, created_at) VALUES (gen_random_uuid(), $1, $2, $3)`, [
    bucket,
    key,
    now,
  ]);

  const rows = await query(
    `SELECT count(*)::int AS count FROM rate_limits WHERE bucket = $1 AND rate_key = $2 AND created_at > $3`,
    [bucket, key, windowStart]
  );
  const count = rows[0]?.count || 0;

  return {
    limited: count > maxAttempts,
    retryAfterSeconds: Math.ceil(windowMs / 1000),
  };
}

/**
 * Express-style helper for the api/*.js handlers: checks the limit and, if
 * exceeded, writes a 429 response and returns true (caller should return
 * immediately). Returns false if the request is allowed to proceed.
 */
export async function enforceRateLimit(req, res, bucket, key, options) {
  const { limited, retryAfterSeconds } = await checkRateLimit(bucket, key, options);
  if (limited) {
    res.setHeader("Retry-After", String(retryAfterSeconds));
    res.status(429).json({
      success: false,
      error: { message: "Too many attempts. Please try again later." },
    });
    return true;
  }
  return false;
}

/**
 * Same as enforceRateLimit, but runs several checks concurrently (e.g. by-IP
 * and by-email at once) instead of sequentially, then responds once if any
 * of them are over their limit. Pass an array of { bucket, key, options }.
 */
export async function enforceRateLimits(req, res, checks) {
  const results = await Promise.all(checks.map((c) => checkRateLimit(c.bucket, c.key, c.options)));
  const hit = results.find((r) => r.limited);
  if (hit) {
    res.setHeader("Retry-After", String(hit.retryAfterSeconds));
    res.status(429).json({
      success: false,
      error: { message: "Too many attempts. Please try again later." },
    });
    return true;
  }
  return false;
}

/**
 * Deletes rate_limits rows older than maxAgeMs. Not called from the
 * request-handling path (that would add latency for no per-request benefit)
 * - wire this into the existing daily cron job instead so the table doesn't
 * grow unbounded.
 */
export async function pruneRateLimits(maxAgeMs = 24 * 60 * 60 * 1000) {
  const cutoff = new Date(Date.now() - maxAgeMs);
  await query(`DELETE FROM rate_limits WHERE created_at <= $1`, [cutoff]);
}

/**
 * Best-effort client IP extraction behind Vercel's proxy.
 */
export function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}
