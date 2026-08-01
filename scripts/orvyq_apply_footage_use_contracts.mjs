#!/usr/bin/env node
import path from "node:path";
import {
  projectDir,
  readJson,
  readJsonSafe,
  writeJsonAtomic,
  parseArgs,
  printJson,
} from "./lib/fs-utils.mjs";
import { canonicalVisualRole } from "./lib/orvyq-visual-roles.mjs";
import { materializeVisualRebalancePlan } from "./lib/orvyq-visual-rebalance.mjs";
import { enforceFootageUseBudget } from "./lib/orvyq-footage-use-budget.mjs";
import { fitContiguousFootageRunsToSources } from "./lib/orvyq-footage-trim-fit.mjs";

function sceneIdFromAsset(assetPath) {
  const match = String(assetPath || "").match(/(?:^|\/)scene_(\d{3})(?:_|\.mp4)/);
  return match ? `scene_${match[1]}` : null;
}

function targetKey(claimId, sliceIndex) {
  return `${claimId}:${Number(sliceIndex)}`;
}

function retirementKey(sceneId, claimId, sliceIndex) {
  return `${sceneId}:${targetKey(claimId, sliceIndex)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateAssignment(item, label) {
  if (!item || typeof item !== "object") throw new Error(`${label} must be an object`);
  if (!/^scene_\d{3}$/.test(String(item.scene_id || ""))) throw new Error(`${label}.scene_id is invalid`);
  if (!String(item.claim_id || "").trim()) throw new Error(`${label}.claim_id is required`);
  if (!Number.isInteger(Number(item.slice_index)) || Number(item.slice_index) < 0)
    throw new Error(`${label}.slice_index must be a non-negative integer`);
  if (!Number.isFinite(Number(item.trim_in_ratio || 0)) || Number(item.trim_in_ratio || 0) < 0 || Number(item.trim_in_ratio || 0) >= 1)
    throw new Error(`${label}.trim_in_ratio must be in [0, 1)`);
  canonicalVisualRole(item.role || "context");
  if (!String(item.semantic_rationale || "").trim()) throw new Error(`${label}.semantic_rationale is required`);
}

function validateRetirement(item, label) {
  if (!item || typeof item !== "object") throw new Error(`${label} must be an object`);
  if (!/^scene_\d{3}$/.test(String(item.scene_id || ""))) throw new Error(`${label}.scene_id is invalid`);
  if (!String(item.claim_id || "").trim()) throw new Error(`${label}.claim_id is required`);
  if (!Number.isInteger(Number(item.slice_index)) || Number(item.slice_index) < 0)
    throw new Error(`${label}.slice_index must be a non-negative integer`);
  if (String(item.reason || "").trim().length < 16) throw new Error(`${label}.reason must explain the retirement`);
}

export function mergeFootageUseContractOverrides(contracts, overrides = null) {
  const merged = clone(contracts);
  merged.managed_scene_ids ||= [];
  merged.pruned_scene_ids ||= [];
  merged.assignments ||= [];
  merged.retired_targets ||= [];

  if (!overrides) return merged;
  if (overrides.schema_version !== "1.0") throw new Error("footage_use_contract_overrides schema_version must be 1.0");
  if (overrides.project_id !== contracts.project_id)
    throw new Error(`footage_use_contract_overrides project_id ${overrides.project_id} does not match ${contracts.project_id}`);

  const overrideManaged = new Set(overrides.managed_scene_ids || []);
  for (const sceneId of overrideManaged) {
    if (!/^scene_\d{3}$/.test(String(sceneId))) throw new Error(`footage_use_contract_overrides has invalid managed scene ${sceneId}`);
  }

  const overrideAssignments = overrides.assignments || [];
  overrideAssignments.forEach((item, index) => validateAssignment(item, `footage_use_contract_overrides.assignments[${index}]`));
  const overrideRetirements = overrides.retired_targets || [];
  overrideRetirements.forEach((item, index) => validateRetirement(item, `footage_use_contract_overrides.retired_targets[${index}]`));

  merged.assignments = merged.assignments.filter((item) => !overrideManaged.has(item.scene_id));
  merged.retired_targets = merged.retired_targets.filter((item) => !overrideManaged.has(item.scene_id));
  merged.assignments.push(...clone(overrideAssignments));
  merged.retired_targets.push(...clone(overrideRetirements));
  merged.managed_scene_ids = [...new Set([...merged.managed_scene_ids, ...overrideManaged])].sort();

  const targetKeys = new Set();
  for (const [index, item] of merged.assignments.entries()) {
    validateAssignment(item, `merged footage assignment[${index}]`);
    const key = targetKey(item.claim_id, item.slice_index);
    if (targetKeys.has(key)) throw new Error(`Merged footage contracts have duplicate target ${key}`);
    targetKeys.add(key);
  }

  const retirementKeys = new Set();
  for (const [index, item] of merged.retired_targets.entries()) {
    validateRetirement(item, `merged retired target[${index}]`);
    const key = retirementKey(item.scene_id, item.claim_id, item.slice_index);
    if (retirementKeys.has(key)) throw new Error(`Merged footage contracts have duplicate retirement ${key}`);
    retirementKeys.add(key);
  }
  return merged;
}

export function assertNoSilentManagedAssignmentRemoval({
  editorialAssignments,
  managedSceneIds,
  prunedSceneIds,
  finalAssignments,
  retiredTargets,
}) {
  const managedScenes = new Set(managedSceneIds || []);
  const prunedScenes = new Set(prunedSceneIds || []);
  const finalByTarget = new Map((finalAssignments || []).map((item) => [targetKey(item.claim_id, item.slice_index), item.scene_id]));
  const retirementKeys = new Set((retiredTargets || []).map((item) => retirementKey(item.scene_id, item.claim_id, item.slice_index)));

  const unaccounted = [];
  for (const [claimId, claimAssignments] of Object.entries(editorialAssignments || {})) {
    for (const [sliceIndex, assignment] of Object.entries(claimAssignments || {})) {
      const sceneId = sceneIdFromAsset(assignment?.asset);
      if (!managedScenes.has(sceneId)) continue;
      const key = targetKey(claimId, sliceIndex);
      const finalScene = finalByTarget.get(key);
      if (finalScene === sceneId || prunedScenes.has(sceneId) || retirementKeys.has(retirementKey(sceneId, claimId, sliceIndex))) continue;
      unaccounted.push(`${sceneId} at ${key}`);
    }
  }
  if (unaccounted.length) {
    throw new Error(
      `Footage use contracts would silently remove ${unaccounted.length} managed assignment(s): ${unaccounted.join(", ")}. ` +
        "Add a replacement assignment or an explicit retired_targets entry with a specific reason."
    );
  }
}

export function synchronizeVisualRebalanceShots({ shots, rebalancePlan, assetRequests = [] }) {
  if (!rebalancePlan || rebalancePlan.status !== "materialized") return clone(shots || []);
  return materializeVisualRebalancePlan({
    shots: shots || [],
    plan: rebalancePlan,
    assetRequests,
  });
}

export async function applyFootageUseContracts(projectId) {
  const dir = projectDir(projectId);
  const files = {
    contracts: path.join(dir, "research", "footage_use_contracts.json"),
    overrides: path.join(dir, "research", "footage_use_contract_overrides.json"),
    editorial: path.join(dir, "config", "editorial_asset_plan.json"),
    runtime: path.join(dir, "assets", "footage_acquisition.runtime.json"),
    plan: path.join(dir, "research", "footage_acquisition_plan.json"),
    blueprint: path.join(dir, "direction", "editorial_blueprint.json"),
    pauseMap: path.join(dir, "direction", "editorial_pause_map.json"),
    motionHook: path.join(dir, "direction", "motion_hook.json"),
    rebalancePlan: path.join(dir, "direction", "visual_rebalance_plan.json"),
    assetRequests: path.join(dir, "research", "visual_asset_requests.json"),
  };
  const [
    baseContracts,
    overrides,
    editorial,
    runtime,
    plan,
    blueprint,
    pauseMap,
    motionHook,
    rebalancePlan,
    assetRequests,
  ] = await Promise.all([
    readJson(files.contracts),
    readJsonSafe(files.overrides, null),
    readJson(files.editorial),
    readJson(files.runtime),
    readJson(files.plan),
    readJson(files.blueprint),
    readJson(files.pauseMap),
    readJson(files.motionHook),
    readJsonSafe(files.rebalancePlan, null),
    readJsonSafe(files.assetRequests, { project_id: projectId, requests: [] }),
  ]);
  for (const [label, value] of Object.entries({
    baseContracts,
    editorial,
    runtime,
    plan,
    blueprint,
    pauseMap,
    motionHook,
    ...(rebalancePlan ? { rebalancePlan } : {}),
    assetRequests,
  })) {
    if (value.project_id !== projectId) throw new Error(`${label} project_id does not match ${projectId}`);
  }

  const contracts = mergeFootageUseContractOverrides(baseContracts, overrides);
  contracts.assignments = (contracts.assignments || []).map((item) => ({
    ...item,
    role: canonicalVisualRole(item.role || "context"),
  }));
  const managedScenes = new Set(contracts.managed_scene_ids || []);
  const prunedScenes = new Set(contracts.pruned_scene_ids || []);
  const assignments = contracts.assignments || [];
  const targetKeys = new Set(assignments.map((item) => targetKey(item.claim_id, item.slice_index)));
  const duplicateTargets = assignments.length - targetKeys.size;
  if (duplicateTargets) throw new Error(`footage_use_contracts has ${duplicateTargets} duplicate claim/slice target(s)`);

  assertNoSilentManagedAssignmentRemoval({
    editorialAssignments: editorial.footage_assignments,
    managedSceneIds: contracts.managed_scene_ids,
    prunedSceneIds: contracts.pruned_scene_ids,
    finalAssignments: assignments,
    retiredTargets: contracts.retired_targets,
  });

  const currentByScene = new Map((runtime.records || []).map((record) => [record.scene_id, record]));
  const provenanceByScene = new Map();
  for (const record of runtime.records || []) {
    provenanceByScene.set(record.scene_id, await readJson(path.join(dir, `${record.path}.provenance.json`)));
  }
  const sourceDurationByAsset = new Map(
    (runtime.records || []).map((record) => {
      const provenance = provenanceByScene.get(record.scene_id) || {};
      const duration = Number(provenance.actual_duration_seconds || provenance.duration_seconds || provenance.duration || 0);
      return [record.path, duration];
    }),
  );

  const shots = blueprint.full_production?.shots || [];
  const shotsByTarget = new Map();
  for (const shot of shots) {
    if (!Number.isInteger(shot.source_slice_index)) continue;
    const key = targetKey(shot.claim_id, shot.source_slice_index);
    const list = shotsByTarget.get(key) || [];
    list.push(shot);
    shotsByTarget.set(key, list);
  }

  editorial.footage_assignments ||= {};
  let removedAssignments = 0;
  for (const [claimId, claimAssignments] of Object.entries(editorial.footage_assignments)) {
    for (const [sliceIndex, assignment] of Object.entries(claimAssignments || {})) {
      const sceneId = sceneIdFromAsset(assignment?.asset);
      if (managedScenes.has(sceneId) || targetKeys.has(targetKey(claimId, sliceIndex))) {
        delete claimAssignments[sliceIndex];
        removedAssignments += 1;
      }
    }
    if (!Object.keys(claimAssignments).length) delete editorial.footage_assignments[claimId];
  }

  const assignmentByTarget = new Map();
  const sceneUseCounts = new Map();
  for (const contract of assignments) {
    if (prunedScenes.has(contract.scene_id)) throw new Error(`${contract.scene_id} is both pruned and assigned`);
    const record = currentByScene.get(contract.scene_id);
    if (!record) throw new Error(`${contract.scene_id}: no current runtime record`);
    const key = targetKey(contract.claim_id, contract.slice_index);
    const targetShots = shotsByTarget.get(key) || [];
    if (!targetShots.length) throw new Error(`${key}: no blueprint shot exists for the contracted source slice`);
    const narrationAnchor = String(targetShots[0].narration_anchor || targetShots[0].editorial_purpose || "").trim();
    if (narrationAnchor.length < 8) throw new Error(`${key}: contracted target has no usable narration anchor`);
    const count = (sceneUseCounts.get(contract.scene_id) || 0) + 1;
    sceneUseCounts.set(contract.scene_id, count);
    editorial.footage_assignments[contract.claim_id] ||= {};
    editorial.footage_assignments[contract.claim_id][String(contract.slice_index)] = {
      asset: record.path,
      trimInRatio: Number(contract.trim_in_ratio || 0),
      motion: contract.motion || "hold",
      role: contract.role,
      semantic_anchor: narrationAnchor,
      semantic_rationale: contract.semantic_rationale,
      semantic_link: contract.semantic_link || "physical",
      ...(count > 1
        ? { reuse_reason: `A deliberate claim-bound reuse of ${contract.scene_id} at a distinct narration target and trim window.` }
        : {}),
    };
    assignmentByTarget.set(key, { ...contract, record, narrationAnchor });
  }

  const activeRecords = (runtime.records || []).filter((record) => !prunedScenes.has(record.scene_id));
  editorial.full_footage_pool = [...new Set(activeRecords.map((record) => record.path))];
  editorial.generation_policy =
    "claim-bound footage use contracts plus explicit validated overrides; editorial role aliases are normalized to canonical render roles; one scene may appear only at listed claim/slice targets; no automatic backfill, silent retirement or scene-id-wide reassignment";

  const nextShots = clone(shots);
  const nextShotsByTarget = new Map();
  for (const shot of nextShots) {
    if (!Number.isInteger(shot.source_slice_index)) continue;
    const key = targetKey(shot.claim_id, shot.source_slice_index);
    const list = nextShotsByTarget.get(key) || [];
    list.push(shot);
    nextShotsByTarget.set(key, list);
  }

  let materializedShotCount = 0;
  const deferredTargets = [];
  for (const [key, assignment] of assignmentByTarget.entries()) {
    const targetShots = nextShotsByTarget.get(key) || [];
    const provenance = provenanceByScene.get(assignment.scene_id);
    const sourceDuration = Number(provenance?.actual_duration_seconds || provenance?.duration || 0);
    const totalShotDuration = targetShots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
    if (!(sourceDuration > 0)) throw new Error(`${assignment.scene_id}: provenance has no valid duration`);
    if (totalShotDuration > sourceDuration + 0.001) {
      deferredTargets.push({
        target: key,
        scene_id: assignment.scene_id,
        required_seconds: totalShotDuration,
        available_seconds: sourceDuration,
      });
      continue;
    }
    const requestedStart = Number(assignment.trim_in_ratio || 0) * sourceDuration;
    let trimCursor = Math.max(0, Math.min(requestedStart, sourceDuration - totalShotDuration));
    for (const shot of targetShots) {
      const duration = Number(shot.duration || 0);
      const trimIn = Math.round(trimCursor * 1000) / 1000;
      const trimOut = Math.round((trimCursor + duration) * 1000) / 1000;
      shot.asset_type = "footage";
      shot.asset = assignment.record.path;
      shot.visual_role = assignment.role;
      shot.motion = assignment.motion || "hold";
      shot.trim_in_sec = trimIn;
      shot.trim_out_sec = trimOut;
      shot.semantic_rationale = assignment.semantic_rationale;
      shot.semantic_link = assignment.semantic_link || "physical";
      shot.generic_stock = provenance.provider === "pexels";
      delete shot.evidence;
      delete shot.graphic;
      trimCursor = trimOut;
      materializedShotCount += 1;
    }
  }

  const synchronizedShots = synchronizeVisualRebalanceShots({
    shots: nextShots,
    rebalancePlan,
    assetRequests: assetRequests.requests || [],
  });
  const trimFitResult = fitContiguousFootageRunsToSources({
    shots: synchronizedShots,
    sourceDurationByAsset,
  });
  const budgetResult = enforceFootageUseBudget({
    shots: trimFitResult.shots,
    maxUsesPerSource: Number(blueprint.global_rules?.max_uses_per_source),
    minimumHookSeconds: Number(motionHook.minimum_seconds),
  });
  blueprint.full_production.shots = budgetResult.shots;
  const canonicalDurationSeconds = Math.round(
    budgetResult.shots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0) * 1000
  ) / 1000;
  blueprint.full_production.generated_total_duration_seconds = canonicalDurationSeconds;
  pauseMap.duration_policy.minimum_final_duration_seconds = canonicalDurationSeconds;

  editorial.last_footage_use_contract_application = {
    generated_at: new Date().toISOString(),
    managed_scene_count: managedScenes.size,
    pruned_scene_count: prunedScenes.size,
    assignment_count: assignments.length,
    removed_previous_assignments: removedAssignments,
    explicit_retirement_count: (contracts.retired_targets || []).length,
    override_file: overrides ? "research/footage_use_contract_overrides.json" : null,
    visual_rebalance_resynchronized: Boolean(rebalancePlan?.status === "materialized"),
    deferred_targets: deferredTargets,
    source_duration_fit: {
      shifted_contiguous_runs: trimFitResult.shifted_runs,
      slowed_contiguous_runs: trimFitResult.slowed_runs,
    },
    footage_use_budget: {
      max_uses_per_source: Number(blueprint.global_rules?.max_uses_per_source),
      minimum_hook_seconds: Number(motionHook.minimum_seconds),
      removed_optional_hook_uses: budgetResult.removed_hook_uses,
      final_use_counts: budgetResult.use_counts,
    },
  };

  const originalPlanCount = (plan.assets || []).length;
  plan.assets = (plan.assets || []).filter((item) => !prunedScenes.has(item.scene_id));
  plan.planned_asset_count = plan.assets.length;
  plan.use_contract = "research/footage_use_contracts.json";
  plan.use_contract_overrides = overrides ? "research/footage_use_contract_overrides.json" : null;

  await Promise.all([
    writeJsonAtomic(files.contracts, contracts),
    writeJsonAtomic(files.editorial, editorial),
    writeJsonAtomic(files.plan, plan),
    writeJsonAtomic(files.blueprint, blueprint),
    writeJsonAtomic(files.pauseMap, pauseMap),
  ]);
  return {
    project_id: projectId,
    assignment_count: assignments.length,
    materialized_shot_count: materializedShotCount,
    visual_rebalance_resynchronized: Boolean(rebalancePlan?.status === "materialized"),
    deferred_target_count: deferredTargets.length,
    removed_previous_assignments: removedAssignments,
    explicit_retirement_count: (contracts.retired_targets || []).length,
    shifted_contiguous_run_count: trimFitResult.shifted_runs.length,
    slowed_contiguous_run_count: trimFitResult.slowed_runs.length,
    removed_optional_hook_use_count: budgetResult.removed_hook_uses.length,
    override_applied: Boolean(overrides),
    pruned_plan_assets: originalPlanCount - plan.assets.length,
    active_plan_assets: plan.assets.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args["project-id"] || args.project;
  if (!projectId) throw new Error("--project-id is required");
  applyFootageUseContracts(projectId)
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
