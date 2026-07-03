import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateShrinkGuard } from "./shrink-guard.js";

test("no previous file (first sync) → never blocked", () => {
  assert.equal(evaluateShrinkGuard(null, 0).blocked, false);
  assert.equal(evaluateShrinkGuard(null, 100).blocked, false);
});

test("empty stays empty → allowed", () => {
  assert.equal(evaluateShrinkGuard(0, 0).blocked, false);
});

test("growth and steady state → allowed", () => {
  assert.equal(evaluateShrinkGuard(10, 10).blocked, false);
  assert.equal(evaluateShrinkGuard(10, 50).blocked, false);
});

test("wipe: >=3 rows → 0 is blocked", () => {
  assert.equal(evaluateShrinkGuard(3, 0).blocked, true);
  assert.equal(evaluateShrinkGuard(200, 0).blocked, true);
});

test("wipe: tiny collections (<3 rows) may legitimately empty", () => {
  assert.equal(evaluateShrinkGuard(1, 0).blocked, false);
  assert.equal(evaluateShrinkGuard(2, 0).blocked, false);
});

test("shrink: >80% loss on a >=10-row collection is blocked", () => {
  assert.equal(evaluateShrinkGuard(100, 10).blocked, true);
  assert.equal(evaluateShrinkGuard(10, 1).blocked, true);
});

test("shrink: exactly 20% surviving is allowed (strict less-than)", () => {
  assert.equal(evaluateShrinkGuard(100, 20).blocked, false);
});

test("shrink: moderate loss is allowed", () => {
  assert.equal(evaluateShrinkGuard(100, 50).blocked, false);
  assert.equal(evaluateShrinkGuard(10, 3).blocked, false);
});

test("shrink: small collections (<10 rows) skip the percentage check", () => {
  // 5 → 1 is an 80% loss but the collection is too small to judge.
  assert.equal(evaluateShrinkGuard(5, 1).blocked, false);
});

test("blocked verdicts carry a human-readable reason", () => {
  const wipe = evaluateShrinkGuard(50, 0);
  assert.match(wipe.reason ?? "", /50 rows -> 0/);
  const shrink = evaluateShrinkGuard(100, 5);
  assert.match(shrink.reason ?? "", /100 rows -> 5/);
});
