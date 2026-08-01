#!/usr/bin/env node
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  projectDir,
  readJson,
  writeJsonAtomic,
  parseArgs,
  printJson,
} from "./lib/fs-utils.mjs";

async function exists(file) {
  return fs.access(file).then(() => true, () => false);
}

export async function pruneOrphanFootage(projectId) {
  const dir = projectDir(projectId);
  const runtimeFile = path.join(dir, "assets", "footage_acquisition.runtime.json");
  const localAssetsFile = path.join(dir, "assets", "local_assets.json");
  const contactManifestFile = path.join(dir, "qa", "footage_contact_sheets.json");
  const [runtime, localAssets, contactManifest] = await Promise.all([
    readJson(runtimeFile),
    readJson(localAssetsFile),
    readJson(contactManifestFile),
  ]);
  const activePaths = new Set((runtime.records || []).map((record) => record.path));
  const activeScenes = new Set((runtime.records || []).map((record) => record.scene_id));
  const footageDir = path.join(dir, "assets", "footage");
  const contactDir = path.join(dir, "qa", "footage-contact-sheets");

  let removedMedia = 0;
  let removedProvenance = 0;
  for (const name of await fs.readdir(footageDir)) {
    if (!name.endsWith(".mp4")) continue;
    const relative = `assets/footage/${name}`;
    if (activePaths.has(relative)) continue;
    await fs.rm(path.join(footageDir, name), { force: true });
    removedMedia += 1;
    const provenance = path.join(footageDir, `${name}.provenance.json`);
    if (await exists(provenance)) {
      await fs.rm(provenance, { force: true });
      removedProvenance += 1;
    }
  }

  let removedContactSheets = 0;
  if (await exists(contactDir)) {
    for (const name of await fs.readdir(contactDir)) {
      const match = name.match(/^(scene_[0-9]{3})\.jpg$/);
      if (!match || activeScenes.has(match[1])) continue;
      await fs.rm(path.join(contactDir, name), { force: true });
      removedContactSheets += 1;
    }
  }

  const nextLocalAssets = {
    ...localAssets,
    assets: (runtime.records || []).map((record) => ({ path: record.path })),
  };
  const nextContactManifest = {
    ...contactManifest,
    entries: (contactManifest.entries || []).filter((entry) => activeScenes.has(entry.scene_id)),
  };
  nextContactManifest.generated_at = new Date().toISOString();

  await Promise.all([
    writeJsonAtomic(localAssetsFile, nextLocalAssets),
    writeJsonAtomic(contactManifestFile, nextContactManifest),
  ]);
  return {
    project_id: projectId,
    active_assets: activePaths.size,
    removed_media: removedMedia,
    removed_provenance: removedProvenance,
    removed_contact_sheets: removedContactSheets,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args["project-id"] || args.project;
  if (!projectId) throw new Error("--project-id is required");
  pruneOrphanFootage(projectId)
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
