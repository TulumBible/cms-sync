import { test } from "node:test";
import assert from "node:assert/strict";

import { parseRetryAfterMs } from "./client.js";

test("missing header → undefined", () => {
  assert.equal(parseRetryAfterMs(null), undefined);
});

test("delta-seconds form", () => {
  assert.equal(parseRetryAfterMs("0"), 0);
  assert.equal(parseRetryAfterMs("30"), 30_000);
});

test("negative delta clamps to 0", () => {
  assert.equal(parseRetryAfterMs("-5"), 0);
});

test("HTTP-date form → ms until that date (>= 0)", () => {
  const inTenSeconds = new Date(Date.now() + 10_000).toUTCString();
  const ms = parseRetryAfterMs(inTenSeconds);
  assert.ok(ms !== undefined && ms > 5_000 && ms <= 11_000, `got ${ms}`);
});

test("HTTP-date in the past clamps to 0", () => {
  const past = new Date(Date.now() - 60_000).toUTCString();
  assert.equal(parseRetryAfterMs(past), 0);
});

test("garbage → undefined", () => {
  assert.equal(parseRetryAfterMs("soon"), undefined);
});
