import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSceneShortlist,
  buildShortlistDocument,
  describeCandidate,
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
