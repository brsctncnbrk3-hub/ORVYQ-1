import test from "node:test";
import assert from "node:assert/strict";
import {
  applyFootageVisualDecisions,
  matchesContactSheetDecision,
  reconcileContextualFootageRequests,
} from "./orvyq-footage-visual-decisions.mjs";

const project_id = "002-example-project";
const policy = {
  default_status_for_unlisted_assets: "pending_frame_review",
  rejected_asset_global_reentry_forbidden: true,
  automatic_backfill_forbidden: true,
  approval_requires_contact_sheet_sha256: true,
  approval_requires_claim_id_narration_anchor_and_semantic_rationale: true,
  approval_is_limited_to_exact_reviewed_uses: true,
};

function entry(scene, provider, assetChar, sheetChar, uses = []) {
  return {
    scene_id: scene,
    provider_asset_id: provider,
    asset_path: `assets/footage/${scene}.mp4`,
    source_page_url: `https://example.com/${provider}`,
    asset_sha256: assetChar.repeat(64),
    contact_sheet_sha256: sheetChar.repeat(64),
    reviewed_frame_count: 12,
    approved_uses_if_visually_valid: uses,
  };
}

const use = {
  claim_id: "CLM_FIXTURE",
  narration_anchor: "The narration names the exact physical process.",
  semantic_rationale: "The reviewed frames directly show the physical process named by narration.",
};

test("applies matching decisions, ignores stale decisions and updates request states", () => {
  const queue = {
    project_id,
    entries: [
      entry("scene_001", "p1", "a", "b", [use]),
      entry("scene_002", "p2", "c", "d", [use]),
      entry("scene_003", "p3", "e", "f", [use]),
    ],
  };
  const decisions = {
    project_id,
    review_basis: "Twelve-frame byte-bound contact sheets were reviewed against exact narration uses.",
    decisions: [
      {
        scene_id: "scene_001",
        provider_asset_id: "p1",
        asset_sha256: "a".repeat(64),
        contact_sheet_sha256: "b".repeat(64),
        decision: "approve",
        reason: "The reviewed frames directly support the assigned contextual use.",
      },
      {
        scene_id: "scene_002",
        provider_asset_id: "p2",
        asset_sha256: "c".repeat(64),
        contact_sheet_sha256: "d".repeat(64),
        decision: "reject",
        reason: "The reviewed frames do not show the physical process named by narration.",
      },
      {
        scene_id: "scene_003",
        provider_asset_id: "old-provider",
        asset_sha256: "e".repeat(64),
        contact_sheet_sha256: "f".repeat(64),
        decision: "approve",
        reason: "This decision is stale and must not apply to replacement bytes.",
      },
    ],
  };
  const reviews = {
    project_id,
    review_basis: decisions.review_basis,
    policy,
    summary: { pool_assets: 0, rejected_from_metadata: 0, pending_frame_review: 0, approved: 0 },
    pending_frame_review_scene_ids: [],
    rejected_assets: [],
    approved_assets: [],
  };
  const runtime = {
    project_id,
    records: [
      { scene_id: "scene_001", provider_asset_id: "p1", path: "assets/footage/scene_001.mp4" },
      { scene_id: "scene_002", provider_asset_id: "p2", path: "assets/footage/scene_002.mp4" },
      { scene_id: "scene_003", provider_asset_id: "p3", path: "assets/footage/scene_003.mp4" },
    ],
  };
  const requests = {
    project_id,
    requests: [
      { asset_request_id: "REQ_FTG_A", type: "contextual_footage", status: "pending_frame_review", resolved_asset_paths: ["assets/footage/scene_001.mp4"] },
      { asset_request_id: "REQ_FTG_B", type: "contextual_footage", status: "pending_frame_review", resolved_asset_paths: ["assets/footage/scene_002.mp4"] },
      { asset_request_id: "REQ_FTG_C", type: "contextual_footage", status: "pending_frame_review", resolved_asset_paths: ["assets/footage/scene_003.mp4"] },
    ],
  };

  const result = applyFootageVisualDecisions({ queue, decisions, reviews, runtime, requests });
  assert.deepEqual(result.reviews.summary, {
    pool_assets: 3,
    rejected_from_metadata: 1,
    pending_frame_review: 1,
    approved: 1,
  });
  assert.deepEqual(result.reviews.pending_frame_review_scene_ids, ["scene_003"]);
  assert.equal(result.requests.requests[0].status, "ready");
  assert.equal(result.requests.requests[1].status, "pending_acquisition");
  assert.equal(result.requests.requests[2].status, "pending_frame_review");
  assert.equal(result.applied_approvals, 1);
  assert.equal(result.applied_rejections, 1);
  assert.equal(result.stale_decisions, 1);
  assert.equal(result.ready_for_materialization, false);
});

test("accepts legacy LFS pointer decisions and persists canonical contact-sheet identity", () => {
  const canonicalSheetSha = "c".repeat(64);
  const pointerSheetSha = "p".repeat(64);
  const queueEntry = {
    ...entry("scene_029", "34495148", "a", "c", [use]),
    contact_sheet_sha256: canonicalSheetSha,
    contact_sheet_pointer_sha256: pointerSheetSha,
  };
  assert.equal(matchesContactSheetDecision(queueEntry, canonicalSheetSha), true);
  assert.equal(matchesContactSheetDecision(queueEntry, pointerSheetSha), true);
  assert.equal(matchesContactSheetDecision(queueEntry, "x".repeat(64)), false);

  const result = applyFootageVisualDecisions({
    queue: { project_id, entries: [queueEntry] },
    decisions: {
      project_id,
      review_basis: "Legacy pointer-bound decision migrated to canonical LFS content identity.",
      decisions: [{
        scene_id: queueEntry.scene_id,
        provider_asset_id: queueEntry.provider_asset_id,
        asset_sha256: queueEntry.asset_sha256,
        contact_sheet_sha256: pointerSheetSha,
        decision: "approve",
        reason: "The reviewed frames support this exact use.",
      }],
    },
    reviews: {
      project_id,
      review_basis: "fixture",
      policy,
      summary: {},
      pending_frame_review_scene_ids: [],
      rejected_assets: [],
      approved_assets: [],
    },
    runtime: {
      project_id,
      records: [{
        scene_id: queueEntry.scene_id,
        provider_asset_id: queueEntry.provider_asset_id,
        path: queueEntry.asset_path,
      }],
    },
    requests: {
      project_id,
      requests: [{
        asset_request_id: "REQ_FTG_CANONICAL",
        type: "contextual_footage",
        status: "pending_frame_review",
        resolved_asset_paths: [queueEntry.asset_path],
      }],
    },
  });

  assert.equal(result.applied_approvals, 1);
  assert.equal(result.stale_decisions, 0);
  assert.equal(result.ready_for_materialization, true);
  assert.equal(result.reviews.approved_assets[0].contact_sheet_sha256, canonicalSheetSha);
});

test("reconciles stale scene claims and paths while folding blocked duplicates", () => {
  const requests = {
    schema_version: "1.0",
    project_id,
    policy: {},
    requests: [
      {
        asset_request_id: "REQ_FTG_SCENE_010",
        type: "contextual_footage",
        status: "pending_acquisition",
        claim_ids: ["CLM_OLD"],
        scene_ids: ["scene_010"],
        required_source: "old plan footage",
        resolved_asset_paths: ["assets/footage/retired.mp4"],
      },
      {
        asset_request_id: "REQ_FTG_SCENE_011",
        type: "contextual_footage",
        status: "pending_acquisition",
        claim_ids: ["CLM_OLDER"],
        scene_ids: ["scene_011"],
        required_source: "old plan footage",
      },
      {
        asset_request_id: "REQ_FTG_SCENE_011_BLOCKED",
        type: "contextual_footage",
        status: "pending_acquisition",
        claim_ids: ["CLM_BLOCKED"],
        scene_ids: ["scene_011"],
        required_source: "a licensed direct replacement",
        required_content: "A real control room that does not substitute a decorative hacker screen.",
      },
    ],
  };
  const plan = {
    project_id,
    assets: [{ scene_id: "scene_010", claim_id: "CLM_CURRENT" }],
  };
  const runtime = {
    project_id,
    records: [{ scene_id: "scene_010", path: "assets/footage/current.mp4", provider_asset_id: "p10" }],
  };

  const result = reconcileContextualFootageRequests({ requests, plan, runtime });
  assert.equal(result.requests.length, 2);
  assert.deepEqual(result.requests[0], {
    asset_request_id: "REQ_FTG_SCENE_010",
    type: "contextual_footage",
    status: "pending_frame_review",
    claim_ids: ["CLM_CURRENT"],
    scene_ids: ["scene_010"],
    required_source: "licensed claim-bound footage from the active acquisition plan",
    resolved_asset_paths: ["assets/footage/current.mp4"],
  });
  assert.equal(result.requests[1].asset_request_id, "REQ_FTG_SCENE_011");
  assert.deepEqual(result.requests[1].claim_ids, ["CLM_BLOCKED"]);
  assert.match(result.requests[1].required_content, /real control room/);
});
