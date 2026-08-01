import test from "node:test";
import assert from "node:assert/strict";
import {
  auditVisualRebalancePlan,
  materializeVisualRebalancePlan,
  resolveVisualRebalancePlan,
} from "./orvyq-visual-rebalance.mjs";

function shot(duration, asset_type, section_id, extra = {}) {
  return {
    duration,
    asset_type,
    section_id,
    claim_id: extra.claim_id || "CLM_001",
    ...extra,
  };
}

function primaryEvidenceAsset(overrides = {}) {
  return {
    evidence_asset_id: "EVID_OFFICIAL",
    source_ids: ["SRC_OFFICIAL"],
    source_url: "https://example.org/official-source.pdf",
    source_institution: "Official Agency",
    source_title: "Official Source Publication",
    source_date: "2026-07-31",
    content_identity: "SRC_OFFICIAL:figure-1",
    caption: "Official Agency — verified Figure 1",
    limitation: "The figure supports only the specific result shown.",
    ...overrides,
  };
}

test("rebalance decisions are exclusive, complete, and tighten-only compliant", () => {
  const shots = [
    shot(65, "footage", "SEC_01"),
    shot(22, "evidence", "SEC_01", {
      evidence: { kind: "official_document", image_assets: ["a.png"], evidence_asset_ids: ["A"] },
    }),
    shot(13, "graphic", "SEC_01", { graphic: { type: "claim_recap_card" } }),
  ];
  const plan = {
    actions: [{
      baseline_shot_index: 2,
      claim_id: "CLM_001",
      duration_seconds: 13,
      decision: "redesign",
      projected_medium: "graphic_card",
      projected_full_screen_text_card: false,
      template_id: "orvyq_single_comparison",
    }],
  };
  const result = auditVisualRebalancePlan({ shots, plan });
  assert.equal(result.pass, true, result.failures.join("; "));
  assert.equal(result.projected_fractions.graphic_card, 0.13);
});

test("missing replacement asset fails closed", () => {
  const shots = [
    shot(65, "footage", "SEC_01"),
    shot(22, "evidence", "SEC_01", {
      evidence: { kind: "official_document", image_assets: ["a.png"], evidence_asset_ids: ["A"] },
    }),
    shot(13, "graphic", "SEC_01", { graphic: { type: "claim_recap_card" } }),
  ];
  const plan = {
    actions: [{
      baseline_shot_index: 2,
      claim_id: "CLM_001",
      duration_seconds: 13,
      decision: "replace_contextual_footage",
      projected_medium: "contextual_footage",
      asset_request_id: "REQ_001",
    }],
  };
  const result = auditVisualRebalancePlan({
    shots,
    plan,
    assetRequests: [{ asset_request_id: "REQ_001", status: "pending_acquisition" }],
  });
  assert.equal(result.editorial_plan_pass, false);
  assert.match(result.failures.join("; "), /contextual footage/);
  assert.equal(result.materialization_ready, false);
});

test("materialization replaces cards with exact evidence, attribution, and footage assets", () => {
  const shots = [
    shot(8, "graphic", "SEC_01", {
      graphic: { type: "claim_recap_card" },
      narration_anchor: "Official evidence appears here.",
    }),
    shot(7, "graphic", "SEC_01", {
      graphic: { type: "claim_recap_card" },
      narration_anchor: "Physical process appears here.",
    }),
  ];
  const requests = [
    { asset_request_id: "REQ_EVD_DIRECT", status: "ready" },
    { asset_request_id: "REQ_FTG_DIRECT", status: "ready" },
  ];
  const plan = {
    status: "materialized",
    actions: [
      {
        baseline_shot_index: 0,
        claim_id: "CLM_001",
        duration_seconds: 8,
        decision: "replace_primary_evidence",
        projected_medium: "primary_evidence",
        asset_request_id: "REQ_EVD_DIRECT",
        rationale: "Use the exact official source figure for the narrated claim.",
        replacement_assets: [{
          asset_path: "assets/evidence/official.png",
          evidence_asset_id: "EVID_OFFICIAL",
          source_region: "Figure 1",
        }],
      },
      {
        baseline_shot_index: 1,
        claim_id: "CLM_001",
        duration_seconds: 7,
        decision: "replace_contextual_footage",
        projected_medium: "contextual_footage",
        asset_request_id: "REQ_FTG_DIRECT",
        rationale: "Use a physically direct process shot for the narrated action.",
        replacement_assets: [{
          asset_path: "assets/footage/direct.mp4",
          trim_in_sec: 2,
          trim_out_sec: 10,
        }],
      },
    ],
  };

  const result = materializeVisualRebalancePlan({
    shots,
    plan,
    assetRequests: requests,
    primaryEvidenceAssets: [primaryEvidenceAsset()],
  });
  assert.equal(result[0].asset_type, "evidence");
  assert.deepEqual(result[0].evidence.evidence_asset_ids, ["EVID_OFFICIAL"]);
  assert.deepEqual(result[0].evidence.source_ids, ["SRC_OFFICIAL"]);
  assert.equal(result[0].evidence.source_label, "Official Agency — 2026-07-31");
  assert.equal(result[0].evidence.title, "Official Agency — verified Figure 1");
  assert.equal(result[0].evidence.eyebrow, "OFFICIAL AGENCY — PRIMARY EVIDENCE");
  assert.equal(result[1].asset_type, "footage");
  assert.equal(result[1].asset, "assets/footage/direct.mp4");
  assert.equal(result[1].trim_in_sec, 2);
  assert.equal(result[1].trim_out_sec, 9);
  assert.equal(result[1].trim_out_sec - result[1].trim_in_sec, result[1].duration);
});

test("footage replacement fails closed when the available source window is shorter than the generated shot", () => {
  const shots = [shot(7, "graphic", "SEC_01", { graphic: { type: "claim_recap_card" } })];
  const plan = {
    status: "materialized",
    actions: [{
      baseline_shot_index: 0,
      claim_id: "CLM_001",
      duration_seconds: 7,
      decision: "replace_contextual_footage",
      projected_medium: "contextual_footage",
      asset_request_id: "REQ_FTG_DIRECT",
      rationale: "Use a physically direct process shot for the narrated action.",
      replacement_assets: [{
        asset_path: "assets/footage/direct.mp4",
        trim_in_sec: 2,
        trim_out_sec: 8.5,
      }],
    }],
  };

  assert.throws(
    () => materializeVisualRebalancePlan({
      shots,
      plan,
      assetRequests: [{ asset_request_id: "REQ_FTG_DIRECT", status: "ready" }],
    }),
    /footage replacement is shorter than the shot/,
  );
});

test("primary-evidence replacement fails closed when canonical provenance is missing", () => {
  const shots = [shot(8, "graphic", "SEC_01", { graphic: { type: "claim_recap_card" } })];
  const plan = {
    status: "materialized",
    actions: [{
      baseline_shot_index: 0,
      claim_id: "CLM_001",
      duration_seconds: 8,
      decision: "replace_primary_evidence",
      projected_medium: "primary_evidence",
      asset_request_id: "REQ_EVD_DIRECT",
      rationale: "Use the exact official source figure for the narrated claim.",
      replacement_assets: [{
        asset_path: "assets/evidence/official.png",
        evidence_asset_id: "EVID_OFFICIAL",
        source_region: "Figure 1",
      }],
    }],
  };

  assert.throws(
    () => materializeVisualRebalancePlan({
      shots,
      plan,
      assetRequests: [{ asset_request_id: "REQ_EVD_DIRECT", status: "ready" }],
      primaryEvidenceAssets: [primaryEvidenceAsset({ source_date: "" })],
    }),
    /lacks canonical provenance fields: source_date/,
  );
});

test("validated action override converts a redundant evidence beat into contiguous approved footage", () => {
  const shots = [
    shot(7, "footage", "SEC_01", {
      asset: "assets/footage/abyss.mp4",
      trim_in_sec: 1,
      trim_out_sec: 8,
      visual_role: "context",
      motion: "push",
      contextual_footage: true,
      generic_stock: false,
      semantic_link: "physical",
      semantic_rationale: "The verified abyssal view establishes the physical setting.",
    }),
    shot(6, "graphic", "SEC_01", {
      graphic: { type: "claim_recap_card" },
      narration_anchor: "The nodules formed layer by layer.",
    }),
  ];
  const plan = {
    status: "materialized",
    actions: [{
      baseline_shot_index: 1,
      claim_id: "CLM_001",
      duration_seconds: 6,
      decision: "replace_primary_evidence",
      projected_medium: "primary_evidence",
      asset_request_id: "REQ_EVD_DIRECT",
      rationale: "Use the source document.",
      replacement_assets: [{
        asset_path: "assets/evidence/official.png",
        evidence_asset_id: "EVID_OFFICIAL",
      }],
    }],
  };
  const actionOverrides = [{
    baseline_shot_index: 1,
    expected_decision: "replace_primary_evidence",
    action: {
      decision: "remove",
      projected_medium: "contextual_footage",
      replacement_strategy: "extend_adjacent_footage",
      rationale: "Continue the approved abyssal footage through the physical formation sentence.",
    },
  }];

  const result = materializeVisualRebalancePlan({ shots, plan, actionOverrides });
  assert.equal(result[1].asset_type, "footage");
  assert.equal(result[1].asset, "assets/footage/abyss.mp4");
  assert.equal(result[1].trim_in_sec, 8);
  assert.equal(result[1].trim_out_sec, 14);
  assert.equal(result[1].motion, "push");
  assert.equal(result[1].generic_stock, false);
  assert.equal(result[1].evidence, undefined);
});

test("visual-rebalance override rejects stale expected decisions", () => {
  const plan = {
    actions: [{
      baseline_shot_index: 2,
      claim_id: "CLM_001",
      duration_seconds: 6,
      decision: "redesign",
      projected_medium: "graphic_card",
    }],
  };
  assert.throws(
    () => resolveVisualRebalancePlan(plan, [{
      baseline_shot_index: 2,
      expected_decision: "replace_primary_evidence",
      action: {
        decision: "remove",
        projected_medium: "contextual_footage",
        replacement_strategy: "extend_adjacent_footage",
      },
    }]),
    /expected replace_primary_evidence, found redesign/,
  );
});

test("materialization redesigns source-derived graphic-card evidence", () => {
  const shots = [
    shot(8, "evidence", "SEC_01", {
      evidence: {
        kind: "concept_map",
        template_id: "legacy_concept_map",
        necessity: "mechanism",
        title: "A source-derived comparison",
        source_ids: ["SRC_001"],
      },
    }),
  ];
  const plan = {
    status: "materialized",
    actions: [{
      baseline_shot_index: 0,
      claim_id: "CLM_001",
      duration_seconds: 8,
      decision: "redesign",
      projected_medium: "graphic_card",
      template_id: "orvyq_single_comparison",
      rationale: "Keep one concise source-derived comparison in the cinematic design system.",
    }],
  };

  const result = materializeVisualRebalancePlan({ shots, plan });
  assert.equal(result[0].asset_type, "evidence");
  assert.equal(result[0].evidence.kind, "concept_map");
  assert.equal(result[0].evidence.template_id, "orvyq_single_comparison");
  assert.equal(result[0].evidence.design_system, "orvyq_cinematic_v1");
});
