import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeStreak } from "./streak.js";

describe("computeStreak", () => {
  test("no activity at all", () => {
    assert.deepEqual(computeStreak([], "2026-07-29"), { current: 0, wroteToday: false });
  });

  test("wrote today only", () => {
    assert.deepEqual(computeStreak(["2026-07-29"], "2026-07-29"), { current: 1, wroteToday: true });
  });

  test("wrote yesterday but not yet today - streak still alive, not broken", () => {
    assert.deepEqual(computeStreak(["2026-07-28"], "2026-07-29"), { current: 1, wroteToday: false });
  });

  test("wrote 3 consecutive days ending today", () => {
    const dates = ["2026-07-27", "2026-07-28", "2026-07-29"];
    assert.deepEqual(computeStreak(dates, "2026-07-29"), { current: 3, wroteToday: true });
  });

  test("wrote 3 consecutive days ending yesterday, nothing today yet", () => {
    const dates = ["2026-07-26", "2026-07-27", "2026-07-28"];
    assert.deepEqual(computeStreak(dates, "2026-07-29"), { current: 3, wroteToday: false });
  });

  test("gap of two days ago (not yesterday, not today) breaks the streak to 0", () => {
    const dates = ["2026-07-27"];
    assert.deepEqual(computeStreak(dates, "2026-07-29"), { current: 0, wroteToday: false });
  });

  test("a gap in the middle of history stops the count there, doesn't skip over it", () => {
    // wrote today and yesterday, but there's a gap before that - streak is 2, not more
    const dates = ["2026-07-20", "2026-07-28", "2026-07-29"];
    assert.deepEqual(computeStreak(dates, "2026-07-29"), { current: 2, wroteToday: true });
  });

  test("duplicate dates in the input don't inflate the count", () => {
    const dates = ["2026-07-29", "2026-07-29", "2026-07-28", "2026-07-28"];
    assert.deepEqual(computeStreak(dates, "2026-07-29"), { current: 2, wroteToday: true });
  });

  test("order of input dates doesn't matter", () => {
    const dates = ["2026-07-29", "2026-07-27", "2026-07-28"];
    assert.deepEqual(computeStreak(dates, "2026-07-29"), { current: 3, wroteToday: true });
  });

  test("streak survives a month boundary", () => {
    const dates = ["2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02"];
    assert.deepEqual(computeStreak(dates, "2026-07-02"), { current: 4, wroteToday: true });
  });

  test("streak survives a year boundary", () => {
    const dates = ["2025-12-30", "2025-12-31", "2026-01-01"];
    assert.deepEqual(computeStreak(dates, "2026-01-01"), { current: 3, wroteToday: true });
  });

  test("streak survives Feb 29 on a leap year", () => {
    const dates = ["2028-02-28", "2028-02-29", "2028-03-01"];
    assert.deepEqual(computeStreak(dates, "2028-03-01"), { current: 3, wroteToday: true });
  });
});
