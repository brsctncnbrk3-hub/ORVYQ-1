// Look before choosing.
//
// A provider search returns dozens of real candidates, each carrying a poster
// frame in the same response. The system used to score them by title text,
// take the top one unseen, download it, and only then look at the pixels --
// using that look solely to veto. So a decision made blind produced a
// permanent rejection, and every cycle burned candidates while the pool got
// worse.
//
// ORVYQ_SYSTEM.md already requires the opposite: "The real content of an
// asset must be inspected (frame-by-frame or by direct viewing, not filename
// or provider metadata alone) and its semantic relationship to the narration
// verified BEFORE assignment." This module carries the shortlist that makes
// that possible -- inspect the candidates, then choose -- and the selection
// contract that records the choice.

const SCENE_PATTERN = /^scene_\d{3}$/;

function assertScene(sceneId, label) {
  if (!SCENE_PATTERN.test(String(sceneId || ""))) throw new Error(`${label} has an invalid scene id ${sceneId}`);
}

/**
 * The shortlist entry kept for one candidate. Deliberately provider-shaped
 * metadata plus a poster frame: enough to inspect and to re-resolve the exact
 * asset later, without committing a download.
 */
export function describeCandidate(candidate, { rank }) {
  const video = candidate.video || {};
  return {
    rank,
    provider_asset_id: String(video.id),
    source_page_url: video.url || null,
    creator: video.user?.name || null,
    duration_seconds: Number(video.duration || 0),
    width: Number(candidate.rendition?.width || 0),
    height: Number(candidate.rendition?.height || 0),
    poster_url: video.image || null,
    metadata_score: Number(candidate.semanticScore || 0),
    metadata_fully_matched: candidate.semanticMetadataFullyMatched === true,
  };
}

export function buildSceneShortlist({ sceneId, claimId, requiredVisibleContent, queries, candidates, limit }) {
  assertScene(sceneId, "shortlist entry");
  const kept = candidates.slice(0, limit).map((candidate, index) => describeCandidate(candidate, { rank: index + 1 }));
  return {
    scene_id: sceneId,
    claim_id: claimId,
    required_visible_content: requiredVisibleContent,
    queries,
    candidate_count: kept.length,
    candidates: kept,
  };
}

export function buildShortlistDocument({ projectId, scenes, limit, generatedAt, selectionScope = null }) {
  const document = {
    schema_version: "1.0",
    project_id: projectId,
    generated_at: generatedAt,
    candidates_per_scene: limit,
    policy:
      "Ranked by provider metadata only. Ranking is an order to inspect, never a decision -- a clip is chosen "
      + "from its poster frames against the scene's required visible content, and a scene with no fitting "
      + "candidate is blocked rather than filled with an approximate one.",
    scene_count: scenes.length,
    scenes,
  };
  if (selectionScope) document.selection_scope = selectionScope;
  return document;
}

function sameStrings(left, right) {
  return [...new Set(left.map(String))].sort().join("\0") === [...new Set(right.map(String))].sort().join("\0");
}

/**
 * A rejection is active only while the rejected provider asset is still
 * pinned in the current plan. Rejection history is permanent, but old
 * rejections must not keep a successfully replaced scene in a retry loop.
 */
export function activeRejectedPlanScenes({ plan, rejectedProviderAssetIds }) {
  const barred = rejectedProviderAssetIds instanceof Set
    ? rejectedProviderAssetIds
    : new Set((rejectedProviderAssetIds || []).map(String));
  return (plan.assets || []).flatMap((item) => {
    const rejected = (item.provider_asset_ids || []).map(String).filter((id) => barred.has(id));
    return rejected.length ? [{ scene_id: item.scene_id, rejected_provider_asset_ids: rejected.sort() }] : [];
  });
}

function isCurrentReplacementShortlist(shortlist, activeRejections) {
  if (shortlist?.selection_scope?.mode !== "active_rejections") return false;
  const declared = shortlist.selection_scope.replacements || [];
  if (!sameStrings(declared.map((item) => item.scene_id), activeRejections.map((item) => item.scene_id))) return false;
  const declaredByScene = new Map(declared.map((item) => [item.scene_id, item.rejected_provider_asset_ids || []]));
  return activeRejections.every((item) =>
    sameStrings(declaredByScene.get(item.scene_id) || [], item.rejected_provider_asset_ids));
}

/**
 * Decide whether the workflow can apply an inspected selection, must publish
 * a replacement board, or is correctly waiting for inspection. This keeps a
 * rejected pinned asset from being re-applied forever without allowing an
 * uninspected automatic substitute.
 */
export function resolveCandidateStage({ plan, shortlist, selection, rejectedProviderAssetIds }) {
  const activeRejections = activeRejectedPlanScenes({ plan, rejectedProviderAssetIds });
  const replacementOnly = activeRejections.length > 0;
  const result = {
    stage: "shortlist",
    replacement_only: replacementOnly,
    active_rejections: activeRejections,
    reason: selection ? "selection_not_applicable" : "selection_missing",
  };

  if (!selection) {
    return result;
  }

  if (!replacementOnly) {
    return { ...result, stage: "apply", replacement_only: false, reason: "selection_available" };
  }

  const currentReplacementShortlist = isCurrentReplacementShortlist(shortlist, activeRejections);
  if (!currentReplacementShortlist) {
    return { ...result, reason: "replacement_shortlist_missing_or_stale" };
  }

  let resolved;
  try {
    resolved = resolveCandidateSelection({ shortlist, selection });
  } catch (error) {
    return { ...result, reason: `selection_invalid: ${error.message}` };
  }

  if (!resolved.complete) {
    return { ...result, stage: "waiting", reason: "replacement_inspection_required" };
  }

  const barred = rejectedProviderAssetIds instanceof Set
    ? rejectedProviderAssetIds
    : new Set((rejectedProviderAssetIds || []).map(String));
  const selectedRejected = resolved.chosen.filter((item) => barred.has(String(item.provider_asset_id)));
  if (selectedRejected.length) {
    return { ...result, reason: "selection_reuses_rejected_asset" };
  }

  return { ...result, stage: "apply", reason: "replacement_selection_inspected" };
}

/**
 * Validates a project-authored selection against the shortlist it was made
 * from. A pick must name a candidate that was actually offered, and a scene
 * with nothing fitting must say so with a reason rather than going silent.
 */
export function resolveCandidateSelection({ shortlist, selection }) {
  if (selection.project_id !== shortlist.project_id) {
    throw new Error(`selection project_id ${selection.project_id} does not match shortlist ${shortlist.project_id}`);
  }

  const shortlistByScene = new Map(shortlist.scenes.map((scene) => [scene.scene_id, scene]));
  const decisionByScene = new Map();
  for (const [index, decision] of (selection.selections || []).entries()) {
    assertScene(decision.scene_id, `selection[${index}]`);
    if (decisionByScene.has(decision.scene_id)) {
      throw new Error(`${decision.scene_id} is decided twice in the selection`);
    }
    decisionByScene.set(decision.scene_id, decision);
  }

  const chosen = [];
  const blocked = [];
  const undecided = [];

  for (const scene of shortlist.scenes) {
    const decision = decisionByScene.get(scene.scene_id);
    if (!decision) {
      undecided.push(scene.scene_id);
      continue;
    }

    if (decision.decision === "blocked") {
      if (String(decision.reason || "").trim().length < 24) {
        throw new Error(`${scene.scene_id}: a blocked scene must record why no candidate fits`);
      }
      blocked.push({
        scene_id: scene.scene_id,
        claim_id: scene.claim_id,
        reason: decision.reason,
        // A moved still is the last resort for a claim with no filmable
        // referent. It is only reachable from here -- a scene whose clip
        // candidates were inspected and found unfit -- so it can never be
        // taken by skipping the looking.
        still_fallback_eligible: true,
      });
      continue;
    }

    if (decision.decision === "still_fallback") {
      throw new Error(
        `${scene.scene_id}: a still fallback is not chosen directly -- block the scene with the reason no clip fits, `
          + "then author the still against its own candidate board",
      );
    }

    if (decision.decision !== "selected") {
      throw new Error(`${scene.scene_id}: unsupported decision ${decision.decision || "(missing)"}`);
    }

    const providerAssetId = String(decision.provider_asset_id || "");
    const candidate = scene.candidates.find((item) => item.provider_asset_id === providerAssetId);
    if (!candidate) {
      throw new Error(
        `${scene.scene_id}: ${providerAssetId || "(no provider_asset_id)"} was not among the candidates offered for this scene`,
      );
    }
    if (String(decision.inspection_note || "").trim().length < 24) {
      throw new Error(`${scene.scene_id}: record what the chosen frames actually show`);
    }
    chosen.push({
      scene_id: scene.scene_id,
      claim_id: scene.claim_id,
      provider_asset_id: providerAssetId,
      source_page_url: candidate.source_page_url,
      duration_seconds: candidate.duration_seconds,
      inspection_note: decision.inspection_note,
    });
  }

  const unknownScenes = [...decisionByScene.keys()].filter((sceneId) => !shortlistByScene.has(sceneId));
  if (unknownScenes.length) {
    throw new Error(`selection decides scenes that are not in the shortlist: ${unknownScenes.join(", ")}`);
  }

  return { chosen, blocked, undecided, complete: undecided.length === 0 };
}

/**
 * Candidates that were offered and not taken. They were never judged unfit --
 * a different clip simply fitted better -- so they must stay available to
 * later scenes and later rebuilds. Only a clip rejected on its own content
 * earns a permanent bar.
 */
export function unselectedCandidateIds({ shortlist, chosen }) {
  const takenByScene = new Map(chosen.map((item) => [item.scene_id, item.provider_asset_id]));
  const unselected = new Set();
  for (const scene of shortlist.scenes) {
    const taken = takenByScene.get(scene.scene_id);
    for (const candidate of scene.candidates) {
      if (candidate.provider_asset_id !== taken) unselected.add(candidate.provider_asset_id);
    }
  }
  for (const item of chosen) unselected.delete(item.provider_asset_id);
  return [...unselected].sort();
}
