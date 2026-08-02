#!/usr/bin/env node
import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  projectDir,
  readJson,
  writeJsonAtomic,
  parseArgs,
  printJson,
} from "./lib/fs-utils.mjs";

const HASH_PATTERN = /^[a-f0-9]{64}$/i;

async function fileSha256(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

function uniqueUses(uses) {
  const output = [];
  const seen = new Set();
  for (const use of uses || []) {
    const normalized = {
      claim_id: String(use.claim_id || "").trim(),
      narration_anchor: String(use.narration_anchor || "").trim(),
      semantic_rationale: String(use.semantic_rationale || "").trim(),
      semantic_link: String(use.semantic_link || "physical").trim(),
    };
    if (!normalized.claim_id || !normalized.narration_anchor || normalized.semantic_rationale.length < 24) {
      throw new Error("Every approved use requires claim_id, narration_anchor and a specific semantic rationale");
    }
    const key = `${normalized.claim_id}\u0000${normalized.narration_anchor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function buildReadyMotionHook({ motionHook, runtime, contracts }) {
  const records = new Map((runtime.records || []).map((record) => [record.scene_id, record]));
  const contractByScene = new Map((contracts.assignments || []).map((entry) => [entry.scene_id, entry]));
  const durations = [3, 2.5, 2.5, 3];
  const trimStarts = [0.5, 1, 1, 0.5];
  const plannedShots = motionHook.shots || [];
  if (plannedShots.length !== 4) throw new Error(`Motion hook must contain four planned shots, found ${plannedShots.length}`);
  const shots = plannedShots
    .slice()
    .sort((a, b) => Number(a.order) - Number(b.order))
    .map((planned, index) => {
      const record = records.get(planned.scene_id);
      if (!record) throw new Error(`${planned.scene_id}: motion hook has no runtime footage record`);
      const contract = contractByScene.get(planned.scene_id) || {};
      const duration = durations[index];
      const trimIn = trimStarts[index];
      return {
        order: index + 1,
        scene_id: planned.scene_id,
        duration,
        asset_type: "footage",
        video_asset: record.path,
        asset: record.path,
        trim_in_sec: trimIn,
        trim_out_sec: trimIn + duration,
        motion_variant: contract.motion || "hold",
        hook_footage: true,
        claim_id: planned.claim_id,
        visual_role: planned.visual_role || planned.role || contract.role || "context",
        generic_stock: true,
        narration_anchor: planned.narration_anchor,
        editorial_purpose: planned.semantic_rationale ||
          `Use ${planned.scene_id} as a brief human-scale opening image tied to the stated narration without presenting generic stock as factual proof.`,
        semantic_rationale: planned.semantic_rationale ||
          `The approved footage gives the opening narration a concrete physical context while all factual burden remains with primary evidence.`,
        semantic_link: planned.semantic_link || "physical",
      };
    });
  return {
    schema_version: "1.0",
    project_id: motionHook.project_id,
    status: "ready",
    purpose: "Open with an eleven-second human-scale cinematic hook, then move quickly into official primary evidence without a document carousel.",
    minimum_seconds: 10,
    maximum_seconds: 14,
    duration_seconds: 11,
    target_duration_seconds: 11,
    target_cut_count: 4,
    replace_opening_shot_count: 4,
    question_eyebrow: "THE QUESTION",
    question: "What happens when AI moves faster than our ability to govern it?",
    question_deck: "Every major lab sees the danger. None can afford to slow down alone.",
    evidence_bridge: [
      { source_shot_index: 1, duration: 5, transition_in: "dissolve" },
      { source_shot_index: 3, duration: 4, transition_in: "cut" }
    ],
    shots,
    first_shot_project001_asset_forbidden: true,
  };
}

export async function applyFootageReviewDecisions(projectId) {
  const dir = projectDir(projectId);
  const paths = {
    queue: path.join(dir, "qa", "footage_review_queue.json"),
    decisions: path.join(dir, "config", "footage_review_decisions.json"),
    runtime: path.join(dir, "assets", "footage_acquisition.runtime.json"),
    reviews: path.join(dir, "research", "visual_asset_reviews.json"),
    requests: path.join(dir, "research", "visual_asset_requests.json"),
    contracts: path.join(dir, "research", "footage_use_contracts.json"),
    editorial: path.join(dir, "config", "editorial_asset_plan.json"),
    motionHook: path.join(dir, "direction", "motion_hook.json"),
    rebalance: path.join(dir, "direction", "visual_rebalance_plan.json"),
    project: path.join(dir, "project.json"),
    productionProfile: path.join(dir, "config", "production_profile.json"),
  };
  const [queue, decisions, runtime, previousReviews, requests, contracts, editorial, motionHook, rebalance, project, productionProfile] = await Promise.all([
    readJson(paths.queue),
    readJson(paths.decisions),
    readJson(paths.runtime),
    readJson(paths.reviews),
    readJson(paths.requests),
    readJson(paths.contracts),
    readJson(paths.editorial),
    readJson(paths.motionHook),
    readJson(paths.rebalance),
    readJson(paths.project),
    readJson(paths.productionProfile),
  ]);
  for (const [label, document] of Object.entries({ queue, decisions, runtime, previousReviews, requests, contracts, editorial, motionHook, rebalance, project, productionProfile })) {
    if (document.project_id !== projectId) throw new Error(`${label} project_id mismatch`);
  }
  if (runtime.pass !== true || Number(runtime.planned_asset_count) !== 20 || (runtime.records || []).length !== 20) {
    throw new Error("Footage acquisition must pass with exactly 20 selected records before visual approval");
  }
  const entries = queue.entries || [];
  if (entries.length !== 20 || Number(queue.pending_review_count) !== 20) {
    throw new Error(`Review queue must contain exactly 20 pending entries, found ${entries.length}`);
  }
  const decisionList = decisions.decisions || [];
  if (decisionList.length !== 20) throw new Error(`Decision file must contain exactly 20 decisions, found ${decisionList.length}`);
  const decisionByScene = new Map(decisionList.map((decision) => [decision.scene_id, decision]));
  if (decisionByScene.size !== 20) throw new Error("Decision file contains duplicate scene ids");
  const recordByScene = new Map((runtime.records || []).map((record) => [record.scene_id, record]));
  const approvalByScene = new Map();
  const reviewedAt = decisions.reviewed_at || new Date().toISOString();

  for (const entry of entries) {
    const decision = decisionByScene.get(entry.scene_id);
    if (!decision) throw new Error(`${entry.scene_id}: review decision is missing`);
    if (decision.decision !== "approve") {
      throw new Error(`${entry.scene_id}: decision is ${decision.decision}; replacement acquisition is required before the project can proceed`);
    }
    if (String(decision.rationale || "").trim().length < 24) {
      throw new Error(`${entry.scene_id}: approval rationale is too short`);
    }
    for (const [label, value] of [["asset_sha256", entry.asset_sha256], ["contact_sheet_sha256", entry.contact_sheet_sha256]]) {
      if (!HASH_PATTERN.test(String(value || ""))) throw new Error(`${entry.scene_id}: invalid ${label}`);
      if (String(decision[label] || "").toLowerCase() !== String(value).toLowerCase()) {
        throw new Error(`${entry.scene_id}: decision ${label} does not match the review queue`);
      }
    }
    const record = recordByScene.get(entry.scene_id);
    if (!record || record.path !== entry.asset_path || String(record.provider_asset_id) !== String(entry.provider_asset_id)) {
      throw new Error(`${entry.scene_id}: runtime record no longer matches the review queue`);
    }
    const [actualAssetHash, actualSheetHash] = await Promise.all([
      fileSha256(path.join(dir, entry.asset_path)),
      fileSha256(path.join(dir, entry.contact_sheet_path)),
    ]);
    if (actualAssetHash !== String(entry.asset_sha256).toLowerCase()) throw new Error(`${entry.scene_id}: footage bytes changed after review preparation`);
    if (actualSheetHash !== String(entry.contact_sheet_sha256).toLowerCase()) throw new Error(`${entry.scene_id}: contact-sheet bytes changed after review preparation`);

    const provenancePath = path.join(dir, `${entry.asset_path}.provenance.json`);
    const provenance = await readJson(provenancePath);
    if (String(provenance.sha256 || provenance.actual_sha256 || "").toLowerCase() !== actualAssetHash) {
      throw new Error(`${entry.scene_id}: provenance hash does not match approved footage bytes`);
    }
    const approvedUses = uniqueUses(entry.approved_uses_if_visually_valid);
    provenance.approved_for_final_edit = true;
    provenance.human_review_status = "APPROVED_CLAIM_SPECIFIC_MULTIFRAME_REVIEW";
    provenance.reviewed_at = reviewedAt;
    provenance.review_method = queue.review_method || "four-frame claim-specific contact-sheet review";
    provenance.contact_sheet_path = entry.contact_sheet_path;
    provenance.contact_sheet_sha256 = actualSheetHash;
    provenance.approved_uses = approvedUses;
    provenance.review_rationale = String(decision.rationale).trim();
    await writeJsonAtomic(provenancePath, provenance);

    approvalByScene.set(entry.scene_id, {
      scene_id: entry.scene_id,
      provider_asset_id: String(entry.provider_asset_id),
      asset_path: entry.asset_path,
      asset_sha256: actualAssetHash,
      contact_sheet_path: entry.contact_sheet_path,
      contact_sheet_sha256: actualSheetHash,
      approved_uses: approvedUses,
      decision: "approved",
      decision_rationale: String(decision.rationale).trim(),
      review_method: queue.review_method || "four-frame claim-specific contact-sheet review",
      reviewed_at: reviewedAt,
    });
  }

  const approvals = [...approvalByScene.values()].sort((a, b) => a.scene_id.localeCompare(b.scene_id));
  const reviews = {
    ...previousReviews,
    schema_version: "1.0",
    project_id: projectId,
    review_basis: "Fresh clean-rebuild four-frame contact-sheet review bound to current footage and contact-sheet SHA-256 values. No prior-project approval was reused.",
    summary: {
      pool_assets: runtime.records.length,
      rejected_from_metadata: 0,
      pending_frame_review: 0,
      approved: approvals.length,
    },
    pending_frame_review_scene_ids: [],
    rejected_assets: [],
    approved_assets: approvals,
    completed_at: reviewedAt,
  };

  for (const request of requests.requests || []) {
    if (request.type !== "contextual_footage") continue;
    const sceneId = request.scene_ids?.[0];
    const record = recordByScene.get(sceneId);
    const approval = approvalByScene.get(sceneId);
    if (!record || !approval) throw new Error(`${request.asset_request_id}: reviewed footage resolution is missing`);
    request.status = "ready";
    request.resolved_asset_paths = [record.path];
    request.visual_review_binding = {
      asset_sha256: approval.asset_sha256,
      contact_sheet_sha256: approval.contact_sheet_sha256,
      reviewed_at: reviewedAt,
    };
  }

  const recordBySceneId = recordByScene;
  editorial.status = "ready";
  editorial.footage_assignments = {};
  for (const contract of contracts.assignments || []) {
    const record = recordBySceneId.get(contract.scene_id);
    const approval = approvalByScene.get(contract.scene_id);
    if (!record || !approval) throw new Error(`${contract.scene_id}: approved contract footage is missing`);
    editorial.footage_assignments[contract.claim_id] ||= {};
    editorial.footage_assignments[contract.claim_id][String(contract.slice_index)] = {
      asset: record.path,
      trimInRatio: Number(contract.trim_in_ratio || 0),
      motion: contract.motion || "hold",
      role: contract.role || "context",
      semantic_anchor: approval.approved_uses[0].narration_anchor,
      semantic_rationale: contract.semantic_rationale,
      semantic_link: contract.semantic_link || "physical",
    };
  }
  editorial.graphic_break_assignments ||= {};
  editorial.full_footage_pool = (runtime.records || []).map((record) => record.path);
  const readyHook = buildReadyMotionHook({ motionHook, runtime, contracts });
  editorial.hook_preloaded_usage = Object.fromEntries(readyHook.shots.map((shot) => [shot.asset, 1]));
  editorial.slice_count_overrides ||= {};
  editorial.generation_policy = "Only current clean-rebuild footage with byte-bound multiframe approval may be assigned; all assignments remain claim-bound and generic stock never carries factual proof.";
  editorial.review_completed_at = reviewedAt;

  rebalance.status = "planned_pending_primary_evidence";
  rebalance.blocked_asset_request_ids = (rebalance.blocked_asset_request_ids || []).filter((id) => !String(id).startsWith("REQ_FTG_"));
  rebalance.visual_review_completed_at = reviewedAt;

  project.status = "visual_assets_reviewed";
  project.current_stage = "render_free_candidate_validation_ready";
  project.render_authorized = false;
  productionProfile.status = "ready_for_candidate_validation";

  await Promise.all([
    writeJsonAtomic(paths.reviews, reviews),
    writeJsonAtomic(paths.requests, requests),
    writeJsonAtomic(paths.editorial, editorial),
    writeJsonAtomic(paths.motionHook, readyHook),
    writeJsonAtomic(paths.rebalance, rebalance),
    writeJsonAtomic(paths.project, project),
    writeJsonAtomic(paths.productionProfile, productionProfile),
  ]);

  return {
    project_id: projectId,
    approved_asset_count: approvals.length,
    footage_assignment_count: (contracts.assignments || []).length,
    motion_hook_shot_count: readyHook.shots.length,
    render_authorized: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args["project-id"] || args.project;
  if (!projectId) throw new Error("--project-id is required");
  applyFootageReviewDecisions(projectId)
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
