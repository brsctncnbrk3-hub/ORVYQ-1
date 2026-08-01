import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import test from "node:test";
import { buildReviewReadinessReport } from "./orvyq_review_readiness_audit.mjs";

const digest = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

async function fixture({ unresolved = [] } = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "orvyq-review-ready-"));
  await fs.mkdir(path.join(rootDir, "qa", "footage-contact-sheets"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "assets", "footage"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "direction"), { recursive: true });
  const projectId = "900-review-ready-fixture";
  const asset = Buffer.from("fixture-video-bytes");
  const sheet = Buffer.from("fixture-contact-sheet-bytes");
  await fs.writeFile(path.join(rootDir, "assets", "footage", "scene_001_fixture.mp4"), asset);
  await fs.writeFile(path.join(rootDir, "qa", "footage-contact-sheets", "scene_001.jpg"), sheet);
  await fs.writeFile(path.join(rootDir, "assets", "footage_acquisition.runtime.json"), JSON.stringify({
    project_id: projectId,
    planned_asset_count: 1,
    unresolved_scene_ids: unresolved,
    provider_search_issues: [],
    records: [{
      scene_id: "scene_001",
      path: "assets/footage/scene_001_fixture.mp4",
      provider_asset_id: "fixture-1"
    }],
    pass: true
  }));
  await fs.writeFile(path.join(rootDir, "qa", "footage_review_queue.json"), JSON.stringify({
    project_id: projectId,
    pending_review_count: 1,
    entries_with_exact_uses: 1,
    entries: [{
      scene_id: "scene_001",
      asset_path: "assets/footage/scene_001_fixture.mp4",
      asset_sha256: digest(asset),
      contact_sheet_path: "qa/footage-contact-sheets/scene_001.jpg",
      contact_sheet_sha256: digest(sheet),
      status: "pending_visual_review",
      approved_uses_if_visually_valid: [{ claim_id: "CLM_FIXTURE", narration_anchor: "fixture" }],
      review_blockers: []
    }]
  }));
  await fs.writeFile(path.join(rootDir, "direction", "visual_rebalance_plan.json"), JSON.stringify({
    project_id: projectId,
    thresholds: {
      contextual_footage_fraction_min: 0.60,
      primary_evidence_fraction_min: 0.20,
      graphic_card_fraction_max: 0.15,
      full_screen_text_card_fraction_max: 0.03,
      maximum_consecutive_graphic_card_shots: 1
    },
    projected: {
      contextual_footage_fraction: 0.61,
      primary_evidence_fraction: 0.26,
      graphic_card_fraction: 0.13,
      full_screen_text_card_fraction: 0.02,
      maximum_consecutive_graphic_card_shots: 1
    }
  }));
  return { projectId, rootDir };
}

test("pre-review readiness passes without an edit_plan when footage, hashes, and visual balance are ready", async (t) => {
  const { projectId, rootDir } = await fixture();
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const report = await buildReviewReadinessReport(projectId, {
    rootDir,
    generatedAt: "2026-07-31T00:00:00.000Z"
  });
  assert.equal(report.pass, true);
  assert.equal(report.review_ready, true);
  assert.equal(report.checks.generic_card_audit, "deferred_until_post_review_edit_plan_materialization");
  await assert.rejects(fs.access(path.join(rootDir, "direction", "edit_plan.json")));
});

test("pre-review readiness fails closed when unresolved footage remains", async (t) => {
  const { projectId, rootDir } = await fixture({ unresolved: ["scene_001"] });
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  await assert.rejects(
    buildReviewReadinessReport(projectId, { rootDir }),
    /Unresolved footage remains: scene_001/
  );
});

test("Project 002 exact footage bytes are fully approved by system-owned visual QA", async () => {
  const report = await buildReviewReadinessReport("002-the-new-war-beneath-the-ocean", {
    generatedAt: "2026-07-31T00:00:00.000Z"
  });
  assert.equal(report.review_ready, true);
  assert.equal(report.checks.footage_plan_complete, 49);
  assert.deepEqual(report.checks.pending_review_scenes, []);
  assert.equal(report.render_started, false);
});