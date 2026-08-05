#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateLocalFootage } from "./orvyq_materialize_footage.mjs";
import {
  parseArgs,
  printJson,
  projectDir,
  readJson,
  writeJsonAtomic,
  pathExists,
} from "./lib/fs-utils.mjs";
import { assignStableShotKeys } from "./lib/orvyq-visual-rebalance.mjs";

export { validateLocalFootage };

function normalizeHash(value) {
  return String(value || "").trim().toLowerCase();
}

function sceneIdFromAsset(assetPath) {
  const match = String(assetPath || "").match(/(?:^|\/)scene_(\d{3})(?:_|\.|$)/);
  return match ? `scene_${match[1]}` : null;
}

function deleteFields(target, fields) {
  for (const field of fields) delete target[field];
}

export function resolveSemanticCorrectionTarget(shots, correction, requireStableKey = false) {
  const stableKey = String(correction?.shot_key || "").trim();
  if (requireStableKey && !stableKey) {
    throw new Error(`Semantic correction ${correction?.shot_index ?? "unknown"} requires shot_key`);
  }
  if (stableKey) {
    const matches = shots
      .map((shot, index) => ({ shot, index }))
      .filter((entry) => entry.shot.shot_key === stableKey);
    if (matches.length !== 1) {
      throw new Error(`Semantic correction shot_key ${stableKey} resolved ${matches.length} targets`);
    }
    return matches[0];
  }
  const index = correction?.shot_index;
  const shot = shots[index];
  if (!shot) throw new Error(`Semantic correction targets missing shot ${index}`);
  return { shot, index };
}

export async function reconcileActiveLocalFootage(projectId) {
  const dir = projectDir(projectId);
  const runtimeFile = path.join(dir, "assets", "footage_acquisition.runtime.json");
  const reviewsFile = path.join(dir, "research", "visual_asset_reviews.json");
  const localAssetsFile = path.join(dir, "assets", "local_assets.json");
  const [runtime, reviews] = await Promise.all([
    readJson(runtimeFile),
    readJson(reviewsFile),
  ]);
  if (runtime.project_id !== projectId || reviews.project_id !== projectId) {
    throw new Error(`Active footage reconciliation project_id mismatch for ${projectId}`);
  }

  const approvedByProvider = new Map(
    (reviews.approved_assets || []).map((approval) => [String(approval.provider_asset_id), approval]),
  );
  const records = runtime.records || [];
  const unapproved = [];
  let repairedProvenance = 0;

  for (const record of records) {
    const providerId = String(record.provider_asset_id);
    const approval = approvedByProvider.get(providerId);
    const provenanceFile = path.join(dir, `${record.path}.provenance.json`);
    if (!(await pathExists(provenanceFile))) {
      throw new Error(`${record.scene_id}: active footage provenance is missing for ${record.path}`);
    }
    const provenance = await readJson(provenanceFile);
    if (String(provenance.provider_asset_id) !== providerId) {
      throw new Error(`${record.scene_id}: runtime and provenance provider identities differ`);
    }
    if (!approval) {
      unapproved.push(record.scene_id);
      continue;
    }
    const currentHash = normalizeHash(provenance.actual_sha256 || provenance.sha256);
    if (!currentHash || currentHash !== normalizeHash(approval.asset_sha256)) {
      throw new Error(`${record.scene_id}: canonical visual approval does not match active footage bytes`);
    }

    const needsRepair = provenance.approved_for_final_edit !== true ||
      normalizeHash(provenance.reviewed_asset_sha256) !== currentHash ||
      normalizeHash(provenance.reviewed_contact_sheet_sha256) !== normalizeHash(approval.contact_sheet_sha256);
    if (needsRepair) {
      provenance.approved_for_final_edit = true;
      provenance.visual_qa_status = "APPROVED_CLAIM_SPECIFIC_CONTACT_SHEET_REVIEW";
      provenance.visual_qa_origin = provenance.visual_qa_origin || "canonical_visual_review_registry";
      provenance.reviewed_asset_sha256 = approval.asset_sha256;
      provenance.reviewed_contact_sheet_sha256 = approval.contact_sheet_sha256;
      provenance.visual_qa_reason = provenance.visual_qa_reason ||
        "Approval restored from the canonical byte-bound visual review registry for the active runtime asset.";
      delete provenance.human_review_status;
      delete provenance.human_review_reason;
      delete provenance.fail_closed_reason;
      await writeJsonAtomic(provenanceFile, provenance);
      repairedProvenance += 1;
    }
  }

  if (unapproved.length) {
    throw new Error(`Active footage lacks canonical visual approval: ${unapproved.sort().join(", ")}`);
  }

  const localAssets = {
    schema_version: 1,
    assets: records.map((record) => ({ path: record.path })),
  };
  await writeJsonAtomic(localAssetsFile, localAssets);
  return {
    project_id: projectId,
    active_assets: records.length,
    repaired_provenance: repairedProvenance,
    local_assets_rebuilt: true,
  };
}

export async function reconcileSemanticShotAssignments(projectId) {
  const dir = projectDir(projectId);
  const blueprintFile = path.join(dir, "direction", "editorial_blueprint.json");
  const runtimeFile = path.join(dir, "assets", "footage_acquisition.runtime.json");
  const reviewsFile = path.join(dir, "research", "visual_asset_reviews.json");
  const correctionsFile = path.join(dir, "direction", "semantic_shot_corrections.json");
  const [blueprint, runtime, reviews] = await Promise.all([
    readJson(blueprintFile),
    readJson(runtimeFile),
    readJson(reviewsFile),
  ]);
  const shots = assignStableShotKeys(blueprint.full_production?.shots || []);
  const recordByScene = new Map((runtime.records || []).map((record) => [record.scene_id, record]));
  const recordByPath = new Map((runtime.records || []).map((record) => [record.path, record]));
  const approvalByProvider = new Map(
    (reviews.approved_assets || []).map((approval) => [String(approval.provider_asset_id), approval]),
  );

  let normalizedPaths = 0;
  for (const shot of shots) {
    if (shot.asset_type !== "footage") continue;
    const sceneId = sceneIdFromAsset(shot.asset);
    const current = recordByScene.get(sceneId);
    if (current && current.path !== shot.asset) {
      shot.asset = current.path;
      normalizedPaths += 1;
    }
  }

  let appliedCorrections = 0;
  if (await pathExists(correctionsFile)) {
    const corrections = await readJson(correctionsFile);
    if (corrections.project_id !== projectId) throw new Error("semantic shot correction project_id mismatch");
    for (const correction of corrections.corrections || []) {
      const { shot, index: resolvedIndex } = resolveSemanticCorrectionTarget(
        shots,
        correction,
        corrections.schema_version === "1.1",
      );
      if (shot.claim_id !== correction.expected_claim_id) {
        throw new Error(`Semantic correction claim drift at ${correction.shot_key || `shot ${resolvedIndex}`}`);
      }
      const currentSceneId = sceneIdFromAsset(shot.asset);
      if (correction.expected_asset_scene_id && currentSceneId !== correction.expected_asset_scene_id) {
        const alreadyApplied = correction.replacement_type === "primary_evidence" && shot.asset_type === "evidence";
        const replacementScene = correction.replacement_type === "contextual_footage" &&
          currentSceneId === correction.source_scene_id;
        if (!alreadyApplied && !replacementScene) {
          throw new Error(`Semantic correction asset drift at ${correction.shot_key || `shot ${resolvedIndex}`}`);
        }
      }

      if (correction.replacement_type === "primary_evidence") {
        shot.asset_type = "evidence";
        shot.visual_role = "evidence";
        shot.editorial_purpose = correction.editorial_purpose;
        shot.semantic_rationale = correction.semantic_rationale;
        shot.semantic_link = "direct_evidence";
        shot.evidence = structuredClone(correction.evidence);
        deleteFields(shot, [
          "asset",
          "trim_in_sec",
          "trim_out_sec",
          "motion",
          "hook_footage",
          "contextual_footage",
          "generic_stock",
          "reuse_reason",
          "claim_bound_extension",
          "claim_bound_extension_basis",
          "graphic",
          "emphasis_card",
          "editorial_overlay",
          "overlay",
        ]);
      } else if (correction.replacement_type === "contextual_footage") {
        const replacement = recordByScene.get(correction.source_scene_id);
        if (!replacement) throw new Error(`Semantic correction source ${correction.source_scene_id} is not active`);
        if (Number(correction.trim_out_sec) - Number(correction.trim_in_sec) + 0.001 < Number(shot.duration)) {
          throw new Error(`Semantic correction trim is shorter than ${correction.shot_key || `shot ${resolvedIndex}`}`);
        }
        shot.asset_type = "footage";
        shot.asset = replacement.path;
        shot.trim_in_sec = correction.trim_in_sec;
        shot.trim_out_sec = correction.trim_out_sec;
        shot.visual_role = "scientific_context";
        shot.editorial_purpose = correction.editorial_purpose;
        shot.semantic_rationale = correction.semantic_rationale;
        shot.semantic_link = correction.semantic_link || "physical";
        shot.contextual_footage = true;
        shot.generic_stock = false;
        deleteFields(shot, [
          "evidence",
          "graphic",
          "emphasis_card",
          "editorial_overlay",
          "overlay",
          "reuse_reason",
        ]);
      } else {
        throw new Error(`Unsupported semantic correction type ${correction.replacement_type}`);
      }
      appliedCorrections += 1;
    }
  }

  let claimBoundExtensions = 0;
  for (const shot of shots) {
    if (shot.asset_type !== "footage") continue;
    const record = recordByPath.get(shot.asset);
    const approval = record && approvalByProvider.get(String(record.provider_asset_id));
    const exactUse = (approval?.approved_uses || []).some((use) =>
      use.claim_id === shot.claim_id && use.narration_anchor === shot.narration_anchor
    );
    if (exactUse) {
      delete shot.claim_bound_extension;
      delete shot.claim_bound_extension_basis;
      continue;
    }
    const sameClaimUse = (approval?.approved_uses || []).some((use) =>
      use.claim_id === shot.claim_id && String(use.semantic_rationale || "").length >= 24
    );
    if (sameClaimUse && String(shot.semantic_rationale || "").length >= 24) {
      shot.claim_bound_extension = true;
      shot.claim_bound_extension_basis =
        "The exact active bytes are already approved for this claim; this shot is an adjacent narration slice with an explicit semantic rationale.";
      claimBoundExtensions += 1;
    } else {
      delete shot.claim_bound_extension;
      delete shot.claim_bound_extension_basis;
    }
  }

  blueprint.full_production.shots = shots;
  await writeJsonAtomic(blueprintFile, blueprint);
  return {
    project_id: projectId,
    normalized_paths: normalizedPaths,
    applied_corrections: appliedCorrections,
    claim_bound_extensions: claimBoundExtensions,
  };
}

export async function reconcileAndValidateLocalFootage(projectId) {
  const reconciliation = await reconcileActiveLocalFootage(projectId);
  const semanticAssignments = await reconcileSemanticShotAssignments(projectId);
  const validation = await validateLocalFootage(projectId);
  return { ...validation, reconciliation, semantic_assignments: semanticAssignments };
}

const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args["project-id"] || process.env.ORVYQ_PROJECT_ID;
  reconcileAndValidateLocalFootage(projectId)
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
