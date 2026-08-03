#!/usr/bin/env node
import path from "node:path";
import {
  projectDir,
  readJson,
  readJsonSafe,
  writeJsonAtomic,
  pathExists,
  parseArgs,
  printJson,
} from "./lib/fs-utils.mjs";
import {
  auditVisualRebalancePlan,
  materializeVisualRebalancePlan,
} from "./lib/orvyq-visual-rebalance.mjs";
import { summarizeExclusiveVisualMedia } from "./lib/orvyq-visual-balance.mjs";
import { resolveProjectId } from "./lib/orvyq-project-profile.mjs";

function shotFrames(shot) {
  if (Number.isFinite(shot.start_frame) && Number.isFinite(shot.end_frame)) {
    return Number(shot.end_frame) - Number(shot.start_frame);
  }
  return Math.round(Number(shot.duration) * 30);
}

export function measureVisualMix(shots) {
  const durationFrames = (shots || []).reduce((sum, shot) => sum + shotFrames(shot), 0);
  const mix = summarizeExclusiveVisualMedia(shots || [], durationFrames);
  return {
    shot_count: shots.length,
    duration_frames: durationFrames,
    duration_seconds: durationFrames / 30,
    contextual_footage_seconds: mix.contextual_footage_frames / 30,
    contextual_footage_fraction: mix.contextual_footage_fraction,
    primary_evidence_seconds: mix.primary_evidence_frames / 30,
    primary_evidence_fraction: mix.primary_evidence_fraction,
    graphic_card_seconds: mix.graphic_card_frames / 30,
    graphic_card_fraction: mix.graphic_card_fraction,
    full_screen_text_card_seconds: mix.full_screen_text_card_frames / 30,
    full_screen_text_card_fraction: mix.full_screen_text_card_fraction,
    maximum_consecutive_graphic_card_shots: mix.maximum_consecutive_graphic_card_shots,
  };
}

export async function resolveVerifiedPrimaryEvidenceRequests({
  dir,
  requests,
  evidenceAssetManifest,
  primaryEvidenceManifest,
  runtime,
}) {
  const declaredById = new Map((evidenceAssetManifest.assets || []).map((asset) => [asset.evidence_asset_id, asset]));
  const primaryById = new Map((primaryEvidenceManifest.assets || []).map((asset) => [asset.evidence_asset_id, asset]));
  const runtimeById = new Map((runtime?.assets || []).map((asset) => [asset.evidence_asset_id, asset]));
  const promotedRequestIds = [];
  const unresolved = [];

  for (const request of requests.requests || []) {
    if (request.type !== "primary_evidence" || request.status === "ready") continue;
    const ids = request.resolved_evidence_asset_ids || [];
    const paths = new Set(request.resolved_asset_paths || []);
    const failures = [];
    if (!ids.length) failures.push("no resolved_evidence_asset_ids");

    for (const id of ids) {
      const declared = declaredById.get(id);
      const primary = primaryById.get(id);
      const verified = runtimeById.get(id);
      if (!declared || declared.status !== "ready") failures.push(`${id} is not ready in evidence_asset_manifest.json`);
      if (!primary?.local_asset) failures.push(`${id} has no canonical local_asset`);
      else if (!paths.has(primary.local_asset)) failures.push(`${id} local_asset is absent from the request resolution`);
      if (!verified) failures.push(`${id} is absent from primary_evidence.runtime.json`);
      else {
        if (verified.local_asset !== primary?.local_asset) failures.push(`${id} runtime path differs from the canonical manifest`);
        if (!/^[a-f0-9]{64}$/i.test(String(verified.sha256 || ""))) failures.push(`${id} has no verified SHA-256`);
        if (!verified.local_asset || !(await pathExists(path.join(dir, verified.local_asset)))) {
          failures.push(`${id} verified file is absent on disk`);
        }
      }
    }

    if (failures.length) unresolved.push({ asset_request_id: request.asset_request_id, failures });
    else {
      request.status = "ready";
      promotedRequestIds.push(request.asset_request_id);
    }
  }

  return { promotedRequestIds, unresolved };
}

export async function finalizeVisualRebalance(projectId) {
  const dir = projectDir(projectId);
  const paths = {
    blueprint: path.join(dir, "direction", "editorial_blueprint.json"),
    plan: path.join(dir, "direction", "visual_rebalance_plan.json"),
    requests: path.join(dir, "research", "visual_asset_requests.json"),
    evidenceAssets: path.join(dir, "research", "evidence_asset_manifest.json"),
    primaryEvidence: path.join(dir, "research", "primary_evidence_manifest.json"),
    runtime: path.join(dir, "assets", "evidence", "primary_evidence.runtime.json"),
  };
  const [blueprint, plan, requests, evidenceAssetManifest, primaryEvidenceManifest, runtime] = await Promise.all([
    readJson(paths.blueprint),
    readJsonSafe(paths.plan, null),
    readJson(paths.requests),
    readJson(paths.evidenceAssets),
    readJson(paths.primaryEvidence),
    readJsonSafe(paths.runtime, { assets: [] }),
  ]);

  if (!plan) return { project_id: projectId, applicable: false, reason: "No visual rebalance plan exists." };
  if (plan.status === "materialized") {
    const report = auditVisualRebalancePlan(
      { shots: blueprint.full_production.shots, plan, assetRequests: requests.requests || [] },
      blueprint.global_rules,
    );
    if (!report.pass) throw new Error(`Existing materialized visual rebalance is invalid: ${report.failures.join(" | ")}`);
    return { project_id: projectId, applicable: true, already_materialized: true, audit: report };
  }
  if (!Array.isArray(plan.actions) || !plan.actions.length) {
    throw new Error("Visual rebalance cannot materialize without project-authored shot-level actions");
  }

  const readiness = await resolveVerifiedPrimaryEvidenceRequests({
    dir,
    requests,
    evidenceAssetManifest,
    primaryEvidenceManifest,
    runtime,
  });
  if (readiness.unresolved.length) {
    throw new Error(`Primary-evidence requests remain unresolved: ${JSON.stringify(readiness.unresolved)}`);
  }

  const requestById = new Map((requests.requests || []).map((request) => [request.asset_request_id, request]));
  const actionRequestIds = [...new Set((plan.actions || []).map((action) => action.asset_request_id).filter(Boolean))];
  const blockedActionRequests = actionRequestIds.filter((id) => requestById.get(id)?.status !== "ready");
  if (blockedActionRequests.length) {
    throw new Error(`Visual rebalance actions still have blocked requests: ${blockedActionRequests.join(", ")}`);
  }

  const baselineShots = blueprint.full_production.shots || [];
  plan.baseline = measureVisualMix(baselineShots);
  plan.status = "materialized";
  plan.blocked_asset_request_ids = [];
  const materializedShots = materializeVisualRebalancePlan({
    shots: baselineShots,
    plan,
    assetRequests: requests.requests || [],
    primaryEvidenceAssets: primaryEvidenceManifest.assets || [],
  });
  plan.projected = measureVisualMix(materializedShots);

  const audit = auditVisualRebalancePlan(
    { shots: materializedShots, plan, assetRequests: requests.requests || [] },
    blueprint.global_rules,
  );
  if (!audit.pass) {
    throw new Error(`Materialized visual rebalance failed: ${[...audit.failures, ...audit.blockers].join(" | ")}`);
  }

  blueprint.full_production.shots = materializedShots;
  blueprint.full_production.status = "ready";
  blueprint.full_production.blocking_claim_ids = [];
  blueprint.full_production.blocking_visual_asset_request_ids = [];
  blueprint.full_production.generated_at = new Date().toISOString();
  plan.materialization_note = "Measured from the canonical shot list after every referenced primary-evidence byte passed runtime verification.";

  await Promise.all([
    writeJsonAtomic(paths.requests, requests),
    writeJsonAtomic(paths.plan, plan),
    writeJsonAtomic(paths.blueprint, blueprint),
  ]);

  return {
    project_id: projectId,
    applicable: true,
    already_materialized: false,
    promoted_request_ids: readiness.promotedRequestIds,
    action_count: plan.actions.length,
    baseline: plan.baseline,
    projected: plan.projected,
    audit,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const projectId = resolveProjectId(args);
    finalizeVisualRebalance(projectId)
      .then((result) => printJson({ ok: true, ...result }))
      .catch((error) => {
        console.error(JSON.stringify({ ok: false, error: error.message }));
        process.exitCode = 1;
      });
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
