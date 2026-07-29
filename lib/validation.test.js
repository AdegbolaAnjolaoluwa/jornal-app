import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isValidUuid, isValidIsoDate, isValidTimezone } from "./validation.js";

describe("isValidUuid", () => {
  test("accepts well-formed UUIDs", () => {
    assert.equal(isValidUuid("550e8400-e29b-41d4-a716-446655440000"), true);
    assert.equal(isValidUuid("f47ac10b-58cc-4372-a567-0e02b2c3d479"), true);
  });

  test("rejects a UUID with an invalid variant nibble", () => {
    // variant nibble must be 8/9/a/b - "c" is out of range
    assert.equal(isValidUuid("550e8400-e29b-41d4-c716-446655440000"), false);
  });

  test("rejects non-UUID strings that would otherwise reach the database driver", () => {
    assert.equal(isValidUuid("not-a-uuid"), false);
    assert.equal(isValidUuid("../../../etc/passwd"), false);
    assert.equal(isValidUuid("1 OR 1=1"), false);
    assert.equal(isValidUuid(""), false);
  });

  test("rejects non-string input without throwing", () => {
    assert.equal(isValidUuid(undefined), false);
    assert.equal(isValidUuid(null), false);
    assert.equal(isValidUuid(12345), false);
    assert.equal(isValidUuid({}), false);
    assert.equal(isValidUuid(["f47ac10b-58cc-4372-a567-0e02b2c3d479"]), false);
  });
});

describe("isValidIsoDate", () => {
  test("accepts well-formed calendar dates", () => {
    assert.equal(isValidIsoDate("2026-07-29"), true);
    assert.equal(isValidIsoDate("2024-02-29"), true); // leap day
    assert.equal(isValidIsoDate("2026-01-01"), true);
  });

  test("rejects dates that don't exist on the calendar, even if shaped correctly", () => {
    // Postgres/JS both silently roll these forward rather than erroring, so
    // the roundtrip check (not just the regex) is what catches them - an
    // AI-hallucinated due date like this should never reach the database.
    assert.equal(isValidIsoDate("2026-02-30"), false);
    assert.equal(isValidIsoDate("2025-02-29"), false); // not a leap year
    assert.equal(isValidIsoDate("2026-13-01"), false);
    assert.equal(isValidIsoDate("2026-00-15"), false);
  });

  test("rejects malformed strings", () => {
    assert.equal(isValidIsoDate("2026/07/29"), false);
    assert.equal(isValidIsoDate("07-29-2026"), false);
    assert.equal(isValidIsoDate("tomorrow"), false);
    assert.equal(isValidIsoDate(""), false);
    assert.equal(isValidIsoDate("2026-7-9"), false); // must be zero-padded
  });

  test("rejects non-string input without throwing", () => {
    assert.equal(isValidIsoDate(undefined), false);
    assert.equal(isValidIsoDate(null), false);
    assert.equal(isValidIsoDate(new Date()), false);
  });
});

describe("isValidTimezone", () => {
  test("accepts real IANA timezone names", () => {
    assert.equal(isValidTimezone("America/Los_Angeles"), true);
    assert.equal(isValidTimezone("Europe/London"), true);
    assert.equal(isValidTimezone("Africa/Lagos"), true);
    assert.equal(isValidTimezone("Asia/Tokyo"), true);
  });

  test("accepts UTC even though it's not in Intl's IANA-only list", () => {
    // A browser can legitimately report timeZone: "UTC", and Postgres's
    // AT TIME ZONE accepts it - special-cased since it's absent from
    // Intl.supportedValuesOf("timeZone")'s otherwise-authoritative list.
    assert.equal(isValidTimezone("UTC"), true);
  });

  test("rejects made-up or malformed zone names", () => {
    assert.equal(isValidTimezone("Not/A/Zone"), false);
    assert.equal(isValidTimezone("America/Nowhere"), false);
    assert.equal(isValidTimezone("GMT+5"), false);
    assert.equal(isValidTimezone(""), false);
    assert.equal(isValidTimezone("1 OR 1=1"), false);
  });

  test("rejects non-string input without throwing", () => {
    assert.equal(isValidTimezone(undefined), false);
    assert.equal(isValidTimezone(null), false);
    assert.equal(isValidTimezone(123), false);
  });

  test("rejects an implausibly long string", () => {
    assert.equal(isValidTimezone("A".repeat(200)), false);
  });
});
