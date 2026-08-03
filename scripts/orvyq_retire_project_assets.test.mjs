import test from "node:test";
import assert from "node:assert/strict";
import { retireVisualAssets } from "./orvyq_retire_project_assets.mjs";
import { collectRejectedProviderAssetIds } from "./orvyq_acquire_footage_demand.mjs";

function reviews(overrides = {}) {
  return {
    schema_version: "1.0",
    project_id: "007-a-film",
    review_basis: "Four-position contact-sheet review bound to the current footage and contact-sheet hashes.",
    policy: {
      default_status_for_unlisted_assets: "pending_frame_review",
      rejected_asset_global_reentry_forbidden: true,
      automatic_backfill_forbidden: true,
      approval_requires_contact_sheet_sha256: true,
      approval_requires_claim_id_narration_anchor_and_semantic_rationale: true,
    },
    summary: { pool_assets: 2, rejected_from_metadata: 1, pending_frame_review: 0, approved: 2 },
    pending_frame_review_scene_ids: [],
    rejected_assets: [{ scene_id: "scene_003", provider_asset_id: "999", reason: "Depicted an unrelated humanoid robot rather than the claim." }],
    approved_assets: [
      { scene_id: "scene_001", provider_asset_id: "111", asset_path: "assets/footage/scene_001_111.mp4", asset_sha256: "a".repeat(64), contact_sheet_sha256: "b".repeat(64), approved_uses: [{ claim_id: "CLM_A", narration_anchor: "anchor one", semantic_rationale: "Carries the claim's physical setting without asserting fact." }] },
      { scene_id: "scene_002", provider_asset_id: "222", asset_path: "assets/footage/scene_002_222.mp4", asset_sha256: "c".repeat(64), contact_sheet_sha256: "d".repeat(64), approved_uses: [{ claim_id: "CLM_B", narration_anchor: "anchor two", semantic_rationale: "Carries the claim's physical setting without asserting fact." }] },
    ],
    completed_at: "2026-08-02T19:47:18.720Z",
    ...overrides,
  };
}

test("every approved asset is retired and the pool is emptied", () => {
  const { reviews: next, retired } = retireVisualAssets(reviews(), { at: "2026-08-03T00:00:00.000Z" });

  assert.deepEqual(retired.map((asset) => asset.provider_asset_id), ["111", "222"]);
  assert.deepEqual(next.approved_assets, []);
  assert.deepEqual(next.pending_frame_review_scene_ids, []);
  assert.equal(next.summary.approved, 0);
  assert.equal(next.summary.pool_assets, 0);
  assert.equal(next.policy.superseded_asset_reentry_forbidden, true);
  assert.equal(next.completed_at, undefined, "a rebuild in progress is not a completed review");
  assert.equal(next.superseded_assets[0].claim_id, "CLM_A");
  assert.ok(next.superseded_assets[0].reason.length >= 24);
});

test("rejected assets stay rejected rather than being re-filed as superseded", () => {
  const { reviews: next } = retireVisualAssets(reviews());
  assert.equal(next.rejected_assets.length, 1);
  assert.equal(next.superseded_assets.some((asset) => asset.provider_asset_id === "999"), false);
});

test("an asset downloaded but never approved is still retired", () => {
  const { retired } = retireVisualAssets(reviews(), {
    runtimeRecords: [
      { scene_id: "scene_001", provider_asset_id: "111", path: "assets/footage/scene_001_111.mp4" },
      { scene_id: "scene_004", provider_asset_id: "444", path: "assets/footage/scene_004_444.mp4", claim_id: "CLM_D" },
    ],
  });
  assert.deepEqual(retired.map((asset) => asset.provider_asset_id).sort(), ["111", "222", "444"]);
});

test("retiring twice does not duplicate an entry", () => {
  const first = retireVisualAssets(reviews());
  const second = retireVisualAssets(first.reviews);
  assert.equal(second.retired.length, 0);
  assert.equal(second.reviews.superseded_assets.length, 2);
});

test("acquisition bars a retired asset exactly as it bars a rejected one", () => {
  const { reviews: next } = retireVisualAssets(reviews());
  const barred = collectRejectedProviderAssetIds({ scenes: {} }, next);
  assert.equal(barred.has("111"), true, "a retired clip must not come back on the rebuild");
  assert.equal(barred.has("222"), true);
  assert.equal(barred.has("999"), true, "and a rejected clip stays barred");
});

test("a scene-level rejection list still contributes to the bar", () => {
  const barred = collectRejectedProviderAssetIds(
    { scenes: { scene_001: { rejected_provider_asset_ids: ["555"] } } },
    { rejected_assets: [], superseded_assets: [] },
  );
  assert.deepEqual([...barred], ["555"]);
});
