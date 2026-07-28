import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isValidUuid } from "./validation.js";

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
