#!/usr/bin/env node
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { resolveProjectId } from "./lib/orvyq-project-profile.mjs";
import { auditFootageSemanticReviews } from "./lib/orvyq-footage-semantic-review.mjs";
import { syncFootageApprovals } from "./orvyq_sync_footage_approvals.mjs";

export async function runFootageSemanticReviewAudit(projectId) {
  const dir = projectDir(projectId);
  await syncFootageApprovals(projectId);
  const [blueprint, reviews] = await Promise.all([
    readJson(path.join(dir, "direction", "editorial_blueprint.json")),
    readJson(path.join(dir, "research", "visual_asset_reviews.json")),
  ]);
  const footageShots = blueprint.full_production.shots
    .filter((shot) => shot.asset_type === "footage");
  const footageAssets = footageShots.map((shot) => shot.asset);
  const provenanceByPath = new Map();
  for (const assetPath of [...new Set(footageAssets)]) {
    try {
      provenanceByPath.set(assetPath, await readJson(path.join(dir, `${assetPath}.provenance.json`)));
    } catch {
      // The pure audit reports this as a missing provenance failure.
    }
  }
  const report = {
    project_id: projectId,
    ...auditFootageSemanticReviews({ footageAssets, footageShots, provenanceByPath, reviews }),
  };
  await writeJsonAtomic(path.join(dir, "qa", "footage_semantic_review_audit.json"), report);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const report = await runFootageSemanticReviewAudit(resolveProjectId(args));
    printJson(report);
    if (!report.pass) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
