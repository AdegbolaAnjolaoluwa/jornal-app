/**
 * Security regression tests for JWT signing/verification and password policy.
 * Requires DATABASE_URL, JWT_SECRET, GROQ_API_KEY in the environment (see
 * .env.example) - these are only needed for validateConfig()'s fail-fast
 * check at module load; no DB connection is actually opened by the tests
 * below (@vercel/postgres connects lazily on first query).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { signToken, verifyToken, validatePassword, hashPassword, comparePassword } from "./auth.js";
import { getConfig } from "../config.js";

describe("JWT signing/verification", () => {
  test("a token signed by signToken verifies successfully", () => {
    const token = signToken("user-123", { tokenVersion: 2 });
    const payload = verifyToken(token);
    assert.equal(payload.userId, "user-123");
    assert.equal(payload.tokenVersion, 2);
  });

  test("rejects a token signed with a different secret", () => {
    const forged = jwt.sign({ userId: "attacker" }, "wrong-secret", {
      algorithm: "HS256",
      issuer: getConfig("auth.jwtIssuer"),
      audience: getConfig("auth.jwtAudience"),
    });
    assert.equal(verifyToken(forged), null);
  });

  test("rejects an alg:none forged token (algorithm confusion)", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ userId: "attacker" })).toString("base64url");
    const forged = `${header}.${payload}.`;
    assert.equal(verifyToken(forged), null);
  });

  test("rejects a token with a mismatched audience claim, even with a valid signature", () => {
    const forged = jwt.sign({ userId: "user-123" }, getConfig("auth.jwtSecret"), {
      algorithm: "HS256",
      issuer: getConfig("auth.jwtIssuer"),
      audience: "some-other-app",
    });
    assert.equal(verifyToken(forged), null);
  });

  test("rejects a token with a mismatched issuer claim", () => {
    const forged = jwt.sign({ userId: "user-123" }, getConfig("auth.jwtSecret"), {
      algorithm: "HS256",
      issuer: "some-other-issuer",
      audience: getConfig("auth.jwtAudience"),
    });
    assert.equal(verifyToken(forged), null);
  });

  test("still verifies a pre-existing token that has no issuer/audience claims (soft rollout)", () => {
    const legacy = jwt.sign({ userId: "user-123", tokenVersion: 0 }, getConfig("auth.jwtSecret"), {
      algorithm: "HS256",
    });
    const payload = verifyToken(legacy);
    assert.equal(payload.userId, "user-123");
  });

  test("rejects an expired token", () => {
    const expired = jwt.sign({ userId: "user-123" }, getConfig("auth.jwtSecret"), {
      algorithm: "HS256",
      issuer: getConfig("auth.jwtIssuer"),
      audience: getConfig("auth.jwtAudience"),
      expiresIn: -10,
    });
    assert.equal(verifyToken(expired), null);
  });

  test("rejects garbage input", () => {
    assert.equal(verifyToken("not-a-jwt"), null);
    assert.equal(verifyToken(""), null);
  });
});

describe("password policy", () => {
  test("accepts a reasonable password", () => {
    assert.equal(validatePassword("correct horse battery staple").valid, true);
  });

  test("rejects passwords shorter than the configured minimum", () => {
    const result = validatePassword("short1");
    assert.equal(result.valid, false);
  });

  test("rejects common/breached passwords even if long enough", () => {
    assert.equal(validatePassword("password123").valid, false);
    assert.equal(validatePassword("qwertyuiop").valid, false);
  });

  test("common-password check is case-insensitive", () => {
    assert.equal(validatePassword("PASSWORD123").valid, false);
  });

  test("rejects absurdly long input instead of silently truncating", () => {
    const result = validatePassword("a".repeat(300));
    assert.equal(result.valid, false);
  });

  test("rejects non-string input without throwing", () => {
    assert.equal(validatePassword(undefined).valid, false);
    assert.equal(validatePassword(12345678).valid, false);
  });
});

describe("password hashing", () => {
  test("hashPassword produces a hash comparePassword can verify", async () => {
    const hash = await hashPassword("a reasonably strong passphrase");
    assert.notEqual(hash, "a reasonably strong passphrase");
    assert.equal(await comparePassword("a reasonably strong passphrase", hash), true);
    assert.equal(await comparePassword("wrong passphrase", hash), false);
  });
});
