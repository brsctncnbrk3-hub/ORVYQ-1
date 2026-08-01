import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesSemanticText, semanticMatchScore, evaluateSemanticCandidate, pick } from "./orvyq_acquire_footage_demand.mjs";

const hd = (id) => ({ id, file_type: "video/mp4", width: 1920, height: 1080, link: `https://videos.pexels.com/video-files/${id}/${id}-hd.mp4` });

test("semantic terms use token and phrase boundaries instead of raw substrings", () => {
  const item = { semantic_title_constraints: { required_any_groups: [["car"]], forbidden_terms: [] } };
  assert.equal(matchesSemanticText("cargo ship at sea", item), false);
  assert.equal(matchesSemanticText("car driving at sea port", item), true);
});

test("forbidden terms also use token and phrase boundaries", () => {
  const item = { semantic_title_constraints: { required_any_groups: [["marine"]], forbidden_terms: ["lab"] } };
  assert.equal(matchesSemanticText("marine collaboration vessel", item), true);
  assert.equal(matchesSemanticText("marine lab vessel", item), false);
});

test("selection prioritizes the most specific semantic match before duration", () => {
  const item = { min_duration_seconds: 8, max_duration_seconds: 30, semantic_title_constraints: { required_any_groups: [["research", "scientific research"], ["vessel"]], forbidden_terms: [] } };
  const generic = { id: 101, duration: 12, url: "https://www.pexels.com/video/research-vessel-101/", user: { name: "Creator" }, video_files: [hd(201)] };
  const specific = { id: 102, duration: 22, url: "https://www.pexels.com/video/scientific-research-vessel-102/", user: { name: "Creator" }, video_files: [hd(202)] };
  assert.ok(semanticMatchScore(specific.url, item) > semanticMatchScore(generic.url, item));
  assert.equal(pick([generic, specific], new Set(), item).video.id, 102);
});

test("selection excludes provider assets rejected by prior review", () => {
  const item = { min_duration_seconds: 8, max_duration_seconds: 30, rejected_provider_asset_ids: ["101"], semantic_title_constraints: { required_any_groups: [["research"], ["vessel"]], forbidden_terms: [] } };
  const rejected = { id: 101, duration: 12, url: "https://www.pexels.com/video/research-vessel-101/", user: { name: "Creator" }, video_files: [hd(201)] };
  assert.equal(pick([rejected], new Set(), item), null);
});


test("semantic token matching accepts conservative singular and plural equivalents", () => {
  const item = { semantic_title_constraints: { required_any_groups: [["worker"], ["vessel"]], forbidden_terms: [] } };
  assert.equal(matchesSemanticText("workers aboard vessels", item), true);
  assert.equal(matchesSemanticText("cargo operations", { semantic_title_constraints: { required_any_groups: [["car"]], forbidden_terms: [] } }), false);
});

test("query assistance may satisfy one missing group but metadata must carry a concrete anchor", () => {
  const item = {
    semantic_title_constraints: {
      required_any_groups: [["research", "scientific"], ["vessel", "ship", "boat"]],
      forbidden_terms: ["fishing", "shipyard"],
      min_metadata_required_groups: 1,
    },
  };
  const assisted = evaluateSemanticCandidate(
    "https://www.pexels.com/video/blue-and-white-boat-at-sea-501/",
    item,
    "research vessel ocean crew",
  );
  assert.equal(assisted.metadataMatchedGroups, 1);
  assert.equal(assisted.queryMatchedGroups, 1);
  assert.equal(assisted.fullyMetadataMatched, false);
  assert.equal(evaluateSemanticCandidate(
    "https://www.pexels.com/video/fishing-boat-at-sea-502/",
    item,
    "research vessel ocean crew",
  ), null);
  assert.equal(evaluateSemanticCandidate(
    "https://www.pexels.com/video-calm-water-503/",
    item,
    "research vessel ocean crew",
  ), null);
});
