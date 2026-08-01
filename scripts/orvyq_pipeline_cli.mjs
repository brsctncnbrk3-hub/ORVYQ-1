#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { parseArgs, printJson } from "./lib/fs-utils.mjs";
import { loadProductionPolicy, resolveProjectId } from "./lib/orvyq-project-profile.mjs";

const AUDIT_SCRIPTS = [
  "scripts/orvyq_evidence_audit.mjs",
  "scripts/orvyq_evidence_spec_audit.mjs",
  "scripts/orvyq_evidence_asset_audit.mjs",
  "scripts/orvyq_semantic_visual_audit.mjs",
  "scripts/orvyq_footage_semantic_review_audit.mjs",
  "scripts/orvyq_visual_rebalance_audit.mjs",
  "scripts/orvyq_pacing_audit.mjs",
  "scripts/orvyq_mobile_legibility_audit.mjs",
  "scripts/orvyq_music_cue_audit.mjs",
  "scripts/orvyq_duplicate_footage_audit.mjs",
  "scripts/orvyq_tension_card_audit.mjs",
  "scripts/orvyq_generic_card_audit.mjs",
  "scripts/orvyq_leaked_instruction_audit.mjs",
  "scripts/orvyq_real_asset_coverage_audit.mjs",
  "scripts/orvyq_retention_question_audit.mjs",
];

const QA_EXTRA_SCRIPTS = [
  "scripts/orvyq_edit_plan_tests.mjs",
  "scripts/orvyq_license_audit.mjs",
  "scripts/orvyq_alignment_score.mjs",
  "scripts/orvyq_parity_check.mjs",
  "scripts/orvyq_music_pause_rise_audit.mjs",
  "scripts/orvyq_duration_parity_audit.mjs",
];

function withoutProjectId(argv) {
  const output = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--project-id=")) continue;
    if (token === "--project-id") {
      index += 1;
      continue;
    }
    output.push(token);
  }
  return output;
}

function runNode(script, projectId, extraArgs = [], { positionalFirst = false } = {}) {
  const projectArg = `--project-id=${projectId}`;
  const argv = positionalFirst
    ? [script, ...extraArgs, projectArg]
    : [script, projectArg, ...extraArgs];
  const result = spawnSync(process.execPath, argv, {
    stdio: "inherit",
    env: { ...process.env, ORVYQ_PROJECT_ID: projectId },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${script} failed with exit code ${result.status}`);
  }
}

export function commandScripts(command) {
  if (command === "audits") return [...AUDIT_SCRIPTS];
  if (command === "qa") return [...AUDIT_SCRIPTS, ...QA_EXTRA_SCRIPTS];
  if (command === "edit-plan") {
    return ["scripts/orvyq_edit_plan.mjs", "scripts/orvyq_creative_polish.mjs"];
  }
  if (command === "audio") {
    return ["scripts/orvyq_audio_mix.mjs", "scripts/orvyq_dynamic_remix.mjs"];
  }
  if (command === "build-render-project") {
    return ["scripts/remotion_build.mjs", "scripts/remotion_build.mjs"];
  }
  return [];
}

export async function runPipelineCommand(command, projectId, extraArgs = []) {
  await loadProductionPolicy(projectId);
  if (command === "build-render-project") {
    runNode("scripts/remotion_build.mjs", projectId, ["derive-configs"], { positionalFirst: true });
    runNode("scripts/remotion_build.mjs", projectId, ["build-project"], { positionalFirst: true });
  } else {
    const scripts = commandScripts(command);
    if (!scripts.length) {
      throw new Error(`Unknown ORVYQ pipeline command: ${command}`);
    }
    for (const script of scripts) runNode(script, projectId, extraArgs);
  }
  return { command, project_id: projectId, pass: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...rawArgs] = process.argv.slice(2);
  const args = parseArgs(rawArgs);
  let projectId;
  try {
    projectId = resolveProjectId(args);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message, code: error.code }));
    process.exitCode = 1;
  }
  if (projectId) {
    runPipelineCommand(command, projectId, withoutProjectId(rawArgs))
      .then((result) => printJson({ ok: true, ...result }))
      .catch((error) => {
        console.error(JSON.stringify({ ok: false, error: error.message }));
        process.exitCode = 1;
      });
  }
}
