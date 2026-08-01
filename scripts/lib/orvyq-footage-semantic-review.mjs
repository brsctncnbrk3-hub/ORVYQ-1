function normalizedShots(footageAssets, footageShots) {
  if (Array.isArray(footageShots)) return footageShots;
  return (footageAssets || []).map((asset) => ({ asset }));
}

export function auditFootageSemanticReviews({ footageAssets, footageShots, provenanceByPath, reviews }) {
  const shots = normalizedShots(footageAssets, footageShots);
  const assetPaths = [...new Set(shots.map((shot) => shot.asset))];
  const rejectedByProviderId = new Map(
    (reviews.rejected_assets || []).map((asset) => [String(asset.provider_asset_id), asset]),
  );
  const approvalsByProviderId = new Map(
    (reviews.approved_assets || []).map((asset) => [String(asset.provider_asset_id), asset]),
  );
  const failures = [];
  const rejected = [];
  const pending = [];

  for (const assetPath of assetPaths) {
    const provenance = provenanceByPath.get(assetPath);
    if (!provenance) {
      failures.push(`${assetPath}: provenance is missing`);
      continue;
    }
    const providerId = String(provenance.provider_asset_id || "");
    const rejection = rejectedByProviderId.get(providerId);
    if (rejection) {
      rejected.push({
        asset_path: assetPath,
        provider_asset_id: providerId,
        reason: rejection.reason,
      });
      failures.push(`${assetPath}: globally rejected semantic match (${rejection.reason})`);
      continue;
    }
    const approval = approvalsByProviderId.get(providerId);
    if (!approval) {
      pending.push({ asset_path: assetPath, provider_asset_id: providerId });
      failures.push(`${assetPath}: pending claim-specific contact-sheet review`);
      continue;
    }
    if (!/^[a-f0-9]{64}$/i.test(String(approval.contact_sheet_sha256 || ""))) {
      failures.push(`${assetPath}: approval lacks contact_sheet_sha256`);
    }
    if (approval.asset_sha256 !== provenance.sha256) {
      failures.push(`${assetPath}: approval does not match current asset bytes`);
    }
    const uses = shots.filter((shot) => shot.asset === assetPath);
    if (Array.isArray(footageShots)) {
      for (const shot of uses) {
        const approvedUse = (approval.approved_uses || []).find((use) =>
          use.claim_id === shot.claim_id &&
          use.narration_anchor === shot.narration_anchor
        );
        const sameClaimUse = (approval.approved_uses || []).find((use) =>
          use.claim_id === shot.claim_id && String(use.semantic_rationale || "").length >= 24
        );
        const validExtension = shot.claim_bound_extension === true &&
          String(shot.claim_bound_extension_basis || "").length >= 24 &&
          String(shot.semantic_rationale || "").length >= 24 &&
          Boolean(sameClaimUse);
        if ((!approvedUse || String(approvedUse.semantic_rationale || "").length < 24) && !validExtension) {
          failures.push(`${assetPath}: no exact approved use for ${shot.claim_id} / ${shot.narration_anchor}`);
        }
      }
    } else if (!approval.claim_id || !approval.narration_anchor || String(approval.semantic_rationale || "").length < 24) {
      failures.push(`${assetPath}: approval lacks claim_id, narration_anchor, or semantic_rationale`);
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    rejected,
    pending,
    reviewed_asset_count: assetPaths.length,
    reviewed_shot_count: shots.length,
  };
}
