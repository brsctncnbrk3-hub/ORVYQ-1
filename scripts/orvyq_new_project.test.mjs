import test from "node:test";
import assert from "node:assert/strict";
import {
  buildScaffoldManifest,
  deriveEditorialRhythm,
} from "./orvyq_new_project.mjs";

test("new project scaffold contains only generic, isolated intake data", () => {
  const manifest = buildScaffoldManifest({
    projectId: "003-isolation-probe",
    title: "Blank Isolation Probe",
    durationMinutes: 15,
  });
  const serialized = JSON.stringify(manifest).toLowerCase();
  assert.ok(serialized.includes("003-isolation-probe"));
  assert.ok(serialized.includes("blank isolation probe"));
  const projectOneId = ["001", "the-ai-race-no-one-can-afford-to-win"].join("-");
  const projectTwoId = ["002", "the-new-war-beneath-the-ocean"].join("-");
  for (const forbidden of [
    projectOneId,
    projectTwoId,
    "scene_024_",
    "anthropic",
    "deepmind",
    "chikyu",
    "source_review_run_id\":302",
  ]) {
    assert.ok(!serialized.includes(forbidden), `scaffold leaked ${forbidden}`);
  }

  const production = manifest["config/production_profile.json"];
  assert.equal(production.status, "needs_editorial_input");
  assert.equal(production.hook.first_shot_asset, null);
  assert.equal(production.art_direction.topic, null);
  assert.equal(production.end_card.title, null);
  assert.equal(production.visual_medium_balance.graphic_card_fraction_max, 0.15);
  assert.equal(production.visual_medium_balance.full_screen_text_card_fraction_max, 0.03);

  const assets = manifest["config/editorial_asset_plan.json"];
  assert.equal(assets.project_id, "003-isolation-probe");
  assert.equal(assets.status, "needs_editorial_input");
  assert.deepEqual(assets.footage_assignments, {});
  assert.deepEqual(assets.full_footage_pool, []);

  const music = manifest["config/music_acquisition.json"];
  assert.equal(music.status, "needs_music_selection");
  assert.deepEqual(music.tracks, []);
  assert.equal(music.artist, null);

  const visualReviews = manifest["research/visual_asset_reviews.json"];
  assert.equal(visualReviews.policy.rejected_asset_global_reentry_forbidden, true);
  assert.deepEqual(visualReviews.approved_assets, []);
});

test("editorial rhythm scales with target duration inside system boundaries", () => {
  const short = deriveEditorialRhythm(8);
  const long = deriveEditorialRhythm(24);
  assert.ok(short.full_pause_target + short.brief_accent_target >= 4);
  assert.ok(long.full_pause_target + long.brief_accent_target <= 12);
  assert.ok(long.full_pause_target >= short.full_pause_target);
  assert.ok(long.brief_accent_target >= short.brief_accent_target);
});
