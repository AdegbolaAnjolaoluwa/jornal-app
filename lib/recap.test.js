import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computePeriodRange, computeFingerprint } from "./recap.js";

describe("computePeriodRange - week", () => {
  test("a Wednesday resolves to that week's Monday-Sunday range", () => {
    assert.deepEqual(computePeriodRange("week", "2026-07-29"), {
      start: "2026-07-27",
      endExclusive: "2026-08-03",
    });
  });

  test("Monday itself is the start of its own week", () => {
    assert.deepEqual(computePeriodRange("week", "2026-07-27"), {
      start: "2026-07-27",
      endExclusive: "2026-08-03",
    });
  });

  test("Sunday is the last day of the week starting the prior Monday", () => {
    assert.deepEqual(computePeriodRange("week", "2026-08-02"), {
      start: "2026-07-27",
      endExclusive: "2026-08-03",
    });
  });

  test("week range survives a month boundary", () => {
    // 2026-08-03 is a Monday, so 2026-08-01 (Saturday) belongs to the week
    // starting 2026-07-27.
    assert.deepEqual(computePeriodRange("week", "2026-08-01"), {
      start: "2026-07-27",
      endExclusive: "2026-08-03",
    });
  });

  test("week range survives a year boundary", () => {
    // 2026-01-01 is a Thursday.
    const range = computePeriodRange("week", "2026-01-01");
    assert.equal(range.start, "2025-12-29");
    assert.equal(range.endExclusive, "2026-01-05");
  });
});

describe("computePeriodRange - month", () => {
  test("mid-month date resolves to the full calendar month", () => {
    assert.deepEqual(computePeriodRange("month", "2026-07-15"), {
      start: "2026-07-01",
      endExclusive: "2026-08-01",
    });
  });

  test("last day of the month still resolves to that month", () => {
    assert.deepEqual(computePeriodRange("month", "2026-07-31"), {
      start: "2026-07-01",
      endExclusive: "2026-08-01",
    });
  });

  test("month range survives a year boundary (December)", () => {
    assert.deepEqual(computePeriodRange("month", "2026-12-15"), {
      start: "2026-12-01",
      endExclusive: "2027-01-01",
    });
  });

  test("February in a leap year", () => {
    assert.deepEqual(computePeriodRange("month", "2028-02-10"), {
      start: "2028-02-01",
      endExclusive: "2028-03-01",
    });
  });
});

describe("computePeriodRange - invalid input", () => {
  test("throws on an unknown period type rather than silently returning something wrong", () => {
    assert.throws(() => computePeriodRange("year", "2026-07-29"));
  });
});

describe("computeFingerprint", () => {
  test("same entries and action points produce the same fingerprint regardless of array order", () => {
    const entries = [
      { id: "a", created_at: "2026-07-27T10:00:00Z" },
      { id: "b", created_at: "2026-07-28T10:00:00Z" },
    ];
    const aps = [{ id: "x", completed: true, completed_at: "2026-07-28T12:00:00Z" }];
    const fp1 = computeFingerprint(entries, aps);
    const fp2 = computeFingerprint([entries[1], entries[0]], aps);
    assert.equal(fp1, fp2);
  });

  test("adding an entry changes the fingerprint", () => {
    const before = computeFingerprint([{ id: "a", created_at: "2026-07-27T10:00:00Z" }], []);
    const after = computeFingerprint(
      [
        { id: "a", created_at: "2026-07-27T10:00:00Z" },
        { id: "b", created_at: "2026-07-28T10:00:00Z" },
      ],
      []
    );
    assert.notEqual(before, after);
  });

  test("toggling an action point's completion changes the fingerprint", () => {
    const entries = [{ id: "a", created_at: "2026-07-27T10:00:00Z" }];
    const incomplete = computeFingerprint(entries, [{ id: "x", completed: false, completed_at: null }]);
    const complete = computeFingerprint(entries, [{ id: "x", completed: true, completed_at: "2026-07-28T12:00:00Z" }]);
    assert.notEqual(incomplete, complete);
  });

  test("empty entries and action points still produce a stable, valid fingerprint", () => {
    assert.equal(computeFingerprint([], []), computeFingerprint([], []));
  });
});
