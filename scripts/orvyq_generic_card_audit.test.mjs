import { test } from "node:test";
import assert from "node:assert/strict";
import { auditGenericCards } from "./orvyq_generic_card_audit.mjs";

const FPS = 30;

function withFrames(shots) {
  let cursor = 0;
  return shots.map((s) => {
    const start_frame = cursor;
    cursor += Math.round(s.duration * FPS);
    return { ...s, start_frame, end_frame: cursor };
  });
}

// Regression fixture: the rejected review (run 30132412035) measured
// "Other full-screen graphic-card duration: approximately 1:28 / 10.2%" of
// a ~14:17 (857s) film -- over the task's explicit 8% ceiling. A minimal
// fixture reproducing that same overage (one section, ~10% graphic-card
// time) must fail.
test("regression: ~10.2% generic-card fraction (rejected review's real measured number) fails the 8% ceiling", () => {
  const shots = withFrames([
    { shot_id: "s1", section_id: "SEC_01", asset_type: "graphic", duration: 10 },
    { shot_id: "s2", section_id: "SEC_01", asset_type: "evidence", duration: 30 },
    { shot_id: "s3", section_id: "SEC_01", asset_type: "footage", duration: 30 },
    { shot_id: "s4", section_id: "SEC_01", asset_type: "evidence", duration: 30 }
  ]);
  const result = auditGenericCards(shots, FPS);
  assert.ok(result.generic_card_fraction > 0.08, `expected fraction over 8%, got ${result.generic_card_fraction}`);
  assert.ok(result.failures.length > 0);
});

test("a film with generic-card fraction under 8% and no consecutive graphics passes", () => {
  const shots = withFrames([
    { shot_id: "s1", section_id: "SEC_01", asset_type: "graphic", duration: 3 },
    { shot_id: "s2", section_id: "SEC_01", asset_type: "evidence", duration: 30 },
    { shot_id: "s3", section_id: "SEC_01", asset_type: "footage", duration: 30 },
    { shot_id: "s4", section_id: "SEC_01", asset_type: "evidence", duration: 30 }
  ]);
  const result = auditGenericCards(shots, FPS);
  assert.ok(result.generic_card_fraction <= 0.08, `expected fraction <= 8%, got ${result.generic_card_fraction}`);
  assert.equal(result.failures.length, 0);
});

test("two consecutive generic graphic cards fail even when the overall fraction is low", () => {
  const shots = withFrames([
    { shot_id: "s1", section_id: "SEC_01", asset_type: "graphic", duration: 3 },
    { shot_id: "s2", section_id: "SEC_01", asset_type: "graphic", duration: 3 },
    { shot_id: "s3", section_id: "SEC_01", asset_type: "footage", duration: 60 }
  ]);
  const result = auditGenericCards(shots, FPS);
  assert.ok(result.failures.some((f) => f.includes("consecutive")));
});

test("a section with generic-card fraction over 12% fails even if the whole-film fraction is under 8%", () => {
  const shots = withFrames([
    // SEC_01: 5s graphic in 20s total = 25%, over the 12% per-section ceiling.
    { shot_id: "s1", section_id: "SEC_01", asset_type: "graphic", duration: 5 },
    { shot_id: "s2", section_id: "SEC_01", asset_type: "footage", duration: 15 },
    // SEC_02: large evidence/footage block with no graphics, dilutes the whole-film fraction under 8%.
    { shot_id: "s3", section_id: "SEC_02", asset_type: "evidence", duration: 200 },
    { shot_id: "s4", section_id: "SEC_02", asset_type: "footage", duration: 200 }
  ]);
  const result = auditGenericCards(shots, FPS);
  assert.ok(result.generic_card_fraction <= 0.08, `expected whole-film fraction <= 8%, got ${result.generic_card_fraction}`);
  assert.ok(result.failures.some((f) => f.includes("SEC_01")), "expected a section-level failure for SEC_01");
});
