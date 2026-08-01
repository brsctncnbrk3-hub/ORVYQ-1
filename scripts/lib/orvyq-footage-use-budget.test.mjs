import test from "node:test";
import assert from "node:assert/strict";
import {
  collectIndependentFootageUses,
  enforceFootageUseBudget,
  footageUseCounts,
} from "./orvyq-footage-use-budget.mjs";

function footage(asset, trimIn, duration, extra = {}) {
  return {
    asset_type: "footage",
    asset,
    trim_in_sec: trimIn,
    trim_out_sec: trimIn + duration,
    duration,
    visual_role: "context",
    ...extra,
  };
}

test("contiguous trim continuation counts as one independent footage use", () => {
  const shots = [footage("a.mp4", 0, 3), footage("a.mp4", 3, 2), footage("b.mp4", 0, 1), footage("a.mp4", 8, 2)];
  assert.equal(collectIndependentFootageUses(shots).length, 3);
  assert.equal(footageUseCounts(shots).get("a.mp4"), 2);
});

test("over-budget optional hook use is removed before claim-bound body uses", () => {
  const shots = [
    footage("crew.mp4", 0, 3, { hook_footage: true, generic_stock: false }),
    footage("ocean.mp4", 0.5, 3, { hook_footage: true, generic_stock: true, visual_role: "metaphor" }),
    footage("life.mp4", 0, 5, { hook_footage: true, generic_stock: false }),
    { asset_type: "evidence", duration: 4 },
    footage("ocean.mp4", 4, 6),
    { asset_type: "evidence", duration: 4 },
    footage("ocean.mp4", 12, 6, { reuse_reason: "deliberate callback" }),
  ];

  const result = enforceFootageUseBudget({ shots, maxUsesPerSource: 2, minimumHookSeconds: 8 });
  assert.equal(result.removed_hook_uses.length, 1);
  assert.equal(result.removed_hook_uses[0].asset, "ocean.mp4");
  assert.equal(result.use_counts["ocean.mp4"], 2);
  assert.equal(result.shots.filter((shot) => shot.hook_footage).reduce((sum, shot) => sum + shot.duration, 0), 8);
});

test("system fails closed when no removable hook use can preserve the authored minimum", () => {
  const shots = [
    footage("ocean.mp4", 0, 5, { hook_footage: true, generic_stock: true }),
    footage("crew.mp4", 0, 5, { hook_footage: true }),
    { asset_type: "evidence", duration: 4 },
    footage("ocean.mp4", 8, 4),
    { asset_type: "evidence", duration: 4 },
    footage("ocean.mp4", 16, 4),
  ];
  assert.throws(
    () => enforceFootageUseBudget({ shots, maxUsesPerSource: 2, minimumHookSeconds: 10 }),
    /cannot be satisfied without changing claim-bound body footage/
  );
});
