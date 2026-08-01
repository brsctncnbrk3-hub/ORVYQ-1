import test from "node:test";
import assert from "node:assert/strict";
import { materializeVisualRebalancePlan } from "./orvyq-visual-rebalance.mjs";

const baseline = {
  duration: 5,
  claim_id: "CLM_FIXTURE",
  section_id: "SEC_FIXTURE",
  visual_role: "graphic",
  asset_type: "graphic",
  editorial_purpose: "Present a source-derived summary before replacement.",
  narration_anchor: "A fixture narration anchor.",
  semantic_rationale: "A fixture rationale long enough for validation.",
  semantic_link: "conceptual",
  graphic: { type: "comparison", title: "Fixture" },
};

const primaryEvidenceAssets = [{
  evidence_asset_id: "EVID_FIXTURE",
  source_ids: ["SRC_FIXTURE"],
  source_url: "https://example.org/fixture.pdf",
  source_institution: "Fixture Institution",
  source_title: "Fixture Primary Source",
  source_date: "2026-07-31",
  content_identity: "SRC_FIXTURE:page-1",
  caption: "Fixture Institution — verified page 1",
  limitation: "The fixture supports only the exact claim shown.",
}];

test("primary-evidence replacement emits the canonical direct_evidence semantic link", () => {
  const [shot] = materializeVisualRebalancePlan({
    shots: [baseline],
    plan: {
      status: "materialized",
      actions: [
        {
          baseline_shot_index: 0,
          claim_id: "CLM_FIXTURE",
          decision: "replace_primary_evidence",
          asset_request_id: "REQ_FIXTURE",
          rationale: "Replace the summary with the verified primary-source capture.",
          replacement_assets: [
            {
              asset_path: "assets/evidence/fixture.png",
              evidence_asset_id: "EVID_FIXTURE",
              source_region: "page 1",
            },
          ],
        },
      ],
    },
    assetRequests: [{ asset_request_id: "REQ_FIXTURE", status: "ready" }],
    primaryEvidenceAssets,
  });

  assert.equal(shot.asset_type, "evidence");
  assert.equal(shot.semantic_link, "direct_evidence");
  assert.deepEqual(shot.evidence.source_ids, ["SRC_FIXTURE"]);
  assert.equal(shot.evidence.source_label, "Fixture Institution — 2026-07-31");
});
