function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function byScene(a, b) {
  return String(a.scene_id || "").localeCompare(String(b.scene_id || ""));
}

function normalizeApprovedUse(use) {
  return {
    claim_id: use.claim_id,
    narration_anchor: String(use.narration_anchor || "").trim(),
    semantic_rationale: String(use.semantic_rationale || "").trim(),
    ...(Number.isFinite(use.trim_in_sec) ? { trim_in_sec: use.trim_in_sec } : {}),
    ...(Number.isFinite(use.trim_out_sec) ? { trim_out_sec: use.trim_out_sec } : {}),
  };
}

export function matchesContactSheetDecision(entry, decisionSha256) {
  const decisionHash = String(decisionSha256 || "").toLowerCase();
  if (!decisionHash) return false;
  return [entry?.contact_sheet_sha256, entry?.contact_sheet_pointer_sha256]
    .filter(Boolean)
    .some((hash) => String(hash).toLowerCase() === decisionHash);
}

function isMatchingDecision(entry, decision) {
  return Boolean(
    entry &&
    entry.scene_id === decision.scene_id &&
    String(entry.provider_asset_id) === String(decision.provider_asset_id) &&
    String(entry.asset_sha256).toLowerCase() === String(decision.asset_sha256).toLowerCase() &&
    matchesContactSheetDecision(entry, decision.contact_sheet_sha256)
  );
}

export function applyFootageVisualDecisions({ queue, decisions, reviews, runtime, requests }) {
  const projectId = runtime.project_id || queue.project_id;
  for (const [label, value] of Object.entries({ queue, decisions, reviews, requests })) {
    if (value.project_id !== projectId) throw new Error(`${label} project_id does not match ${projectId}`);
  }

  const records = runtime.records || [];
  const currentProviderIds = new Set(records.map((record) => String(record.provider_asset_id)));
  const currentByPath = new Map(records.map((record) => [record.path, record]));
  const currentByProvider = new Map(records.map((record) => [String(record.provider_asset_id), record]));
  const queueByScene = new Map((queue.entries || []).map((entry) => [entry.scene_id, entry]));
  const queueByProvider = new Map((queue.entries || []).map((entry) => [String(entry.provider_asset_id), entry]));

  const rejectedByProvider = new Map(
    (reviews.rejected_assets || []).map((asset) => [String(asset.provider_asset_id), clone(asset)]),
  );
  const approvedByProvider = new Map(
    (reviews.approved_assets || [])
      .filter((asset) => currentProviderIds.has(String(asset.provider_asset_id)))
      .map((asset) => [String(asset.provider_asset_id), clone(asset)]),
  );

  const seenScenes = new Set();
  let appliedApprovals = 0;
  let appliedRejections = 0;
  let staleDecisions = 0;

  for (const decision of decisions.decisions || []) {
    if (seenScenes.has(decision.scene_id)) throw new Error(`Duplicate footage decision for ${decision.scene_id}`);
    seenScenes.add(decision.scene_id);
    const entry = queueByScene.get(decision.scene_id);
    if (!isMatchingDecision(entry, decision)) {
      staleDecisions += 1;
      continue;
    }

    const providerId = String(decision.provider_asset_id);
    if (decision.decision === "approve") {
      const approvedUses = (entry.approved_uses_if_visually_valid || []).map(normalizeApprovedUse);
      if (!approvedUses.length) {
        throw new Error(`${decision.scene_id}: approval has no exact claim-bound use in the current review queue`);
      }
      approvedByProvider.set(providerId, {
        scene_id: decision.scene_id,
        provider_asset_id: providerId,
        asset_sha256: decision.asset_sha256,
        // Persist the canonical contact-sheet content identity. A legacy decision may match the pointer-file SHA,
        // but the resulting approval is upgraded to the Git LFS object SHA emitted by the current queue.
        contact_sheet_sha256: entry.contact_sheet_sha256,
        reviewed_frame_count: entry.reviewed_frame_count,
        approved_uses: approvedUses,
      });
      rejectedByProvider.delete(providerId);
      appliedApprovals += 1;
    } else if (decision.decision === "reject") {
      rejectedByProvider.set(providerId, {
        scene_id: decision.scene_id,
        provider_asset_id: providerId,
        source_page_url: entry.source_page_url,
        reason: decision.reason,
      });
      approvedByProvider.delete(providerId);
      appliedRejections += 1;
    } else {
      throw new Error(`${decision.scene_id}: unsupported decision ${decision.decision}`);
    }
  }

  let approvedCurrent = 0;
  let rejectedCurrent = 0;
  const pendingSceneIds = [];
  for (const record of records) {
    const providerId = String(record.provider_asset_id);
    const approval = approvedByProvider.get(providerId);
    const queueEntry = queueByProvider.get(providerId);
    const approvalMatchesCurrentBytes = Boolean(
      approval && (!queueEntry || String(approval.asset_sha256).toLowerCase() === String(queueEntry.asset_sha256).toLowerCase()),
    );
    if (approvalMatchesCurrentBytes) approvedCurrent += 1;
    else if (rejectedByProvider.has(providerId)) rejectedCurrent += 1;
    else pendingSceneIds.push(record.scene_id);
  }

  const nextRequests = clone(requests);
  for (const request of nextRequests.requests || []) {
    if (request.type !== "contextual_footage") continue;
    const paths = request.resolved_asset_paths || [];
    if (!paths.length) {
      request.status = "pending_acquisition";
      continue;
    }
    const states = paths.map((assetPath) => {
      const record = currentByPath.get(assetPath);
      if (!record) return "missing";
      const providerId = String(record.provider_asset_id);
      if (rejectedByProvider.has(providerId)) return "rejected";
      const approval = approvedByProvider.get(providerId);
      const queueEntry = queueByProvider.get(providerId);
      if (approval && (!queueEntry || approval.asset_sha256 === queueEntry.asset_sha256)) return "approved";
      return "pending";
    });
    if (states.every((state) => state === "approved")) request.status = "ready";
    else if (states.some((state) => state === "rejected" || state === "missing")) request.status = "pending_acquisition";
    else request.status = "pending_frame_review";
  }

  const nextReviews = clone(reviews);
  nextReviews.review_basis = decisions.review_basis;
  nextReviews.rejected_assets = [...rejectedByProvider.values()].sort(byScene);
  nextReviews.approved_assets = [...approvedByProvider.values()]
    .filter((asset) => currentProviderIds.has(String(asset.provider_asset_id)))
    .sort(byScene);
  nextReviews.pending_frame_review_scene_ids = [...pendingSceneIds].sort();
  nextReviews.summary = {
    pool_assets: records.length,
    rejected_from_metadata: rejectedCurrent,
    pending_frame_review: pendingSceneIds.length,
    approved: approvedCurrent,
  };

  const allRequestsReady = (nextRequests.requests || []).every((request) => request.status === "ready");
  const readyForMaterialization = rejectedCurrent === 0 && pendingSceneIds.length === 0 && allRequestsReady;

  return {
    reviews: nextReviews,
    requests: nextRequests,
    ready_for_materialization: readyForMaterialization,
    applied_approvals: appliedApprovals,
    applied_rejections: appliedRejections,
    stale_decisions: staleDecisions,
    current_provider_ids: [...currentByProvider.keys()],
  };
}
