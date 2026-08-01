import test from "node:test";
import assert from "node:assert/strict";
import { auditRetentionQuestions } from "./orvyq_retention_question_audit.mjs";

const limits = {
  hook: {
    minimum_duration_seconds: 8,
    maximum_duration_seconds: 15,
    question_minimum_characters: 25,
    question_maximum_characters: 120,
    human_context_first_required: true,
  },
  editorial_rhythm: {
    brief_accent_minimum_seconds: 1.5,
    brief_accent_maximum_seconds: 3,
    full_pause_minimum_seconds: 3,
  },
  opening_evidence: {
    required: true,
    materialized_asset_prefix: "assets/evidence/",
    allowed_extensions: [".png", ".jpg", ".jpeg", ".webp"],
  },
};

function policy(overrides = {}) {
  return {
    limits,
    project: {
      hook: {
        first_shot_role: "human_context",
        first_shot_asset: null,
        target_cut_count: 4,
        target_duration_seconds: 11,
        question_minimum_characters: 35,
        question_maximum_characters: 90,
        ...(overrides.hook || {}),
      },
      editorial_rhythm: {
        full_pause_target: 3,
        brief_accent_target: 4,
        brief_accent_minimum_seconds: 1.5,
        brief_accent_maximum_seconds: 3,
        ...(overrides.editorial_rhythm || {}),
      },
      opening_evidence: {
        kind: "split_documents",
        target_asset_count: 2,
        ...(overrides.opening_evidence || {}),
      },
    },
  };
}

function validPlan(projectPolicy) {
  const hookQuestion = {
    eyebrow: "THE QUESTION",
    question: "What happens when progress outruns our ability to govern it?",
    deck: "The stakes arrive before the rules.",
  };
  const cutCount = projectPolicy.project.hook.target_cut_count;
  const totalHookFrames = 330;
  const baseCutFrames = Math.floor(totalHookFrames / cutCount);
  const shots = [];
  let cursor = 0;
  for (let index = 0; index < cutCount; index += 1) {
    const end = index === cutCount - 1 ? totalHookFrames : cursor + baseCutFrames;
    shots.push({
      shot_id: `shot_${String(index + 1).padStart(3, "0")}`,
      start_frame: cursor,
      end_frame: end,
      hook_footage: true,
      asset_type: "footage",
      video_asset: `assets/footage/hook-${index + 1}.mp4`,
      editorial_role: index === 0 ? "human_context" : "systems_context",
      ...(index === 0 ? { hook_question: hookQuestion } : {}),
    });
    cursor = end;
  }

  const evidenceAssets = Array.from(
    { length: projectPolicy.project.opening_evidence.target_asset_count },
    (_, index) => `assets/evidence/source-${index + 1}.png`,
  );
  shots.push({
    shot_id: `shot_${String(shots.length + 1).padStart(3, "0")}`,
    start_frame: cursor,
    end_frame: cursor + 180,
    asset_type: "evidence",
    evidence: {
      kind: projectPolicy.project.opening_evidence.kind,
      image_assets: evidenceAssets,
    },
  });
  cursor += 180;

  const durations = [
    ...Array(projectPolicy.project.editorial_rhythm.full_pause_target).fill(120),
    ...Array(projectPolicy.project.editorial_rhythm.brief_accent_target).fill(60),
  ];
  for (let index = 0; index < durations.length; index += 1) {
    const duration = durations[index];
    shots.push({
      shot_id: `shot_${String(shots.length + 1).padStart(3, "0")}`,
      start_frame: cursor,
      end_frame: cursor + duration,
      asset_type: "footage",
      emphasis_card: {
        eyebrow: duration <= 90 ? "CONSIDER" : "THE QUESTION",
        title: `What does question number ${index + 1} reveal?`,
        anchor_text: `Anchor ${index + 1}.`,
      },
    });
    cursor += duration;
  }
  return { fps: 30, shots };
}

test("retention audit passes a four-cut, 3+4 project profile", () => {
  const projectPolicy = policy();
  const result = auditRetentionQuestions(validPlan(projectPolicy), projectPolicy);
  assert.equal(result.pass, true, result.failures.join("; "));
  assert.equal(result.hook_cut_count, 4);
  assert.equal(result.pause_question_count, 7);
  assert.equal(result.full_pause_count, 3);
  assert.equal(result.brief_accent_count, 4);
  assert.equal(result.opening_document_count, 2);
  assert.equal(result.human_first_hook, true);
});

test("the same audit supports a different three-cut, 2+3, one-document project", () => {
  const projectPolicy = policy({
    hook: { target_cut_count: 3 },
    editorial_rhythm: { full_pause_target: 2, brief_accent_target: 3 },
    opening_evidence: { kind: "official_document", target_asset_count: 1 },
  });
  const result = auditRetentionQuestions(validPlan(projectPolicy), projectPolicy);
  assert.equal(result.pass, true, result.failures.join("; "));
  assert.equal(result.hook_cut_count, 3);
  assert.equal(result.pause_question_count, 5);
  assert.equal(result.opening_document_count, 1);
});

test("retention audit rejects violations against the selected project profile", () => {
  const projectPolicy = policy();
  const plan = validPlan(projectPolicy);
  delete plan.shots[0].hook_question;
  plan.shots[0].editorial_role = "systems_context";
  plan.shots[5].emphasis_card.title = "A statement, not a question";
  plan.shots[4].evidence.kind = "image_sequence";
  plan.shots[4].evidence.image_assets.push("assets/evidence/third.png");
  const result = auditRetentionQuestions(plan, projectPolicy);
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes("hook_question")));
  assert.ok(result.failures.some((failure) => failure.includes("human context")));
  assert.ok(result.failures.some((failure) => failure.includes("not a question")));
  assert.ok(result.failures.some((failure) => failure.includes("kind=split_documents")));
  assert.ok(result.failures.some((failure) => failure.includes("2 materialized assets")));
});
