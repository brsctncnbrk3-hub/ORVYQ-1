#!/usr/bin/env node
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";

const PROJECT_ID = process.env.ORVYQ_PROJECT_ID || null;

const EXACT_REWRITES = new Map([
  [
    "dated release/compute/market evidence, no decorative stock ticker",
    "dated release, compute, and market evidence"
  ]
]);

function rewriteVisibleText(value) {
  if (typeof value !== "string") return value;
  return EXACT_REWRITES.get(value) ?? value;
}

export function sanitizeViewerText(plan) {
  let rewrites = 0;
  for (const shot of plan.shots || []) {
    if (shot.asset_type === "graphic" && shot.graphic) {
      for (const key of ["kicker", "title", "subtitle"]) {
        const next = rewriteVisibleText(shot.graphic[key]);
        if (next !== shot.graphic[key]) {
          shot.graphic[key] = next;
          rewrites += 1;
        }
      }
      if (Array.isArray(shot.graphic.labels)) {
        shot.graphic.labels = shot.graphic.labels.map((label) => {
          const next = rewriteVisibleText(label);
          if (next !== label) rewrites += 1;
          return next;
        });
      }
    }
  }
  return { plan, rewrites };
}

export async function runViewerTextSanitize(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const planPath = path.join(dir, "direction", "edit_plan.json");
  const plan = await readJson(planPath);
  const result = sanitizeViewerText(plan);
  await writeJsonAtomic(planPath, result.plan);
  return { schema_version: "1.0", project_id: projectId, rewrites: result.rewrites };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  runViewerTextSanitize(args["project-id"] || PROJECT_ID)
    .then((report) => printJson({ ok: true, ...report }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
