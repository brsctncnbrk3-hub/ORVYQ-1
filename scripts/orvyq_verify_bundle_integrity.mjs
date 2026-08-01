#!/usr/bin/env node
// verifyBundleIntegrity() -- for a workflow that downloaded a candidate
// bundle (an orvyq-validated-candidate-bundle-<run_id> or
// orvyq-render-bundle-<run_id> artifact) and placed it into the project
// tree WITHOUT rebuilding anything: confirms every placed file's real
// sha256 (and the placed render_ready_project directory's own tree hash)
// still matches what the bundle's own qa/frozen_candidate.json recorded at
// freeze time. This is a self-consistency check against the bundle's OWN
// recorded identity (proving the download/placement did not corrupt or
// silently substitute a file) -- not an independent recomputation of the
// candidate from scratch, which a consumer of an already-frozen bundle must
// never do (see docs/canonical-candidate-audit.md: "validation candidate ==
// review candidate == final candidate").
import path from "node:path";
import { promises as fs } from "node:fs";
import { projectDir, readJson, parseArgs, printJson, pathExists } from "./lib/fs-utils.mjs";
import { sha256OfFile, sha256OfDirectoryTree } from "./orvyq_frozen_candidate.mjs";

const PROJECT_ID = process.env.ORVYQ_PROJECT_ID || null;

export async function verifyBundleIntegrity(projectId = PROJECT_ID, { renderReadyDir } = {}) {
  const dir = projectDir(projectId);
  const candidate = await readJson(path.join(dir, "qa", "frozen_candidate.json"));
  const identity = candidate.canonical_candidate_identity;
  if (!identity) throw new Error("qa/frozen_candidate.json has no canonical_candidate_identity -- this bundle predates candidate-identity hardening");

  const fileChecks = [
    ["edit_plan_hash", path.join(dir, "direction", "edit_plan.json")],
    ["caption_hash", path.join(dir, "remotion", "captions.json")],
    ["audio_mix_metadata_hash", path.join(dir, "assets", "audio", "final_mix.metadata.json")],
    ["asset_registry_hash", path.join(dir, "assets", "asset_registry.json")],
    ["final_mix_audio_hash", path.join(dir, "assets", "audio", "final_mix.mp3")],
    ["music_bed_hash", path.join(dir, "assets", "music", "approved_bed.mp3")]
  ];

  const mismatches = [];
  for (const [field, filePath] of fileChecks) {
    const expected = identity[field];
    if (!expected) continue;
    if (!(await pathExists(filePath))) {
      mismatches.push(`${field}: expected ${expected}, but file is missing (${filePath})`);
      continue;
    }
    const actual = await sha256OfFile(filePath);
    if (actual !== expected) mismatches.push(`${field}: expected ${expected}, got ${actual} (${filePath})`);
  }

  // The immutable bundle must carry every binary asset that was frozen, not
  // merely an asset registry containing their names. Without this check a
  // source-only bundle can pass typecheck and identity checks, then fail only
  // when Remotion tries to resolve staticFile() at render time.
  const assetManifest = candidate.asset_manifest || [];
  for (const asset of assetManifest) {
    const assetPath = path.join(dir, asset.path);
    if (!(await pathExists(assetPath))) {
      mismatches.push(`asset_manifest: missing ${asset.path}`);
      continue;
    }
    const stat = await fs.stat(assetPath);
    if (stat.size !== asset.bytes) mismatches.push(`asset_manifest: ${asset.path} expected ${asset.bytes} bytes, got ${stat.size}`);
    const actual = await sha256OfFile(assetPath);
    if (actual !== asset.sha256) mismatches.push(`asset_manifest: ${asset.path} expected ${asset.sha256}, got ${actual}`);
  }

  if (identity.render_ready_source_hash) {
    const actualTreeHash = await sha256OfDirectoryTree(renderReadyDir || path.join(dir, "remotion", "render_ready_project"));
    if (actualTreeHash !== identity.render_ready_source_hash)
      mismatches.push(`render_ready_source_hash: expected ${identity.render_ready_source_hash}, got ${actualTreeHash} (render_ready_project directory)`);
  }

  if (mismatches.length)
    throw new Error(`Bundle integrity check failed -- ${mismatches.length} mismatch(es) against the bundle's own frozen_candidate.json:\n- ${mismatches.join("\n- ")}`);

  return {
    ok: true,
    candidate_hash: candidate.candidate_hash,
    render_bundle_hash: candidate.render_bundle_hash,
    checked: fileChecks.filter(([field]) => identity[field]).map(([field]) => field).concat(identity.render_ready_source_hash ? ["render_ready_source_hash"] : []),
    checked_assets: assetManifest.length
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  verifyBundleIntegrity(args["project-id"] || PROJECT_ID, { renderReadyDir: args["render-ready-dir"] || undefined })
    .then((result) => printJson(result))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
