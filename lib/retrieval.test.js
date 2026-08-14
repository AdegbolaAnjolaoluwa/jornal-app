import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { matchTags, mergeEntries, entryToGroundingText } from "./retrieval.js";

describe("matchTags", () => {
  test("matches a tag named as a whole word in the question", () => {
    const allTags = [{ id: "t1", name: "gym" }];
    const result = matchTags(allTags, "what have I written about the gym lately?");
    assert.deepEqual(result, allTags);
  });

  test("does not match a tag as a substring of another word", () => {
    const allTags = [{ id: "t1", name: "gym" }];
    const result = matchTags(allTags, "I love gymnastics");
    assert.deepEqual(result, []);
  });

  test("case-insensitive matching", () => {
    const allTags = [{ id: "t1", name: "Work" }];
    const result = matchTags(allTags, "how has work been?");
    assert.equal(result.length, 1);
  });

  test("escapes tag names containing regex-special characters", () => {
    const allTags = [{ id: "t1", name: "c++" }];
    const result = matchTags(allTags, "notes tagged c++ from today");
    assert.equal(result.length, 1);
  });

  test("no tags named in the question returns empty", () => {
    const allTags = [{ id: "t1", name: "gym" }, { id: "t2", name: "work" }];
    const result = matchTags(allTags, "how am I feeling today?");
    assert.deepEqual(result, []);
  });

  test("empty tag list returns empty", () => {
    assert.deepEqual(matchTags([], "anything"), []);
  });
});

describe("mergeEntries", () => {
  test("fact-backed entries ordered first, then tag-matched, then FTS", () => {
    const factBacked = [{ id: "a" }];
    const tagMatched = [{ id: "b" }];
    const fts = [{ id: "c" }];
    const result = mergeEntries(factBacked, tagMatched, fts);
    assert.deepEqual(result.map((e) => e.id), ["a", "b", "c"]);
  });

  test("de-duplicates entries appearing in multiple lists, keeping the earliest source", () => {
    const factBacked = [{ id: "a", source: "fact" }];
    const tagMatched = [{ id: "a", source: "tag" }, { id: "b", source: "tag" }];
    const fts = [{ id: "a", source: "fts" }, { id: "b", source: "fts" }, { id: "c", source: "fts" }];
    const result = mergeEntries(factBacked, tagMatched, fts);
    assert.equal(result.length, 3);
    assert.equal(result[0].source, "fact");
    assert.equal(result[1].source, "tag");
  });

  test("caps at 8 entries total", () => {
    const factBacked = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}` }));
    const tagMatched = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}` }));
    const fts = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}` }));
    const result = mergeEntries(factBacked, tagMatched, fts);
    assert.equal(result.length, 8);
  });

  test("empty inputs produce an empty result", () => {
    assert.deepEqual(mergeEntries([], [], []), []);
  });
});

describe("entryToGroundingText", () => {
  test("appends reflection in parentheses when present", () => {
    const entry = { input_text: "Had a good day", reflection: "Sounds productive." };
    assert.equal(entryToGroundingText(entry), "Had a good day\n(Sounds productive.)");
  });

  test("uses input_text alone when there's no reflection", () => {
    const entry = { input_text: "Had a good day", reflection: null };
    assert.equal(entryToGroundingText(entry), "Had a good day");
  });

  test("truncates to 500 characters", () => {
    const entry = { input_text: "a".repeat(600), reflection: null };
    assert.equal(entryToGroundingText(entry).length, 500);
  });

  test("truncation applies to the combined text+reflection, not just input_text", () => {
    const entry = { input_text: "a".repeat(490), reflection: "b".repeat(50) };
    const result = entryToGroundingText(entry);
    assert.equal(result.length, 500);
  });
});
