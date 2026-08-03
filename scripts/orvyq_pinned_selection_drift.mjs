#!/usr/bin/env node
// Reports every scene whose acquired clip is not the clip its inspection
// round pinned.
//
// The acquisition workflow decides whether to re-download by comparing a
// planned count against an acquired count. Those two numbers match perfectly
// while every single file is the wrong one, which is the state project 004
// was in: 31 of 34 scenes held a provider asset no inspection note describes.
// Drift is therefore its own signal, read from the same two files acquisition
// itself writes.
import path from "node:path";
import { projectDir, readJson, readJsonSafe, pathExists, parseArgs, printJson } from "./lib/fs-utils.mjs";

const PROJECT_ID = process.env.ORVYQ_PROJECT_ID || null;

/** The provider asset a scene's plan entry pins, if it pins one at all. */
export function pinnedProviderAssetId(asset) {
  const inspected = String(asset?.inspected_selection?.provider_asset_id || "").trim();
  if (inspected) return inspected;
  const ids = (asset?.provider_asset_ids || []).map(String).map((id) => id.trim()).filter(Boolean);
  return ids.length === 1 ? ids[0] : "";
}

export function collectPinnedSelectionDrift({ acquisitionPlan, runtime, provenanceByScene }) {
  const recordByScene = new Map((runtime?.records || []).map((record) => [String(record.scene_id), record]));
  const drifted = [];
  const unpinned = [];
  for (const asset of acquisitionPlan?.assets || []) {
    const sceneId = String(asset?.scene_id || "").trim();
    if (!sceneId) continue;
    const pinned = pinnedProviderAssetId(asset);
    if (!pinned) {
      unpinned.push(sceneId);
      continue;
    }
    // A scene with nothing acquired is already counted as missing by the
    // planned-vs-actual check; reporting it again as drift would double-count.
    if (!recordByScene.has(sceneId)) continue;
    const actual = String(provenanceByScene.get(sceneId) || "").trim();
    if (!actual || actual === pinned) continue;
    drifted.push({ scene_id: sceneId, pinned_provider_asset_id: pinned, acquired_provider_asset_id: actual });
  }
  return { drifted, unpinned };
}

export async function reportPinnedSelectionDrift(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const [acquisitionPlan, runtime] = await Promise.all([
    readJson(path.join(dir, "research", "footage_acquisition_plan.json")),
    readJsonSafe(path.join(dir, "assets", "footage_acquisition.runtime.json"), { records: [] }),
  ]);
  const provenanceByScene = new Map();
  for (const record of runtime.records || []) {
    const provenanceFile = path.join(dir, `${record.path}.provenance.json`);
    if (!(await pathExists(provenanceFile))) continue;
    const provenance = await readJson(provenanceFile);
    provenanceByScene.set(String(record.scene_id), String(provenance.provider_asset_id || ""));
  }
  const { drifted, unpinned } = collectPinnedSelectionDrift({ acquisitionPlan, runtime, provenanceByScene });
  return {
    project_id: projectId,
    drifted_scene_ids: drifted.map((entry) => entry.scene_id),
    drift: drifted,
    unpinned_scene_ids: unpinned,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  reportPinnedSelectionDrift(args["project-id"] || args.project || PROJECT_ID)
    .then((report) => printJson(report))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
