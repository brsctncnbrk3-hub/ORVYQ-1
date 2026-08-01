#!/usr/bin/env node
import path from "node:path";
import { promises as fs } from "node:fs";
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";

async function exists(file) {
  return fs.access(file).then(() => true, () => false);
}

export async function failClosedPendingFootage(projectId) {
  const dir = projectDir(projectId);
  const runtime = await readJson(path.join(dir, "assets", "footage_acquisition.runtime.json"));
  let normalized = 0;

  for (const record of runtime.records || []) {
    if (!record.path) continue;
    const provenanceFile = path.join(dir, `${record.path}.provenance.json`);
    if (!(await exists(provenanceFile))) throw new Error(`${record.scene_id}: provenance is missing`);
    const provenance = await readJson(provenanceFile);
    const reviewStatus = String(provenance.human_review_status || "");
    const pending = reviewStatus.startsWith("PENDING_") || reviewStatus === "";
    if (!pending || provenance.approved_for_final_edit === false) continue;
    provenance.approved_for_final_edit = false;
    provenance.fail_closed_reason = "Byte-bound contact-sheet and claim-specific semantic review are required before final-edit approval.";
    await writeJsonAtomic(provenanceFile, provenance);
    normalized += 1;
  }

  return { project_id: projectId, normalized_pending_assets: normalized };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args["project-id"] || args.project;
  if (!projectId) throw new Error("--project-id is required");
  printJson(await failClosedPendingFootage(projectId));
}
