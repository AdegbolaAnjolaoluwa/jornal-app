import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { timingSafeEqualStrings } from "./timingSafeEqual.js";

describe("timingSafeEqualStrings", () => {
  test("returns true for identical strings", () => {
    assert.equal(timingSafeEqualStrings("Bearer abc123", "Bearer abc123"), true);
  });

  test("returns false for different strings of the same length", () => {
    assert.equal(timingSafeEqualStrings("Bearer abc123", "Bearer abc124"), false);
  });

  test("returns false for strings of different lengths, without throwing", () => {
    assert.doesNotThrow(() => {
      assert.equal(timingSafeEqualStrings("short", "a much longer string"), false);
    });
  });

  test("returns false when one string is empty", () => {
    assert.equal(timingSafeEqualStrings("", "Bearer abc123"), false);
  });

  test("returns true when both strings are empty", () => {
    assert.equal(timingSafeEqualStrings("", ""), true);
  });
});
