#!/usr/bin/env node
import path from "node:path";
import { projectDir, readJson, readJsonSafe, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { resolveProjectId } from "./lib/orvyq-project-profile.mjs";
import { auditVisualRebalancePlan } from "./lib/orvyq-visual-rebalance.mjs";

export async function runVisualRebalanceAudit(projectId) {
  const dir = projectDir(projectId);
  const [blueprint, plan, requestManifest] = await Promise.all([
    readJson(path.join(dir, "direction", "editorial_blueprint.json")),
    readJsonSafe(path.join(dir, "direction", "visual_rebalance_plan.json"), null),
    readJsonSafe(path.join(dir, "research", "visual_asset_requests.json"), { requests: [] }),
  ]);
  if (!plan) {
    const report = {
      project_id: projectId,
      pass: true,
      applicable: false,
      reason: "No migration rebalance plan; the canonical semantic visual audit remains mandatory.",
    };
    await writeJsonAtomic(path.join(dir, "qa", "visual_rebalance_audit.json"), report);
    return report;
  }
  const report = {
    project_id: projectId,
    applicable: true,
    ...auditVisualRebalancePlan(
      {
        shots: blueprint.full_production.shots,
        plan,
        assetRequests: requestManifest.requests,
      },
      blueprint.global_rules,
    ),
  };
  await writeJsonAtomic(path.join(dir, "qa", "visual_rebalance_audit.json"), report);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const projectId = resolveProjectId(args);
    const report = await runVisualRebalanceAudit(projectId);
    printJson(report);
    if (!report.pass) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
