#!/usr/bin/env node
// Authors the claim-bound contextual-footage distribution into the canonical
// contract at `research/footage_use_contracts.json`.
//
// Run this after `orvyq_full_production_plan.mjs` (which produces the live
// claim/slice topology) and before `orvyq_apply_footage_use_contracts.mjs`
// (which derives the editorial asset plan and the blueprint shots from the
// contract). Authoring into any derived file instead makes the contract and
// the plan disagree, and the reconciler then refuses the unaccounted targets.
//
// `--seed-from-acquisition` covers the states the pool cannot be read out of
// the approved contract in: a project's first review round and any later
// replacement round whose newly acquired bytes are still pending. See
// collectAcquiredClaimPools() for why those states would otherwise deadlock.
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
 * The claim-bound pool a project starts from before any contact sheet has been
 * judged: the scenes acquisition actually materialized, each carrying the
 * claim its own acquisition plan entry was written against.
 *
 * This exists because the pool below is read out of the contract, and a fresh
 * project's contract is empty -- so without it, a rebuild can never produce
 * the blueprint footage shots the review queue derives its exact claim-bound
 * uses from, and therefore can never approve the first clip either. Nothing
 * here approves anything: the distribution it seeds only makes the shots
 * reviewable. `orvyq_apply_footage_visual_decisions.mjs` still refuses to
 * materialize until every scene carries a real byte-bound approval.
 */
export function collectAcquiredClaimPools(acquisitionPlan, runtime, includeSceneIds = null) {
  const acquiredSceneIds = new Set((runtime?.records || []).map((record) => String(record.scene_id)));
  const assignments = [];
  for (const asset of acquisitionPlan?.assets || []) {
    const sceneId = String(asset?.scene_id || "").trim();
    const claimId = String(asset?.claim_id || "").trim();
    // A scene with no acquired bytes, or no claim of its own, is a gap to
    // report rather than a slot to invent a binding for.
    if (!sceneId || !claimId || !acquiredSceneIds.has(sceneId)) continue;
    if (includeSceneIds && !includeSceneIds.has(sceneId)) continue;
    assignments.push({
      scene_id: sceneId,
      claim_id: claimId,
      role: asset.role || "context",
      semantic_link: asset.semantic_link || "physical",
      semantic_rationale: String(asset.semantic_rationale || asset.editorial_note || "").trim(),
    });
  }
  return assignments;
}

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
 * Builds the pool used while a review round is open. Existing assignments are
 * admitted only when their current bytes are already approved; newly acquired
 * pending scenes are admitted only as provisional claim-bound review targets.
 *
 * This is deliberately not an approval shortcut. It gives replacement clips
 * the exact uses their contact-sheet decisions must judge, while the visual
 * decision reconciler remains the sole step that can approve their bytes.
 */
export function assembleReviewablePoolSource({ contracts, approvedSceneIds, pendingSceneIds, acquisitionPlan, runtime }) {
  const approvedAssignments = (contracts?.assignments || []).filter((assignment) =>
    approvedSceneIds.has(String(assignment?.scene_id || "").trim()),
  );
  const provisionalAssignments = collectAcquiredClaimPools(acquisitionPlan, runtime, pendingSceneIds);
  return {
    assignments: [...approvedAssignments, ...provisionalAssignments],
    approved_assignments: approvedAssignments,
    provisional_assignments: provisionalAssignments,
    provisional_scene_count: new Set(provisionalAssignments.map((entry) => entry.scene_id)).size,
  };
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

function maximumUncoveredRunSeconds(slices, selectedSliceIndexes) {
  const selected = new Set(selectedSliceIndexes);
  let current = 0;
  let maximum = 0;
  for (const slice of slices) {
    if (selected.has(slice.slice_index)) {
      maximum = Math.max(maximum, current);
      current = 0;
    } else {
      current += Number(slice.duration_seconds || 0);
    }
  }
  return Math.max(maximum, current);
}

function chooseBalancedAvailableSlice(slices, selectedSliceIndexes) {
  const selected = new Set(selectedSliceIndexes);
  const candidates = slices.filter((slice) => !selected.has(slice.slice_index));
  if (!candidates.length) return null;
  if (!selected.size) return candidates[0];
  return candidates.slice().sort((a, b) =>
    maximumUncoveredRunSeconds(slices, [...selected, a.slice_index])
      - maximumUncoveredRunSeconds(slices, [...selected, b.slice_index])
    || a.duration_seconds - b.duration_seconds
    || a.slice_index - b.slice_index)[0];
}

function shotTargetKey(shot) {
  return Number.isInteger(shot?.source_slice_index) && String(shot?.claim_id || "").trim()
    ? `${shot.claim_id}:${shot.source_slice_index}`
    : null;
}

/** Exact claim/slice targets required to break every evidence run and hold every pause on footage. */
export function collectCoverageTargetRequirements(shots, maxEvidenceRunSeconds) {
  const required = new Map();
  for (const shot of shots || []) {
    const key = shotTargetKey(shot);
    if (shot?.emphasis_card && shot.asset_type !== "footage" && key) {
      required.set(key, {
        claim_id: shot.claim_id,
        slice_index: shot.source_slice_index,
        reason: "editorial_pause_requires_footage",
      });
    }
  }

  const uncoveredRuns = () => {
    const runs = [];
    let active = [];
    const close = () => {
      if (active.length) runs.push(active);
      active = [];
    };
    for (const shot of shots || []) {
      const key = shotTargetKey(shot);
      if (shot?.asset_type !== "evidence" || (key && required.has(key))) {
        close();
      } else {
        active.push(shot);
      }
    }
    close();
    return runs;
  };

  while (true) {
    const overlong = uncoveredRuns().find(
      (run) => run.reduce((sum, shot) => sum + Number(shot.duration || 0), 0) > maxEvidenceRunSeconds + 0.001,
    );
    if (!overlong) break;
    const candidateKeys = [...new Set(overlong.map(shotTargetKey).filter(Boolean))];
    if (!candidateKeys.length) {
      throw new Error("An overlong evidence run has no claim/slice target that can be assigned footage");
    }
    const chosen = candidateKeys.slice().sort((a, b) => {
      const score = (key) => {
        let current = 0;
        let maximum = 0;
        for (const shot of overlong) {
          if (shotTargetKey(shot) === key) {
            maximum = Math.max(maximum, current);
            current = 0;
          } else {
            current += Number(shot.duration || 0);
          }
        }
        return Math.max(maximum, current);
      };
      return score(a) - score(b) || a.localeCompare(b);
    })[0];
    const [claimId, sliceIndex] = chosen.split(":");
    required.set(chosen, {
      claim_id: claimId,
      slice_index: Number(sliceIndex),
      reason: "break_uninterrupted_evidence_run",
    });
  }
  return [...required.values()].sort((a, b) =>
    a.claim_id.localeCompare(b.claim_id) || a.slice_index - b.slice_index);
}

/**
 * Keeps already-reviewed exact uses stable during a replacement round and
 * adds one balanced, claim-bound target for each newly acquired pending clip.
 * Claims already reported by the coverage gate are minimally rebalanced with
 * the same approved scenes before pending targets are added.
 */
export function extendAssignmentsForPendingReview({
  approvedAssignments,
  provisionalAssignments,
  claimSlices,
  requiredCoverageTargets = [],
  hookUsesByScene = new Map(),
  maxUsesPerSource,
  totalRuntimeSeconds,
  hookFootageSeconds,
  footageFractionMin,
  footageFractionMax,
}) {
  const topology = new Map(claimSlices.map((entry) => [entry.claim_id, entry.slices]));
  let assignments = approvedAssignments.map((item) => ({ ...item }));
  const targetKeys = new Set(assignments.map((item) => `${item.claim_id}:${item.slice_index}`));
  const usesByScene = new Map(hookUsesByScene);
  for (const assignment of assignments) {
    usesByScene.set(assignment.scene_id, (usesByScene.get(assignment.scene_id) || 0) + 1);
  }

  const pending = provisionalAssignments.slice().sort((a, b) => a.scene_id.localeCompare(b.scene_id));
  const addProvisionalAt = (scene, target) => {
    const key = `${scene.claim_id}:${target.slice_index}`;
    if (targetKeys.has(key)) throw new Error(`${scene.scene_id}: duplicate provisional target ${key}`);
    const ordinal = usesByScene.get(scene.scene_id) || 0;
    if (ordinal >= maxUsesPerSource) {
      throw new Error(`${scene.scene_id}: provisional review target would exceed the ${maxUsesPerSource}-use source budget`);
    }
    assignments.push({
      ...scene,
      slice_index: target.slice_index,
      trim_in_ratio: [0.08, 0.32, 0.05, 0.24, 0.14][ordinal % 5],
      motion: ["hold", "push", "pull", "drift_left"][(target.slice_index + ordinal) % 4],
    });
    targetKeys.add(key);
    usesByScene.set(scene.scene_id, ordinal + 1);
  };

  // Coverage requirements are exact: pause targets and the midpoint targets
  // that split real evidence runs. Prefer a pending clip from the same claim;
  // otherwise move one existing approved use within that claim, choosing the
  // move that leaves the most balanced remaining evidence spans.
  for (const target of requiredCoverageTargets) {
    const key = `${target.claim_id}:${target.slice_index}`;
    if (targetKeys.has(key)) continue;
    const pendingIndex = pending.findIndex((scene) => scene.claim_id === target.claim_id);
    if (pendingIndex >= 0) {
      const [scene] = pending.splice(pendingIndex, 1);
      addProvisionalAt(scene, target);
      continue;
    }
    const slices = topology.get(target.claim_id) || [];
    const selected = assignments
      .filter((assignment) => assignment.claim_id === target.claim_id)
      .map((assignment) => assignment.slice_index);
    const candidates = assignments
      .map((assignment, index) => ({ assignment, index }))
      .filter(({ assignment }) => assignment.claim_id === target.claim_id)
      .filter(({ assignment }) => !requiredCoverageTargets.some((required) =>
        required.claim_id === assignment.claim_id && required.slice_index === assignment.slice_index));
    if (!candidates.length) {
      throw new Error(`${key}: coverage requires footage but the claim has neither a pending clip nor a movable approved use`);
    }
    const chosen = candidates.slice().sort((a, b) => {
      const score = ({ assignment }) => maximumUncoveredRunSeconds(
        slices,
        [...selected.filter((sliceIndex) => sliceIndex !== assignment.slice_index), target.slice_index],
      );
      return score(a) - score(b) || b.assignment.slice_index - a.assignment.slice_index;
    })[0];
    targetKeys.delete(`${chosen.assignment.claim_id}:${chosen.assignment.slice_index}`);
    assignments[chosen.index] = { ...chosen.assignment, slice_index: target.slice_index };
    targetKeys.add(key);
  }

  for (const scene of pending) {
    const slices = topology.get(scene.claim_id) || [];
    const selected = assignments
      .filter((assignment) => assignment.claim_id === scene.claim_id)
      .map((assignment) => assignment.slice_index);
    const target = chooseBalancedAvailableSlice(slices, selected);
    if (!target) throw new Error(`${scene.scene_id}: ${scene.claim_id} has no unassigned narration slice for visual review`);
    addProvisionalAt(scene, target);
  }

  assignments.sort((a, b) => a.claim_id.localeCompare(b.claim_id) || a.slice_index - b.slice_index);
  const durationByTarget = new Map();
  for (const claim of claimSlices) {
    for (const slice of claim.slices) durationByTarget.set(`${claim.claim_id}:${slice.slice_index}`, slice.duration_seconds);
  }
  const bodySeconds = assignments.reduce(
    (sum, assignment) => sum + Number(durationByTarget.get(`${assignment.claim_id}:${assignment.slice_index}`) || 0),
    0,
  );
  const contextualFraction = (bodySeconds + hookFootageSeconds) / totalRuntimeSeconds;
  if (contextualFraction < footageFractionMin - 0.001 || contextualFraction > footageFractionMax + 0.001) {
    throw new Error(
      `Stable replacement review distribution reaches ${(contextualFraction * 100).toFixed(1)}%, outside the `
      + `${(footageFractionMin * 100).toFixed(0)}-${(footageFractionMax * 100).toFixed(0)}% contextual-footage band`,
    );
  }
  const maximumUses = Math.max(0, ...usesByScene.values());
  if (maximumUses > maxUsesPerSource) {
    throw new Error(`Stable replacement review distribution reaches ${maximumUses} uses for one source; limit is ${maxUsesPerSource}`);
  }
  return {
    assignments,
    summary: {
      claim_count: new Set(assignments.map((item) => item.claim_id)).size,
      claims_without_approved_pool: claimSlices
        .filter((claim) => !assignments.some((item) => item.claim_id === claim.claim_id))
        .map((claim) => claim.claim_id),
      assignment_count: assignments.length,
      total_runtime_seconds: Math.round(totalRuntimeSeconds * 1000) / 1000,
      hook_footage_seconds: Math.round(hookFootageSeconds * 1000) / 1000,
      body_footage_seconds: Math.round(bodySeconds * 1000) / 1000,
      contextual_footage_fraction: Math.round(contextualFraction * 1000) / 1000,
      coverage_status: "within_band",
      contextual_footage_fraction_min: footageFractionMin,
      contextual_footage_fraction_max: footageFractionMax,
      max_uses_per_source: maxUsesPerSource,
      maximum_uses_reached: maximumUses,
      reachable_body_seconds: Math.round(bodySeconds * 1000) / 1000,
    },
  };
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

export async function authorFootageDistribution(projectId, { seedFromAcquisition = false } = {}) {
  const dir = projectDir(projectId);
  const files = {
    contracts: path.join(dir, "research", "footage_use_contracts.json"),
    blueprint: path.join(dir, "direction", "editorial_blueprint.json"),
    reviews: path.join(dir, "research", "visual_asset_reviews.json"),
    profile: path.join(dir, "config", "production_profile.json"),
    editorial: path.join(dir, "config", "editorial_asset_plan.json"),
    coverageGaps: path.join(dir, "qa", "full_production_coverage_gaps.json"),
    acquisitionPlan: path.join(dir, "research", "footage_acquisition_plan.json"),
    runtime: path.join(dir, "assets", "footage_acquisition.runtime.json"),
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
  const pendingSceneIds = reviews
    ? new Set((reviews.pending_frame_review_scene_ids || []).map((sceneId) => String(sceneId || "").trim()).filter(Boolean))
    : new Set();
  // A first review and a later replacement review have the same bootstrap
  // need: pending bytes need exact claim-bound uses before a human/system
  // visual decision can approve them. Existing approvals remain the trusted
  // part of the pool; only explicitly pending acquired scenes are added
  // provisionally when the workflow opts into seeding.
  const seeding = Boolean(seedFromAcquisition && approvedSceneIds && pendingSceneIds.size);
  if (approvedSceneIds && !approvedSceneIds.size && !seeding) {
    throw new Error("visual_asset_reviews.json lists no approved assets; footage review must complete first");
  }

  let seededSceneCount = 0;
  let poolSource = contracts;
  let poolSceneFilter = approvedSceneIds;
  let reviewPoolAssembly = null;
  if (seeding) {
    const [acquisitionPlan, runtime] = await Promise.all([
      readJson(files.acquisitionPlan),
      readJson(files.runtime),
    ]);
    const assembled = assembleReviewablePoolSource({
      contracts,
      approvedSceneIds,
      pendingSceneIds,
      acquisitionPlan,
      runtime,
    });
    if (!assembled.provisional_scene_count) {
      throw new Error(
        "no pending acquired scene carries a claim in research/footage_acquisition_plan.json; there is nothing to seed a distribution from",
      );
    }
    seededSceneCount = assembled.provisional_scene_count;
    reviewPoolAssembly = assembled;
    poolSource = assembled;
    poolSceneFilter = null;
  }

  const claimSlices = collectClaimSliceTopology(shots);
  const claimPools = collectApprovedClaimPools(poolSource, poolSceneFilter);
  const hook = collectHookFootageUsage(shots);
  const totalRuntimeSeconds = shots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
  const requiredCoverageTargets = collectCoverageTargetRequirements(
    shots,
    Number(blueprint.global_rules?.max_uninterrupted_evidence_seconds) || 15,
  );

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
  const canPreserveApprovedDistribution = Boolean(
    !seeding
    && approvedSceneIds
    && (contracts.assignments || []).length
    && (contracts.assignments || []).every((assignment) => approvedSceneIds.has(assignment.scene_id))
    && !(coverageGaps?.gap_count > 0),
  );
  try {
    plan = canPreserveApprovedDistribution
      ? extendAssignmentsForPendingReview({
        approvedAssignments: contracts.assignments,
        provisionalAssignments: [],
        claimSlices,
        requiredCoverageTargets,
        hookUsesByScene: hook.usesByScene,
        maxUsesPerSource: planInput.maxUsesPerSource,
        totalRuntimeSeconds,
        hookFootageSeconds: hook.seconds,
        footageFractionMin: planInput.footageFractionMin,
        footageFractionMax: planInput.footageFractionMax,
      })
      : seeding && reviewPoolAssembly.approved_assignments.length
      ? extendAssignmentsForPendingReview({
        approvedAssignments: reviewPoolAssembly.approved_assignments,
        provisionalAssignments: reviewPoolAssembly.provisional_assignments,
        claimSlices,
        requiredCoverageTargets,
        hookUsesByScene: hook.usesByScene,
        maxUsesPerSource: planInput.maxUsesPerSource,
        totalRuntimeSeconds,
        hookFootageSeconds: hook.seconds,
        footageFractionMin: planInput.footageFractionMin,
        footageFractionMax: planInput.footageFractionMax,
      })
      : planFootageDistribution(planInput);
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
      basis: seeding
        ? (approvedSceneIds.size
          ? "byte_bound_approvals_plus_acquisition_seed_pending_visual_review"
          : "acquisition_seed_pending_visual_review")
        : "byte_bound_visual_approvals",
      policy: seeding
        ? "Provisional review authoring: existing assignments remain eligible only when their current bytes are "
          + "approved, while explicitly pending acquired scenes are bound to the claims in their own acquisition "
          + "plan entries only so their exact uses can be inspected. No pending scene is approved here, and the "
          + "visual-decision step still refuses to materialize one until it carries a byte-bound approval."
        : "Slices are chosen from the project's own live claim/slice topology, bound only to already-approved "
          + "claim-bound scenes, spread through each claim so contextual footage interleaves with primary evidence, "
          + "and capped by the blueprint's per-source use budget. No unreviewed footage and no automatic backfill.",
      ...(seeding ? { seeded_scene_count: seededSceneCount } : {}),
      ...(canPreserveApprovedDistribution ? { preserved_approved_exact_uses: true } : {}),
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
  authorFootageDistribution(projectId, {
    seedFromAcquisition: args["seed-from-acquisition"] === true || args["seed-from-acquisition"] === "true",
  })
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
