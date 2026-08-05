import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  mergeFootageUseContractOverrides,
  assertNoSilentManagedAssignmentRemoval,
  resolveContractReuseReason,
  synchronizeVisualRebalanceShots,
} from "./orvyq_apply_footage_use_contracts.mjs";

const base = {
  schema_version: "1.0",
  project_id: "999-contract-fixture",
  managed_scene_ids: ["scene_010"],
  pruned_scene_ids: [],
  assignments: [
    {
      scene_id: "scene_010",
      claim_id: "CLM_A",
      slice_index: 1,
      trim_in_ratio: 0,
      motion: "hold",
      role: "context",
      semantic_link: "conceptual",
      semantic_rationale: "The original approved use is tied to this exact narration target.",
    },
  ],
};

test("a reusable override can move one managed scene while preserving its other explicit use", () => {
  const merged = mergeFootageUseContractOverrides(base, {
    schema_version: "1.0",
    project_id: "999-contract-fixture",
    managed_scene_ids: ["scene_020"],
    retired_targets: [
      {
        scene_id: "scene_020",
        claim_id: "CLM_B",
        slice_index: 4,
        reason: "Move the governance break earlier to interrupt the evidence run.",
      },
    ],
    assignments: [
      {
        scene_id: "scene_020",
        claim_id: "CLM_B",
        slice_index: 2,
        trim_in_ratio: 0,
        motion: "hold",
        role: "human_context",
        semantic_link: "conceptual",
        semantic_rationale: "A real hearing interrupts the dense legal evidence sequence.",
      },
      {
        scene_id: "scene_020",
        claim_id: "CLM_C",
        slice_index: 1,
        trim_in_ratio: 0.3,
        motion: "pull",
        role: "human_context",
        semantic_link: "conceptual",
        semantic_rationale: "A distinct reviewed trim represents later regulatory delay.",
      },
    ],
  });

  assert.deepEqual(merged.managed_scene_ids, ["scene_010", "scene_020"]);
  assert.equal(merged.assignments.length, 3);
  assert.equal(merged.retired_targets.length, 1);
});

test("contract reuse reasons preserve explicit intent and never invent a first-use callback", () => {
  const explicit = "The second use returns to the reviewed setting at a separate narration target for a deliberate callback.";
  assert.equal(resolveContractReuseReason({ scene_id: "scene_020", reuse_reason: explicit }, 1), explicit);
  assert.equal(resolveContractReuseReason({ scene_id: "scene_020" }, 1), null);
  assert.match(resolveContractReuseReason({ scene_id: "scene_020" }, 2), /explicit footage contract/);
});

test("Project 002 records explicit callback reasons for all five repetitions exposed by run 31009178282", () => {
  const projectRoot = new URL("../projects/002-the-new-war-beneath-the-ocean/", import.meta.url);
  const overrides = JSON.parse(readFileSync(new URL("research/footage_use_contract_overrides.json", projectRoot), "utf8"));
  const rebalance = JSON.parse(readFileSync(new URL("direction/visual_rebalance_plan.json", projectRoot), "utf8"));
  const contractReasons = new Map(
    overrides.assignments
      .filter((entry) => entry.reuse_reason)
      .map((entry) => [entry.scene_id, entry.reuse_reason]),
  );
  const replacementReasons = new Map(
    rebalance.actions.flatMap((action) =>
      (action.replacement_assets || [])
        .filter((entry) => entry.reuse_reason)
        .map((entry) => [entry.asset_path, entry.reuse_reason]),
    ),
  );

  for (const sceneId of ["scene_016", "scene_033", "scene_053"]) {
    assert.ok(String(contractReasons.get(sceneId) || "").length >= 24, `${sceneId} contract callback reason is missing`);
  }
  for (const assetPath of ["assets/footage/scene_012_official_reuse.mp4", "assets/footage/scene_052_direct.mp4"]) {
    assert.ok(String(replacementReasons.get(assetPath) || "").length >= 24, `${assetPath} replacement callback reason is missing`);
  }
});

test("silent removal of a managed editorial assignment fails closed", () => {
  assert.throws(
    () =>
      assertNoSilentManagedAssignmentRemoval({
        editorialAssignments: {
          CLM_B: {
            4: { asset: "assets/footage/scene_020_example.mp4" },
          },
        },
        managedSceneIds: ["scene_020"],
        prunedSceneIds: [],
        finalAssignments: [],
        retiredTargets: [],
      }),
    /silently remove/
  );
});

test("an explicit retirement with a reason permits an intentional move", () => {
  assert.doesNotThrow(() =>
    assertNoSilentManagedAssignmentRemoval({
      editorialAssignments: {
        CLM_B: {
          4: { asset: "assets/footage/scene_020_example.mp4" },
        },
      },
      managedSceneIds: ["scene_020"],
      prunedSceneIds: [],
      finalAssignments: [
        {
          scene_id: "scene_020",
          claim_id: "CLM_B",
          slice_index: 2,
        },
      ],
      retiredTargets: [
        {
          scene_id: "scene_020",
          claim_id: "CLM_B",
          slice_index: 4,
          reason: "Move the clip earlier to break a long uninterrupted evidence sequence.",
        },
      ],
    })
  );
});

test("duplicate override targets are rejected before project files are changed", () => {
  assert.throws(
    () =>
      mergeFootageUseContractOverrides(base, {
        schema_version: "1.0",
        project_id: "999-contract-fixture",
        managed_scene_ids: ["scene_020"],
        assignments: [
          {
            scene_id: "scene_020",
            claim_id: "CLM_A",
            slice_index: 1,
            trim_in_ratio: 0,
            semantic_rationale: "This conflicts with the base target and must fail closed.",
          },
        ],
      }),
    /duplicate target/
  );
});

test("footage reconciliation reapplies the effective visual-rebalance materialization", () => {
  const shots = [
    {
      duration: 7,
      claim_id: "CLM_A",
      section_id: "SEC_A",
      source_slice_index: 0,
      asset_type: "footage",
      asset: "assets/footage/abyss.mp4",
      visual_role: "context",
      trim_in_sec: 1,
      trim_out_sec: 8,
      motion: "push",
      semantic_link: "physical",
      semantic_rationale: "The approved abyssal footage establishes the physical setting.",
      contextual_footage: true,
      generic_stock: false,
    },
    {
      duration: 6,
      claim_id: "CLM_A",
      section_id: "SEC_A",
      source_slice_index: 1,
      asset_type: "evidence",
      visual_role: "evidence",
      semantic_link: "direct_evidence",
      semantic_rationale: "The previous blueprint still contains a redundant evidence beat.",
      evidence: {
        kind: "official_figure",
        source_ids: ["SRC_A"],
        source_label: "Fixture Institution",
        title: "Fixture source — redundant view",
      },
    },
    {
      duration: 4,
      claim_id: "CLM_A",
      section_id: "SEC_A",
      source_slice_index: 2,
      asset_type: "evidence",
      visual_role: "evidence",
      semantic_link: "direct_evidence",
      semantic_rationale: "A concise source-backed beat remains after the redundant view is removed.",
      evidence: {
        kind: "source_article",
        source_ids: ["SRC_A"],
        source_label: "Fixture Institution",
        title: "Fixture source — retained evidence",
      },
    },
  ];
  const rebalancePlan = {
    status: "materialized",
    actions: [
      {
        baseline_shot_index: 1,
        claim_id: "CLM_A",
        duration_seconds: 6,
        decision: "remove",
        projected_medium: "contextual_footage",
        replacement_strategy: "extend_adjacent_footage",
        rationale: "Continue the approved physical footage instead of repeating the same evidence page.",
      },
    ],
  };

  const synchronized = synchronizeVisualRebalanceShots({ shots, rebalancePlan });
  assert.equal(synchronized[1].asset_type, "footage");
  assert.equal(synchronized[1].asset, "assets/footage/abyss.mp4");
  assert.equal(synchronized[1].trim_in_sec, 8);
  assert.equal(synchronized[1].trim_out_sec, 14);
  assert.equal(synchronized[1].evidence, undefined);
  assert.equal(synchronized[2].asset_type, "evidence");
  assert.deepEqual(synchronized[2].evidence.source_ids, ["SRC_A"]);
});
