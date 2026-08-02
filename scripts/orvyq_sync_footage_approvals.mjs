#!/usr/bin/env node
import path from "node:path";
import {
  projectDir,
  readJson,
  writeJsonAtomic,
  parseArgs,
  printJson,
} from "./lib/fs-utils.mjs";

function useKey(use) {
  return [
    String(use.claim_id || ""),
    String(use.narration_anchor || ""),
  ].join("\u0000");
}

function validUse(shot) {
  return Boolean(
    String(shot.claim_id || "").trim() &&
    String(shot.narration_anchor || "").trim() &&
    String(shot.semantic_rationale || shot.editorial_purpose || "").trim().length >= 24
  );
}

export async function syncFootageApprovals(projectId) {
  const dir = projectDir(projectId);
  const blueprint = await readJson(path.join(dir, "direction", "editorial_blueprint.json"));
  const reviewsPath = path.join(dir, "research", "visual_asset_reviews.json");
  const reviews = await readJson(reviewsPath);
  if (blueprint.project_id !== projectId || reviews.project_id !== projectId) {
    throw new Error("Project id mismatch while synchronizing footage approvals");
  }

  const approvals = reviews.approved_assets || [];
  const approvalByProviderId = new Map(
    approvals.map((approval) => [String(approval.provider_asset_id || ""), approval]),
  );
  const footageShots = (blueprint.full_production?.shots || []).filter(
    (shot) => shot.asset_type === "footage" && shot.asset,
  );
  if (!footageShots.length) throw new Error("No footage shots exist in the full production plan");

  const provenanceByAsset = new Map();
  for (const assetPath of [...new Set(footageShots.map((shot) => shot.asset))]) {
    provenanceByAsset.set(
      assetPath,
      await readJson(path.join(dir, `${assetPath}.provenance.json`)),
    );
  }

  let addedUseCount = 0;
  for (const shot of footageShots) {
    if (!validUse(shot)) {
      throw new Error(
        `${shot.asset}: generated footage shot lacks claim_id, narration_anchor, or a sufficiently specific semantic rationale`,
      );
    }
    const provenance = provenanceByAsset.get(shot.asset);
    const providerId = String(provenance.provider_asset_id || "");
    const approval = approvalByProviderId.get(providerId);
    if (!approval) throw new Error(`${shot.asset}: no canonical visual approval exists`);
    if (String(approval.asset_sha256 || "").toLowerCase() !== String(provenance.sha256 || provenance.actual_sha256 || "").toLowerCase()) {
      throw new Error(`${shot.asset}: approval hash no longer matches provenance`);
    }
    approval.approved_uses ||= [];
    const nextUse = {
      claim_id: shot.claim_id,
      narration_anchor: shot.narration_anchor,
      semantic_rationale: shot.semantic_rationale || shot.editorial_purpose,
      semantic_link: shot.semantic_link || "physical",
      source_slice_index: Number.isInteger(shot.source_slice_index) ? shot.source_slice_index : null,
      synchronized_from_full_production_plan: true,
    };
    const keys = new Set(approval.approved_uses.map(useKey));
    if (!keys.has(useKey(nextUse))) {
      approval.approved_uses.push(nextUse);
      addedUseCount += 1;
    }
  }

  reviews.last_full_production_use_sync_at = new Date().toISOString();
  reviews.last_full_production_use_sync = {
    footage_shot_count: footageShots.length,
    approved_asset_count: approvals.length,
    added_exact_use_count: addedUseCount,
  };
  await writeJsonAtomic(reviewsPath, reviews);
  return {
    project_id: projectId,
    footage_shot_count: footageShots.length,
    approved_asset_count: approvals.length,
    added_exact_use_count: addedUseCount,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args["project-id"] || args.project;
  if (!projectId) throw new Error("--project-id is required");
  syncFootageApprovals(projectId)
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
