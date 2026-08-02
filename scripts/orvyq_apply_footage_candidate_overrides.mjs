#!/usr/bin/env node
import path from "node:path";
import {
  projectDir,
  readJson,
  writeJsonAtomic,
  parseArgs,
  printJson,
} from "./lib/fs-utils.mjs";

export async function applyFootageCandidateOverrides(projectId) {
  const root = projectDir(projectId);
  const manifestPath = path.join(root, "research", "selected_pexels_manifest.json");
  const overridePath = path.join(root, "config", "footage_candidate_overrides.json");
  const [manifest, overrides] = await Promise.all([
    readJson(manifestPath),
    readJson(overridePath),
  ]);
  if (manifest.project_id !== projectId || overrides.project_id !== projectId) {
    throw new Error("Project id mismatch while applying footage candidate overrides");
  }
  if (!Array.isArray(overrides.overrides) || !overrides.overrides.length) {
    throw new Error("Footage candidate override file has no overrides");
  }
  const byScene = new Map((manifest.assets || []).map((entry) => [entry.scene_id, entry]));
  const applied = [];
  for (const override of overrides.overrides) {
    const entry = byScene.get(override.scene_id);
    if (!entry) throw new Error(`${override.scene_id}: selected manifest entry is missing`);
    const candidates = (override.provider_asset_ids || []).map(String).filter(Boolean);
    if (!candidates.length) throw new Error(`${override.scene_id}: override has no provider_asset_ids`);
    if (new Set(candidates).size !== candidates.length) {
      throw new Error(`${override.scene_id}: override has duplicate provider asset ids`);
    }
    entry.provider_asset_ids = candidates;
    if (String(override.semantic_rationale || "").trim()) {
      entry.semantic_rationale = String(override.semantic_rationale).trim();
    }
    if (String(override.narration_anchor || "").trim()) {
      entry.narration_anchor = String(override.narration_anchor).trim();
    }
    entry.replacement_review = {
      reason: String(override.reason || "Previous footage failed semantic or cinematic review").trim(),
      replaced_provider_asset_ids: (override.replaced_provider_asset_ids || []).map(String),
      requested_at: overrides.requested_at || new Date().toISOString(),
      request_revision: overrides.request_revision || 1,
    };
    applied.push({ scene_id: override.scene_id, provider_asset_ids: candidates });
  }
  manifest.generated_at = new Date().toISOString();
  manifest.replacement_override_revision = overrides.request_revision || 1;
  await writeJsonAtomic(manifestPath, manifest);
  return { project_id: projectId, applied_count: applied.length, applied };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args["project-id"] || args.project;
  if (!projectId) throw new Error("--project-id is required");
  applyFootageCandidateOverrides(projectId)
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
