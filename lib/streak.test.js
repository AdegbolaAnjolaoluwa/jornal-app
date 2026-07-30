import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeStreak, computeLongestStreak } from "./streak.js";

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

describe("computeLongestStreak", () => {
  test("no activity at all", () => {
    assert.equal(computeLongestStreak([]), 0);
  });

  test("a single day is a streak of 1", () => {
    assert.equal(computeLongestStreak(["2026-07-29"]), 1);
  });

  test("finds a longer streak buried earlier in history than the current one", () => {
    // A 5-day streak in the past, then a gap, then a 2-day streak touching
    // "today" - longest should report 5, not 2, even though 2 is more recent.
    const dates = [
      "2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05",
      "2026-07-20", "2026-07-21",
    ];
    assert.equal(computeLongestStreak(dates), 5);
  });

  test("the current streak IS the longest one", () => {
    const dates = ["2026-07-01", "2026-07-15", "2026-07-16", "2026-07-27", "2026-07-28", "2026-07-29"];
    assert.equal(computeLongestStreak(dates), 3);
  });

  test("duplicate dates don't inflate the count", () => {
    const dates = ["2026-07-27", "2026-07-27", "2026-07-28", "2026-07-28", "2026-07-29"];
    assert.equal(computeLongestStreak(dates), 3);
  });

  test("order of input doesn't matter", () => {
    const dates = ["2026-07-29", "2026-07-01", "2026-07-27", "2026-07-02", "2026-07-28"];
    assert.equal(computeLongestStreak(dates), 3);
  });

  test("all isolated single days - longest is 1", () => {
    const dates = ["2026-07-01", "2026-07-05", "2026-07-10", "2026-07-15"];
    assert.equal(computeLongestStreak(dates), 1);
  });

  test("survives a month and year boundary within the same run", () => {
    const dates = ["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"];
    assert.equal(computeLongestStreak(dates), 4);
  });
});
