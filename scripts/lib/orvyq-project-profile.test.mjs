import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveProjectId,
  validateProductionProfile,
} from "./orvyq-project-profile.mjs";

const system = {
  creative_limits: {
    visual_medium_balance: {
      contextual_footage_fraction_min: 0.60,
      contextual_footage_fraction_max: 0.70,
      primary_evidence_fraction_min: 0.20,
      graphic_card_fraction_max: 0.15,
      full_screen_text_card_fraction_max: 0.03,
      section_graphic_card_fraction_max: 0.25,
      maximum_consecutive_graphic_card_shots: 1,
      maximum_graphic_template_uses: 3,
      maximum_full_screen_template_uses: 2,
    },
    hook: {
      minimum_cuts: 3,
      maximum_cuts: 6,
      minimum_duration_seconds: 8,
      maximum_duration_seconds: 15,
      human_context_first_required: true,
    },
    editorial_rhythm: {
      minimum_question_beats: 4,
      maximum_question_beats: 12,
    },
    opening_evidence: {
      allowed_kinds: ["split_documents", "official_document"],
      minimum_assets: 1,
      maximum_assets: 3,
    },
  },
};

function profile(projectId, overrides = {}) {
  return {
    schema_version: "1.0",
    project_id: projectId,
    status: "ready",
    creative_profile: "orvyq-aperture-cinematic",
    visual_medium_balance: {
      contextual_footage_fraction_min: 0.60,
      contextual_footage_fraction_max: 0.70,
      primary_evidence_fraction_min: 0.20,
      graphic_card_fraction_max: 0.15,
      full_screen_text_card_fraction_max: 0.03,
      section_graphic_card_fraction_max: 0.25,
      maximum_consecutive_graphic_card_shots: 1,
      maximum_graphic_template_uses: 3,
      maximum_full_screen_template_uses: 2,
    },
    hook: {
      first_shot_role: "human_context",
      first_shot_asset: null,
      target_cut_count: 4,
      target_duration_seconds: 11,
      ...(overrides.hook || {}),
    },
    editorial_rhythm: {
      full_pause_target: 3,
      brief_accent_target: 4,
      ...(overrides.editorial_rhythm || {}),
    },
    opening_evidence: {
      kind: "split_documents",
      target_asset_count: 2,
      ...(overrides.opening_evidence || {}),
    },
    creative_polish: {
      footage_replacements: [],
    },
  };
}

test("two unrelated projects can use different valid production profiles", () => {
  const first = profile("002-ocean-depths");
  const second = profile("003-lost-city", {
    hook: { target_cut_count: 3, target_duration_seconds: 9 },
    editorial_rhythm: { full_pause_target: 2, brief_accent_target: 3 },
    opening_evidence: { kind: "official_document", target_asset_count: 1 },
  });
  assert.equal(validateProductionProfile(first, system), first);
  assert.equal(validateProductionProfile(second, system), second);
});

test("a scaffold profile blocks production until editorial input is complete", () => {
  const draft = profile("004-draft-film");
  draft.status = "needs_editorial_input";
  assert.throws(
    () => validateProductionProfile(draft, system),
    /not ready/,
  );
});

test("project id resolution never silently falls back to another video", () => {
  const previous = process.env.ORVYQ_PROJECT_ID;
  delete process.env.ORVYQ_PROJECT_ID;
  try {
    assert.throws(() => resolveProjectId({}), /project id is required/i);
    assert.equal(resolveProjectId({ "project-id": "005-new-film" }), "005-new-film");
  } finally {
    if (previous === undefined) delete process.env.ORVYQ_PROJECT_ID;
    else process.env.ORVYQ_PROJECT_ID = previous;
  }
});

test("a project may tighten shared visual limits but cannot loosen them", () => {
  const strict = profile("006-strict-film");
  strict.visual_medium_balance.graphic_card_fraction_max = 0.12;
  strict.visual_medium_balance.primary_evidence_fraction_min = 0.24;
  assert.equal(validateProductionProfile(strict, system), strict);

  const loose = profile("007-loose-film");
  loose.visual_medium_balance.graphic_card_fraction_max = 0.2;
  assert.throws(() => validateProductionProfile(loose, system), /may only be tightened/);
});
