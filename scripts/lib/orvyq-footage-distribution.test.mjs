import test from "node:test";
import assert from "node:assert/strict";
import {
  collectClaimSliceTopology,
  collectHookFootageUsage,
  planFootageDistribution,
} from "./orvyq-footage-distribution.mjs";

function shot(claimId, sliceIndex, duration, extra = {}) {
  return { claim_id: claimId, source_slice_index: sliceIndex, duration, ...extra };
}

function pool(sceneIds) {
  return sceneIds.map((sceneId) => ({
    scene_id: sceneId,
    role: "context",
    semantic_link: "physical",
    semantic_rationale: `Approved claim-bound footage carried forward for ${sceneId} at this narration beat.`,
  }));
}

/** A claim with `sliceCount` equal-length slices. */
function evenClaim(claimId, sliceCount, duration = 8) {
  return { claim_id: claimId, slices: Array.from({ length: sliceCount }, (_, index) => ({ slice_index: index, duration_seconds: duration })) };
}

test("slice topology sums every shot that shares one contracted source slice", () => {
  const topology = collectClaimSliceTopology([
    shot("CLM_B", 0, 3),
    shot("CLM_A", 1, 4),
    shot("CLM_A", 1, 2),
    shot("CLM_A", 0, 5),
    { claim_id: "CLM_A", source_slice_index: null, duration: 9 },
  ]);

  assert.deepEqual(topology, [
    { claim_id: "CLM_A", slices: [{ slice_index: 0, duration_seconds: 5 }, { slice_index: 1, duration_seconds: 6 }] },
    { claim_id: "CLM_B", slices: [{ slice_index: 0, duration_seconds: 3 }] },
  ]);
});

test("hook usage is attributed to the scene each hook shot actually plays", () => {
  const hook = collectHookFootageUsage([
    { asset_type: "footage", hook_footage: true, scene_id: "scene_001", duration: 3 },
    { asset_type: "footage", hook_footage: true, scene_id: "scene_004", duration: 2.5 },
    { asset_type: "footage", hook_footage: true, scene_id: "scene_004", duration: 1.5 },
    { asset_type: "footage", hook_footage: false, scene_id: "scene_009", duration: 7 },
    { asset_type: "evidence", hook_footage: true, duration: 4 },
  ]);

  assert.equal(hook.seconds, 7);
  assert.equal(hook.usesByScene.get("scene_001"), 1);
  assert.equal(hook.usesByScene.get("scene_004"), 2);
  assert.equal(hook.usesByScene.has("scene_009"), false);
});

test("authored distribution lands inside the profile band and never exceeds the per-source budget", () => {
  const claimSlices = [evenClaim("CLM_A", 6), evenClaim("CLM_B", 6), evenClaim("CLM_C", 6)];
  const result = planFootageDistribution({
    claimSlices,
    claimPools: {
      CLM_A: pool(["scene_001", "scene_002", "scene_003"]),
      CLM_B: pool(["scene_004", "scene_005", "scene_006"]),
      CLM_C: pool(["scene_007", "scene_008", "scene_009"]),
    },
    totalRuntimeSeconds: 144,
    maxUsesPerSource: 2,
    footageFractionMin: 0.6,
    footageFractionMax: 0.7,
  });

  assert.ok(result.summary.contextual_footage_fraction >= 0.6);
  assert.ok(result.summary.contextual_footage_fraction <= 0.7);

  const uses = new Map();
  for (const assignment of result.assignments) {
    uses.set(assignment.scene_id, (uses.get(assignment.scene_id) || 0) + 1);
  }
  assert.equal(Math.max(...uses.values()) <= 2, true);

  const targets = new Set(result.assignments.map((item) => `${item.claim_id}:${item.slice_index}`));
  assert.equal(targets.size, result.assignments.length, "every contracted target is unique");
});

test("hook uses are charged against the same per-source budget as body targets", () => {
  const result = planFootageDistribution({
    claimSlices: [evenClaim("CLM_A", 4), evenClaim("CLM_B", 4)],
    claimPools: { CLM_A: pool(["scene_001", "scene_002"]), CLM_B: pool(["scene_003", "scene_004"]) },
    totalRuntimeSeconds: 100,
    hookFootageSeconds: 8,
    hookUsesByScene: new Map([["scene_001", 1]]),
    maxUsesPerSource: 2,
    footageFractionMin: 0.6,
    footageFractionMax: 0.7,
  });

  const sceneOneUses = result.assignments.filter((item) => item.scene_id === "scene_001").length;
  assert.equal(sceneOneUses <= 1, true, "scene_001 already spent one of its two uses on the motion hook");
});

test("footage is spread across each claim rather than clumped at its opening", () => {
  const result = planFootageDistribution({
    claimSlices: [evenClaim("CLM_A", 8)],
    claimPools: { CLM_A: pool(["scene_001", "scene_002", "scene_003", "scene_004"]) },
    totalRuntimeSeconds: 100,
    maxUsesPerSource: 2,
    footageFractionMin: 0.6,
    footageFractionMax: 0.7,
  });

  const slices = result.assignments.map((item) => item.slice_index).sort((a, b) => a - b);
  assert.equal(slices[0], 0, "the claim opens on approved footage");
  const gaps = slices.slice(1).map((value, index) => value - slices[index]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 2, `expected an even spread, got ${slices.join(",")}`);
});

test("reuse varies the trim window and motion so a repeated clip never replays identically", () => {
  const result = planFootageDistribution({
    claimSlices: [evenClaim("CLM_A", 4)],
    claimPools: { CLM_A: pool(["scene_001"]) },
    totalRuntimeSeconds: 26,
    maxUsesPerSource: 2,
    footageFractionMin: 0.6,
    footageFractionMax: 0.7,
  });

  const reuses = result.assignments.filter((item) => item.scene_id === "scene_001");
  assert.equal(reuses.length, 2);
  assert.notEqual(reuses[0].trim_in_ratio, reuses[1].trim_in_ratio);
  for (const assignment of reuses) {
    assert.ok(assignment.trim_in_ratio >= 0 && assignment.trim_in_ratio < 1);
  }
});

test("an infeasible footage floor fails closed with the per-claim acquisition it would take to clear it", () => {
  // Two claims, one approved scene each, two uses apiece: at most 4 of the 10
  // slices can carry footage, well under a 60% floor.
  assert.throws(
    () => planFootageDistribution({
      claimSlices: [evenClaim("CLM_A", 5), evenClaim("CLM_B", 5)],
      claimPools: { CLM_A: pool(["scene_001"]), CLM_B: pool(["scene_002"]) },
      totalRuntimeSeconds: 80,
      maxUsesPerSource: 2,
      footageFractionMin: 0.6,
      footageFractionMax: 0.7,
    }),
    (error) => {
      assert.equal(error.code, "FOOTAGE_COVERAGE_INFEASIBLE");
      assert.match(error.message, /Acquire and review more claim-bound footage/);
      const claims = error.details.required_additional_scenes.map((entry) => entry.claim_id).sort();
      assert.deepEqual(claims, ["CLM_A", "CLM_B"]);
      assert.equal(error.details.satisfiable, true);
      return true;
    },
  );
});

test("a claim with no approved footage is reported rather than silently backfilled", () => {
  const result = planFootageDistribution({
    claimSlices: [evenClaim("CLM_A", 6), evenClaim("CLM_B", 2)],
    claimPools: { CLM_A: pool(["scene_001", "scene_002", "scene_003"]) },
    totalRuntimeSeconds: 64,
    maxUsesPerSource: 2,
    footageFractionMin: 0.6,
    footageFractionMax: 0.7,
  });

  assert.deepEqual(result.summary.claims_without_approved_pool, ["CLM_B"]);
  assert.equal(result.assignments.every((item) => item.claim_id === "CLM_A"), true);
});

test("the same inputs always author the same distribution", () => {
  const input = {
    claimSlices: [evenClaim("CLM_A", 6), evenClaim("CLM_B", 6)],
    claimPools: { CLM_A: pool(["scene_001", "scene_002"]), CLM_B: pool(["scene_003", "scene_004"]) },
    totalRuntimeSeconds: 100,
    maxUsesPerSource: 2,
    footageFractionMin: 0.6,
    footageFractionMax: 0.7,
  };
  assert.deepEqual(planFootageDistribution(input).assignments, planFootageDistribution(input).assignments);
});
