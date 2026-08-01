#!/usr/bin/env node
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { loadProductionPolicy, resolveProjectId } from "./lib/orvyq-project-profile.mjs";

const IMAGE_EVIDENCE_KINDS = new Set([
  "split_documents",
  "official_document",
  "official_figure",
  "official_screen",
  "image_sequence",
  "recap",
]);

function durationSeconds(shot, fps) {
  return (Number(shot.end_frame) - Number(shot.start_frame)) / Number(fps);
}

export function maximumContiguousSameFootageSeconds(shots, fps) {
  let maximum = 0;
  let currentAsset = null;
  let currentSeconds = 0;
  for (const shot of shots) {
    if (shot.asset_type !== "footage") {
      currentAsset = null;
      currentSeconds = 0;
      continue;
    }
    const seconds = durationSeconds(shot, fps);
    if (shot.video_asset === currentAsset) currentSeconds += seconds;
    else {
      currentAsset = shot.video_asset;
      currentSeconds = seconds;
    }
    maximum = Math.max(maximum, currentSeconds);
  }
  return Math.round(maximum * 1000) / 1000;
}

export function normalizeFootageReplacements(profile) {
  return (profile?.creative_polish?.footage_replacements || []).map((entry) => ({
    shotId: entry.shot_id,
    asset: entry.asset,
    trimIn: Number(entry.trim_in_seconds || 0),
    motion: entry.motion || "hold",
    reason: entry.reason,
  }));
}

function sourceUsageFor(shots) {
  const usage = new Map();
  let previousFootage = null;
  for (const shot of shots) {
    if (shot.asset_type === "evidence") {
      for (const asset of shot.evidence?.image_assets || []) usage.set(asset, (usage.get(asset) || 0) + 1);
      previousFootage = null;
      continue;
    }
    if (shot.asset_type !== "footage") {
      previousFootage = null;
      continue;
    }
    const continuation = previousFootage?.asset === shot.video_asset
      && Math.abs(Number(previousFootage.trimOut) - Number(shot.trim_in_sec)) < 0.03;
    if (!continuation) usage.set(shot.video_asset, (usage.get(shot.video_asset) || 0) + 1);
    previousFootage = { asset: shot.video_asset, trimOut: shot.trim_out_sec };
  }
  return usage;
}

async function applyFootageReplacements(dir, plan, replacements) {
  const applied = [];
  for (const replacement of replacements) {
    const shot = plan.shots.find((entry) => entry.shot_id === replacement.shotId);
    if (!shot) throw new Error(`Creative polish replacement target is missing: ${replacement.shotId}`);
    if (shot.asset_type !== "footage") throw new Error(`Creative polish target ${replacement.shotId} is not footage`);
    const seconds = durationSeconds(shot, plan.fps);
    const provenance = await readJson(path.join(dir, `${replacement.asset}.provenance.json`));
    if (!provenance.approved_for_final_edit || !provenance.license_url) {
      throw new Error(`${replacement.asset} is not licensed and approved`);
    }
    const sourceDuration = Number(provenance.actual_duration_seconds || provenance.duration);
    const trimOut = replacement.trimIn + seconds;
    if (!Number.isFinite(sourceDuration) || trimOut > sourceDuration + 0.02) {
      throw new Error(`${replacement.shotId} replacement overruns ${replacement.asset}: ${trimOut}s > ${sourceDuration}s`);
    }
    const previousAsset = shot.video_asset;
    shot.video_asset = replacement.asset;
    shot.motif = replacement.asset;
    shot.trim_in_sec = Math.round(replacement.trimIn * 1000) / 1000;
    shot.trim_out_sec = Math.round(trimOut * 1000) / 1000;
    shot.motion_variant = replacement.motion;
    shot.reuse_reason = replacement.reason;
    applied.push({
      shot_id: replacement.shotId,
      previous_asset: previousAsset,
      replacement_asset: replacement.asset,
    });
  }
  return applied;
}

function applyEvidenceAndGraphicPolish(plan, minimumMobileFontPx) {
  let evidenceIndex = 0;
  const presentationCounts = {};
  for (const shot of plan.shots) {
    if (shot.asset_type === "evidence" && shot.evidence) {
      const presentation = IMAGE_EVIDENCE_KINDS.has(shot.evidence.kind)
        ? "cinematic_source"
        : evidenceIndex % 2 === 0
          ? "cinematic_field"
          : "cinematic_split";
      shot.evidence.presentation = presentation;
      shot.evidence.font_px = Math.max(minimumMobileFontPx, Number(shot.evidence.font_px) || 0);
      shot.evidence.density = "reduced";
      presentationCounts[presentation] = (presentationCounts[presentation] || 0) + 1;
      evidenceIndex += 1;
    } else if (shot.asset_type === "graphic" && shot.graphic) {
      shot.graphic.presentation = "cinematic";
      shot.graphic.mobile_font_px = minimumMobileFontPx;
    }
  }
  return presentationCounts;
}

async function applyRetentionQuestions(dir, plan, policy) {
  const [motionHook, resolvedPausePlan] = await Promise.all([
    readJson(path.join(dir, "direction", "motion_hook.json")),
    readJson(path.join(dir, "direction", "resolved_pause_plan.json")),
  ]);

  const hookShots = plan.shots.filter((shot) => shot.hook_footage === true);
  if (!hookShots.length) throw new Error("Creative polish could not find the opening motion-hook shots");
  if (!motionHook.question || !String(motionHook.question).trim().endsWith("?")) {
    throw new Error("direction/motion_hook.json requires a retention question ending with '?'");
  }
  hookShots[0].editorial_role = policy.project.hook.first_shot_role || hookShots[0].editorial_role;
  hookShots[0].hook_question = {
    eyebrow: motionHook.question_eyebrow || "THE QUESTION",
    question: String(motionHook.question).trim(),
    deck: motionHook.question_deck || null,
  };

  const questionsByAnchor = new Map(
    (resolvedPausePlan.pauses || [])
      .filter((pause) => pause.question)
      .map((pause) => [pause.anchor_text, pause.question]),
  );
  const briefMaximum = Number(
    policy.project.editorial_rhythm.brief_accent_maximum_seconds
      ?? policy.limits.editorial_rhythm.brief_accent_maximum_seconds,
  );
  let pauseQuestionCount = 0;
  let fullPauseCount = 0;
  let briefAccentCount = 0;
  for (const shot of plan.shots) {
    if (!shot.emphasis_card) continue;
    const anchorText = shot.emphasis_card.anchor_text || shot.emphasis_card.title;
    const question = questionsByAnchor.get(anchorText);
    if (!question) throw new Error(`No authored retention question resolved for pause anchor: ${anchorText}`);
    const isBriefAccent = durationSeconds(shot, plan.fps) <= briefMaximum;
    shot.emphasis_card = {
      ...shot.emphasis_card,
      eyebrow: isBriefAccent ? "CONSIDER" : "THE QUESTION",
      title: question,
      anchor_text: anchorText,
      accent: shot.emphasis_card.accent || "#E06A63",
    };
    if (isBriefAccent) briefAccentCount += 1;
    else fullPauseCount += 1;
    pauseQuestionCount += 1;
  }
  if (pauseQuestionCount !== questionsByAnchor.size) {
    throw new Error(`Retention-question count mismatch: applied ${pauseQuestionCount}, resolved ${questionsByAnchor.size}`);
  }

  const expectedFull = Number(policy.project.editorial_rhythm.full_pause_target);
  const expectedBrief = Number(policy.project.editorial_rhythm.brief_accent_target);
  if (fullPauseCount !== expectedFull || briefAccentCount !== expectedBrief) {
    throw new Error(
      `Project pause profile mismatch: expected ${expectedFull} full pauses + ${expectedBrief} brief accents, got ${fullPauseCount} + ${briefAccentCount}`,
    );
  }

  return {
    opening_question: hookShots[0].hook_question.question,
    opening_hook_frames: hookShots.reduce((sum, shot) => sum + shot.end_frame - shot.start_frame, 0),
    pause_question_count: pauseQuestionCount,
    full_pause_count: fullPauseCount,
    brief_accent_count: briefAccentCount,
  };
}

export async function polishCreativePlan(projectId) {
  const policy = await loadProductionPolicy(projectId);
  const dir = projectDir(projectId);
  const editPlanPath = path.join(dir, "direction", "edit_plan.json");
  const plan = await readJson(editPlanPath);
  if (!Array.isArray(plan.shots) || !plan.shots.length) {
    throw new Error("Creative polish requires a built direction/edit_plan.json");
  }

  const minimumMobileFontPx = Number(policy.limits.minimum_mobile_font_px);
  const maximumUsesPerSource = Number(policy.limits.maximum_uses_per_source);
  const replacementsToApply = normalizeFootageReplacements(policy.project);
  const beforeMaximum = maximumContiguousSameFootageSeconds(plan.shots, plan.fps);
  const replacements = await applyFootageReplacements(dir, plan, replacementsToApply);
  const presentationCounts = applyEvidenceAndGraphicPolish(plan, minimumMobileFontPx);
  const retention = await applyRetentionQuestions(dir, plan, policy);
  const usage = sourceUsageFor(plan.shots);
  const overused = [...usage.entries()].filter(([, count]) => count > maximumUsesPerSource);
  if (overused.length) {
    throw new Error(
      `Creative polish exceeds source-use limits: ${overused.map(([asset, count]) => `${asset}=${count}`).join(", ")}`,
    );
  }

  plan.source_usage = Object.fromEntries([...usage.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  const afterMaximum = maximumContiguousSameFootageSeconds(plan.shots, plan.fps);
  plan.quality_policy = {
    ...plan.quality_policy,
    minimum_overlay_font_px: minimumMobileFontPx,
    creative_polish_profile: policy.project.creative_profile,
    maximum_contiguous_same_footage_seconds: afterMaximum,
    evidence_presentation_modes: presentationCounts,
    opening_retention_question_required: true,
    opening_human_context_required: policy.limits.hook.human_context_first_required,
    opening_evidence_kind: policy.project.opening_evidence.kind,
    editorial_pause_questions_required: true,
    editorial_pause_profile: `${policy.project.editorial_rhythm.full_pause_target}-full-${policy.project.editorial_rhythm.brief_accent_target}-brief`,
  };

  if (
    policy.project.creative_polish?.require_repetition_reduction
    && replacementsToApply.length > 0
    && afterMaximum >= beforeMaximum
  ) {
    throw new Error(
      `Creative polish did not reduce the maximum repeated-footage run (${beforeMaximum}s -> ${afterMaximum}s)`,
    );
  }

  const report = {
    schema_version: "3.0-project-profile",
    project_id: projectId,
    creative_profile: policy.project.creative_profile,
    source_review_run_id: policy.project.creative_polish?.source_review_run_id || null,
    replacement_count: replacements.length,
    replacements,
    maximum_contiguous_same_footage_seconds_before: beforeMaximum,
    maximum_contiguous_same_footage_seconds_after: afterMaximum,
    minimum_mobile_font_px: minimumMobileFontPx,
    evidence_presentation_modes: presentationCounts,
    retention,
    final_source_usage: plan.source_usage,
  };
  await writeJsonAtomic(editPlanPath, plan);
  await writeJsonAtomic(path.join(dir, "qa", "creative_polish_report.json"), report);
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
    polishCreativePlan(projectId)
      .then((report) => printJson({ ok: true, ...report }))
      .catch((error) => {
        console.error(JSON.stringify({ ok: false, error: error.message }));
        process.exitCode = 1;
      });
  }
}
