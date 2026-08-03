import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  validateAssignment,
  validateCapacityTarget,
  materializeAssignments,
  preflightPexelsSelections,
  searchPexels,
} from "./orvyq_acquire_footage_demand.mjs";

function assignedItem(overrides = {}) {
  return {
    scene_id: "scene_021",
    role: "context",
    editorial_assignment: {
      claim_id: "CLM_TEST",
      slice_index: 20,
      narration_anchor: "There is another possibility.",
      semantic_rationale: "The selected physical process directly carries the meaning of this narration anchor.",
      replace_graphic_break: true,
      expected_replacement_seconds: 8,
      motion: "hold",
      ...overrides,
    },
  };
}

test("validateAssignment requires an explicit narration anchor and stable target", () => {
  assert.deepEqual(validateAssignment(assignedItem()), { claimId: "CLM_TEST", sliceIndex: 20 });
  assert.throws(
    () => validateAssignment(assignedItem({ narration_anchor: "" })),
    /narration_anchor is required/
  );
});

test("validateCapacityTarget rejects a fixed asset count that cannot cover the measured graphics deficit", () => {
  const valid = {
    capacity_target: {
      baseline_pure_graphics_fraction: 0.274,
      maximum_pure_graphics_fraction: 0.2,
      candidate_duration_seconds: 100,
      minimum_graphic_seconds_to_replace: 7.4,
    },
    assets: [assignedItem()],
  };
  assert.equal(validateCapacityTarget(valid).planned, 8);
  assert.throws(
    () => validateCapacityTarget({ ...valid, assets: [assignedItem({ expected_replacement_seconds: 7 })] }),
    /below required/
  );
});

test("Pexels preflight reports every scene with no eligible metadata match", async () => {
  const video = {
    id: 101,
    duration: 12,
    url: "https://www.pexels.com/video/working-ship-ocean-waves-101/",
    user: { name: "Source Creator" },
    video_files: [{
      id: 201,
      file_type: "video/mp4",
      width: 1920,
      height: 1080,
      link: "https://videos.pexels.com/video-files/101/101-hd_1920_1080_30fps.mp4",
    }],
  };
  const items = [
    {
      scene_id: "scene_001",
      queries: ["working ship"],
      min_duration_seconds: 8,
      semantic_title_constraints: {
        required_any_groups: [["working"], ["ship"]],
        forbidden_terms: [],
      },
    },
    {
      scene_id: "scene_002",
      queries: ["magnet factory"],
      min_duration_seconds: 8,
      semantic_title_constraints: {
        required_any_groups: [["magnet"], ["factory"]],
        forbidden_terms: [],
      },
    },
    {
      scene_id: "scene_003",
      queries: ["underwater robot"],
      min_duration_seconds: 8,
      semantic_title_constraints: {
        required_any_groups: [["underwater"], ["robot"]],
        forbidden_terms: [],
      },
    },
  ];
  const result = await preflightPexelsSelections(
    items,
    "test-key",
    new Set(),
    {},
    async () => [video],
  );
  assert.deepEqual(result.failures, ["scene_002", "scene_003"]);
  assert.equal(result.selectedByScene.get("scene_001").selected.video.id, 101);
});

test("Pexels search retries one transient 429 and exposes quota headers", async () => {
  const responses = [
    {
      ok: false,
      status: 429,
      headers: { get: () => null },
    },
    {
      ok: true,
      status: 200,
      headers: {
        get: (name) => ({
          "x-ratelimit-limit": "200",
          "x-ratelimit-remaining": "178",
          "x-ratelimit-reset": "2000000000",
        })[name.toLowerCase()] ?? null,
      },
      json: async () => ({ videos: [{ id: 55 }] }),
    },
  ];
  const sleeps = [];
  const result = await searchPexels("research vessel", "key", 30, 1, {
    fetchFn: async () => responses.shift(),
    sleepFn: async (milliseconds) => sleeps.push(milliseconds),
    maxRetries: 1,
    maxRetryDelayMs: 1000,
  });
  assert.deepEqual(result.videos, [{ id: 55 }]);
  assert.equal(result.rate_limit.remaining, 178);
  assert.deepEqual(sleeps, [500]);
});

test("Pexels preflight keeps earlier selections and reports a later provider limit", async () => {
  const video = {
    id: 101,
    duration: 12,
    url: "https://www.pexels.com/video/working-ship-ocean-waves-101/",
    user: { name: "Source Creator" },
    video_files: [{
      id: 201,
      file_type: "video/mp4",
      width: 1920,
      height: 1080,
      link: "https://videos.pexels.com/video-files/101/101-hd.mp4",
    }],
  };
  let calls = 0;
  const searchFn = async () => {
    calls += 1;
    if (calls === 1) return { videos: [video], rate_limit: { remaining: 150 } };
    const error = new Error("Pexels search 429: underwater robot");
    error.status = 429;
    throw error;
  };
  const result = await preflightPexelsSelections([
    {
      scene_id: "scene_001",
      queries: ["working ship"],
      min_duration_seconds: 8,
      semantic_title_constraints: {
        required_any_groups: [["working"], ["ship"]],
        forbidden_terms: [],
      },
    },
    {
      scene_id: "scene_002",
      queries: ["underwater robot"],
      min_duration_seconds: 8,
      semantic_title_constraints: {
        required_any_groups: [["underwater"], ["robot"]],
        forbidden_terms: [],
      },
    },
    {
      scene_id: "scene_003",
      queries: ["research laboratory"],
      min_duration_seconds: 8,
      semantic_title_constraints: {
        required_any_groups: [["research"], ["laboratory"]],
        forbidden_terms: [],
      },
    },
  ], "key", new Set(), { request_delay_ms: 0 }, searchFn);
  assert.equal(result.selectedByScene.get("scene_001").selected.video.id, 101);
  assert.deepEqual(result.failures, ["scene_002", "scene_003"]);
  assert.equal(result.providerIssues[0].type, "rate_limited");
  assert.equal(result.providerUnavailable, true);
  assert.equal(calls, 2);
});

test("Pexels preflight reuses duplicate query pages inside one run", async () => {
  const video = {
    id: 101,
    duration: 12,
    url: "https://www.pexels.com/video/working-ship-ocean-waves-101/",
    user: { name: "Source Creator" },
    video_files: [{
      id: 201,
      file_type: "video/mp4",
      width: 1920,
      height: 1080,
      link: "https://videos.pexels.com/video-files/101/101-hd.mp4",
    }],
  };
  let calls = 0;
  const item = (scene) => ({
    scene_id: scene,
    queries: ["working ship"],
    min_duration_seconds: 8,
    semantic_title_constraints: {
      required_any_groups: [["working"], ["ship"]],
      forbidden_terms: [],
    },
  });
  const result = await preflightPexelsSelections(
    [item("scene_001"), item("scene_002")],
    "key",
    new Set(),
    { request_delay_ms: 0 },
    async () => {
      calls += 1;
      return { videos: [video], rate_limit: { remaining: 150 } };
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.requestCount, 1);
  assert.deepEqual(result.failures, ["scene_002"]);
});

test("materializeAssignments resolves the downloaded hash path and is idempotent", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orvyq-acquisition-"));
  try {
    await fs.mkdir(path.join(dir, "config"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "config", "editorial_asset_plan.json"),
      JSON.stringify({
        project_id: "002-the-new-war-beneath-the-ocean",
        footage_assignments: {},
        graphic_break_assignments: { CLM_TEST: { "20": { title: "Old filler card" } } },
        full_footage_pool: [],
      })
    );
    const plan = {
      project_id: "002-the-new-war-beneath-the-ocean",
      assets: [assignedItem()],
    };
    const records = [{
      scene_id: "scene_021",
      path: "assets/footage/scene_021_resolvedhash.mp4",
      provider_asset_id: "123",
      role: "context",
    }];

    const first = await materializeAssignments(dir, plan, records);
    assert.equal(first.replaced_graphics, 1);
    const materialized = JSON.parse(await fs.readFile(path.join(dir, "config", "editorial_asset_plan.json"), "utf8"));
    assert.equal(materialized.footage_assignments.CLM_TEST["20"].asset, records[0].path);
    assert.equal(materialized.graphic_break_assignments.CLM_TEST, undefined);

    const second = await materializeAssignments(dir, plan, records);
    assert.equal(second.replaced_graphics, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("materializeAssignments retires every use of a reacquired scene, not only its named target", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orvyq-acquisition-global-replace-"));
  try {
    await fs.mkdir(path.join(dir, "config"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "config", "editorial_asset_plan.json"),
      JSON.stringify({
        project_id: "002-the-new-war-beneath-the-ocean",
        footage_assignments: {
          CLM_A: { "0": { asset: "assets/footage/scene_021_aabbcc11.mp4" } },
          CLM_B: { "2": { asset: "assets/footage/scene_021_aabbcc11.mp4" } },
        },
        graphic_break_assignments: {},
        full_footage_pool: ["assets/footage/scene_021_aabbcc11.mp4"],
      }),
    );
    const plan = { assets: [] };
    const records = [{
      scene_id: "scene_021",
      path: "assets/footage/scene_021_ddeeff22.mp4",
      provider_asset_id: "456",
      role: "context",
    }];

    const result = await materializeAssignments(dir, plan, records);
    assert.equal(result.retired_paths, 1);
    const materialized = JSON.parse(
      await fs.readFile(path.join(dir, "config", "editorial_asset_plan.json"), "utf8"),
    );
    assert.equal(materialized.footage_assignments.CLM_A["0"].asset, records[0].path);
    assert.equal(materialized.footage_assignments.CLM_B["2"].asset, records[0].path);
    assert.deepEqual(materialized.full_footage_pool, [records[0].path]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function pexelsVideo(id, overrides = {}) {
  return {
    id,
    duration: 12,
    url: `https://www.pexels.com/video/engineers-reviewing-code-${id}/`,
    user: { name: "Source Creator" },
    video_files: [{
      id: id + 1000,
      file_type: "video/mp4",
      width: 1920,
      height: 1080,
      link: `https://videos.pexels.com/video-files/${id}/${id}-hd_1920_1080_30fps.mp4`,
    }],
    ...overrides,
  };
}

const PINNED_ITEM = {
  scene_id: "scene_001",
  queries: ["engineers reviewing code"],
  min_duration_seconds: 8,
  provider_asset_ids: ["4630103"],
  semantic_title_constraints: {
    required_any_groups: [["engineers"], ["code"]],
    forbidden_terms: [],
  },
};

test("a pinned scene downloads the inspected clip instead of re-ranking a search", async () => {
  const searched = [];
  const result = await preflightPexelsSelections(
    [PINNED_ITEM],
    "test-key",
    new Set(),
    {},
    async (query) => { searched.push(query); return [pexelsVideo(33656654)]; },
    async (providerAssetId) => ({ video: pexelsVideo(Number(providerAssetId)), rate_limit: {} }),
  );
  assert.deepEqual(result.failures, []);
  assert.equal(result.selectedByScene.get("scene_001").selected.video.id, 4630103);
  assert.equal(result.selectedByScene.get("scene_001").selectedQuery, "inspected_selection");
  // The whole point: no search ran, so no better-scoring stranger can win.
  assert.deepEqual(searched, []);
});

test("a pinned clip the provider cannot serve is unresolved, never substituted", async () => {
  const result = await preflightPexelsSelections(
    [PINNED_ITEM],
    "test-key",
    new Set(),
    {},
    async () => [pexelsVideo(33656654)],
    async () => { const error = new Error("Pexels video 404"); error.status = 404; throw error; },
  );
  assert.deepEqual(result.failures, ["scene_001"]);
  assert.equal(result.selectedByScene.has("scene_001"), false);
  assert.equal(result.providerIssues[0].type, "pinned_selection_unavailable");
});

test("a pinned clip that fails licence or duration checks is reported, not downloaded", async () => {
  const result = await preflightPexelsSelections(
    [PINNED_ITEM],
    "test-key",
    new Set(),
    {},
    async () => [pexelsVideo(33656654)],
    async (providerAssetId) => ({ video: pexelsVideo(Number(providerAssetId), { duration: 2 }), rate_limit: {} }),
  );
  assert.deepEqual(result.failures, ["scene_001"]);
  assert.equal(result.providerIssues[0].type, "pinned_selection_unusable");
});

test("an unpinned scene still resolves through the ordinary search path", async () => {
  const { provider_asset_ids, ...unpinned } = PINNED_ITEM;
  const result = await preflightPexelsSelections(
    [unpinned],
    "test-key",
    new Set(),
    {},
    async () => [pexelsVideo(33656654)],
    async () => { throw new Error("the video endpoint must not be reached for an unpinned scene"); },
  );
  assert.deepEqual(result.failures, []);
  assert.equal(result.selectedByScene.get("scene_001").selected.video.id, 33656654);
});
