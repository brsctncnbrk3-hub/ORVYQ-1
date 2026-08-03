// Turns a footage-coverage shortfall into blocked acquisition requests.
//
// ORVYQ_SYSTEM.md section 6: "If the existing pool has no semantically
// fitting visual, the system records a blocked asset request; it does not
// insert an approximate clip or automatically author a decorative graphic."
// A shortfall against the contextual-footage floor is exactly that case, one
// claim at a time, so the system records the requests rather than leaving a
// human to translate a percentage into an acquisition list.

const SCENE_ID_PATTERN = /^scene_(\d{3})$/;

function nextSceneNumber(existingSceneIds) {
  const numbers = existingSceneIds
    .map((sceneId) => SCENE_ID_PATTERN.exec(String(sceneId))?.[1])
    .filter(Boolean)
    .map(Number);
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

function sceneId(number) {
  if (number > 999) throw new Error("Scene ids are exhausted; a project cannot hold more than 999 scenes");
  return `scene_${String(number).padStart(3, "0")}`;
}

/**
 * Builds the additional scenes a shortfall calls for, carrying each claim's
 * already-reviewed semantic direction forward so acquisition searches for the
 * same thing the claim was approved for -- never a fresh guess.
 */
export function planCoverageAcquisition({
  requiredAdditionalScenes,
  semanticConstraints,
  acquisitionPlan,
  existingSceneIds,
  shortfallSummary = {},
}) {
  const scenesByClaim = new Map();
  for (const [id, constraint] of Object.entries(semanticConstraints?.scenes || {})) {
    const list = scenesByClaim.get(constraint.claim_id) || [];
    list.push({ scene_id: id, ...constraint });
    scenesByClaim.set(constraint.claim_id, list);
  }
  const planByScene = new Map((acquisitionPlan?.assets || []).map((asset) => [asset.scene_id, asset]));

  let cursor = nextSceneNumber(existingSceneIds);
  const scenes = [];

  for (const { claim_id: claimId, additional_approved_scenes: count } of requiredAdditionalScenes) {
    const reviewed = scenesByClaim.get(claimId) || [];
    if (!reviewed.length) {
      throw new Error(
        `${claimId} needs more contextual footage but has no reviewed semantic constraint to acquire against`,
      );
    }
    for (let index = 0; index < count; index += 1) {
      // Rotate through the claim's reviewed scenes so a claim needing two
      // more clips asks for two different looks rather than the same one.
      const template = reviewed[index % reviewed.length];
      const templatePlan = planByScene.get(template.scene_id) || {};
      const id = sceneId(cursor);
      cursor += 1;
      scenes.push({
        scene_id: id,
        claim_id: claimId,
        role: templatePlan.role || "context",
        semantic_link: template.semantic_link || "physical",
        required_visible_content: template.required_visible_content,
        forbidden_content: template.forbidden_content || [],
        queries: templatePlan.queries || [],
        fallback_queries: templatePlan.fallback_queries || [],
        min_duration_seconds: Number(templatePlan.min_duration_seconds || 8),
        modelled_on_scene_id: template.scene_id,
      });
    }
  }

  return { scenes, shortfall: shortfallSummary };
}

/**
 * Adds the planned scenes to visual_asset_requests.json, footage_semantic_-
 * constraints.json and footage_acquisition_plan.json. Idempotent: a claim
 * that already carries an unresolved coverage request is not asked twice.
 */
export function applyCoverageAcquisition({ scenes, requests, semanticConstraints, acquisitionPlan }) {
  const nextRequests = structuredClone(requests);
  const nextConstraints = structuredClone(semanticConstraints);
  const nextPlan = structuredClone(acquisitionPlan);

  const unresolvedClaims = new Set(
    (nextRequests.requests || [])
      .filter((request) => request.status !== "ready")
      .flatMap((request) => request.claim_ids || []),
  );

  const added = [];
  for (const scene of scenes) {
    // A claim already waiting on acquisition must not be asked twice.
    if (unresolvedClaims.has(scene.claim_id)) continue;
    const requestId = `REQ_FTG_${scene.scene_id.toUpperCase()}`;
    if ((nextRequests.requests || []).some((request) => request.asset_request_id === requestId)) {
      // Reusing a live scene id would rebind an already-approved clip to a
      // different claim. Fail loudly rather than skip: a silently dropped
      // request looks exactly like a satisfied one.
      throw new Error(
        `${scene.scene_id} is already requested; coverage scene ids were allocated against an incomplete scene list`,
      );
    }

    nextRequests.requests.push({
      asset_request_id: requestId,
      type: "contextual_footage",
      status: "pending_acquisition",
      claim_ids: [scene.claim_id],
      scene_ids: [scene.scene_id],
      required_source: "licensed stock footage acquired and frame-reviewed for this claim",
      required_content: scene.required_visible_content,
      acceptance:
        "Approved only after four-position contact-sheet inspection confirms the visible content matches this "
        + "claim's narration beat; provider metadata alone is not sufficient.",
      forbidden_substitutes: scene.forbidden_content.length
        ? scene.forbidden_content
        : ["footage acquired for a different claim"],
    });

    nextConstraints.scenes[scene.scene_id] = {
      claim_id: scene.claim_id,
      required_visible_content: scene.required_visible_content,
      forbidden_content: scene.forbidden_content,
      narration_anchor: "To be resolved from fixed narration alignment",
      semantic_link: scene.semantic_link,
    };

    nextPlan.assets.push({
      scene_id: scene.scene_id,
      claim_id: scene.claim_id,
      role: scene.role,
      queries: scene.queries,
      fallback_queries: scene.fallback_queries,
      min_duration_seconds: scene.min_duration_seconds,
      editorial_note: scene.required_visible_content,
      narration_anchor: "To be resolved from fixed voice_script.txt during alignment",
      semantic_link: scene.semantic_link,
      semantic_rationale: scene.required_visible_content,
    });

    added.push(scene);
  }

  if (added.length) {
    nextRequests.request_revision = Number(nextRequests.request_revision || 1) + 1;
    nextConstraints.request_revision = Number(nextConstraints.request_revision || 1) + 1;
  }

  return { requests: nextRequests, semanticConstraints: nextConstraints, acquisitionPlan: nextPlan, added };
}
