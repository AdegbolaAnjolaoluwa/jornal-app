import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computePeriodRange, computeFingerprint, computePreviousPeriodStart } from "./recap.js";

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
      { id: "a", updated_at: "2026-07-27T10:00:00Z" },
      { id: "b", updated_at: "2026-07-28T10:00:00Z" },
    ];
    const aps = [{ id: "x", completed: true, completed_at: "2026-07-28T12:00:00Z" }];
    const fp1 = computeFingerprint(entries, aps);
    const fp2 = computeFingerprint([entries[1], entries[0]], aps);
    assert.equal(fp1, fp2);
  });

  test("adding an entry changes the fingerprint", () => {
    const before = computeFingerprint([{ id: "a", updated_at: "2026-07-27T10:00:00Z" }], []);
    const after = computeFingerprint(
      [
        { id: "a", updated_at: "2026-07-27T10:00:00Z" },
        { id: "b", updated_at: "2026-07-28T10:00:00Z" },
      ],
      []
    );
    assert.notEqual(before, after);
  });

  test("toggling an action point's completion changes the fingerprint", () => {
    const entries = [{ id: "a", updated_at: "2026-07-27T10:00:00Z" }];
    const incomplete = computeFingerprint(entries, [{ id: "x", completed: false, completed_at: null }]);
    const complete = computeFingerprint(entries, [{ id: "x", completed: true, completed_at: "2026-07-28T12:00:00Z" }]);
    assert.notEqual(incomplete, complete);
  });

  test("editing an entry's text/reflection changes the fingerprint even though created_at is untouched", () => {
    // The bug this guards against: an edit bumps updated_at but never
    // created_at, so keying the fingerprint on created_at alone would let a
    // stale cached recap survive an edit indefinitely.
    const before = computeFingerprint([{ id: "a", updated_at: "2026-07-27T10:00:00Z" }], []);
    const afterEdit = computeFingerprint([{ id: "a", updated_at: "2026-07-27T15:30:00Z" }], []);
    assert.notEqual(before, afterEdit);
  });

  test("adding a tag to an entry changes the fingerprint", () => {
    const entries = [{ id: "a", updated_at: "2026-07-27T10:00:00Z" }];
    const noTags = computeFingerprint(entries, [], []);
    const oneTag = computeFingerprint(entries, [], [{ entry_id: "a", id: "tag-1", name: "work" }]);
    assert.notEqual(noTags, oneTag);
  });

  test("removing a tag from an entry changes the fingerprint", () => {
    const entries = [{ id: "a", updated_at: "2026-07-27T10:00:00Z" }];
    const withTag = computeFingerprint(entries, [], [{ entry_id: "a", id: "tag-1", name: "work" }]);
    const withoutTag = computeFingerprint(entries, [], []);
    assert.notEqual(withTag, withoutTag);
  });

  test("same tags in a different order produce the same fingerprint", () => {
    const entries = [{ id: "a", updated_at: "2026-07-27T10:00:00Z" }];
    const tags = [
      { entry_id: "a", id: "tag-1", name: "work" },
      { entry_id: "a", id: "tag-2", name: "urgent" },
    ];
    const fp1 = computeFingerprint(entries, [], tags);
    const fp2 = computeFingerprint(entries, [], [tags[1], tags[0]]);
    assert.equal(fp1, fp2);
  });

  test("empty entries, action points, and tags still produce a stable, valid fingerprint", () => {
    assert.equal(computeFingerprint([], [], []), computeFingerprint([], [], []));
  });

  test("tags parameter is optional, defaults to no tags", () => {
    const entries = [{ id: "a", updated_at: "2026-07-27T10:00:00Z" }];
    assert.equal(computeFingerprint(entries, []), computeFingerprint(entries, [], []));
  });
});

describe("computePreviousPeriodStart", () => {
  test("previous week is 7 days before the given week's start", () => {
    assert.equal(computePreviousPeriodStart("week", "2026-07-27"), "2026-07-20");
  });

  test("previous month is the prior calendar month's start", () => {
    assert.equal(computePreviousPeriodStart("month", "2026-07-01"), "2026-06-01");
  });

  test("previous month survives a year boundary (January -> December)", () => {
    assert.equal(computePreviousPeriodStart("month", "2026-01-01"), "2025-12-01");
  });

  test("previous week survives a year boundary", () => {
    assert.equal(computePreviousPeriodStart("week", "2026-01-05"), "2025-12-29");
  });

  test("previous month handles varying month lengths correctly (March -> February)", () => {
    assert.equal(computePreviousPeriodStart("month", "2026-03-01"), "2026-02-01");
  });
});
