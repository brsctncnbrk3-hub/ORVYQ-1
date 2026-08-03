import test from "node:test";
import assert from "node:assert/strict";
import { collectPinnedSelectionDrift, pinnedProviderAssetId } from "./orvyq_pinned_selection_drift.mjs";

const PLAN = {
  assets: [
    { scene_id: "scene_001", provider_asset_ids: ["4630103"], inspected_selection: { provider_asset_id: "4630103" } },
    { scene_id: "scene_002", provider_asset_ids: ["7141174"], inspected_selection: { provider_asset_id: "7141174" } },
    { scene_id: "scene_003", provider_asset_ids: ["9574129"], inspected_selection: { provider_asset_id: "9574129" } },
    { scene_id: "scene_004", queries: ["never inspected"] },
  ],
};
const RUNTIME = {
  records: [
    { scene_id: "scene_001", path: "assets/footage/scene_001_a.mp4" },
    { scene_id: "scene_002", path: "assets/footage/scene_002_b.mp4" },
    { scene_id: "scene_004", path: "assets/footage/scene_004_d.mp4" },
  ],
};

test("a scene holding a clip nobody pinned is reported with both ids", () => {
  const { drifted } = collectPinnedSelectionDrift({
    acquisitionPlan: PLAN,
    runtime: RUNTIME,
    provenanceByScene: new Map([["scene_001", "33656654"], ["scene_002", "7141174"], ["scene_004", "1"]]),
  });
  assert.deepEqual(drifted, [
    { scene_id: "scene_001", pinned_provider_asset_id: "4630103", acquired_provider_asset_id: "33656654" },
  ]);
});

test("a scene holding exactly its pinned clip is not drift", () => {
  const { drifted } = collectPinnedSelectionDrift({
    acquisitionPlan: PLAN,
    runtime: RUNTIME,
    provenanceByScene: new Map([["scene_001", "4630103"], ["scene_002", "7141174"]]),
  });
  assert.deepEqual(drifted, []);
});

test("a pinned scene with nothing acquired is left to the planned-vs-actual check", () => {
  const { drifted } = collectPinnedSelectionDrift({
    acquisitionPlan: PLAN,
    runtime: RUNTIME,
    provenanceByScene: new Map([["scene_001", "4630103"], ["scene_002", "7141174"]]),
  });
  assert.equal(drifted.some((entry) => entry.scene_id === "scene_003"), false);
});

test("a scene the plan never pinned is listed as unpinned rather than drifted", () => {
  const { drifted, unpinned } = collectPinnedSelectionDrift({
    acquisitionPlan: PLAN,
    runtime: RUNTIME,
    provenanceByScene: new Map([["scene_004", "999"]]),
  });
  assert.deepEqual(unpinned, ["scene_004"]);
  assert.equal(drifted.some((entry) => entry.scene_id === "scene_004"), false);
});

test("an ambiguous multi-id pin is not treated as a pin at all", () => {
  assert.equal(pinnedProviderAssetId({ provider_asset_ids: ["1", "2"] }), "");
  assert.equal(pinnedProviderAssetId({ provider_asset_ids: ["1"] }), "1");
  assert.equal(pinnedProviderAssetId({ inspected_selection: { provider_asset_id: "7" } }), "7");
});
