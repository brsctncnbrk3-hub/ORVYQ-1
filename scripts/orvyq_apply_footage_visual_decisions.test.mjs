import test from "node:test";
import assert from "node:assert/strict";
import { materializeOpeningHook } from "./orvyq_apply_footage_visual_decisions.mjs";

const motionHook = {
  replace_opening_shot_count: 5,
  shots: [
    { duration: 3, video_asset: "scene-1.mp4", claim_id: "CLM_1", visual_role: "context", editorial_purpose: "one" },
    { duration: 2.5, video_asset: "scene-2.mp4", claim_id: "CLM_2", visual_role: "context", editorial_purpose: "two" },
    { duration: 3, video_asset: "scene-3.mp4", claim_id: "CLM_3", visual_role: "context", editorial_purpose: "three" },
    { duration: 2.5, video_asset: "scene-4.mp4", claim_id: "CLM_4", visual_role: "context", editorial_purpose: "four" },
    { duration: 3, video_asset: "scene-5.mp4", claim_id: "CLM_5", visual_role: "context", editorial_purpose: "five" },
  ],
};

function existingHookShot(authored) {
  return {
    duration: authored.duration,
    asset_type: "footage",
    asset: authored.video_asset,
    claim_id: authored.claim_id,
    hook_footage: true,
  };
}

test("opening-hook materialization preserves an already-integrated budgeted subset", () => {
  const shots = [
    ...motionHook.shots.slice(0, 4).map(existingHookShot),
    { duration: 7.866, asset_type: "evidence", claim_id: "CLM_1" },
  ];

  assert.strictEqual(materializeOpeningHook(shots, motionHook), shots);
  assert.equal(shots.filter((shot) => shot.hook_footage).length, 4);
});

test("opening-hook materialization fails closed for an unknown existing hook shot", () => {
  const shots = [
    { ...existingHookShot(motionHook.shots[0]), asset: "unexpected.mp4" },
    { duration: 7, asset_type: "evidence", claim_id: "CLM_1" },
  ];

  assert.throws(
    () => materializeOpeningHook(shots, motionHook),
    /does not match an ordered subset/,
  );
});

test("opening-hook materialization still replaces a genuine pre-hook baseline", () => {
  const baseline = Array.from({ length: 5 }, (_, index) => ({
    duration: motionHook.shots[index].duration,
    asset_type: "evidence",
    section_id: "SEC_1",
  }));

  const result = materializeOpeningHook(baseline, motionHook);
  assert.equal(result.length, 5);
  assert.deepEqual(result.map((shot) => shot.asset), motionHook.shots.map((shot) => shot.video_asset));
  assert.ok(result.every((shot) => shot.hook_footage === true));
});
