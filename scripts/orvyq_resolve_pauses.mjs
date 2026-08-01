#!/usr/bin/env node
// resolveCanonicalPausePlan() -- the single place full_film_pause_anchors
// (direction/editorial_pause_map.json) get resolved against real per-word
// ASR timestamps (voice/narration_alignment.json) into real
// source_time_seconds values.
//
// Before this script existed, scripts/orvyq_audio_mix.mjs and
// scripts/orvyq_full_production_plan.mjs each loaded the same two input
// files and called resolveFullFilmPauses() independently -- functionally
// harmless (both reads are pure and deterministic against the same inputs,
// so they always agreed), but it meant "the pause plan" had no single
// artifact a human or a QA script could inspect, and any future drift in
// either call site's inputs could silently diverge the two. This script
// resolves once and writes direction/resolved_pause_plan.json; both
// consumers now read that file instead of calling the resolver themselves.
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { resolveFullFilmPauses } from "./lib/orvyq-pause-resolver.mjs";

const PROJECT_ID = process.env.ORVYQ_PROJECT_ID || null;

export async function resolveCanonicalPausePlan(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const [pauseMap, alignment] = await Promise.all([
    readJson(path.join(dir, "direction", "editorial_pause_map.json")),
    readJson(path.join(dir, "voice", "narration_alignment.json"))
  ]);
  const anchors = pauseMap.full_film_pause_anchors || [];
  if (!anchors.length) throw new Error("direction/editorial_pause_map.json has no full_film_pause_anchors to resolve");

  const { pauses, narrationEndSeconds } = resolveFullFilmPauses({ words: alignment.words, anchors });

  const plan = {
    schema_version: "1.0-resolved-pause-plan",
    project_id: projectId,
    source_pause_map: "direction/editorial_pause_map.json",
    source_alignment: "voice/narration_alignment.json",
    narration_end_seconds: Math.round(narrationEndSeconds * 1000) / 1000,
    pauses
  };

  await writeJsonAtomic(path.join(dir, "direction", "resolved_pause_plan.json"), plan);
  return plan;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  resolveCanonicalPausePlan(args["project-id"] || PROJECT_ID)
    .then((plan) =>
      printJson({
        ok: true,
        pause_count: plan.pauses.length,
        narration_end_seconds: plan.narration_end_seconds,
        total_pause_seconds: Math.round(plan.pauses.reduce((sum, pause) => sum + pause.duration_seconds, 0) * 1000) / 1000,
        output: "direction/resolved_pause_plan.json"
      })
    )
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
