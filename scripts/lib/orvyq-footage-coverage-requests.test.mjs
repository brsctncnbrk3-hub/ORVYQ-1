import test from "node:test";
import assert from "node:assert/strict";
import { planCoverageAcquisition, applyCoverageAcquisition } from "./orvyq-footage-coverage-requests.mjs";

function constraints(scenes) {
  return { schema_version: "1.0", project_id: "007-a-film", request_revision: 1, scenes };
}

const REVIEWED = constraints({
  scene_001: {
    claim_id: "CLM_A",
    required_visible_content: "An official governance setting; the regulation text stays primary evidence.",
    forbidden_content: ["logos presented as factual endorsement"],
    semantic_link: "conceptual",
  },
  scene_002: {
    claim_id: "CLM_B",
    required_visible_content: "Ordinary human scale and the distributed social consequence.",
    forbidden_content: ["unrelated robots or humanoids"],
    semantic_link: "physical",
  },
});

const PLAN = {
  schema_version: "1.0",
  project_id: "007-a-film",
  assets: [
    { scene_id: "scene_001", claim_id: "CLM_A", role: "context", queries: ["parliament exterior"], fallback_queries: ["government building"], min_duration_seconds: 8 },
    { scene_id: "scene_002", claim_id: "CLM_B", role: "human_context", queries: ["city crowd"], min_duration_seconds: 8 },
  ],
};

const REQUESTS = {
  schema_version: "1.0",
  project_id: "007-a-film",
  request_revision: 1,
  policy: { automatic_backfill_forbidden: true, decorative_document_recreation_forbidden: true, same_content_different_crop_counts_once: true },
  requests: [
    { asset_request_id: "REQ_FTG_SCENE_001", type: "contextual_footage", status: "ready", claim_ids: ["CLM_A"], scene_ids: ["scene_001"], resolved_asset_paths: ["assets/footage/scene_001_1.mp4"] },
    { asset_request_id: "REQ_FTG_SCENE_002", type: "contextual_footage", status: "ready", claim_ids: ["CLM_B"], scene_ids: ["scene_002"], resolved_asset_paths: ["assets/footage/scene_002_2.mp4"] },
  ],
};

test("a shortfall becomes claim-bound acquisition scenes that carry the reviewed direction forward", () => {
  const { scenes } = planCoverageAcquisition({
    requiredAdditionalScenes: [{ claim_id: "CLM_A", additional_approved_scenes: 1 }],
    semanticConstraints: REVIEWED,
    acquisitionPlan: PLAN,
    existingSceneIds: ["scene_001", "scene_002"],
  });

  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].scene_id, "scene_003");
  assert.equal(scenes[0].claim_id, "CLM_A");
  assert.equal(scenes[0].required_visible_content, REVIEWED.scenes.scene_001.required_visible_content);
  assert.deepEqual(scenes[0].queries, ["parliament exterior"]);
  assert.equal(scenes[0].modelled_on_scene_id, "scene_001");
});

test("a claim needing two more clips is modelled on two different reviewed scenes", () => {
  const reviewed = constraints({
    ...REVIEWED.scenes,
    scene_003: { claim_id: "CLM_B", required_visible_content: "The physical machine and concentrated infrastructure.", forbidden_content: ["stock crowd"], semantic_link: "physical" },
  });
  const { scenes } = planCoverageAcquisition({
    requiredAdditionalScenes: [{ claim_id: "CLM_B", additional_approved_scenes: 2 }],
    semanticConstraints: reviewed,
    acquisitionPlan: PLAN,
    existingSceneIds: ["scene_001", "scene_002", "scene_003"],
  });

  assert.deepEqual(scenes.map((scene) => scene.scene_id), ["scene_004", "scene_005"]);
  assert.notEqual(scenes[0].modelled_on_scene_id, scenes[1].modelled_on_scene_id);
});

test("scene ids continue past every id already spoken for, not just the constraint file's", () => {
  const { scenes } = planCoverageAcquisition({
    requiredAdditionalScenes: [{ claim_id: "CLM_A", additional_approved_scenes: 1 }],
    semanticConstraints: REVIEWED,
    acquisitionPlan: PLAN,
    // The acquired pool ran ahead of the constraints file.
    existingSceneIds: ["scene_001", "scene_002", "scene_040", "scene_041"],
  });
  assert.equal(scenes[0].scene_id, "scene_042");
});

test("a claim with no reviewed constraint cannot be acquired against", () => {
  assert.throws(
    () => planCoverageAcquisition({
      requiredAdditionalScenes: [{ claim_id: "CLM_UNKNOWN", additional_approved_scenes: 1 }],
      semanticConstraints: REVIEWED,
      acquisitionPlan: PLAN,
      existingSceneIds: ["scene_001"],
    }),
    /no reviewed semantic constraint/,
  );
});

test("recorded requests are blocked on acquisition and bound to the claim in all three files", () => {
  const { scenes } = planCoverageAcquisition({
    requiredAdditionalScenes: [{ claim_id: "CLM_A", additional_approved_scenes: 1 }],
    semanticConstraints: REVIEWED,
    acquisitionPlan: PLAN,
    existingSceneIds: ["scene_001", "scene_002"],
  });
  const result = applyCoverageAcquisition({ scenes, requests: REQUESTS, semanticConstraints: REVIEWED, acquisitionPlan: PLAN });

  assert.equal(result.added.length, 1);
  const request = result.requests.requests.at(-1);
  assert.equal(request.asset_request_id, "REQ_FTG_SCENE_003");
  assert.equal(request.status, "pending_acquisition");
  assert.deepEqual(request.claim_ids, ["CLM_A"]);
  assert.match(request.acceptance, /contact-sheet/);
  assert.equal(result.semanticConstraints.scenes.scene_003.claim_id, "CLM_A");
  assert.equal(result.acquisitionPlan.assets.at(-1).scene_id, "scene_003");
  assert.equal(result.requests.request_revision, 2);

  // The inputs are untouched, so a failed write cannot half-apply.
  assert.equal(REQUESTS.requests.length, 2);
  assert.equal(PLAN.assets.length, 2);
});

test("a claim already waiting on acquisition is not asked twice", () => {
  const pending = {
    ...REQUESTS,
    requests: [
      ...REQUESTS.requests,
      { asset_request_id: "REQ_FTG_SCENE_009", type: "contextual_footage", status: "pending_acquisition", claim_ids: ["CLM_A"], scene_ids: ["scene_009"] },
    ],
  };
  const { scenes } = planCoverageAcquisition({
    requiredAdditionalScenes: [{ claim_id: "CLM_A", additional_approved_scenes: 1 }],
    semanticConstraints: REVIEWED,
    acquisitionPlan: PLAN,
    existingSceneIds: ["scene_001", "scene_002", "scene_009"],
  });
  const result = applyCoverageAcquisition({ scenes, requests: pending, semanticConstraints: REVIEWED, acquisitionPlan: PLAN });
  assert.equal(result.added.length, 0);
  assert.equal(result.requests.requests.length, 3);
});

test("allocating a scene id that is already requested fails loudly instead of silently skipping", () => {
  const scenes = [{
    scene_id: "scene_001",
    claim_id: "CLM_C",
    role: "context",
    semantic_link: "physical",
    required_visible_content: "Something else entirely for a different claim.",
    forbidden_content: [],
    queries: [],
    fallback_queries: [],
    min_duration_seconds: 8,
  }];
  assert.throws(
    () => applyCoverageAcquisition({ scenes, requests: REQUESTS, semanticConstraints: REVIEWED, acquisitionPlan: PLAN }),
    /already requested/,
  );
});
