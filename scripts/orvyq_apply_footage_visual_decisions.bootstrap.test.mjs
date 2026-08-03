import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import {
  applyProjectFootageVisualDecisions,
  resolvePostFootageVisualState,
} from "./orvyq_apply_footage_visual_decisions.mjs";
import { PROJECTS_DIR } from "./lib/fs-utils.mjs";

// The script resolves paths through projectDir(), so the fixture has to live
// under projects/. It is removed again in the same test.
const PROJECT_ID = "993-visual-decision-bootstrap";

const FILES = {
  "qa/footage_review_queue.json": { schema_version: "1.0", project_id: PROJECT_ID, entries: [] },
  "research/visual_asset_reviews.json": {
    schema_version: "1.0",
    project_id: PROJECT_ID,
    review_basis: "A fresh project that has not been through any contact-sheet review round yet.",
    policy: {
      default_status_for_unlisted_assets: "pending_frame_review",
      rejected_asset_global_reentry_forbidden: true,
      automatic_backfill_forbidden: true,
      approval_requires_contact_sheet_sha256: true,
      approval_requires_claim_id_narration_anchor_and_semantic_rationale: true,
    },
    summary: { pool_assets: 0, rejected_from_metadata: 0, pending_frame_review: 0, approved: 0 },
    pending_frame_review_scene_ids: [],
    rejected_assets: [],
    approved_assets: [],
  },
  "assets/footage_acquisition.runtime.json": { schema_version: "1.0", project_id: PROJECT_ID, records: [] },
  "research/visual_asset_requests.json": {
    schema_version: "1.0",
    project_id: PROJECT_ID,
    policy: {
      automatic_backfill_forbidden: true,
      decorative_document_recreation_forbidden: true,
      same_content_different_crop_counts_once: true,
    },
    requests: [],
  },
  "direction/visual_rebalance_plan.json": { schema_version: "1.0", project_id: PROJECT_ID, status: "not_required", actions: [] },
  "direction/editorial_blueprint.json": { schema_version: "1.0", project_id: PROJECT_ID, full_production: { shots: [] } },
  "direction/motion_hook.json": { schema_version: "1.0", project_id: PROJECT_ID, minimum_seconds: 10, shots: [] },
};

test("a project with no visual-decision round yet is a no-op, not a failure", async (t) => {
  const root = path.join(PROJECTS_DIR, PROJECT_ID);
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  for (const [relative, contents] of Object.entries(FILES)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify(contents, null, 2)}\n`);
  }

  const before = await fs.readFile(path.join(root, "research/visual_asset_reviews.json"), "utf8");
  const result = await applyProjectFootageVisualDecisions(PROJECT_ID);

  assert.equal(result.decision_rounds, 0);
  assert.equal(result.applied_decisions, 0);
  assert.match(result.note, /nothing was approved/);

  // Nothing may be rewritten when there is nothing to apply -- least of all
  // the review record, which is what approval hangs on.
  const after = await fs.readFile(path.join(root, "research/visual_asset_reviews.json"), "utf8");
  assert.equal(after, before, "the review record must be left untouched");

  const runtime = await fs.readFile(path.join(root, "assets/footage_acquisition.runtime.json"), "utf8");
  assert.equal(JSON.parse(runtime).records.length, 0);
});

test("a missing required input is still a hard failure", async (t) => {
  const root = path.join(PROJECTS_DIR, PROJECT_ID);
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  // Everything except the review record, which the step cannot proceed without.
  for (const [relative, contents] of Object.entries(FILES)) {
    if (relative === "research/visual_asset_reviews.json") continue;
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify(contents, null, 2)}\n`);
  }

  await assert.rejects(() => applyProjectFootageVisualDecisions(PROJECT_ID), /reviews file is missing/);
});

test("completed footage preserves primary-evidence blockers instead of materializing an empty rebalance plan", () => {
  const state = resolvePostFootageVisualState({
    footageReady: true,
    pendingRequestIds: [],
    rebalance: {
      status: "blocked_pending_assets",
      blocked_asset_request_ids: ["REQ_FTG_SCENE_001", "REQ_EVD_CLAIM_A"],
      projected: {},
      actions: [],
    },
  });

  assert.equal(state.rebalance_status, "planned_pending_primary_evidence");
  assert.equal(state.rebalance_materialized, false);
  assert.deepEqual(state.blocked_asset_request_ids, ["REQ_EVD_CLAIM_A"]);
});

test("completed footage keeps only an already complete, unblocked rebalance plan materialized", () => {
  const state = resolvePostFootageVisualState({
    footageReady: true,
    pendingRequestIds: [],
    rebalance: {
      status: "materialized",
      purpose: "Keep the measured visual mix within every editorial threshold.",
      baseline: { duration_seconds: 1 },
      actions: [{ decision: "keep" }],
      blocked_asset_request_ids: [],
    },
  });

  assert.equal(state.rebalance_status, "materialized");
  assert.equal(state.rebalance_materialized, true);
  assert.deepEqual(state.blocked_asset_request_ids, []);
});
