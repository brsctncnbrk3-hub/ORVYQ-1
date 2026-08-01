#!/usr/bin/env node
// promoteEvidenceAssets() -- the one place research/evidence_asset_manifest.json
// entries move from "spec_ready_asset_pending" to "ready".
//
// research/evidence_asset_manifest.json (checked by scripts/orvyq_edit_plan.mjs's
// buildFullPlan()) and research/primary_evidence_manifest.json +
// assets/evidence/primary_evidence.runtime.json (checked by
// scripts/orvyq_evidence_asset_audit.mjs, populated by
// scripts/orvyq_fetch_primary_evidence.mjs) are two independent registries
// for the same real, materialized evidence images -- see
// schemas/evidence_registry.schema.json's own description of the intent to
// eventually unify them. Until then, an entry here may only ever become
// "ready" by real, CI-verified proof: a matching entry in
// primary_evidence.runtime.json (the fetch script's own record of a
// downloaded, magic-byte-checked, sha256'd file) AND the physical file
// actually present on disk at the declared local_asset path. Never promote
// on declaration alone -- that would let a build-time IMAGE_KINDS shot
// reference an asset that was never actually verified to exist, exactly
// the "fake metadata card counted as real evidence" failure mode task
// section 4.3 forbids.
import path from "node:path";
import { projectDir, readJson, readJsonSafe, writeJsonAtomic, pathExists, parseArgs, printJson } from "./lib/fs-utils.mjs";

const PROJECT_ID = process.env.ORVYQ_PROJECT_ID || null;

export async function promoteEvidenceAssets(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const manifestPath = path.join(dir, "research", "evidence_asset_manifest.json");
  const [manifest, runtime] = await Promise.all([
    readJson(manifestPath),
    readJsonSafe(path.join(dir, "assets", "evidence", "primary_evidence.runtime.json"))
  ]);
  const runtimeById = new Map((runtime?.assets || []).map((asset) => [asset.evidence_asset_id, asset]));

  const promoted = [];
  const stillPending = [];
  for (const asset of manifest.assets || []) {
    if (asset.status !== "spec_ready_asset_pending") continue;
    const verified = runtimeById.get(asset.evidence_asset_id);
    if (!verified) {
      stillPending.push({ evidence_asset_id: asset.evidence_asset_id, reason: "not present in assets/evidence/primary_evidence.runtime.json -- fetch step did not verify it" });
      continue;
    }
    const localPath = verified.local_asset;
    if (!localPath || !(await pathExists(path.join(dir, localPath)))) {
      stillPending.push({ evidence_asset_id: asset.evidence_asset_id, reason: `verified runtime record has no usable physical file at ${localPath || "(none)"}` });
      continue;
    }
    if (!verified.sha256 || verified.sha256.length !== 64) {
      stillPending.push({ evidence_asset_id: asset.evidence_asset_id, reason: "verified runtime record has no valid sha256" });
      continue;
    }
    asset.status = "ready";
    promoted.push(asset.evidence_asset_id);
  }

  if (promoted.length) await writeJsonAtomic(manifestPath, manifest);

  return { promoted, stillPending };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  promoteEvidenceAssets(args["project-id"] || PROJECT_ID)
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
