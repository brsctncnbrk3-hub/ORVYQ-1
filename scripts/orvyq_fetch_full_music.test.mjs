import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attributionFor,
  validateMusicAcquisitionPlan,
} from "./orvyq_fetch_full_music.mjs";

function plan(projectId = "002-sample-film") {
  return {
    schema_version: "1.0",
    project_id: projectId,
    status: "ready",
    artist: "Example Artist",
    license_name: "Example License",
    license_url: "https://license.example/terms",
    attribution_template: "{title} — {artist} — {license_name} — {license_url}",
    tracks: [
      {
        cue_id: "CUE_OPEN",
        track_id: "example_open",
        title: "Opening Track",
        source_page_url: "https://music.example/open",
        download_url: "https://music.example/open.mp3",
        approved_for_proof: true,
        approved_for_full: true,
      },
      {
        cue_id: "CUE_CLOSE",
        track_id: "example_close",
        title: "Closing Track",
        source_page_url: "https://music.example/close",
        download_url: "https://music.example/close.mp3",
        approved_for_proof: false,
        approved_for_full: true,
      },
    ],
  };
}

test("music acquisition accepts an arbitrary project's licensed cue plan", () => {
  const value = plan();
  assert.equal(validateMusicAcquisitionPlan(value, "002-sample-film"), value);
  assert.equal(new Set(value.tracks.map((track) => track.cue_id)).size, 2);
});

test("music acquisition rejects project mismatch and duplicate cue mappings", () => {
  assert.throws(
    () => validateMusicAcquisitionPlan(plan(), "003-other-film"),
    /does not match/,
  );
  const duplicate = plan();
  duplicate.tracks[1].cue_id = duplicate.tracks[0].cue_id;
  assert.throws(() => validateMusicAcquisitionPlan(duplicate), /Duplicate cue_id/);
});

test("attribution is generated from the project's template and metadata", () => {
  assert.equal(
    attributionFor(plan(), "Opening Track"),
    "Opening Track — Example Artist — Example License — https://license.example/terms",
  );
});
