import test from "node:test";
import assert from "node:assert/strict";
import { mergeCoverageGapClaims, retireSupersededTargets } from "./orvyq_author_footage_distribution.mjs";

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
