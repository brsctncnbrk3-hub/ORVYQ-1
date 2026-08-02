#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promises as fs } from "node:fs";

const PROJECT_ID = process.argv.find((arg) => arg.startsWith("--project-id="))?.split("=")[1]
  || process.argv[process.argv.indexOf("--project-id") + 1];
if (!PROJECT_ID || PROJECT_ID.startsWith("--")) {
  throw new Error("Usage: node scripts/orvyq_full_production_diagnostic.mjs --project-id <project-id>");
}

const sourcePath = path.resolve("scripts/orvyq_full_production_plan.mjs");
const runtimePath = path.resolve("scripts/.orvyq_full_production_diagnostic_runtime.mjs");
const source = await fs.readFile(sourcePath, "utf8");
const startMarker = "  if (missingCoverage.length) {";
const endMarker = "\n\n  quantizeShotsToFrames(shots);";
const startIndex = source.indexOf(startMarker);
const endIndex = source.indexOf(endMarker, startIndex);
if (startIndex < 0 || endIndex < 0) {
  throw new Error("Could not locate the full-production creative-coverage gate");
}

const replacement = `  if (missingCoverage.length) {
    const diagnosticShots = shots.map((shot, index) => ({
      index,
      shot_id: shot.shot_id || null,
      claim_id: shot.claim_id || null,
      section_id: shot.section_id || null,
      source_slice_index: shot.source_slice_index ?? shot.sourceSliceIndex ?? null,
      start_time_seconds: shot.start_time_seconds ?? shot.start ?? null,
      end_time_seconds: shot.end_time_seconds ?? shot.end ?? null,
      duration_seconds: shot.duration ?? null,
      asset_type: shot.asset_type || null,
      asset: shot.asset || null,
      visual_role: shot.visual_role || shot.role || null,
      evidence_kind: shot.evidence_kind || shot.evidenceKind || null,
      narration_anchor: shot.narration_anchor || null,
      emphasis_card: shot.emphasis_card || null,
      trim_in_sec: shot.trim_in_sec ?? null,
      trim_out_sec: shot.trim_out_sec ?? null,
    }));
    await writeJsonAtomic(path.join(dir, "qa", "full_production_coverage_diagnostic.json"), {
      schema_version: "1.0",
      project_id: projectId,
      generated_at: new Date().toISOString(),
      max_uninterrupted_evidence_seconds: MAX_EVIDENCE_RUN_SECONDS,
      missing_coverage: missingCoverage,
      shot_count: diagnosticShots.length,
      claim_slice_counts: Object.fromEntries(
        [...new Set(diagnosticShots.map((shot) => shot.claim_id).filter(Boolean))].map((claimId) => [
          claimId,
          new Set(
            diagnosticShots
              .filter((shot) => shot.claim_id === claimId && Number.isInteger(shot.source_slice_index))
              .map((shot) => shot.source_slice_index),
          ).size,
        ]),
      ),
      shots: diagnosticShots,
    });
    throw new Error(\`Full production plan has \${missingCoverage.length} unresolved creative-coverage gap(s):\\n- \${missingCoverage.join("\\n- ")}\`);
  }`;

const instrumented = `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex)}`;
await fs.writeFile(runtimePath, instrumented);
try {
  const runtimeModule = await import(`${pathToFileURL(runtimePath).href}?diagnostic=${Date.now()}`);
  await runtimeModule.buildFullProductionPlan(PROJECT_ID);
} finally {
  await fs.rm(runtimePath, { force: true });
}
