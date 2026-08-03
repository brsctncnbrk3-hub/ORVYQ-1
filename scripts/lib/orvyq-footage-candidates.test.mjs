import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSceneShortlist,
  buildShortlistDocument,
  describeCandidate,
  activeRejectedPlanScenes,
  activeFootageCandidateGaps,
  prioritizeCuratedCandidates,
  resolveCandidateStage,
  resolveCandidateSelection,
  unselectedCandidateIds,
} from "./orvyq-footage-candidates.mjs";

function candidate(id, { score = 100, duration = 12, poster = `https://images.example/${id}.jpg` } = {}) {
  return {
    video: { id, url: `https://www.pexels.com/video/clip-${id}/`, duration, image: poster, user: { name: "A Creator" } },
    rendition: { width: 1920, height: 1080 },
    semanticScore: score,
    semanticMetadataFullyMatched: score > 500,
  };
}

function shortlist(sceneCandidates = [candidate(1), candidate(2), candidate(3)]) {
  return buildShortlistDocument({
    projectId: "007-a-film",
    generatedAt: "2026-08-03T00:00:00.000Z",
    limit: 6,
    scenes: [
      buildSceneShortlist({
        sceneId: "scene_001",
        claimId: "CLM_A",
        requiredVisibleContent: "An official governance setting with the institution visible.",
        queries: ["parliament exterior"],
        candidates: sceneCandidates,
        limit: 6,
      }),
    ],
  });
}

const NOTE = "Frames two and three show the chamber itself, not a lookalike national building.";

test("a candidate keeps the poster frame needed to inspect it before downloading", () => {
  const described = describeCandidate(candidate(42), { rank: 1 });
  assert.equal(described.provider_asset_id, "42");
  assert.equal(described.poster_url, "https://images.example/42.jpg");
  assert.equal(described.rank, 1);
  assert.equal(described.duration_seconds, 12);
});

test("the shortlist keeps several candidates rather than one", () => {
  const doc = shortlist();
  assert.equal(doc.scenes[0].candidate_count, 3);
  assert.deepEqual(doc.scenes[0].candidates.map((item) => item.rank), [1, 2, 3]);
  assert.match(doc.policy, /never a decision/);
});

test("a selection must name a candidate that was actually offered", () => {
  assert.throws(
    () => resolveCandidateSelection({
      shortlist: shortlist(),
      selection: {
        project_id: "007-a-film",
        selections: [{ scene_id: "scene_001", decision: "selected", provider_asset_id: "999", inspection_note: NOTE }],
      },
    }),
    /was not among the candidates offered/,
  );
});

test("a valid pick resolves to the candidate's own provenance", () => {
  const result = resolveCandidateSelection({
    shortlist: shortlist(),
    selection: {
      project_id: "007-a-film",
      selections: [{ scene_id: "scene_001", decision: "selected", provider_asset_id: "2", inspection_note: NOTE }],
    },
  });
  assert.equal(result.complete, true);
  assert.equal(result.chosen.length, 1);
  assert.equal(result.chosen[0].provider_asset_id, "2");
  assert.equal(result.chosen[0].source_page_url, "https://www.pexels.com/video/clip-2/");
});

test("choosing without saying what the frames show is refused", () => {
  assert.throws(
    () => resolveCandidateSelection({
      shortlist: shortlist(),
      selection: {
        project_id: "007-a-film",
        selections: [{ scene_id: "scene_001", decision: "selected", provider_asset_id: "1", inspection_note: "looks ok" }],
      },
    }),
    /record what the chosen frames actually show/,
  );
});

test("a scene with no fitting candidate is blocked with a reason, never filled", () => {
  const result = resolveCandidateSelection({
    shortlist: shortlist(),
    selection: {
      project_id: "007-a-film",
      selections: [{
        scene_id: "scene_001",
        decision: "blocked",
        reason: "Every candidate showed a national parliament, which would misrepresent an EU institution.",
      }],
    },
  });
  assert.equal(result.blocked.length, 1);
  assert.equal(result.chosen.length, 0);
  assert.equal(result.complete, true);
});

test("blocking without a reason is refused", () => {
  assert.throws(
    () => resolveCandidateSelection({
      shortlist: shortlist(),
      selection: { project_id: "007-a-film", selections: [{ scene_id: "scene_001", decision: "blocked", reason: "none fit" }] },
    }),
    /must record why no candidate fits/,
  );
});

test("an undecided scene is reported rather than silently passed", () => {
  const result = resolveCandidateSelection({
    shortlist: shortlist(),
    selection: { project_id: "007-a-film", selections: [] },
  });
  assert.deepEqual(result.undecided, ["scene_001"]);
  assert.equal(result.complete, false);
});

test("deciding a scene twice, or a scene not offered, is refused", () => {
  const twice = {
    project_id: "007-a-film",
    selections: [
      { scene_id: "scene_001", decision: "selected", provider_asset_id: "1", inspection_note: NOTE },
      { scene_id: "scene_001", decision: "selected", provider_asset_id: "2", inspection_note: NOTE },
    ],
  };
  assert.throws(() => resolveCandidateSelection({ shortlist: shortlist(), selection: twice }), /decided twice/);

  const unknown = {
    project_id: "007-a-film",
    selections: [{ scene_id: "scene_099", decision: "selected", provider_asset_id: "1", inspection_note: NOTE }],
  };
  assert.throws(() => resolveCandidateSelection({ shortlist: shortlist(), selection: unknown }), /not in the shortlist/);
});

test("candidates that were offered and not taken are not treated as rejected", () => {
  const doc = shortlist();
  const chosen = [{ scene_id: "scene_001", provider_asset_id: "2" }];
  assert.deepEqual(unselectedCandidateIds({ shortlist: doc, chosen }), ["1", "3"]);
});

test("a clip chosen for one scene is never counted as unselected elsewhere", () => {
  const doc = buildShortlistDocument({
    projectId: "007-a-film",
    generatedAt: "2026-08-03T00:00:00.000Z",
    limit: 6,
    scenes: [
      buildSceneShortlist({ sceneId: "scene_001", claimId: "CLM_A", requiredVisibleContent: "x", queries: [], candidates: [candidate(1), candidate(2)], limit: 6 }),
      buildSceneShortlist({ sceneId: "scene_002", claimId: "CLM_B", requiredVisibleContent: "y", queries: [], candidates: [candidate(2), candidate(3)], limit: 6 }),
    ],
  });
  const chosen = [{ scene_id: "scene_002", provider_asset_id: "2" }];
  assert.deepEqual(unselectedCandidateIds({ shortlist: doc, chosen }), ["1", "3"]);
});

test("a blocked scene becomes eligible for a still, and only a blocked scene does", () => {
  const result = resolveCandidateSelection({
    shortlist: shortlist(),
    selection: {
      project_id: "007-a-film",
      selections: [{
        scene_id: "scene_001",
        decision: "blocked",
        reason: "Every candidate showed a national parliament, which would misrepresent an EU institution.",
      }],
    },
  });
  assert.equal(result.blocked[0].still_fallback_eligible, true);

  const selected = resolveCandidateSelection({
    shortlist: shortlist(),
    selection: {
      project_id: "007-a-film",
      selections: [{ scene_id: "scene_001", decision: "selected", provider_asset_id: "1", inspection_note: NOTE }],
    },
  });
  assert.equal(selected.chosen[0].still_fallback_eligible, undefined, "a scene that found a clip is not still-eligible");
});

test("a still cannot be chosen without first inspecting clips and finding none fit", () => {
  assert.throws(
    () => resolveCandidateSelection({
      shortlist: shortlist(),
      selection: {
        project_id: "007-a-film",
        selections: [{ scene_id: "scene_001", decision: "still_fallback", provider_asset_id: "1", inspection_note: NOTE }],
      },
    }),
    /not chosen directly/,
  );
});

const replacementPlan = {
  project_id: "007-a-film",
  assets: [
    { scene_id: "scene_001", provider_asset_ids: ["10"] },
    { scene_id: "scene_002", provider_asset_ids: ["20"] },
  ],
};

function replacementShortlist() {
  return buildShortlistDocument({
    projectId: "007-a-film",
    generatedAt: "2026-08-03T00:00:00.000Z",
    limit: 6,
    selectionScope: {
      mode: "active_rejections",
      replacements: [{ scene_id: "scene_001", rejected_provider_asset_ids: ["10"] }],
    },
    scenes: [
      buildSceneShortlist({
        sceneId: "scene_001",
        claimId: "CLM_A",
        requiredVisibleContent: "An official governance setting with the institution visible.",
        queries: ["parliament exterior"],
        candidates: [candidate(11), candidate(12)],
        limit: 6,
      }),
    ],
  });
}

test("only rejected assets still pinned in the plan are active rejections", () => {
  assert.deepEqual(
    activeRejectedPlanScenes({ plan: replacementPlan, rejectedProviderAssetIds: new Set(["10", "99"]) }),
    [{ scene_id: "scene_001", rejected_provider_asset_ids: ["10"] }],
  );
});

test("a rejected pinned selection requests a replacement shortlist", () => {
  const stage = resolveCandidateStage({
    plan: replacementPlan,
    shortlist: shortlist([candidate(10), candidate(11)]),
    selection: {
      project_id: "007-a-film",
      selections: [{ scene_id: "scene_001", decision: "selected", provider_asset_id: "10", inspection_note: NOTE }],
    },
    rejectedProviderAssetIds: new Set(["10"]),
  });
  assert.equal(stage.stage, "shortlist");
  assert.equal(stage.replacement_only, true);
});

test("a current replacement board waits instead of repeatedly rebuilding", () => {
  const stage = resolveCandidateStage({
    plan: replacementPlan,
    shortlist: replacementShortlist(),
    selection: { project_id: "007-a-film", selection_status: "inspection_required", selections: [] },
    rejectedProviderAssetIds: new Set(["10"]),
  });
  assert.equal(stage.stage, "waiting");
});

test("an inspected non-rejected replacement can be applied", () => {
  const stage = resolveCandidateStage({
    plan: replacementPlan,
    shortlist: replacementShortlist(),
    selection: {
      project_id: "007-a-film",
      selections: [{ scene_id: "scene_001", decision: "selected", provider_asset_id: "11", inspection_note: NOTE }],
    },
    rejectedProviderAssetIds: new Set(["10"]),
  });
  assert.equal(stage.stage, "apply");
  assert.equal(stage.reason, "replacement_selection_inspected");
});

test("an unacquired uninspected plan scene requires a candidate board", () => {
  const plan = {
    project_id: "007-a-film",
    assets: [{
      scene_id: "scene_007",
      claim_id: "CLM_GAP",
      role: "context",
      queries: ["server room racks"],
      fallback_queries: ["data centre aisle"],
      min_duration_seconds: 8,
      editorial_note: "A real server aisle with visible racks.",
      semantic_link: "physical",
    }],
  };
  const gaps = activeFootageCandidateGaps({
    plan,
    runtime: { records: [] },
    rejectedProviderAssetIds: new Set(),
  });
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].scene_id, "scene_007");
  assert.match(gaps[0].request_signature, /^[a-f0-9]{64}$/);

  const stage = resolveCandidateStage({
    plan,
    runtime: { records: [] },
    shortlist: null,
    selection: { project_id: "007-a-film", selections: [] },
    rejectedProviderAssetIds: new Set(),
  });
  assert.equal(stage.stage, "shortlist");
  assert.equal(stage.replacement_only, true);
});

test("a requeued scene preserves its own rejected provider history", () => {
  const plan = {
    project_id: "007-a-film",
    assets: [{
      scene_id: "scene_007",
      claim_id: "CLM_GAP",
      role: "context",
      queries: ["server room racks"],
      fallback_queries: ["data centre aisle"],
      min_duration_seconds: 8,
      editorial_note: "A real server aisle with visible racks.",
      semantic_link: "physical",
      rejected_provider_asset_ids: ["old-2", "old-1"],
    }],
  };
  const gaps = activeFootageCandidateGaps({
    plan,
    runtime: { records: [] },
    rejectedProviderAssetIds: new Set(["globally-barred"]),
  });
  assert.deepEqual(gaps[0].rejected_provider_asset_ids, ["old-1", "old-2"]);
});

test("rejected history alone does not reopen an acquired inspected scene", () => {
  const plan = {
    project_id: "007-a-film",
    assets: [{
      scene_id: "scene_007",
      claim_id: "CLM_GAP",
      role: "context",
      queries: ["server room racks"],
      fallback_queries: ["data centre aisle"],
      min_duration_seconds: 8,
      editorial_note: "A real server aisle with visible racks.",
      semantic_link: "physical",
      provider_asset_ids: ["new-choice"],
      inspected_selection: { provider_asset_id: "new-choice" },
      rejected_provider_asset_ids: ["old-choice"],
    }],
  };
  const gaps = activeFootageCandidateGaps({
    plan,
    runtime: { records: [{ scene_id: "scene_007", provider_asset_id: "new-choice" }] },
    rejectedProviderAssetIds: new Set(),
  });
  assert.deepEqual(gaps, []);
});

test("human-researched provider details lead the inspectable board without becoming a selection", () => {
  const candidates = [
    { video: { id: "search-1" } },
    { video: { id: "curated-2" } },
    { video: { id: "curated-1" } },
    { video: { id: "search-2" } },
  ];
  const ranked = prioritizeCuratedCandidates(candidates, ["curated-1", "curated-2"], 3);
  assert.deepEqual(ranked.map((candidate) => candidate.video.id), ["curated-1", "curated-2", "search-1"]);
});

test("changing curated provider details invalidates an old active-gap board", () => {
  const base = {
    scene_id: "scene_007",
    claim_id: "CLM_GAP",
    role: "context",
    queries: ["server room racks"],
    fallback_queries: [],
    min_duration_seconds: 8,
    editorial_note: "A real server aisle.",
    semantic_link: "physical",
  };
  const first = activeFootageCandidateGaps({
    plan: { assets: [{ ...base, curated_provider_asset_ids: ["one"] }] },
    runtime: { records: [] },
    rejectedProviderAssetIds: new Set(),
  });
  const second = activeFootageCandidateGaps({
    plan: { assets: [{ ...base, curated_provider_asset_ids: ["two"] }] },
    runtime: { records: [] },
    rejectedProviderAssetIds: new Set(),
  });
  assert.notEqual(first[0].request_signature, second[0].request_signature);
});
