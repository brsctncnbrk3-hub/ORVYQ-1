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

/**
 * Folds the claims the shot plan could not cover into the acquisition list
 * the fraction shortfall produced, so one request covers both reasons a claim
 * can be short of footage. A claim already asking for more is left alone.
 */
export function mergeCoverageGapClaims(requiredAdditionalScenes, coverageGapClaimIds, claimPools) {
  const merged = [...requiredAdditionalScenes];
  const known = new Set(merged.map((entry) => entry.claim_id));
  for (const claimId of coverageGapClaimIds) {
    if (known.has(claimId)) continue;
    // Only claims that already hold reviewed footage can be topped up; a claim
    // with no approved pool at all is a different, louder problem.
    if (!(claimPools[claimId] || []).length) continue;
    merged.push({ claim_id: claimId, additional_approved_scenes: 1 });
    known.add(claimId);
  }
  return merged.sort((a, b) => a.claim_id.localeCompare(b.claim_id));
}

/** `assets/footage/scene_007_<provider-id>.mp4` -> `scene_007`. */
function sceneIdFromAsset(assetPath) {
  const match = String(assetPath || "").match(/(?:^|\/)scene_(\d{3})(?:_|\.)/);
  return match ? `scene_${match[1]}` : null;
}

/**
 * Re-authoring the distribution supersedes whatever the previous editorial
 * plan carried. The reconciler refuses to drop a managed assignment that the
 * contract does not account for -- correctly, because a silent drop and a
 * deliberate one look identical from there. So say which ones were deliberate,
 * in the contract's own vocabulary, with the reason each was let go.
 */
export function retireSupersededTargets({ editorialAssignments, assignments, managedSceneIds, existingRetirements = [] }) {
  const managed = new Set(managedSceneIds);
  const finalByTarget = new Map(assignments.map((item) => [`${item.claim_id}:${item.slice_index}`, item.scene_id]));
  const seen = new Set(existingRetirements.map((item) => `${item.scene_id}:${item.claim_id}:${item.slice_index}`));
  const retirements = [...existingRetirements];

  for (const [claimId, claimAssignments] of Object.entries(editorialAssignments || {})) {
    for (const [sliceIndex, assignment] of Object.entries(claimAssignments || {})) {
      const sceneId = sceneIdFromAsset(assignment?.asset);
      if (!sceneId || !managed.has(sceneId)) continue;
      const target = `${claimId}:${Number(sliceIndex)}`;
      const replacement = finalByTarget.get(target);
      if (replacement === sceneId) continue;
      const key = `${sceneId}:${claimId}:${Number(sliceIndex)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      retirements.push({
        scene_id: sceneId,
        claim_id: claimId,
        slice_index: Number(sliceIndex),
        reason: replacement
          ? `Re-authored from the project's current shot list: this narration target now carries ${replacement}, which spreads the claim's approved pool more evenly across its slices.`
          : "Re-authored from the project's current shot list: this narration target is no longer contextual footage, so the slice returns to primary evidence within the profile's visual-medium band.",
      });
    }
  }
  return retirements;
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
    editorial: path.join(dir, "config", "editorial_asset_plan.json"),
    coverageGaps: path.join(dir, "qa", "full_production_coverage_gaps.json"),
  };

  const [contracts, blueprint, reviews, profile, editorial, coverageGaps] = await Promise.all([
    readJson(files.contracts),
    readJson(files.blueprint),
    readJsonSafe(files.reviews, null),
    readJsonSafe(files.profile, null),
    readJsonSafe(files.editorial, null),
    readJsonSafe(files.coverageGaps, null),
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

  const planInput = {
    claimSlices,
    claimPools,
    totalRuntimeSeconds,
    hookFootageSeconds: hook.seconds,
    hookUsesByScene: hook.usesByScene,
    maxUsesPerSource: Number(blueprint.global_rules?.max_uses_per_source),
    footageFractionMin: thresholds.contextual_footage_fraction_min,
    footageFractionMax: thresholds.contextual_footage_fraction_max,
  };

  let plan;
  let shortfall = null;
  try {
    plan = planFootageDistribution(planInput);
  } catch (error) {
    if (error.code !== "FOOTAGE_COVERAGE_INFEASIBLE" || !error.details?.required_additional_scenes?.length) throw error;
    // Record the blocked acquisition rather than leaving a percentage for
    // someone to translate by hand. Claims the plan could not cover -- an
    // evidence run it could not break, a pause it could not land on footage --
    // need a clip too, and they fail those rules long before they move the
    // aggregate fraction, so fold them into the same request.
    error.details.required_additional_scenes = mergeCoverageGapClaims(
      error.details.required_additional_scenes,
      coverageGaps?.claim_ids || [],
      claimPools,
    );
    error.recorded_requests = await recordCoverageRequests(dir, projectId, error.details);
    // Still author the best reachable distribution, because the reconciler
    // that derives the editorial plan runs ahead of acquisition and cannot
    // reconcile against a contract that was never written. The gate below
    // keeps the project out of validation until the footage exists.
    plan = planFootageDistribution({ ...planInput, allowBelowFloor: true });
    shortfall = error;
  }
  const { assignments, summary } = plan;
  const managedSceneIds = [...new Set(assignments.map((item) => item.scene_id))].sort();
  const retiredTargets = retireSupersededTargets({
    editorialAssignments: editorial?.footage_assignments,
    assignments,
    managedSceneIds,
    existingRetirements: contracts.retired_targets || [],
  });

  const next = {
    ...contracts,
    managed_scene_ids: managedSceneIds,
    pruned_scene_ids: contracts.pruned_scene_ids || [],
    assignments,
    retired_targets: retiredTargets,
    authored_distribution: {
      schema_version: "1.0",
      generated_at: nowIso(),
      source: "direction/editorial_blueprint.json full_production shots",
      policy:
        "Slices are chosen from the project's own live claim/slice topology, bound only to already-approved "
        + "claim-bound scenes, spread through each claim so contextual footage interleaves with primary evidence, "
        + "and capped by the blueprint's per-source use budget. No unreviewed footage and no automatic backfill.",
      ...summary,
      ...(shortfall ? { blocked_on_acquisition: shortfall.details } : {}),
    },
  };

  await writeJsonAtomic(files.contracts, next);
  if (shortfall) {
    shortfall.authored_below_floor = { project_id: projectId, ...summary };
    throw shortfall;
  }
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
        ...(error.authored_below_floor ? { authored_below_floor: error.authored_below_floor } : {}),
      }, null, 2));
      process.exitCode = 1;
    });
}
