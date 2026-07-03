import { test } from "node:test";
import assert from "node:assert/strict";

import { sameIgnoringSyncedAt } from "./compare.js";

test("identical envelopes are equal", () => {
  const a = { syncedAt: "2026-01-01T00:00:00Z", citySlug: "tulum", venues: [{ convexId: "x" }] };
  const b = { syncedAt: "2026-01-01T00:00:00Z", citySlug: "tulum", venues: [{ convexId: "x" }] };
  assert.equal(sameIgnoringSyncedAt(a, b), true);
});

test("only syncedAt differs → equal (the whole point)", () => {
  const a = { syncedAt: "2026-01-01T00:00:00Z", citySlug: "tulum", venues: [{ convexId: "x" }] };
  const b = { syncedAt: "2026-06-14T10:21:11Z", citySlug: "tulum", venues: [{ convexId: "x" }] };
  assert.equal(sameIgnoringSyncedAt(a, b), true);
});

test("row content differs → not equal", () => {
  const a = { syncedAt: "t", venues: [{ convexId: "x", name: "Umi" }] };
  const b = { syncedAt: "t", venues: [{ convexId: "x", name: "Bagatelle" }] };
  assert.equal(sameIgnoringSyncedAt(a, b), false);
});

test("row added → not equal", () => {
  const a = { syncedAt: "t", venues: [{ convexId: "x" }] };
  const b = { syncedAt: "t", venues: [{ convexId: "x" }, { convexId: "y" }] };
  assert.equal(sameIgnoringSyncedAt(a, b), false);
});

test("mode flip (published → draft) → not equal", () => {
  const a = { syncedAt: "t", mode: "published", venues: [] };
  const b = { syncedAt: "t", mode: "draft", venues: [] };
  assert.equal(sameIgnoringSyncedAt(a, b), false);
});

test("nested syncedAt-like keys are NOT stripped (top level only)", () => {
  const a = { syncedAt: "t1", venues: [{ syncedAt: "inner-1" }] };
  const b = { syncedAt: "t2", venues: [{ syncedAt: "inner-2" }] };
  assert.equal(sameIgnoringSyncedAt(a, b), false);
});

test("non-object values compare by value", () => {
  assert.equal(sameIgnoringSyncedAt(null, null), true);
  assert.equal(sameIgnoringSyncedAt([1, 2], [1, 2]), true);
  assert.equal(sameIgnoringSyncedAt([1, 2], [2, 1]), false);
});
