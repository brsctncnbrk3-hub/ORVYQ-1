import test from "node:test";
import assert from "node:assert/strict";
import {
  collectAcquiredClaimPools,
  mergeCoverageGapClaims,
  retireSupersededTargets,
} from "./orvyq_author_footage_distribution.mjs";

const POOLS = { CLM_A: [{ scene_id: "scene_001" }], CLM_B: [{ scene_id: "scene_002" }], CLM_C: [] };

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
