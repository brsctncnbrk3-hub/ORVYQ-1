#!/usr/bin/env node
import path from "node:path";
import { projectDir, readJson, readJsonSafe, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { collectRejectedProviderAssetIds } from "./orvyq_acquire_footage_demand.mjs";
import { resolveCandidateStage } from "./lib/orvyq-footage-candidates.mjs";

export async function footageCandidateStage(projectId) {
  const dir = projectDir(projectId);
  const [plan, semantic, reviews, shortlist, selection] = await Promise.all([
    readJson(path.join(dir, "research", "footage_acquisition_plan.json")),
    readJsonSafe(path.join(dir, "research", "footage_semantic_constraints.json"), { scenes: {} }),
    readJsonSafe(path.join(dir, "research", "visual_asset_reviews.json"), { rejected_assets: [] }),
    readJsonSafe(path.join(dir, "research", "footage_candidate_shortlist.json"), null),
    readJsonSafe(path.join(dir, "research", "footage_candidate_selection.json"), null),
  ]);
  if (plan.project_id !== projectId) throw new Error(`footage_acquisition_plan project_id does not match ${projectId}`);
  const rejectedProviderAssetIds = collectRejectedProviderAssetIds(semantic, reviews);
  return { project_id: projectId, ...resolveCandidateStage({ plan, shortlist, selection, rejectedProviderAssetIds }) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args["project-id"] || args.project;
  if (!projectId) throw new Error("--project-id is required");
  footageCandidateStage(projectId)
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
