import test from "node:test";
import assert from "node:assert/strict";
import { gainForEnergy, musicGainExpression, minimumAcceptableLra } from "./orvyq_dynamic_remix.mjs";

test("gainForEnergy creates a meaningful but bounded section-energy spread", () => {
  assert.ok(gainForEnergy(0.76) - gainForEnergy(0.28) >= 0.4);
  assert.ok(gainForEnergy(0) >= 0.5);
  assert.ok(gainForEnergy(2) <= 1);
});

test("musicGainExpression follows authored cue boundaries and ramps", () => {
  const expression = musicGainExpression([
    { start: 0, end: 10, energy_start: 0.2, energy_end: 0.7 },
    { start: 10, end: 20, energy_start: 0.7, energy_end: 0.3 }
  ], 20);
  assert.match(expression, /between\(t,0,10\)/);
  assert.match(expression, /between\(t,10,20\)/);
  assert.match(expression, /\*\(t-0\)\/10/);
});

test("minimumAcceptableLra stays within the realistic 3.5-4.0 LU band regardless of source", () => {
  assert.ok(minimumAcceptableLra(0) >= 3.5);
  assert.ok(minimumAcceptableLra(0) <= 4.0);
  assert.ok(minimumAcceptableLra(10) >= 3.5);
  assert.ok(minimumAcceptableLra(10) <= 4.0);
});

test("minimumAcceptableLra tracks the real source narration measurement (regression: Project 002's raw narration measured 4.30-4.40 LU across CI runs)", () => {
  assert.equal(minimumAcceptableLra(4.3), 3.5);
  assert.equal(minimumAcceptableLra(4.5), 3.7);
});

test("minimumAcceptableLra falls back to the realistic floor when the source measurement is missing or invalid", () => {
  assert.equal(minimumAcceptableLra(NaN), 3.5);
  assert.equal(minimumAcceptableLra(undefined), 3.5);
});

test("minimumAcceptableLra rounds cleanly so an exact-match mix isn't rejected by floating-point noise (regression: run 30292647441, 4.4 - 0.8 === 3.6000000000000005 in raw JS)", () => {
  assert.equal(4.4 - 0.8 === 3.6, false);
  assert.equal(minimumAcceptableLra(4.4), 3.6);
});
