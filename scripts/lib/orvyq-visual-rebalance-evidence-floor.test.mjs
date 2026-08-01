import test from "node:test";
import assert from "node:assert/strict";
import { materializeVisualRebalancePlan } from "./orvyq-visual-rebalance.mjs";

const evidenceShot = (claimId, duration = 4) => ({
  claim_id: claimId,
  duration,
  asset_type: "evidence",
  visual_role: "evidence",
  evidence: { kind: "comparison", source_ids: ["SRC_1"], source_label: "Source" },
});

const footageShot = (claimId, duration = 4) => ({
  claim_id: claimId,
  duration,
  asset_type: "footage",
  asset: "assets/footage/original.mp4",
  trim_in_sec: 0,
  trim_out_sec: duration,
});

const footageAction = (index, claimId, requestId) => ({
  baseline_shot_index: index,
  claim_id: claimId,
  decision: "replace_contextual_footage",
  projected_medium: "contextual_footage",
  asset_request_id: requestId,
  replacement_assets: [{ asset_path: "assets/footage/replacement.mp4", trim_in_sec: 0, trim_out_sec: 12 }],
  rationale: "Use reviewed contextual footage.",
});

test("preserves the last source-backed evidence beat for a claim", () => {
  const result = materializeVisualRebalancePlan({
    shots: [footageShot("CLM_A", 5), evidenceShot("CLM_A", 3)],
    plan: { status: "materialized", actions: [footageAction(1, "CLM_A", "REQ_A")] },
    assetRequests: [{ asset_request_id: "REQ_A", status: "ready" }],
    actionOverrides: [],
  });
  assert.equal(result[1].asset_type, "evidence");
  assert.deepEqual(result[1].evidence.source_ids, ["SRC_1"]);
});

test("allows a replacement when another source-backed beat remains", () => {
  const result = materializeVisualRebalancePlan({
    shots: [evidenceShot("CLM_A", 3), evidenceShot("CLM_A", 5)],
    plan: { status: "materialized", actions: [footageAction(0, "CLM_A", "REQ_A")] },
    assetRequests: [{ asset_request_id: "REQ_A", status: "ready" }],
    actionOverrides: [],
  });
  assert.equal(result[0].asset_type, "footage");
  assert.equal(result[1].asset_type, "evidence");
});

test("allows old evidence removal when the same claim gains primary evidence", () => {
  const result = materializeVisualRebalancePlan({
    shots: [evidenceShot("CLM_A", 3), footageShot("CLM_A", 5)],
    plan: {
      status: "materialized",
      actions: [
        footageAction(0, "CLM_A", "REQ_FTG"),
        {
          baseline_shot_index: 1,
          claim_id: "CLM_A",
          decision: "replace_primary_evidence",
          projected_medium: "primary_evidence",
          asset_request_id: "REQ_EVD",
          replacement_assets: [{
            asset_path: "assets/evidence/source.png",
            evidence_asset_id: "EVID_1",
            source_region: "page 1",
          }],
          rationale: "Use the primary source.",
        },
      ],
    },
    assetRequests: [
      { asset_request_id: "REQ_FTG", status: "ready" },
      { asset_request_id: "REQ_EVD", status: "ready" },
    ],
    primaryEvidenceAssets: [{
      evidence_asset_id: "EVID_1",
      source_ids: ["SRC_2"],
      source_institution: "Institution",
      source_title: "Official source",
      source_date: "2026-01-01",
      source_url: "https://example.test/source",
      content_identity: "official page",
      caption: "Official source page",
      limitation: "Supports only the displayed claim.",
    }],
    actionOverrides: [],
  });
  assert.equal(result[0].asset_type, "footage");
  assert.equal(result[1].asset_type, "evidence");
  assert.deepEqual(result[1].evidence.source_ids, ["SRC_2"]);
});
