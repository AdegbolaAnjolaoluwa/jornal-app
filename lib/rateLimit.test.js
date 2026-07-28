/**
 * Tests the DB-independent parts of rate limiting: client-IP extraction
 * (proxy-header trust boundary) and the enforce* response contract. The
 * counting logic itself (checkRateLimit) is backed by Postgres and is
 * exercised via manual/integration testing against a live DB, not here.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getClientIp } from "./rateLimit.js";

describe("getClientIp", () => {
  test("uses the first IP in a comma-separated X-Forwarded-For chain", () => {
    const req = { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" }, socket: {} };
    assert.equal(getClientIp(req), "203.0.113.5");
  });

  test("trims whitespace around the extracted IP", () => {
    const req = { headers: { "x-forwarded-for": "  203.0.113.5  , 10.0.0.1" }, socket: {} };
    assert.equal(getClientIp(req), "203.0.113.5");
  });

  test("falls back to the socket's remote address when the header is absent", () => {
    const req = { headers: {}, socket: { remoteAddress: "192.0.2.1" } };
    assert.equal(getClientIp(req), "192.0.2.1");
  });

  test("falls back to a sentinel string when neither is available", () => {
    const req = { headers: {}, socket: {} };
    assert.equal(getClientIp(req), "unknown");
  });

  test("ignores a non-string header value instead of throwing", () => {
    const req = { headers: { "x-forwarded-for": ["array", "value"] }, socket: { remoteAddress: "192.0.2.1" } };
    assert.equal(getClientIp(req), "192.0.2.1");
  });
});

// enforceRateLimit's 429/Retry-After response contract and checkRateLimit's
// counting logic are both backed by the rate_limits Postgres table, so they
// aren't covered by these DB-independent unit tests - see the manual
// verification notes in the audit report for how those were exercised
// against a live database instead.
