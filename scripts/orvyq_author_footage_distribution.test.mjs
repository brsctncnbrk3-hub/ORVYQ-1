import test from "node:test";
import assert from "node:assert/strict";
import {
  assembleReviewablePoolSource,
  collectAcquiredClaimPools,
  collectCoverageTargetRequirements,
  extendAssignmentsForPendingReview,
  mergeCoverageGapClaims,
  retireSupersededTargets,
} from "./orvyq_author_footage_distribution.mjs";

const POOLS = { CLM_A: [{ scene_id: "scene_001" }], CLM_B: [{ scene_id: "scene_002" }], CLM_C: [] };

function evenClaim(claimId, sliceCount, durationSeconds) {
  return {
    claim_id: claimId,
    slices: Array.from({ length: sliceCount }, (_, sliceIndex) => ({
      slice_index: sliceIndex,
      duration_seconds: durationSeconds,
    })),
  };
}

test("a claim the plan could not cover is added to the acquisition list", () => {
  const merged = mergeCoverageGapClaims([{ claim_id: "CLM_A", additional_approved_scenes: 2 }], ["CLM_B"], POOLS);
  assert.deepEqual(merged, [
    { claim_id: "CLM_A", additional_approved_scenes: 2 },
    { claim_id: "CLM_B", additional_approved_scenes: 1 },
  ]);
});

test("a claim already asking for more footage is not asked twice", () => {
  const merged = mergeCoverageGapClaims([{ claim_id: "CLM_A", additional_approved_scenes: 2 }], ["CLM_A"], POOLS);
  assert.deepEqual(merged, [{ claim_id: "CLM_A", additional_approved_scenes: 2 }]);
});

test("a claim with no approved pool at all is left to the louder error", () => {
  assert.deepEqual(mergeCoverageGapClaims([], ["CLM_C"], POOLS), []);
});

test("superseded editorial targets are retired with a reason, not silently dropped", () => {
  const retirements = retireSupersededTargets({
    editorialAssignments: {
      CLM_A: {
        0: { asset: "assets/footage/scene_001_12345678.mp4" },
        3: { asset: "assets/footage/scene_001_12345678.mp4" },
      },
    },
    assignments: [{ claim_id: "CLM_A", slice_index: 0, scene_id: "scene_001" }],
    managedSceneIds: ["scene_001"],
  });

  assert.equal(retirements.length, 1, "slice 0 is still contracted; only slice 3 is retired");
  assert.equal(retirements[0].scene_id, "scene_001");
  assert.equal(retirements[0].slice_index, 3);
  assert.ok(retirements[0].reason.length >= 16);
});

test("a target handed to a different approved scene names its replacement", () => {
  const retirements = retireSupersededTargets({
    editorialAssignments: { CLM_A: { 2: { asset: "assets/footage/scene_001_12345678.mp4" } } },
    assignments: [{ claim_id: "CLM_A", slice_index: 2, scene_id: "scene_009" }],
    managedSceneIds: ["scene_001", "scene_009"],
  });
  assert.match(retirements[0].reason, /scene_009/);
});

test("an unmanaged scene's assignment is left alone", () => {
  assert.deepEqual(
    retireSupersededTargets({
      editorialAssignments: { CLM_A: { 0: { asset: "assets/footage/scene_077_12345678.mp4" } } },
      assignments: [],
      managedSceneIds: ["scene_001"],
    }),
    [],
  );
});

test("retirements already recorded are not duplicated on a re-run", () => {
  const existing = [{ scene_id: "scene_001", claim_id: "CLM_A", slice_index: 3, reason: "Recorded on an earlier authoring pass." }];
  const retirements = retireSupersededTargets({
    editorialAssignments: { CLM_A: { 3: { asset: "assets/footage/scene_001_12345678.mp4" } } },
    assignments: [],
    managedSceneIds: ["scene_001"],
    existingRetirements: existing,
  });
  assert.equal(retirements.length, 1);
});

const ACQUISITION_PLAN = {
  assets: [
    {
      scene_id: "scene_001",
      claim_id: "CLM_A",
      role: "human_context",
      semantic_link: "physical",
      semantic_rationale: "Engineers reading frontier code carry the opening line without asserting anything themselves.",
    },
    {
      scene_id: "scene_002",
      claim_id: "CLM_B",
      editorial_note: "An instrumented bench where a controlled scenario is prepared for a test.",
    },
    { scene_id: "scene_003", claim_id: "CLM_C", semantic_rationale: "Never acquired, so never poolable at all." },
    { scene_id: "scene_004", semantic_rationale: "Acquired, but its plan entry binds it to no claim of its own." },
  ],
};
const RUNTIME = {
  records: [
    { scene_id: "scene_001", path: "assets/footage/scene_001_1.mp4" },
    { scene_id: "scene_002", path: "assets/footage/scene_002_2.mp4" },
    { scene_id: "scene_004", path: "assets/footage/scene_004_4.mp4" },
  ],
};

test("the seed pool carries every acquired scene its own plan binds to a claim", () => {
  const seeded = collectAcquiredClaimPools(ACQUISITION_PLAN, RUNTIME);
  assert.deepEqual(seeded.map((entry) => entry.scene_id), ["scene_001", "scene_002"]);
  assert.equal(seeded[0].role, "human_context");
  // An entry with no explicit role or link still lands on the canonical defaults.
  assert.equal(seeded[1].role, "context");
  assert.equal(seeded[1].semantic_link, "physical");
  // editorial_note stands in for a missing rationale rather than leaving it empty.
  assert.match(seeded[1].semantic_rationale, /instrumented bench/);
});

test("a planned scene with no acquired bytes is never seeded into the pool", () => {
  const seeded = collectAcquiredClaimPools(ACQUISITION_PLAN, RUNTIME);
  assert.equal(seeded.some((entry) => entry.scene_id === "scene_003"), false);
});

test("an acquired scene with no claim of its own is a gap, not an invented binding", () => {
  const seeded = collectAcquiredClaimPools(ACQUISITION_PLAN, RUNTIME);
  assert.equal(seeded.some((entry) => entry.scene_id === "scene_004"), false);
});

test("nothing is seeded when acquisition produced no records at all", () => {
  assert.deepEqual(collectAcquiredClaimPools(ACQUISITION_PLAN, { records: [] }), []);
});

test("an explicit pending filter seeds only the acquired scenes in the open review round", () => {
  const seeded = collectAcquiredClaimPools(ACQUISITION_PLAN, RUNTIME, new Set(["scene_002", "scene_003"]));
  assert.deepEqual(seeded.map((entry) => entry.scene_id), ["scene_002"]);
});

test("a replacement review keeps approved contract entries and provisionally adds only pending acquisitions", () => {
  const assembled = assembleReviewablePoolSource({
    contracts: {
      assignments: [
        { scene_id: "scene_001", claim_id: "CLM_A", semantic_rationale: "Approved current bytes with an existing exact use." },
        { scene_id: "scene_002", claim_id: "CLM_B", semantic_rationale: "Stale assignment from bytes that are no longer approved." },
      ],
    },
    approvedSceneIds: new Set(["scene_001"]),
    pendingSceneIds: new Set(["scene_002"]),
    acquisitionPlan: ACQUISITION_PLAN,
    runtime: RUNTIME,
  });

  assert.equal(assembled.provisional_scene_count, 1);
  assert.deepEqual(assembled.assignments.map((entry) => entry.scene_id), ["scene_001", "scene_002"]);
  assert.match(assembled.assignments[1].semantic_rationale, /instrumented bench/);
});

test("a replacement review preserves approved exact uses and adds a balanced pending target", () => {
  const result = extendAssignmentsForPendingReview({
    approvedAssignments: [
      { scene_id: "scene_001", claim_id: "CLM_A", slice_index: 0, semantic_rationale: "Approved opening use stays exact." },
      { scene_id: "scene_001", claim_id: "CLM_A", slice_index: 4, semantic_rationale: "Approved closing use stays exact." },
    ],
    provisionalAssignments: [
      { scene_id: "scene_002", claim_id: "CLM_A", role: "context", semantic_link: "physical", semantic_rationale: "Pending replacement is bound only for review." },
    ],
    claimSlices: [evenClaim("CLM_A", 5, 10)],
    maxUsesPerSource: 2,
    totalRuntimeSeconds: 50,
    hookFootageSeconds: 0,
    footageFractionMin: 0.5,
    footageFractionMax: 0.8,
  });

  assert.deepEqual(result.assignments.filter((item) => item.scene_id === "scene_001").map((item) => item.slice_index), [0, 4]);
  assert.equal(result.assignments.find((item) => item.scene_id === "scene_002").slice_index, 2);
  assert.equal(result.summary.contextual_footage_fraction, 0.6);
});

test("an exact coverage target minimally moves one approved use within its own claim", () => {
  const result = extendAssignmentsForPendingReview({
    approvedAssignments: [
      { scene_id: "scene_001", claim_id: "CLM_A", slice_index: 0, semantic_rationale: "Approved opening use." },
      { scene_id: "scene_001", claim_id: "CLM_A", slice_index: 4, semantic_rationale: "Approved far-edge use." },
    ],
    provisionalAssignments: [],
    claimSlices: [evenClaim("CLM_A", 5, 10)],
    requiredCoverageTargets: [{ claim_id: "CLM_A", slice_index: 2, reason: "break_uninterrupted_evidence_run" }],
    maxUsesPerSource: 2,
    totalRuntimeSeconds: 50,
    hookFootageSeconds: 0,
    footageFractionMin: 0.3,
    footageFractionMax: 0.6,
  });

  assert.deepEqual(result.assignments.map((item) => item.slice_index), [0, 2]);
});

test("coverage requirements choose exact pause targets and split overlong evidence runs", () => {
  const requirements = collectCoverageTargetRequirements([
    { claim_id: "CLM_A", source_slice_index: 0, asset_type: "evidence", duration: 7 },
    { claim_id: "CLM_A", source_slice_index: 1, asset_type: "evidence", duration: 7, emphasis_card: { title: "Hold" } },
    { claim_id: "CLM_A", source_slice_index: 2, asset_type: "evidence", duration: 7 },
    { claim_id: "CLM_A", source_slice_index: 3, asset_type: "evidence", duration: 7 },
    { claim_id: "CLM_A", source_slice_index: 4, asset_type: "evidence", duration: 7 },
  ], 15);

  assert.deepEqual(requirements, [
    { claim_id: "CLM_A", slice_index: 1, reason: "editorial_pause_requires_footage" },
    { claim_id: "CLM_A", slice_index: 3, reason: "break_uninterrupted_evidence_run" },
  ]);
});
