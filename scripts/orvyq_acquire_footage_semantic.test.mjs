import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  collectRejectedProviderAssetIds,
  matchesSemanticText,
  materializeAssignments,
} from "./orvyq_acquire_footage_demand.mjs";

const constrained = {
  semantic_title_constraints: {
    required_any_groups: [["robot", "submersible", "rov"], ["underwater", "ocean", "sea"]],
    forbidden_terms: ["diver", "scuba"],
  },
};

test("semantic metadata constraints reject fuzzy but visibly different provider titles", () => {
  assert.equal(
    matchesSemanticText("https://www.pexels.com/video/scuba-diver-putting-sea-urchins-in-a-basket-8823145/", constrained),
    false,
  );
  assert.equal(
    matchesSemanticText("https://www.pexels.com/video/underwater-rov-robot-exploring-ocean-floor-123/", constrained),
    true,
  );
  assert.equal(
    matchesSemanticText("https://www.pexels.com/video/underwater-diver-beside-a-robot-123/", constrained),
    false,
  );
});

test("a rejected provider asset is globally barred from every backfill scene", () => {
  const rejected = collectRejectedProviderAssetIds(
    { scenes: { scene_001: { rejected_provider_asset_ids: ["111"] } } },
    { rejected_assets: [{ scene_id: "scene_002", provider_asset_id: "222" }] },
  );
  assert.deepEqual([...rejected].sort(), ["111", "222"]);
});

test("semantic reacquisition may replace the same narration-anchored footage target", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orvyq-semantic-replace-"));
  try {
    await fs.mkdir(path.join(dir, "config"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "config", "editorial_asset_plan.json"),
      JSON.stringify({
        project_id: "002-the-new-war-beneath-the-ocean",
        footage_assignments: {
          CLM_TEST: {
            "28": {
              asset: "assets/footage/scene_025_bad.mp4",
              semantic_anchor: "The ability to reach a resource does not create an obligation to extract it.",
            },
          },
        },
        graphic_break_assignments: {},
        full_footage_pool: ["assets/footage/scene_025_bad.mp4"],
      }),
    );
    const plan = {
      assets: [{
        scene_id: "scene_025",
        role: "context",
        force_reacquire: true,
        editorial_assignment: {
          claim_id: "CLM_TEST",
          slice_index: 28,
          narration_anchor: "The ability to reach a resource does not create an obligation to extract it.",
          semantic_rationale: "Directly shows the verified machine operation named by this narration anchor.",
          replace_graphic_break: true,
        },
      }],
    };
    const records = [{
      scene_id: "scene_025",
      path: "assets/footage/scene_025_good.mp4",
      provider_asset_id: "456",
      role: "context",
    }];

    const result = await materializeAssignments(dir, plan, records);
    assert.equal(result.retired_paths, 1);
    const materialized = JSON.parse(
      await fs.readFile(path.join(dir, "config", "editorial_asset_plan.json"), "utf8"),
    );
    assert.equal(materialized.footage_assignments.CLM_TEST["28"].asset, records[0].path);
    assert.deepEqual(materialized.full_footage_pool, [records[0].path]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
