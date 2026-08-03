import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scoreFacts, mergeEntries, entryToGroundingText } from "./retrieval.js";

describe("scoreFacts", () => {
  test("matches a fact sharing a significant word with the question", () => {
    const facts = [{ text: "Works with a colleague named Sam", entry_id: "e1" }];
    const result = scoreFacts(facts, "when did I last talk to Sam about the migration?");
    assert.deepEqual(result, facts);
  });

  test("excludes facts with no word overlap", () => {
    const facts = [{ text: "Loves hiking on weekends", entry_id: "e1" }];
    const result = scoreFacts(facts, "when did I last talk to Sam?");
    assert.deepEqual(result, []);
  });

  test("stopwords alone never produce a match", () => {
    const facts = [{ text: "Has a dog", entry_id: "e1" }];
    // "the", "a", "and" are stopwords - a question made only of stopwords
    // shouldn't spuriously match everything.
    const result = scoreFacts(facts, "the and a");
    assert.deepEqual(result, []);
  });

  test("ranks facts with more overlapping words higher", () => {
    const facts = [
      { text: "Loves hiking", entry_id: "e1" },
      { text: "Works with Sam on the payments migration project", entry_id: "e2" },
    ];
    const result = scoreFacts(facts, "Sam migration project");
    assert.equal(result.length, 1);
    assert.equal(result[0].entry_id, "e2");
  });

  test("caps at 5 matched facts", () => {
    const facts = Array.from({ length: 10 }, (_, i) => ({ text: `project alpha number ${i}`, entry_id: `e${i}` }));
    const result = scoreFacts(facts, "project alpha");
    assert.equal(result.length, 5);
  });

  test("case-insensitive matching", () => {
    const facts = [{ text: "Works with SAM", entry_id: "e1" }];
    const result = scoreFacts(facts, "sam");
    assert.equal(result.length, 1);
  });

  test("empty facts list returns empty", () => {
    assert.deepEqual(scoreFacts([], "anything"), []);
  });

  test("question with no significant words returns empty without throwing", () => {
    const facts = [{ text: "Works with Sam", entry_id: "e1" }];
    assert.deepEqual(scoreFacts(facts, "the a an"), []);
  });
});

describe("mergeEntries", () => {
  test("fact-backed entries are ordered before FTS results", () => {
    const factBacked = [{ id: "a" }];
    const fts = [{ id: "b" }, { id: "c" }];
    const result = mergeEntries(factBacked, fts);
    assert.deepEqual(result.map((e) => e.id), ["a", "b", "c"]);
  });

  test("de-duplicates entries appearing in both lists, keeping the fact-backed copy first", () => {
    const factBacked = [{ id: "a", source: "fact" }];
    const fts = [{ id: "a", source: "fts" }, { id: "b", source: "fts" }];
    const result = mergeEntries(factBacked, fts);
    assert.equal(result.length, 2);
    assert.equal(result[0].source, "fact");
  });

  test("caps at 8 entries total", () => {
    const factBacked = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}` }));
    const fts = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}` }));
    const result = mergeEntries(factBacked, fts);
    assert.equal(result.length, 8);
  });

  test("empty inputs produce an empty result", () => {
    assert.deepEqual(mergeEntries([], []), []);
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
