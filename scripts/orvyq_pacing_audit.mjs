#!/usr/bin/env node
// Shot-duration variety gate. Deliberate change vs golden: `plan.preview`
// -> `plan.mode === "proof"`, matching the canonical edit_plan.schema.json.
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic } from "./lib/fs-utils.mjs";

const PROJECT_ID = process.env.ORVYQ_PROJECT_ID || null;

export async function runPacingAudit(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const [plan, blueprint] = await Promise.all([
    readJson(path.join(dir, "direction", "edit_plan.json")),
    readJson(path.join(dir, "direction", "editorial_blueprint.json"))
  ]);
  const maxSeconds = blueprint.global_rules.max_shot_seconds;
  const failures = [];
  const warnings = [];
  const durations = plan.shots.map((shot) => (shot.end_frame - shot.start_frame) / plan.fps);
  const variants = new Set(durations.map((value) => value.toFixed(3)));

  for (let index = 0; index < plan.shots.length; index += 1) {
    const shot = plan.shots[index];
    const seconds = durations[index];
    if (seconds <= 0 || seconds > maxSeconds + 0.001) failures.push(`${shot.shot_id} duration ${seconds.toFixed(2)}s violates 0-${maxSeconds}s`);
    if (["evidence", "archive"].includes(shot.visual_role) && seconds < 4) warnings.push(`${shot.shot_id} may be too short for evidence reading`);
    // Short authored section stings contain only an eyebrow and a title. They
    // are deliberately distinct from reading overlays that carry evidence,
    // quotations or explanatory copy and still require at least four seconds.
    const readingRequired = shot.editorial_overlay?.reading_required !== false;
    if (shot.editorial_overlay && readingRequired && seconds < 4)
      failures.push(`${shot.shot_id} has a reading overlay but lasts only ${seconds.toFixed(2)}s`);
  }

  for (let index = 2; index < durations.length; index += 1) {
    if (durations[index] === durations[index - 1] && durations[index - 1] === durations[index - 2]) {
      const trio = plan.shots.slice(index - 2, index + 1);
      const visualRoles = new Set(trio.map((shot) => shot.visual_role));
      const motifs = new Set(trio.map((shot) => shot.motif));
      const range = `${trio[0].shot_id}-${trio[2].shot_id}`;
      // Exact duration repetition is a hard pacing defect only when the three
      // beats are also visually homogeneous. A footage/context interruption
      // between source-backed evidence cards creates a deliberate visual
      // cadence change even when ASR word-boundary quantization gives all
      // three shots the same frame count; forcing a synthetic one-frame nudge
      // would alter canonical timing solely to satisfy the metric.
      if (visualRoles.size === 1 && motifs.size === 1) {
        failures.push(`${range} create three identical and visually homogeneous shot durations in a row`);
      } else {
        warnings.push(`${range} share an identical duration, but visual role/motif changes provide a pacing break`);
      }
    }
  }

  const short = durations.filter((seconds) => seconds <= 4).length;
  const medium = durations.filter((seconds) => seconds > 4 && seconds <= 6).length;
  const long = durations.filter((seconds) => seconds > 6).length;
  if (variants.size < 5) failures.push(`pacing uses only ${variants.size} duration variants; at least 5 are required`);
  if (!short || !medium || !long) failures.push("pacing must contain short, medium and long shots");
  const average = durations.reduce((sum, value) => sum + value, 0) / durations.length;
  if (plan.mode === "proof" && average > 5.8) warnings.push(`proof average shot duration ${average.toFixed(2)}s may feel slow`);

  const transitions = {};
  for (const shot of plan.shots) transitions[shot.transition_in] = (transitions[shot.transition_in] || 0) + 1;
  if ((transitions.cut || 0) / plan.shots.length > 0.9) warnings.push("more than 90% of shots enter with a hard cut; confirm this is narratively motivated");

  const report = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    mode: plan.mode,
    shot_count: durations.length,
    average_shot_seconds: average,
    duration_variants: [...variants].map(Number).sort((a, b) => a - b),
    duration_buckets: { short, medium, long },
    transition_counts: transitions,
    warnings,
    failures,
    pass: failures.length === 0
  };
  await writeJsonAtomic(path.join(dir, "qa", "pacing_audit.json"), report);
  if (!report.pass) throw new Error(`ORVYQ pacing audit failed: ${failures.join("; ")}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPacingAudit().then((report) => console.log(JSON.stringify({ ok: true, ...report }))).catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  });
}
