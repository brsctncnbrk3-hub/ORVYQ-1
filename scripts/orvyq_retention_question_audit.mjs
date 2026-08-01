#!/usr/bin/env node
import path from "node:path";
import {
  projectDir,
  readJson,
  writeJsonAtomic,
  parseArgs,
  printJson,
} from "./lib/fs-utils.mjs";
import { loadProductionPolicy, resolveProjectId } from "./lib/orvyq-project-profile.mjs";

function shotDurationSeconds(shot, fps) {
  return (Number(shot.end_frame) - Number(shot.start_frame)) / Number(fps);
}

function isHumanFirstShot(shot, hookPolicy) {
  if (!shot) return false;
  if (shot.editorial_role === "human_context" || shot.hook_role === "human_context") return true;
  return Boolean(hookPolicy.first_shot_asset && shot.video_asset === hookPolicy.first_shot_asset);
}

function allowedEvidenceAsset(asset, evidenceLimits) {
  if (!String(asset).startsWith(evidenceLimits.materialized_asset_prefix)) return false;
  const lower = String(asset).toLowerCase();
  return evidenceLimits.allowed_extensions.some((extension) => lower.endsWith(extension));
}

export function auditRetentionQuestions(plan, policy) {
  const failures = [];
  const limits = policy.limits;
  const project = policy.project;
  const hookPolicy = project.hook;
  const rhythmPolicy = project.editorial_rhythm;
  const evidencePolicy = project.opening_evidence;

  const hookShots = (plan.shots || []).filter((shot) => shot.hook_footage === true);
  const hookQuestionShots = hookShots.filter((shot) => shot.hook_question);
  const hookDurationSeconds = hookShots.reduce(
    (sum, shot) => sum + shotDurationSeconds(shot, plan.fps),
    0,
  );

  if (!hookShots.length || hookShots[0].start_frame !== 0) {
    failures.push("Opening motion hook must begin at frame 0");
  }
  if (hookShots.length !== hookPolicy.target_cut_count) {
    failures.push(
      `Project hook profile requires ${hookPolicy.target_cut_count} purposeful cuts, found ${hookShots.length}`,
    );
  }
  const humanFirst = isHumanFirstShot(hookShots[0], hookPolicy);
  if (limits.hook.human_context_first_required && !humanFirst) {
    failures.push("Opening hook must begin with project-authored human context before expanding to systems or institutions");
  }
  if (hookQuestionShots.length !== 1) {
    failures.push(`Opening hook must declare exactly one uninterrupted hook_question, found ${hookQuestionShots.length}`);
  }
  const openingQuestion = hookQuestionShots[0]?.hook_question?.question || "";
  if (!openingQuestion.endsWith("?")) {
    failures.push("Opening retention question must end with '?'");
  }
  const questionMinimum = Number(
    hookPolicy.question_minimum_characters ?? limits.hook.question_minimum_characters,
  );
  const questionMaximum = Number(
    hookPolicy.question_maximum_characters ?? limits.hook.question_maximum_characters,
  );
  if (openingQuestion.length < questionMinimum || openingQuestion.length > questionMaximum) {
    failures.push(
      `Opening retention question must be ${questionMinimum}-${questionMaximum} characters, got ${openingQuestion.length}`,
    );
  }
  if (
    hookDurationSeconds < limits.hook.minimum_duration_seconds
    || hookDurationSeconds > limits.hook.maximum_duration_seconds
  ) {
    failures.push(
      `Opening hook must span ${limits.hook.minimum_duration_seconds}-${limits.hook.maximum_duration_seconds}s, got ${hookDurationSeconds.toFixed(2)}s`,
    );
  }

  const pauseShots = (plan.shots || []).filter((shot) => shot.emphasis_card);
  const pauseQuestions = pauseShots.map((shot) => shot.emphasis_card.title);
  const requiredPauseQuestions = Number(rhythmPolicy.full_pause_target) + Number(rhythmPolicy.brief_accent_target);
  if (pauseQuestions.length !== requiredPauseQuestions) {
    failures.push(
      `Project rhythm requires ${requiredPauseQuestions} authored question beats, found ${pauseQuestions.length}`,
    );
  }
  for (const shot of pauseShots) {
    if (!String(shot.emphasis_card.title || "").endsWith("?")) {
      failures.push(`${shot.shot_id} pause overlay is not a question`);
    }
    if (!shot.emphasis_card.anchor_text) {
      failures.push(`${shot.shot_id} pause question lost its narration anchor`);
    }
  }
  if (new Set(pauseQuestions).size !== pauseQuestions.length) {
    failures.push("Editorial pause questions must be unique");
  }

  const briefMaximum = Number(
    rhythmPolicy.brief_accent_maximum_seconds
      ?? limits.editorial_rhythm.brief_accent_maximum_seconds,
  );
  const briefMinimum = Number(
    rhythmPolicy.brief_accent_minimum_seconds
      ?? limits.editorial_rhythm.brief_accent_minimum_seconds,
  );
  const briefAccentShots = pauseShots.filter(
    (shot) => shotDurationSeconds(shot, plan.fps) <= briefMaximum,
  );
  const fullPauseShots = pauseShots.filter(
    (shot) => shotDurationSeconds(shot, plan.fps) > briefMaximum,
  );
  if (fullPauseShots.length !== rhythmPolicy.full_pause_target) {
    failures.push(
      `Project rhythm requires ${rhythmPolicy.full_pause_target} full pauses, found ${fullPauseShots.length}`,
    );
  }
  if (briefAccentShots.length !== rhythmPolicy.brief_accent_target) {
    failures.push(
      `Project rhythm requires ${rhythmPolicy.brief_accent_target} brief accents, found ${briefAccentShots.length}`,
    );
  }
  for (const shot of briefAccentShots) {
    const seconds = shotDurationSeconds(shot, plan.fps);
    if (seconds < briefMinimum) {
      failures.push(`${shot.shot_id} brief accent is too short to read (${seconds.toFixed(2)}s)`);
    }
  }
  for (const shot of fullPauseShots) {
    const seconds = shotDurationSeconds(shot, plan.fps);
    if (seconds < limits.editorial_rhythm.full_pause_minimum_seconds) {
      failures.push(`${shot.shot_id} full pause is too short (${seconds.toFixed(2)}s)`);
    }
  }

  const hookEndFrame = Math.max(...hookShots.map((entry) => entry.end_frame), 0);
  const firstPostHook = (plan.shots || []).find((shot) => shot.start_frame >= hookEndFrame);
  if (limits.opening_evidence.required && (!firstPostHook || firstPostHook.asset_type !== "evidence")) {
    failures.push("The first post-hook shot must be primary evidence");
  }
  if (firstPostHook?.evidence?.kind !== evidencePolicy.kind) {
    failures.push(
      `Project opening evidence requires kind=${evidencePolicy.kind}, found ${firstPostHook?.evidence?.kind || "missing"}`,
    );
  }
  const documentCount = firstPostHook?.evidence?.image_assets?.length || 0;
  if (documentCount !== evidencePolicy.target_asset_count) {
    failures.push(
      `Project opening evidence requires ${evidencePolicy.target_asset_count} materialized assets, found ${documentCount}`,
    );
  }
  for (const asset of firstPostHook?.evidence?.image_assets || []) {
    if (!allowedEvidenceAsset(asset, limits.opening_evidence)) {
      failures.push(`Opening evidence asset is not a materialized project evidence capture: ${asset}`);
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    hook_duration_seconds: Math.round(hookDurationSeconds * 1000) / 1000,
    opening_question: openingQuestion,
    hook_cut_count: hookShots.length,
    pause_question_count: pauseQuestions.length,
    full_pause_count: fullPauseShots.length,
    brief_accent_count: briefAccentShots.length,
    opening_document_count: documentCount,
    human_first_hook: humanFirst,
  };
}

export async function runRetentionQuestionAudit(projectId) {
  const dir = projectDir(projectId);
  const [plan, policy] = await Promise.all([
    readJson(path.join(dir, "direction", "edit_plan.json")),
    loadProductionPolicy(projectId),
  ]);
  const result = auditRetentionQuestions(plan, policy);
  const report = {
    schema_version: "3.0-project-profile",
    project_id: projectId,
    creative_profile: policy.project.creative_profile,
    ...result,
  };
  await writeJsonAtomic(
    path.join(dir, "qa", "retention_question_audit.json"),
    report,
  );
  if (!result.pass) {
    throw new Error(`Retention-question audit failed:\n- ${result.failures.join("\n- ")}`);
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  let projectId;
  try {
    projectId = resolveProjectId(args);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message, code: error.code }));
    process.exitCode = 1;
  }
  if (projectId) {
    runRetentionQuestionAudit(projectId)
      .then((report) => printJson({ ok: true, ...report }))
      .catch((error) => {
        console.error(JSON.stringify({ ok: false, error: error.message }));
        process.exitCode = 1;
      });
  }
}
