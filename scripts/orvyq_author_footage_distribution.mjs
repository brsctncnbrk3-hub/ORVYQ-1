#!/usr/bin/env node
// Authors the claim-bound contextual-footage distribution into the canonical
// contract at `research/footage_use_contracts.json`.
//
// Run this after `orvyq_full_production_plan.mjs` (which produces the live
// claim/slice topology) and before `orvyq_apply_footage_use_contracts.mjs`
// (which derives the editorial asset plan and the blueprint shots from the
// contract). Authoring into any derived file instead makes the contract and
// the plan disagree, and the reconciler then refuses the unaccounted targets.
import path from "node:path";
import {
  projectDir,
  readJson,
  readJsonSafe,
  writeJsonAtomic,
  parseArgs,
  printJson,
  nowIso,
} from "./lib/fs-utils.mjs";
import { canonicalVisualRole } from "./lib/orvyq-visual-roles.mjs";
import { resolveVisualBalanceThresholds } from "./lib/orvyq-visual-balance.mjs";
import {
  collectClaimSliceTopology,
  collectHookFootageUsage,
  planFootageDistribution,
} from "./lib/orvyq-footage-distribution.mjs";
import {
  planCoverageAcquisition,
  applyCoverageAcquisition,
} from "./lib/orvyq-footage-coverage-requests.mjs";

/**
 * The approved, claim-bound pool: the reviewed scenes the contract already
 * carries, grouped by claim. Approval stays where it was granted -- this step
 * never promotes an unreviewed scene into the pool, it only decides how many
 * narration targets each already-approved scene covers.
 */
export function collectApprovedClaimPools(contracts, approvedSceneIds = null) {
  const pools = new Map();
  const seen = new Set();
  for (const assignment of contracts.assignments || []) {
    const sceneId = String(assignment?.scene_id || "").trim();
    const claimId = String(assignment?.claim_id || "").trim();
    if (!sceneId || !claimId) continue;
    if (approvedSceneIds && !approvedSceneIds.has(sceneId)) continue;
    const key = `${claimId}:${sceneId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pool = pools.get(claimId) || [];
    pool.push({
      // Editorial role aliases stay as reviewed; the contract reconciler
      // normalizes them to canonical render roles.
      scene_id: sceneId,
      role: assignment.role || "context",
      semantic_link: assignment.semantic_link || "physical",
      semantic_rationale: String(assignment.semantic_rationale || "").trim(),
    });
    pools.set(claimId, pool);
  }
  for (const [claimId, pool] of pools) {
    for (const entry of pool) {
      canonicalVisualRole(entry.role);
      if (entry.semantic_rationale.length < 24) {
        throw new Error(`${claimId}/${entry.scene_id} has no reviewed semantic_rationale to carry forward`);
      }
    }
  }
  return Object.fromEntries([...pools.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

async function recordCoverageRequests(dir, projectId, details) {
  const files = {
    requests: path.join(dir, "research", "visual_asset_requests.json"),
    constraints: path.join(dir, "research", "footage_semantic_constraints.json"),
    acquisition: path.join(dir, "research", "footage_acquisition_plan.json"),
  };
  const [requests, semanticConstraints, acquisitionPlan, runtime] = await Promise.all([
    readJsonSafe(files.requests, null),
    readJsonSafe(files.constraints, null),
    readJsonSafe(files.acquisition, null),
    readJsonSafe(path.join(dir, "assets", "footage_acquisition.runtime.json"), null),
  ]);
  if (!requests || !semanticConstraints || !acquisitionPlan) return null;

  // Every place a scene id can already be spoken for. The constraints file
  // alone lags behind the acquired pool, and allocating against it hands out
  // ids that are already carrying approved footage.
  const existingSceneIds = [
    ...Object.keys(semanticConstraints.scenes || {}),
    ...(acquisitionPlan.assets || []).map((asset) => asset.scene_id),
    ...(requests.requests || []).flatMap((request) => request.scene_ids || []),
    ...(runtime?.records || []).map((record) => record.scene_id),
  ].filter(Boolean);

  const { scenes } = planCoverageAcquisition({
    requiredAdditionalScenes: details.required_additional_scenes,
    semanticConstraints,
    acquisitionPlan,
    existingSceneIds,
    shortfallSummary: details,
  });
  const applied = applyCoverageAcquisition({ scenes, requests, semanticConstraints, acquisitionPlan });
  if (!applied.added.length) return { added: [], note: "coverage requests were already open" };

  await Promise.all([
    writeJsonAtomic(files.requests, applied.requests),
    writeJsonAtomic(files.constraints, applied.semanticConstraints),
    writeJsonAtomic(files.acquisition, applied.acquisitionPlan),
  ]);
  return {
    project_id: projectId,
    added: applied.added.map((scene) => ({ scene_id: scene.scene_id, claim_id: scene.claim_id, modelled_on: scene.modelled_on_scene_id })),
  };
}

export async function authorFootageDistribution(projectId) {
  const dir = projectDir(projectId);
  const files = {
    contracts: path.join(dir, "research", "footage_use_contracts.json"),
    blueprint: path.join(dir, "direction", "editorial_blueprint.json"),
    reviews: path.join(dir, "research", "visual_asset_reviews.json"),
    profile: path.join(dir, "config", "production_profile.json"),
  };

  const [contracts, blueprint, reviews, profile] = await Promise.all([
    readJson(files.contracts),
    readJson(files.blueprint),
    readJsonSafe(files.reviews, null),
    readJsonSafe(files.profile, null),
  ]);

  for (const [label, value] of Object.entries({ contracts, blueprint, ...(reviews ? { reviews } : {}) })) {
    if (value.project_id !== projectId) throw new Error(`${label} project_id does not match ${projectId}`);
  }

  const shots = blueprint.full_production?.shots || [];
  if (!shots.length) {
    throw new Error(
      "editorial_blueprint.json carries no full_production shots; run orvyq_full_production_plan.mjs first",
    );
  }

  const approvedSceneIds = reviews
    ? new Set((reviews.approved_assets || []).map((asset) => String(asset.scene_id || "").trim()).filter(Boolean))
    : null;
  if (approvedSceneIds && !approvedSceneIds.size) {
    throw new Error("visual_asset_reviews.json lists no approved assets; footage review must complete first");
  }

  const claimSlices = collectClaimSliceTopology(shots);
  const claimPools = collectApprovedClaimPools(contracts, approvedSceneIds);
  const hook = collectHookFootageUsage(shots);
  const totalRuntimeSeconds = shots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0);

  // The band is the project's own resolved profile clamped by the system
  // profile defaults, so a project can only tighten it, never widen it.
  const thresholds = resolveVisualBalanceThresholds({
    ...(profile?.creative_limits?.visual_medium_balance || {}),
    ...(blueprint.global_rules || {}),
  });

  let plan;
  try {
    plan = planFootageDistribution({
      claimSlices,
      claimPools,
      totalRuntimeSeconds,
      hookFootageSeconds: hook.seconds,
      hookUsesByScene: hook.usesByScene,
      maxUsesPerSource: Number(blueprint.global_rules?.max_uses_per_source),
      footageFractionMin: thresholds.contextual_footage_fraction_min,
      footageFractionMax: thresholds.contextual_footage_fraction_max,
    });
  } catch (error) {
    if (error.code !== "FOOTAGE_COVERAGE_INFEASIBLE" || !error.details?.required_additional_scenes?.length) throw error;
    // Record the blocked acquisition rather than leaving a percentage for
    // someone to translate by hand, then still fail closed: the footage has
    // to be acquired and frame-reviewed before a distribution can exist.
    error.recorded_requests = await recordCoverageRequests(dir, projectId, error.details);
    throw error;
  }
  const { assignments, summary } = plan;

  const next = {
    ...contracts,
    managed_scene_ids: [...new Set(assignments.map((item) => item.scene_id))].sort(),
    pruned_scene_ids: contracts.pruned_scene_ids || [],
    assignments,
    retired_targets: contracts.retired_targets || [],
    authored_distribution: {
      schema_version: "1.0",
      generated_at: nowIso(),
      source: "direction/editorial_blueprint.json full_production shots",
      policy:
        "Slices are chosen from the project's own live claim/slice topology, bound only to already-approved "
        + "claim-bound scenes, spread through each claim so contextual footage interleaves with primary evidence, "
        + "and capped by the blueprint's per-source use budget. No unreviewed footage and no automatic backfill.",
      ...summary,
    },
  };

  await writeJsonAtomic(files.contracts, next);
  return { project_id: projectId, ...summary };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args["project-id"] || args.project;
  if (!projectId) throw new Error("--project-id is required");
  authorFootageDistribution(projectId)
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        error: error.message,
        ...(error.details ? { details: error.details } : {}),
        ...(error.recorded_requests ? { recorded_requests: error.recorded_requests } : {}),
      }, null, 2));
      process.exitCode = 1;
    });
}
