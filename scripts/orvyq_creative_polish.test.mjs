import test from "node:test";
import assert from "node:assert/strict";
import {
  maximumContiguousSameFootageSeconds,
  normalizeFootageReplacements,
} from "./orvyq_creative_polish.mjs";

test("maximumContiguousSameFootageSeconds detects and separates repeated footage runs", () => {
  const repeated = [
    { asset_type: "footage", video_asset: "a.mp4", start_frame: 0, end_frame: 210 },
    { asset_type: "footage", video_asset: "a.mp4", start_frame: 210, end_frame: 420 },
    { asset_type: "footage", video_asset: "a.mp4", start_frame: 420, end_frame: 630 },
  ];
  assert.equal(maximumContiguousSameFootageSeconds(repeated, 30), 21);
  repeated[1].video_asset = "b.mp4";
  assert.equal(maximumContiguousSameFootageSeconds(repeated, 30), 7);
});

test("creative replacements come entirely from the selected project profile", () => {
  const first = normalizeFootageReplacements({
    creative_polish: {
      footage_replacements: [
        {
          shot_id: "shot_009",
          asset: "assets/footage/project-a.mp4",
          trim_in_seconds: 2.5,
          motion: "push",
          reason: "Project A editorial choice",
        },
      ],
    },
  });
  const second = normalizeFootageReplacements({
    creative_polish: {
      footage_replacements: [
        {
          shot_id: "shot_021",
          asset: "assets/footage/project-b.mp4",
          trim_in_seconds: 7,
          motion: "drift_left",
          reason: "Project B editorial choice",
        },
      ],
    },
  });

  assert.deepEqual(first, [{
    shotId: "shot_009",
    asset: "assets/footage/project-a.mp4",
    trimIn: 2.5,
    motion: "push",
    reason: "Project A editorial choice",
  }]);
  assert.equal(second[0].shotId, "shot_021");
  assert.notEqual(first[0].asset, second[0].asset);
});
