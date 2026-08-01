#!/usr/bin/env node
// Generic full-screen typography/title card gate (task section 4.2 / 8.3).
// Reads direction/edit_plan.json's real shots -- no separate data model.
//
// Distinct from scripts/orvyq_tension_card_audit.mjs: that script governs
// PAUSE-DRIVEN emphasis beats specifically (their own duration/typical-band/
// title-uniqueness budget), explicitly excluding structural graphics
// (section_title/end_card/claim_recap_card) from its own count. This script
// measures the OTHER thing task section 4.2 asks for: the total screen time
// every asset_type "graphic" shot takes up film-wide and per-section --
// section titles, recap cards, and the end card all count here, since they
// are exactly the "generic full-screen typography" the rejected review's
// giant CONTEXT cards came from (confirmed root cause, see the commit that
// added spec.mode to templates/remotion/src/OrvyqGraphic.tsx).
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";

const PROJECT_ID = process.env.ORVYQ_PROJECT_ID || null;
// Task section 4.2's explicit ceiling. Whole-film.
const MAX_GENERIC_CARD_FRACTION = 0.08;
// Task section 4.2: "<= 12% within any individual section."
const MAX_SECTION_GENERIC_CARD_FRACTION = 0.12;

function shotDuration(shot, fps) {
  return (shot.end_frame - shot.start_frame) / fps;
}

export function auditGenericCards(shots, fps) {
  const failures = [];
  const warnings = [];
  const totalDuration = shots.reduce((sum, shot) => sum + shotDuration(shot, fps), 0);

  const genericDurations = shots.map((shot) => (shot.asset_type === "graphic" ? shotDuration(shot, fps) : 0));
  const genericTotal = genericDurations.reduce((sum, d) => sum + d, 0);
  const genericFraction = totalDuration > 0 ? genericTotal / totalDuration : 0;

  if (genericFraction > MAX_GENERIC_CARD_FRACTION) {
    failures.push(
      `generic full-screen graphic cards are ${(genericFraction * 100).toFixed(1)}% of the film (${genericTotal.toFixed(1)}s of ${totalDuration.toFixed(1)}s), over the ${(MAX_GENERIC_CARD_FRACTION * 100).toFixed(0)}% ceiling`
    );
  }

  // No two generic typography cards may appear consecutively (task 4.2).
  for (let i = 1; i < shots.length; i += 1) {
    if (shots[i].asset_type === "graphic" && shots[i - 1].asset_type === "graphic") {
      failures.push(`${shots[i - 1].shot_id} and ${shots[i].shot_id} are two consecutive generic graphic cards -- a real evidence or footage shot must separate them`);
    }
  }

  // Per-section fraction.
  const sectionDurations = new Map();
  const sectionGenericDurations = new Map();
  for (const shot of shots) {
    const sectionId = shot.section_id || "(no section)";
    const duration = shotDuration(shot, fps);
    sectionDurations.set(sectionId, (sectionDurations.get(sectionId) || 0) + duration);
    if (shot.asset_type === "graphic") sectionGenericDurations.set(sectionId, (sectionGenericDurations.get(sectionId) || 0) + duration);
  }
  const sectionReport = [];
  for (const [sectionId, sectionTotal] of sectionDurations.entries()) {
    const sectionGeneric = sectionGenericDurations.get(sectionId) || 0;
    const fraction = sectionTotal > 0 ? sectionGeneric / sectionTotal : 0;
    sectionReport.push({ section_id: sectionId, generic_seconds: Math.round(sectionGeneric * 1000) / 1000, section_seconds: Math.round(sectionTotal * 1000) / 1000, generic_fraction: Math.round(fraction * 1000) / 1000 });
    if (fraction > MAX_SECTION_GENERIC_CARD_FRACTION) {
      failures.push(`section ${sectionId} is ${(fraction * 100).toFixed(1)}% generic graphic cards, over the ${(MAX_SECTION_GENERIC_CARD_FRACTION * 100).toFixed(0)}% per-section ceiling`);
    }
  }

  // Every graphic shot's own identity, in film order -- lets a human (or a
  // future editorial pass) see exactly which section_title/claim_recap_card/
  // end_card shots make up the totals above, without needing the full
  // edit_plan.json alongside this report.
  const graphicShots = shots
    .filter((shot) => shot.asset_type === "graphic")
    .map((shot) => ({
      shot_id: shot.shot_id,
      claim_id: shot.claim_id,
      section_id: shot.section_id,
      duration_seconds: Math.round(shotDuration(shot, fps) * 1000) / 1000,
      graphic_type: shot.graphic?.type || null,
      title: shot.graphic?.title || null
    }));

  return {
    total_seconds: Math.round(totalDuration * 1000) / 1000,
    generic_card_seconds: Math.round(genericTotal * 1000) / 1000,
    generic_card_fraction: Math.round(genericFraction * 1000) / 1000,
    sections: sectionReport,
    graphic_shots: graphicShots,
    failures,
    warnings
  };
}

export async function runGenericCardAudit(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const plan = await readJson(path.join(dir, "direction", "edit_plan.json"));
  const result = auditGenericCards(plan.shots, plan.fps);
  const report = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    max_generic_card_fraction: MAX_GENERIC_CARD_FRACTION,
    max_section_generic_card_fraction: MAX_SECTION_GENERIC_CARD_FRACTION,
    ...result,
    pass: result.failures.length === 0
  };
  await writeJsonAtomic(path.join(dir, "qa", "generic_card_audit.json"), report);
  if (!report.pass) {
    // The report (including the graphic_shots breakdown above) is already
    // written to qa/generic_card_audit.json, but that file only reaches a
    // human via the validation-reports artifact. Attaching it to the thrown
    // error surfaces the same detail directly in this step's own CI log
    // output -- no artifact download required to diagnose a real failure.
    const error = new Error(`ORVYQ generic card audit failed: ${result.failures.join("; ")}`);
    error.report = report;
    throw error;
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  runGenericCardAudit(args["project-id"] || PROJECT_ID)
    .then((report) => printJson({ ok: true, ...report }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message, report: error.report || null }));
      process.exitCode = 1;
    });
}
